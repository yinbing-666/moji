#!/usr/bin/env python3
"""Privacy-first ActivityWatch analytics and offline report generator.

Uses only the Python standard library. Raw titles and full URLs are held in
memory only while matching and never written to generated artifacts.
"""

from __future__ import annotations

import argparse
import copy
import html
import json
import math
import os
import platform
import re
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


VERSION = "1.0.0"
LEVEL_POINTS = {
    "focus": 100,
    "other_work": 75,
    "neutral": 50,
    "personal": 25,
    "distracting": 0,
}
LEVEL_ORDER = ["focus", "other_work", "neutral", "personal", "distracting"]
LEVEL_COLORS = {
    "focus": "#34d399",
    "other_work": "#3b82f6",
    "neutral": "#8b5cf6",
    "personal": "#f59e0b",
    "distracting": "#f05d4f",
}
CATEGORY_COLORS = ["#3bd16f", "#4488ff", "#8b5cf6", "#36c5d0", "#f5b51b", "#f05d4f", "#94a3b8", "#ec4899"]
BROWSER_APPS = {
    "Google Chrome", "Google-chrome", "chrome.exe", "Chromium", "chromium.exe",
    "Brave Browser", "brave.exe", "Firefox", "firefox.exe", "Safari",
    "Microsoft Edge", "msedge.exe", "Arc", "Arc.exe", "Vivaldi", "Opera",
}
AI_TERMS = (
    "chatgpt", "openai", "claude", "anthropic", "gemini", "copilot", "cursor",
    "perplexity", "deepseek", "通义", "豆包", "kimi", "元宝", "ai 助手", "ai助手",
)
FOCUS_TERMS = (
    "program", "coding", "development", "software", "writing", "research", "design",
    "study", "learning", "deep work", "work", "编程", "开发", "写作", "研究", "设计",
    "学习", "深度工作", "工作", "创作", "阅读",
)
OTHER_WORK_TERMS = (
    "email", "meeting", "communication", "collaboration", "admin", "planning",
    "邮件", "会议", "沟通", "协作", "管理", "计划",
)
PERSONAL_TERMS = (
    "music", "video", "media", "entertainment", "social", "personal", "shopping",
    "音乐", "视频", "媒体", "娱乐", "社交", "个人", "购物",
)
DISTRACTING_TERMS = ("gaming", "games", "game", "casino", "游戏", "赌博")


class AnalyticsError(RuntimeError):
    pass


def local_tz():
    return datetime.now().astimezone().tzinfo or timezone.utc


def parse_datetime(value: str) -> datetime:
    value = value.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=local_tz())
    return dt


def iso(dt: datetime) -> str:
    return dt.astimezone().isoformat(timespec="seconds")


def event_bounds(event: Dict[str, Any]) -> Tuple[datetime, datetime]:
    start = parse_datetime(str(event["timestamp"]))
    duration = max(0.0, float(event.get("duration", 0) or 0))
    return start, start + timedelta(seconds=duration)


def normalize_event(event: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "timestamp": iso(parse_datetime(str(event["timestamp"]))),
        "duration": max(0.0, float(event.get("duration", 0) or 0)),
        "data": dict(event.get("data") or {}),
    }


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(value, fh, ensure_ascii=False, indent=2, sort_keys=False)
        fh.write("\n")


def safe_slug(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    return value.strip("-") or "report"


def seconds_human(seconds: float, locale: str = "zh-CN") -> str:
    seconds = max(0, int(round(seconds)))
    hours, rem = divmod(seconds, 3600)
    minutes = rem // 60
    if locale == "zh-CN":
        if hours:
            return f"{hours}小时{minutes}分" if minutes else f"{hours}小时"
        return f"{minutes}分钟"
    if hours:
        return f"{hours}h {minutes}m" if minutes else f"{hours}h"
    return f"{minutes}m"


def pct(part: float, total: float) -> float:
    return round(100.0 * part / total, 1) if total > 0 else 0.0


def pct_change(current: float, previous: float) -> Optional[float]:
    if previous <= 0:
        return None
    return round(100.0 * (current - previous) / previous, 1)


def mean(values: Sequence[float]) -> Optional[float]:
    return round(statistics.fmean(values), 3) if values else None


class ApiClient:
    def __init__(self, base: str, timeout: float = 30.0, token: Optional[str] = None):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.token = token

    def request(self, method: str, endpoint: str, payload: Any = None) -> Any:
        url = f"{self.base}/api/0/{endpoint.lstrip('/')}"
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise AnalyticsError("ActivityWatch API requires a local token; pass --api-token or update the local client configuration.") from exc
            raise AnalyticsError(f"ActivityWatch API returned HTTP {exc.code} for {endpoint}.") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise AnalyticsError(f"Cannot connect to ActivityWatch at {self.base}.") from exc
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise AnalyticsError(f"ActivityWatch returned invalid JSON for {endpoint}.") from exc

    def get(self, endpoint: str) -> Any:
        return self.request("GET", endpoint)

    def post(self, endpoint: str, payload: Any) -> Any:
        return self.request("POST", endpoint, payload)


def platform_root() -> Optional[Path]:
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "activitywatch"
    if system == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        return Path(local) / "activitywatch" if local else None
    return None


def find_settings_file(explicit: Optional[str] = None) -> Optional[Path]:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if not path.is_file():
            raise AnalyticsError(f"Settings file does not exist: {path}")
        return path
    root = platform_root()
    if not root:
        return None
    candidates = [
        root / "aw-server" / "settings.json",
        root / "aw-server-rust" / "settings.json",
        root / "settings.json",
    ]
    existing = [path for path in candidates if path.is_file()]
    if not existing:
        return None
    return max(existing, key=lambda path: path.stat().st_mtime)


def discover_api_base(explicit: Optional[str] = None) -> str:
    if explicit:
        return explicit.rstrip("/")
    root = platform_root()
    if root:
        candidates = [
            root / "aw-client" / "aw-client.toml",
            root / "aw-server" / "aw-server.toml",
            root / "aw-server-rust" / "aw-server.toml",
        ]
        for path in candidates:
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            host_match = re.search(r"(?m)^\s*(?:hostname|host)\s*=\s*[\"']([^\"']+)", text)
            port_match = re.search(r"(?m)^\s*port\s*=\s*[\"']?(\d+)", text)
            if port_match:
                host = host_match.group(1) if host_match else "127.0.0.1"
                if host in {"localhost", "0.0.0.0", "::"}:
                    host = "127.0.0.1"
                return f"http://{host}:{port_match.group(1)}"
    return "http://127.0.0.1:5600"


def merge_category_sets(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    classes = settings.get("classes")
    if isinstance(classes, list) and classes:
        return [dict(item) for item in classes if isinstance(item, dict)]
    sets = settings.get("category_sets") or []
    active = settings.get("active_set_ids") or ["default"]
    by_id = {item.get("id"): item for item in sets if isinstance(item, dict)}
    merged: List[Dict[str, Any]] = []
    seen = set()
    for set_id in active:
        for category in (by_id.get(set_id) or {}).get("categories", []):
            name = category.get("name") or []
            key = json.dumps(name, ensure_ascii=False)
            if key not in seen:
                seen.add(key)
                merged.append(dict(category))
    return merged


def categories_for_query(categories: Sequence[Dict[str, Any]]) -> List[Any]:
    result = []
    for category in categories:
        name = category.get("name")
        rule = category.get("rule") or {"type": "none"}
        if isinstance(name, list) and name and rule.get("type") != "none":
            result.append([name, rule])
    return result


def choose_bucket(buckets: Dict[str, Dict[str, Any]], prefix: str, host: Optional[str]) -> Optional[str]:
    candidates = []
    for bucket_id, meta in buckets.items():
        if not bucket_id.startswith(prefix):
            continue
        hostname = str(meta.get("hostname") or "")
        host_match = not host or hostname == host or bucket_id.endswith("_" + host) or bucket_id.endswith("-" + host)
        candidates.append((host_match, str(meta.get("last_updated") or meta.get("created") or ""), bucket_id))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][2]


def browser_buckets(buckets: Dict[str, Dict[str, Any]], host: Optional[str]) -> List[str]:
    result = []
    for bucket_id, meta in buckets.items():
        kind = str(meta.get("type") or "")
        if "watcher-web" not in bucket_id and "web.tab.current" not in kind:
            continue
        hostname = str(meta.get("hostname") or "")
        if host and hostname and hostname != host and not bucket_id.endswith("_" + host):
            continue
        result.append(bucket_id)
    return sorted(result)


def parse_start_of_day(settings: Dict[str, Any]) -> Tuple[int, int]:
    value = str(settings.get("startOfDay") or "04:00")
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", value)
    if not match:
        return 4, 0
    return min(23, int(match.group(1))), min(59, int(match.group(2)))


def day_start_for(moment: datetime, start_hour: int, start_minute: int) -> datetime:
    local = moment.astimezone(local_tz())
    start = local.replace(hour=start_hour, minute=start_minute, second=0, microsecond=0)
    if local < start:
        start -= timedelta(days=1)
    return start


def resolve_period(spec: str, settings: Dict[str, Any], now: Optional[datetime] = None) -> Tuple[datetime, datetime, str]:
    now = (now or datetime.now().astimezone()).astimezone(local_tz())
    hour, minute = parse_start_of_day(settings)
    today = day_start_for(now, hour, minute)
    if spec == "today":
        return today, now, today.date().isoformat()
    if spec == "yesterday":
        return today - timedelta(days=1), today, (today - timedelta(days=1)).date().isoformat()
    start_week_name = str(settings.get("startOfWeek") or "Monday").lower()
    week_index = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}.get(start_week_name, 0)
    week_start = today - timedelta(days=(today.weekday() - week_index) % 7)
    if spec == "this-week":
        return week_start, now, f"{week_start.date().isoformat()}_to_{now.date().isoformat()}"
    if spec == "last-week":
        return week_start - timedelta(days=7), week_start, f"{(week_start - timedelta(days=7)).date().isoformat()}_to_{(week_start - timedelta(seconds=1)).date().isoformat()}"
    if "/" in spec:
        left, right = spec.split("/", 1)
        start = parse_datetime(left)
        end = parse_datetime(right)
        if end <= start:
            raise AnalyticsError("The period end must be after the start.")
        return start, end, f"{start.date().isoformat()}_to_{end.date().isoformat()}"
    raise AnalyticsError(f"Unsupported period: {spec}")


def build_canonical_query(window_bucket: str, afk_bucket: Optional[str], categories: Sequence[Dict[str, Any]]) -> str:
    query_categories = json.dumps(categories_for_query(categories), ensure_ascii=False)
    query_categories = re.sub(r"\\\\", r"\\", query_categories)
    lines = [f'events = flood(query_bucket("{window_bucket}"));']
    if afk_bucket:
        lines.extend([
            f'not_afk = flood(query_bucket("{afk_bucket}"));',
            'not_afk = filter_keyvals(not_afk, "status", ["not-afk"]);',
            "events = filter_period_intersect(events, not_afk);",
        ])
    if query_categories != "[]":
        lines.append(f"events = categorize(events, {query_categories});")
    lines.append("RETURN = events;")
    return "\n".join(lines)


def api_query_periods(client: ApiClient, query: str, periods: Sequence[Tuple[datetime, datetime]]) -> List[List[Dict[str, Any]]]:
    body = {
        "timeperiods": [f"{iso(start)}/{iso(end)}" for start, end in periods],
        "query": query.splitlines(),
    }
    response = client.post("query/", body)
    if not isinstance(response, list):
        raise AnalyticsError("Unexpected ActivityWatch Query API response.")
    normalized = []
    for result in response:
        normalized.append([normalize_event(event) for event in (result or [])])
    while len(normalized) < len(periods):
        normalized.append([])
    return normalized


def api_get_events(client: ApiClient, bucket_id: str, start: datetime, end: datetime) -> List[Dict[str, Any]]:
    params = urllib.parse.urlencode({"start": iso(start), "end": iso(end), "limit": -1})
    result = client.get(f"buckets/{urllib.parse.quote(bucket_id, safe='')}/events?{params}")
    return [normalize_event(event) for event in (result or [])]


def extract_export_buckets(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    buckets = payload.get("buckets", payload)
    if not isinstance(buckets, dict):
        raise AnalyticsError("The export does not contain a buckets object.")
    normalized = {}
    for bucket_id, bucket in buckets.items():
        if not isinstance(bucket, dict):
            continue
        item = dict(bucket)
        item.setdefault("id", bucket_id)
        item["events"] = [normalize_event(event) for event in (item.get("events") or [])]
        normalized[bucket_id] = item
    return normalized


def clip_events(events: Sequence[Dict[str, Any]], start: datetime, end: datetime) -> List[Dict[str, Any]]:
    result = []
    for event in events:
        e_start, e_end = event_bounds(event)
        left, right = max(e_start, start), min(e_end, end)
        if right <= left:
            continue
        item = copy.deepcopy(event)
        item["timestamp"] = iso(left)
        item["duration"] = (right - left).total_seconds()
        result.append(item)
    return sorted(result, key=lambda item: parse_datetime(item["timestamp"]))


def status_duration(events: Sequence[Dict[str, Any]], status: str) -> float:
    """Sum watcher status events after callers have clipped them to a period."""
    return round(sum(
        float(event.get("duration", 0) or 0)
        for event in events
        if str((event.get("data") or {}).get("status") or "") == status
    ), 3)


def intersect_events(events: Sequence[Dict[str, Any]], masks: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    source = sorted(events, key=lambda item: event_bounds(item)[0])
    intervals = sorted((event_bounds(item) for item in masks), key=lambda pair: pair[0])
    result: List[Dict[str, Any]] = []
    j = 0
    for event in source:
        start, end = event_bounds(event)
        while j < len(intervals) and intervals[j][1] <= start:
            j += 1
        k = j
        while k < len(intervals) and intervals[k][0] < end:
            left, right = max(start, intervals[k][0]), min(end, intervals[k][1])
            if right > left:
                item = copy.deepcopy(event)
                item["timestamp"] = iso(left)
                item["duration"] = (right - left).total_seconds()
                result.append(item)
            k += 1
    return result


def compiled_rules(categories: Sequence[Dict[str, Any]]) -> Tuple[List[Tuple[Dict[str, Any], re.Pattern]], List[Dict[str, Any]]]:
    result = []
    issues = []
    for category in categories:
        name = category.get("name") or []
        path = " / ".join(str(part) for part in name)
        rule = category.get("rule") or {}
        if rule.get("type") != "regex":
            continue
        pattern = str(rule.get("regex") or "")
        if not pattern:
            issues.append({"category": path, "issue": "empty_regex"})
            continue
        flags = re.IGNORECASE if rule.get("ignore_case") else 0
        try:
            result.append((category, re.compile(pattern, flags)))
        except re.error as exc:
            issues.append({"category": path, "issue": "invalid_regex", "detail": str(exc)})
    return result, issues


def matching_categories(event: Dict[str, Any], rules: Sequence[Tuple[Dict[str, Any], re.Pattern]]) -> List[Dict[str, Any]]:
    data = event.get("data") or {}
    app = str(data.get("app") or "")
    title = str(data.get("title") or "")
    matches = []
    for category, pattern in rules:
        if pattern.search(app) or pattern.search(title):
            matches.append(category)
    return matches


def categorize_events(events: Sequence[Dict[str, Any]], categories: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rules, _ = compiled_rules(categories)
    result = []
    for event in events:
        item = copy.deepcopy(event)
        existing = (item.get("data") or {}).get("$category")
        if not existing:
            matches = matching_categories(item, rules)
            matches.sort(key=lambda category: len(category.get("name") or []), reverse=True)
            item.setdefault("data", {})["$category"] = (matches[0].get("name") if matches else ["Uncategorized"])
        result.append(item)
    return result


def offline_period_events(
    buckets: Dict[str, Dict[str, Any]], window_bucket: str, afk_bucket: Optional[str],
    categories: Sequence[Dict[str, Any]], periods: Sequence[Tuple[datetime, datetime]],
) -> List[List[Dict[str, Any]]]:
    window_events = buckets[window_bucket].get("events") or []
    afk_events = buckets.get(afk_bucket or "", {}).get("events") or []
    result = []
    for start, end in periods:
        events = clip_events(window_events, start, end)
        if afk_bucket:
            not_afk = [event for event in clip_events(afk_events, start, end) if str((event.get("data") or {}).get("status")) == "not-afk"]
            events = intersect_events(events, not_afk)
        result.append(categorize_events(events, categories))
    return result


def split_duration_by_hour(event: Dict[str, Any], hourly: List[float]) -> None:
    start, end = event_bounds(event)
    cursor = start
    while cursor < end:
        next_hour = cursor.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        right = min(end, next_hour)
        hourly[cursor.astimezone(local_tz()).hour] += (right - cursor).total_seconds()
        cursor = right


def union_duration(intervals: Sequence[Tuple[datetime, datetime]], gap_seconds: float = 0) -> Tuple[float, List[Tuple[datetime, datetime]]]:
    intervals = sorted((start, end) for start, end in intervals if end > start)
    if not intervals:
        return 0.0, []
    merged = [intervals[0]]
    gap = timedelta(seconds=gap_seconds)
    for start, end in intervals[1:]:
        prev_start, prev_end = merged[-1]
        if start <= prev_end + gap:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return sum((end - start).total_seconds() for start, end in merged), merged


def category_key(path: Sequence[Any]) -> str:
    return " / ".join(str(part) for part in path) if path else "Uncategorized"


def infer_level(path: str) -> str:
    lowered = path.lower()
    if any(term in lowered for term in DISTRACTING_TERMS):
        return "distracting"
    if any(term in lowered for term in OTHER_WORK_TERMS):
        return "other_work"
    if any(term in lowered for term in FOCUS_TERMS):
        return "focus"
    if any(term in lowered for term in PERSONAL_TERMS):
        return "personal"
    return "neutral"


def default_profile(locale: str) -> Dict[str, Any]:
    return {
        "schema_version": 1,
        "locale": locale,
        "mappings": {},
        "goals": {},
        "thresholds": {"minimum_actionable_minutes": 30, "deviation_percent": 25},
    }


def ensure_profile(profile: Dict[str, Any], category_paths: Iterable[str]) -> bool:
    changed = False
    mappings = profile.setdefault("mappings", {})
    for path in sorted(set(category_paths)):
        if path == "Uncategorized" or path in mappings:
            continue
        mappings[path] = {"level": infer_level(path), "status": "provisional"}
        changed = True
    return changed


def mapping_for(path: str, profile: Dict[str, Any]) -> Dict[str, str]:
    mappings = profile.get("mappings") or {}
    candidates = [part.strip() for part in path.split(" / ")]
    for length in range(len(candidates), 0, -1):
        key = " / ".join(candidates[:length])
        value = mappings.get(key)
        if isinstance(value, str):
            return {"level": value if value in LEVEL_POINTS else "neutral", "status": "confirmed"}
        if isinstance(value, dict):
            level = value.get("level") if value.get("level") in LEVEL_POINTS else "neutral"
            status = value.get("status") if value.get("status") in {"confirmed", "provisional"} else "provisional"
            return {"level": level, "status": status}
    return {"level": "neutral", "status": "unmapped"}


def native_score_for(path: str, categories: Sequence[Dict[str, Any]]) -> Optional[float]:
    parts = [part.strip() for part in path.split(" / ")]
    by_path = {category_key(category.get("name") or []): category for category in categories}
    for length in range(len(parts), 0, -1):
        category = by_path.get(" / ".join(parts[:length]))
        score = ((category or {}).get("data") or {}).get("score")
        if score is not None:
            try:
                return float(score)
            except (TypeError, ValueError):
                return None
    return None


def domain_from_url(value: str) -> Optional[str]:
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().strip(".")
    if host.startswith("www."):
        host = host[4:]
    return host or None


def browser_domain_events(raw_events: Sequence[Dict[str, Any]], active_events: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    browser_masks = [event for event in active_events if str((event.get("data") or {}).get("app") or "") in BROWSER_APPS]
    active_web = intersect_events(raw_events, browser_masks) if browser_masks else []
    result = []
    for event in active_web:
        data = event.get("data") or {}
        domain = domain_from_url(str(data.get("url") or ""))
        if not domain:
            continue
        result.append({"timestamp": event["timestamp"], "duration": event["duration"], "data": {"domain": domain}})
    return result


def direct_domain_events(active_events: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Extract domain-only facts when a window watcher already provides a URL."""
    result = []
    for event in active_events:
        domain = domain_from_url(str((event.get("data") or {}).get("url") or ""))
        if domain:
            result.append({"timestamp": event["timestamp"], "duration": event["duration"], "data": {"domain": domain}})
    return result


def prefer_domain_events(web_events: Sequence[Dict[str, Any]], active_events: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Avoid double counting when both browser and window watchers expose URLs."""
    return list(web_events) if web_events else direct_domain_events(active_events)


def deep_work_metrics(events: Sequence[Dict[str, Any]], profile: Dict[str, Any]) -> Dict[str, Any]:
    intervals = []
    for event in events:
        path = category_key((event.get("data") or {}).get("$category") or ["Uncategorized"])
        if mapping_for(path, profile)["level"] == "focus":
            intervals.append(event_bounds(event))
    _, merged = union_duration(intervals, gap_seconds=120)
    blocks = [(start, end) for start, end in merged if (end - start).total_seconds() >= 25 * 60]
    durations = [(end - start).total_seconds() for start, end in blocks]
    start_hours = [0.0] * 24
    for start, _ in blocks:
        start_hours[start.astimezone(local_tz()).hour] += 1
    return {
        "seconds": round(sum(durations), 3),
        "longest_seconds": round(max(durations) if durations else 0, 3),
        "block_count": len(blocks),
        "start_hours": start_hours,
    }


def is_ai_text(value: str) -> bool:
    lowered = value.lower()
    return any(term in lowered for term in AI_TERMS)


def summarize_events(
    events: Sequence[Dict[str, Any]], domain_events: Sequence[Dict[str, Any]],
    categories: Sequence[Dict[str, Any]], profile: Dict[str, Any],
) -> Dict[str, Any]:
    category_seconds: Dict[str, float] = defaultdict(float)
    app_seconds: Dict[str, float] = defaultdict(float)
    domain_seconds: Dict[str, float] = defaultdict(float)
    level_seconds: Dict[str, float] = defaultdict(float)
    hourly = [0.0] * 24
    confirmed_seconds = 0.0
    provisional_seconds = 0.0
    native_total = 0.0
    has_native = False
    ai_intervals: List[Tuple[datetime, datetime]] = []

    for event in events:
        duration = float(event.get("duration", 0) or 0)
        data = event.get("data") or {}
        path = category_key(data.get("$category") or ["Uncategorized"])
        app = str(data.get("app") or "Unknown")
        category_seconds[path] += duration
        app_seconds[app] += duration
        mapping = mapping_for(path, profile)
        level_seconds[mapping["level"]] += duration
        if mapping["status"] == "confirmed":
            confirmed_seconds += duration
        elif mapping["status"] == "provisional":
            provisional_seconds += duration
        native = native_score_for(path, categories)
        if native is not None:
            native_total += (duration / 3600.0) * native
            has_native = True
        if is_ai_text(path) or is_ai_text(app):
            ai_intervals.append(event_bounds(event))
        split_duration_by_hour(event, hourly)

    for event in domain_events:
        duration = float(event.get("duration", 0) or 0)
        domain = str((event.get("data") or {}).get("domain") or "")
        if not domain:
            continue
        domain_seconds[domain] += duration
        if is_ai_text(domain):
            ai_intervals.append(event_bounds(event))

    active = sum(category_seconds.values())
    uncategorized = category_seconds.get("Uncategorized", 0.0)
    weighted = sum(level_seconds[level] * LEVEL_POINTS[level] for level in LEVEL_ORDER)
    pulse = round(weighted / active, 1) if active else 0.0
    productive = level_seconds["focus"] + level_seconds["other_work"]
    ai_seconds, _ = union_duration(ai_intervals)
    deep = deep_work_metrics(events, profile)

    def ranked(source: Dict[str, float], name_key: str, limit: Optional[int] = 12) -> List[Dict[str, Any]]:
        ordered = sorted(source.items(), key=lambda pair: (-pair[1], pair[0]))
        if limit is not None:
            ordered = ordered[:limit]
        return [
            {name_key: name, "seconds": round(seconds, 3), "percent": pct(seconds, active)}
            for name, seconds in ordered
        ]

    mapping_total = confirmed_seconds + provisional_seconds
    status = "calibrated" if active > 0 and confirmed_seconds >= active - 1 else "estimated"
    return {
        "active_seconds": round(active, 3),
        "categorized_seconds": round(active - uncategorized, 3),
        "uncategorized_seconds": round(uncategorized, 3),
        "category_coverage_percent": pct(active - uncategorized, active),
        "pulse": pulse,
        "score_status": status,
        "productive_seconds": round(productive, 3),
        "productive_percent": pct(productive, active),
        "confirmed_mapping_percent": pct(confirmed_seconds, active),
        "mapped_percent": pct(mapping_total, active),
        "levels": [
            {"level": level, "seconds": round(level_seconds[level], 3), "percent": pct(level_seconds[level], active), "points": LEVEL_POINTS[level]}
            for level in LEVEL_ORDER
        ],
        "native_score": round(native_total, 2) if has_native else None,
        "categories": ranked(category_seconds, "path", limit=None),
        "apps": ranked(app_seconds, "app"),
        "domains": ranked(domain_seconds, "domain"),
        "hourly": [round(value, 3) for value in hourly],
        "deep_work": deep,
        "ai_seconds": round(ai_seconds, 3),
    }


def audit_rules(
    events: Sequence[Dict[str, Any]], domain_events: Sequence[Dict[str, Any]],
    categories: Sequence[Dict[str, Any]], summary: Dict[str, Any],
) -> Dict[str, Any]:
    rules, issues = compiled_rules(categories)
    duplicates: Dict[Tuple[str, bool], List[str]] = defaultdict(list)
    for category in categories:
        rule = category.get("rule") or {}
        if rule.get("type") == "regex":
            duplicates[(str(rule.get("regex") or ""), bool(rule.get("ignore_case")))].append(category_key(category.get("name") or []))
    for (_, _), paths in duplicates.items():
        if len(paths) > 1:
            issues.append({"category": " | ".join(paths), "issue": "duplicate_regex"})

    match_seconds: Dict[str, float] = defaultdict(float)
    conflict_seconds = 0.0
    uncategorized_apps: Dict[str, float] = defaultdict(float)
    for event in events:
        duration = float(event.get("duration", 0) or 0)
        matches = matching_categories(event, rules)
        for category in matches:
            match_seconds[category_key(category.get("name") or [])] += duration
        if len(matches) > 1:
            conflict_seconds += duration
        path = category_key((event.get("data") or {}).get("$category") or ["Uncategorized"])
        if path == "Uncategorized":
            app = str((event.get("data") or {}).get("app") or "Unknown")
            uncategorized_apps[app] += duration

    suggestions = []
    for app, seconds in sorted(uncategorized_apps.items(), key=lambda pair: -pair[1])[:5]:
        if app and app != "Unknown":
            suggestions.append({
                "source": "app", "value": app, "suggested_regex": f"^{re.escape(app)}$",
                "expected_seconds": round(seconds, 3), "confidence": "high",
            })
    uncategorized_domains: Dict[str, float] = defaultdict(float)
    for event in domain_events:
        domain = str((event.get("data") or {}).get("domain") or "")
        if domain:
            uncategorized_domains[domain] += float(event.get("duration", 0) or 0)
    for domain, seconds in sorted(uncategorized_domains.items(), key=lambda pair: -pair[1])[:3]:
        suggestions.append({
            "source": "domain", "value": domain, "suggested_regex": re.escape(domain),
            "expected_seconds": round(seconds, 3), "confidence": "medium",
            "note": "ActivityWatch category matching may require the domain to appear in the window title.",
        })

    unused = [
        category_key(category.get("name") or []) for category, _ in rules
        if match_seconds.get(category_key(category.get("name") or []), 0) <= 0
    ]
    return {
        "rule_count": len(rules),
        "issue_count": len(issues),
        "issues": issues,
        "conflict_seconds": round(conflict_seconds, 3),
        "unused_rule_count": len(unused),
        "unused_rules": unused[:20],
        "coverage_percent": summary["category_coverage_percent"],
        "suggestions": suggestions,
    }


def average_metric(summaries: Sequence[Dict[str, Any]], key: str) -> Optional[float]:
    values = [float(item[key]) for item in summaries if item.get("active_seconds", 0) > 0 and item.get(key) is not None]
    return mean(values)


def aggregate_summary_period(
    daily: Sequence[Dict[str, Any]], start: datetime, end: datetime,
) -> Optional[Dict[str, Any]]:
    members = [
        item for item in daily
        if parse_datetime(item["start"]) >= start
        and parse_datetime(item["end"]) <= end
        and item.get("active_seconds", 0) > 0
    ]
    active = sum(float(item["active_seconds"]) for item in members)
    if active <= 0:
        return None
    return {
        "start": iso(start), "end": iso(end), "active_seconds": round(active, 3),
        "pulse": round(sum(float(item["pulse"]) * float(item["active_seconds"]) for item in members) / active, 1),
        "productive_seconds": round(sum(float(item["productive_seconds"]) for item in members), 3),
        "deep_work": {"seconds": round(sum(float(item["deep_work"]["seconds"]) for item in members), 3)},
        "ai_seconds": round(sum(float(item["ai_seconds"]) for item in members), 3),
    }


def comparison_period(selected_start: datetime, selected_end: datetime, daily: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    span = selected_end - selected_start
    return aggregate_summary_period(daily, selected_start - span, selected_start)


def build_baseline(selected_start: datetime, selected_end: datetime, daily: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    is_daily = (selected_end - selected_start) <= timedelta(hours=36)
    prior = [item for item in daily if parse_datetime(item["end"]) <= selected_start and item["active_seconds"] > 0]
    if is_daily:
        candidates = [item for item in prior if parse_datetime(item["start"]).weekday() == selected_start.weekday()]
        candidates = candidates[-4:]
    else:
        span = selected_end - selected_start
        candidates = []
        for offset in range(4, 0, -1):
            candidate = aggregate_summary_period(
                daily, selected_start - span * offset, selected_start - span * (offset - 1),
            )
            if candidate:
                candidates.append(candidate)
    sufficient = len(candidates) >= 3
    return {
        "sample_count": len(candidates),
        "sufficient": sufficient,
        "pulse": average_metric(candidates, "pulse") if sufficient else None,
        "active_seconds": average_metric(candidates, "active_seconds") if sufficient else None,
        "productive_seconds": average_metric(candidates, "productive_seconds") if sufficient else None,
        "deep_work_seconds": mean([item["deep_work"]["seconds"] for item in candidates]) if sufficient else None,
        "ai_seconds": average_metric(candidates, "ai_seconds") if sufficient else None,
    }


def localized(locale: str, zh: str, en: str) -> str:
    return zh if locale == "zh-CN" else en


def build_insights(summary: Dict[str, Any], baseline: Dict[str, Any], rules: Dict[str, Any], profile: Dict[str, Any], locale: str) -> List[Dict[str, Any]]:
    insights = []
    minimum = float((profile.get("thresholds") or {}).get("minimum_actionable_minutes", 30)) * 60
    deviation = float((profile.get("thresholds") or {}).get("deviation_percent", 25))

    if summary["category_coverage_percent"] < 90:
        insights.append({
            "kind": "rules", "severity": "warning", "metric": "category_coverage_percent",
            "title": localized(locale, "分类覆盖率需要提高", "Category coverage needs attention"),
            "evidence": localized(locale, f"当前有{summary['category_coverage_percent']:.1f}%的活跃时间被分类。", f"{summary['category_coverage_percent']:.1f}% of active time is categorized."),
            "action": localized(locale, "优先处理规则健康页中耗时最高的未分类应用，再观察下一份报告的覆盖率。", "Classify the highest-time uncategorized app in Rule Health, then check coverage in the next report."),
            "verify": localized(locale, "分类覆盖率是否达到90%以上", "Whether category coverage reaches 90%"),
        })
    if summary["confirmed_mapping_percent"] < 80:
        insights.append({
            "kind": "calibration", "severity": "info", "metric": "confirmed_mapping_percent",
            "title": localized(locale, "效率评分仍是估算值", "The productivity score is still estimated"),
            "evidence": localized(locale, f"只有{summary['confirmed_mapping_percent']:.1f}%的活跃时间使用了已确认的生产力映射。", f"Only {summary['confirmed_mapping_percent']:.1f}% of active time uses confirmed productivity mappings."),
            "action": localized(locale, "在设置页确认耗时最高类别的五档生产力等级。", "Confirm the productivity level of the highest-time categories in Settings."),
            "verify": localized(locale, "已确认映射覆盖率是否提高", "Whether confirmed mapping coverage increases"),
        })

    if baseline.get("sufficient"):
        focus_base = float(baseline.get("deep_work_seconds") or 0)
        focus_change = pct_change(summary["deep_work"]["seconds"], focus_base)
        if focus_base > 0 and summary["deep_work"]["seconds"] + minimum < focus_base and focus_change is not None and focus_change <= -deviation:
            insights.append({
                "kind": "focus", "severity": "warning", "metric": "deep_work_seconds",
                "title": localized(locale, "深度工作低于个人基线", "Deep work is below your baseline"),
                "evidence": localized(locale, f"深度工作比可比日期平均值低{abs(focus_change):.1f}%。", f"Deep work is {abs(focus_change):.1f}% below comparable days."),
                "action": localized(locale, "下一工作日预留一个不被会议打断的25分钟专注块。", "Reserve one meeting-free 25-minute focus block on the next workday."),
                "verify": localized(locale, "深度工作块数量和最长专注块是否增加", "Whether deep-work block count and longest block increase"),
            })
        ai_base = float(baseline.get("ai_seconds") or 0)
        ai_change = pct_change(summary["ai_seconds"], ai_base)
        if ai_base > 0 and summary["ai_seconds"] > ai_base + minimum and ai_change is not None and ai_change >= deviation:
            insights.append({
                "kind": "ai", "severity": "info", "metric": "ai_seconds",
                "title": localized(locale, "AI 使用时间明显增加", "AI usage increased materially"),
                "evidence": localized(locale, f"AI相关活动比可比日期平均值高{ai_change:.1f}%。", f"AI-related activity is {ai_change:.1f}% above comparable days."),
                "action": localized(locale, "把零散AI查询集中成两个短时段，并记录它是否减少任务切换。", "Batch scattered AI queries into two short windows and observe whether task switching falls."),
                "verify": localized(locale, "AI总时长、深度工作块和应用切换是否改善", "AI time, deep-work blocks, and app switching"),
            })

    if not insights:
        insights.append({
            "kind": "summary", "severity": "success", "metric": "pulse",
            "title": localized(locale, "今天的节奏较稳定", "Your activity pattern is stable"),
            "evidence": localized(locale, "没有发现超过当前行动阈值的异常变化。", "No change exceeded the current actionable threshold."),
            "action": localized(locale, "保持当前节奏，并继续积累个人基线。", "Keep the current rhythm and continue building your personal baseline."),
            "verify": localized(locale, "下一份报告中的效率分和深度工作时长", "Productivity pulse and deep-work time in the next report"),
        })
    return insights[:3]


def build_report(
    source: Dict[str, Any], period: Tuple[datetime, datetime, str], selected_events: Sequence[Dict[str, Any]],
    selected_domains: Sequence[Dict[str, Any]], daily_periods: Sequence[Tuple[datetime, datetime]],
    daily_events: Sequence[Sequence[Dict[str, Any]]], daily_domains: Sequence[Sequence[Dict[str, Any]]],
    categories: Sequence[Dict[str, Any]], profile: Dict[str, Any], settings: Dict[str, Any], locale: str,
    afk_available: bool, browser_available: bool, afk_seconds: float = 0.0,
) -> Dict[str, Any]:
    start, end, period_id = period
    category_paths = [category_key((event.get("data") or {}).get("$category") or ["Uncategorized"]) for event in selected_events]
    ensure_profile(profile, category_paths)
    summary = summarize_events(selected_events, selected_domains, categories, profile)
    summary["afk_seconds"] = round(afk_seconds, 3)
    daily = []
    for (d_start, d_end), events, domains in zip(daily_periods, daily_events, daily_domains):
        item = summarize_events(events, domains, categories, profile)
        item.update({"start": iso(d_start), "end": iso(d_end), "date": d_start.date().isoformat()})
        daily.append(item)
    baseline = build_baseline(start, end, daily)
    previous = comparison_period(start, end, daily)
    rule_health = audit_rules(selected_events, selected_domains, categories, summary)
    insights = build_insights(summary, baseline, rule_health, profile, locale)
    compact_trend = [
        {
            "date": item["date"], "start": item["start"], "end": item["end"],
            "active_seconds": item["active_seconds"], "pulse": item["pulse"],
            "productive_seconds": item["productive_seconds"], "productive_percent": item["productive_percent"],
            "deep_work": {"seconds": item["deep_work"]["seconds"]}, "ai_seconds": item["ai_seconds"],
        }
        for item in daily[-28:]
    ]

    last_event = max((event_bounds(event)[1] for event in selected_events), default=None)
    return {
        "schema_version": 1,
        "generator": {"name": "analyze-activitywatch", "version": VERSION},
        "generated_at": iso(datetime.now().astimezone()),
        "locale": locale,
        "period": {"id": period_id, "start": iso(start), "end": iso(end), "label": f"{start.date().isoformat()} — {end.date().isoformat()}"},
        "source": {
            **source,
            "afk_available": afk_available,
            "browser_available": browser_available,
            "last_event_at": iso(last_event) if last_event else None,
        },
        "privacy": {
            "window_titles": "omitted", "full_urls": "omitted", "domains": "aggregated",
            "raw_events": "not_persisted",
        },
        "settings": {
            "start_of_day": settings.get("startOfDay", "04:00"),
            "start_of_week": settings.get("startOfWeek", "Monday"),
            "category_count": len(categories),
        },
        "summary": summary,
        "comparison": {
            "previous_available": previous is not None,
            "pulse_change": round(summary["pulse"] - previous["pulse"], 1) if previous else None,
            "active_percent_change": pct_change(summary["active_seconds"], previous["active_seconds"]) if previous else None,
            "productive_percent_change": pct_change(summary["productive_seconds"], previous["productive_seconds"]) if previous else None,
            "deep_work_percent_change": pct_change(summary["deep_work"]["seconds"], previous["deep_work"]["seconds"]) if previous else None,
        },
        "baseline": baseline,
        "trend": compact_trend,
        "rule_health": rule_health,
        "insights": insights,
        "profile_status": {
            "mapping_count": len(profile.get("mappings") or {}),
            "confirmed_count": sum(1 for value in (profile.get("mappings") or {}).values() if isinstance(value, dict) and value.get("status") == "confirmed"),
        },
    }


def periods_for_history(end: datetime, settings: Dict[str, Any], days: int = 36) -> List[Tuple[datetime, datetime]]:
    hour, minute = parse_start_of_day(settings)
    current_start = day_start_for(end, hour, minute)
    result = []
    for offset in range(days - 1, -1, -1):
        start = current_start - timedelta(days=offset)
        stop = min(start + timedelta(days=1), end) if offset == 0 else start + timedelta(days=1)
        if stop > start:
            result.append((start, stop))
    return result


def domain_events_by_period(all_events: Sequence[Dict[str, Any]], active_sets: Sequence[Sequence[Dict[str, Any]]], periods: Sequence[Tuple[datetime, datetime]]) -> List[List[Dict[str, Any]]]:
    result = []
    for active, (start, end) in zip(active_sets, periods):
        clipped = clip_events(all_events, start, end)
        result.append(browser_domain_events(clipped, active))
    return result


def collect_from_api(args: argparse.Namespace, settings: Dict[str, Any]) -> Tuple[Any, ...]:
    base = discover_api_base(args.api_base)
    client = ApiClient(base, timeout=args.timeout, token=args.api_token)
    info = client.get("info") or {}
    api_settings = client.get("settings") or {}
    if api_settings:
        settings.clear()
        settings.update(api_settings)
    period = resolve_period(args.period, settings)
    buckets = client.get("buckets/") or {}
    host = args.host or info.get("hostname")
    window = choose_bucket(buckets, "aw-watcher-window_", host)
    if not window:
        raise AnalyticsError("No ActivityWatch window bucket was found for the selected host.")
    afk = choose_bucket(buckets, "aw-watcher-afk_", host)
    categories = merge_category_sets(settings)
    history_periods = periods_for_history(period[1], settings)
    query = build_canonical_query(window, afk, categories)
    daily_events = api_query_periods(client, query, history_periods)
    selected_events = api_query_periods(client, query, [(period[0], period[1])])[0]
    afk_seconds = 0.0
    if afk:
        afk_events = clip_events(api_get_events(client, afk, period[0], period[1]), period[0], period[1])
        afk_seconds = status_duration(afk_events, "afk")
    web_buckets = browser_buckets(buckets, host)
    all_web = []
    for bucket_id in web_buckets:
        all_web.extend(api_get_events(client, bucket_id, history_periods[0][0], period[1]))
    web_daily_domains = domain_events_by_period(all_web, daily_events, history_periods)
    daily_domains = [prefer_domain_events(web, active) for web, active in zip(web_daily_domains, daily_events)]
    selected_web_domains = browser_domain_events(clip_events(all_web, period[0], period[1]), selected_events)
    selected_domains = prefer_domain_events(selected_web_domains, selected_events)
    browser_available = bool(web_buckets) or any(daily_domains)
    source = {"mode": "api", "api_base": base, "host": host, "window_bucket": window, "afk_bucket": afk, "browser_buckets": web_buckets}
    return period, source, categories, history_periods, daily_events, daily_domains, selected_events, selected_domains, bool(afk), browser_available, afk_seconds


def collect_from_export(args: argparse.Namespace, settings: Dict[str, Any]) -> Tuple[Any, ...]:
    if not args.export:
        raise AnalyticsError("Export mode requires --export <file>.")
    export_path = Path(args.export).expanduser().resolve()
    period = resolve_period(args.period, settings)
    buckets = extract_export_buckets(read_json(export_path))
    metadata = {bucket_id: {key: value for key, value in bucket.items() if key != "events"} for bucket_id, bucket in buckets.items()}
    host = args.host
    if not host:
        hosts = [str(item.get("hostname")) for item in metadata.values() if item.get("hostname")]
        host = hosts[0] if hosts else None
    window = choose_bucket(metadata, "aw-watcher-window_", host)
    if not window:
        raise AnalyticsError("The export has no window bucket for the selected host.")
    afk = choose_bucket(metadata, "aw-watcher-afk_", host)
    categories = merge_category_sets(settings)
    history_periods = periods_for_history(period[1], settings)
    daily_events = offline_period_events(buckets, window, afk, categories, history_periods)
    selected_events = offline_period_events(buckets, window, afk, categories, [(period[0], period[1])])[0]
    afk_seconds = status_duration(clip_events(buckets.get(afk or "", {}).get("events") or [], period[0], period[1]), "afk") if afk else 0.0
    web_ids = browser_buckets(metadata, host)
    all_web = []
    for bucket_id in web_ids:
        all_web.extend(buckets[bucket_id].get("events") or [])
    web_daily_domains = domain_events_by_period(all_web, daily_events, history_periods)
    daily_domains = [prefer_domain_events(web, active) for web, active in zip(web_daily_domains, daily_events)]
    selected_web_domains = browser_domain_events(clip_events(all_web, period[0], period[1]), selected_events)
    selected_domains = prefer_domain_events(selected_web_domains, selected_events)
    browser_available = bool(web_ids) or any(daily_domains)
    source = {"mode": "export", "file": export_path.name, "host": host, "window_bucket": window, "afk_bucket": afk, "browser_buckets": web_ids}
    return period, source, categories, history_periods, daily_events, daily_domains, selected_events, selected_domains, bool(afk), browser_available, afk_seconds


def collect(args: argparse.Namespace, profile: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    settings_path = find_settings_file(args.settings)
    settings = read_json(settings_path) if settings_path else {}
    if args.source == "api":
        collected = collect_from_api(args, settings)
    elif args.source == "export":
        collected = collect_from_export(args, settings)
    else:
        try:
            collected = collect_from_api(args, settings)
        except AnalyticsError as api_error:
            if not args.export:
                raise AnalyticsError(f"{api_error} Start ActivityWatch or pass --export <file> for offline analysis.") from api_error
            collected = collect_from_export(args, settings)
    period, source, categories, history_periods, daily_events, daily_domains, selected_events, selected_domains, afk_available, browser_available, afk_seconds = collected
    source["settings_file"] = settings_path.name if settings_path else None
    all_paths = [category_key((event.get("data") or {}).get("$category") or ["Uncategorized"]) for events in daily_events for event in events]
    ensure_profile(profile, all_paths)
    report = build_report(
        source, period, selected_events, selected_domains, history_periods, daily_events,
        daily_domains, categories, profile, settings, args.locale, afk_available, browser_available, afk_seconds,
    )
    return report, profile


def escape_svg(value: Any) -> str:
    return html.escape(str(value), quote=True)


def svg_header(width: int, height: int, title: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{escape_svg(title)}"><style>text{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}</style>'


def category_svg(report: Dict[str, Any]) -> str:
    rows = report["summary"]["categories"][:8]
    width, row_h = 760, 42
    height = 70 + row_h * max(1, len(rows))
    out = [svg_header(width, height, "Category time distribution"), '<rect width="100%" height="100%" rx="18" fill="#111722"/>']
    out.append('<text x="24" y="34" fill="#f8fafc" font-size="18" font-weight="700">Category distribution</text>')
    max_seconds = max([item["seconds"] for item in rows] or [1])
    for index, item in enumerate(rows):
        y = 58 + index * row_h
        bar_w = 400 * item["seconds"] / max_seconds
        color = CATEGORY_COLORS[index % len(CATEGORY_COLORS)]
        label = item["path"].split(" / ")[-1]
        out.append(f'<text x="24" y="{y + 16}" fill="#cbd5e1" font-size="13">{escape_svg(label)}</text>')
        out.append(f'<rect x="190" y="{y + 3}" width="400" height="14" rx="7" fill="#1f2937"/>')
        out.append(f'<rect x="190" y="{y + 3}" width="{bar_w:.1f}" height="14" rx="7" fill="{color}"/>')
        out.append(f'<text x="610" y="{y + 16}" fill="#f8fafc" font-size="13">{escape_svg(seconds_human(item["seconds"], report["locale"]))}</text>')
    out.append("</svg>")
    return "".join(out)


def level_svg(report: Dict[str, Any]) -> str:
    width, height = 760, 170
    levels = report["summary"]["levels"]
    out = [svg_header(width, height, "Productivity level distribution"), '<rect width="100%" height="100%" rx="18" fill="#111722"/>']
    out.append('<text x="24" y="34" fill="#f8fafc" font-size="18" font-weight="700">Productivity levels</text>')
    x, y, available = 24.0, 62.0, 712.0
    for item in levels:
        w = available * item["percent"] / 100.0
        if w > 0:
            out.append(f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="32" fill="{LEVEL_COLORS[item["level"]]}"/>')
            x += w
    cursor = 24
    for item in levels:
        out.append(f'<circle cx="{cursor + 6}" cy="125" r="6" fill="{LEVEL_COLORS[item["level"]]}"/>')
        out.append(f'<text x="{cursor + 18}" y="130" fill="#cbd5e1" font-size="12">{escape_svg(item["level"])} {item["percent"]:.1f}%</text>')
        cursor += 140
    out.append("</svg>")
    return "".join(out)


def trend_svg(report: Dict[str, Any]) -> str:
    data = [item for item in report.get("trend", []) if item.get("active_seconds", 0) > 0][-14:]
    width, height = 900, 300
    out = [svg_header(width, height, "Productivity trend"), '<rect width="100%" height="100%" rx="18" fill="#111722"/>']
    out.append('<text x="24" y="34" fill="#f8fafc" font-size="18" font-weight="700">Productivity trend</text>')
    left, top, chart_w, chart_h = 55, 58, 810, 190
    for value in [0, 25, 50, 75, 100]:
        y = top + chart_h * (100 - value) / 100
        out.append(f'<line x1="{left}" y1="{y:.1f}" x2="{left + chart_w}" y2="{y:.1f}" stroke="#253041" stroke-width="1"/>')
        out.append(f'<text x="18" y="{y + 4:.1f}" fill="#758198" font-size="11">{value}</text>')
    if data:
        step = chart_w / max(1, len(data) - 1)
        points = [(left + i * step, top + chart_h * (100 - item["pulse"]) / 100) for i, item in enumerate(data)]
        path = " ".join(("M" if i == 0 else "L") + f" {x:.1f} {y:.1f}" for i, (x, y) in enumerate(points))
        area = path + f" L {points[-1][0]:.1f} {top + chart_h} L {points[0][0]:.1f} {top + chart_h} Z"
        out.append(f'<path d="{area}" fill="#34d399" opacity="0.12"/>')
        out.append(f'<path d="{path}" fill="none" stroke="#34d399" stroke-width="3"/>')
        for i, ((x, y), item) in enumerate(zip(points, data)):
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="#111722" stroke="#34d399" stroke-width="3"/>')
            if i in {0, len(data) - 1} or len(data) <= 7:
                out.append(f'<text x="{x:.1f}" y="{top + chart_h + 24}" fill="#758198" font-size="10" text-anchor="middle">{escape_svg(item["date"][5:])}</text>')
    out.append("</svg>")
    return "".join(out)


def hourly_svg(report: Dict[str, Any]) -> str:
    values = report["summary"]["hourly"]
    width, height = 900, 220
    out = [svg_header(width, height, "Hourly activity"), '<rect width="100%" height="100%" rx="18" fill="#111722"/>']
    out.append('<text x="24" y="34" fill="#f8fafc" font-size="18" font-weight="700">Hourly activity</text>')
    maximum = max(values or [1]) or 1
    for hour, value in enumerate(values):
        x = 24 + hour * 35
        bar_h = 110 * value / maximum
        out.append(f'<rect x="{x}" y="{165 - bar_h:.1f}" width="23" height="{bar_h:.1f}" rx="5" fill="#6f48f5" opacity="{0.35 + 0.65 * value / maximum:.2f}"/>')
        if hour % 3 == 0:
            out.append(f'<text x="{x + 11}" y="190" fill="#758198" font-size="10" text-anchor="middle">{hour:02d}</text>')
    out.append("</svg>")
    return "".join(out)


def make_charts(report: Dict[str, Any], chart_dir: Path) -> Dict[str, str]:
    chart_dir.mkdir(parents=True, exist_ok=True)
    charts = {
        "categories": category_svg(report),
        "levels": level_svg(report),
        "trend": trend_svg(report),
        "hourly": hourly_svg(report),
    }
    for name, content in charts.items():
        (chart_dir / f"{name}.svg").write_text(content, encoding="utf-8")
    return charts


def load_asset(name: str) -> str:
    return (Path(__file__).resolve().parent.parent / "assets" / name).read_text(encoding="utf-8")


def render_markdown(report: Dict[str, Any]) -> str:
    locale = report["locale"]
    summary = report["summary"]
    lines = [
        f"# {localized(locale, 'ActivityWatch 效率报告', 'ActivityWatch Productivity Report')}", "",
        f"**{localized(locale, '统计区间', 'Period')}：** {report['period']['label']}", "",
        f"- {localized(locale, '效率评分', 'Productivity pulse')}：{summary['pulse']:.1f}/100 ({summary['score_status']})",
        f"- {localized(locale, '活跃时间', 'Active time')}：{seconds_human(summary['active_seconds'], locale)}",
        f"- {localized(locale, '离开时间', 'AFK time')}：{seconds_human(summary.get('afk_seconds', 0), locale) if report['source'].get('afk_available') else localized(locale, '不可用', 'Unavailable')}",
        f"- {localized(locale, '生产性时间', 'Productive time')}：{seconds_human(summary['productive_seconds'], locale)} ({summary['productive_percent']:.1f}%)",
        f"- {localized(locale, '深度工作', 'Deep work')}：{seconds_human(summary['deep_work']['seconds'], locale)}",
        f"- {localized(locale, '分类覆盖率', 'Category coverage')}：{summary['category_coverage_percent']:.1f}%", "",
        f"## {localized(locale, '时间分布', 'Time distribution')}", "", "![Categories](charts/categories.svg)", "", "![Levels](charts/levels.svg)", "",
        f"## {localized(locale, '趋势', 'Trend')}", "", "![Trend](charts/trend.svg)", "", "![Hourly](charts/hourly.svg)", "",
        f"## {localized(locale, '主要建议', 'Recommendations')}", "",
    ]
    for item in report.get("insights", []):
        lines.extend([
            f"### {item['title']}", "",
            f"- **{localized(locale, '证据', 'Evidence')}：** {item['evidence']}",
            f"- **{localized(locale, '行动', 'Action')}：** {item['action']}",
            f"- **{localized(locale, '验证', 'Verify')}：** {item['verify']}", "",
        ])
    lines.extend([
        f"## {localized(locale, '规则健康', 'Rule health')}", "",
        f"- {localized(locale, '有效规则', 'Valid rules')}：{report['rule_health']['rule_count']}",
        f"- {localized(locale, '规则问题', 'Rule issues')}：{report['rule_health']['issue_count']}",
        f"- {localized(locale, '冲突时间', 'Conflict time')}：{seconds_human(report['rule_health']['conflict_seconds'], locale)}", "",
        f"> {localized(locale, '隐私：原始窗口标题、完整 URL 和原始事件未写入本报告。', 'Privacy: raw window titles, full URLs, and raw events were not written to this report.')}", "",
    ])
    return "\n".join(lines)


def render_html(report: Dict[str, Any], charts: Dict[str, str]) -> str:
    template = load_asset("report-template.html")
    payload = json.dumps(report, ensure_ascii=False).replace("</", "<\\/")
    replacements = {
        "{{REPORT_JSON}}": payload,
        "{{CATEGORY_SVG}}": charts["categories"],
        "{{LEVEL_SVG}}": charts["levels"],
        "{{TREND_SVG}}": charts["trend"],
        "{{HOURLY_SVG}}": charts["hourly"],
    }
    for token, value in replacements.items():
        template = template.replace(token, value)
    return template


def render_artifacts(report: Dict[str, Any], output_dir: Path) -> Dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    charts = make_charts(report, output_dir / "charts")
    report_json = output_dir / "report.json"
    report_md = output_dir / "report.md"
    report_html = output_dir / "report.html"
    write_json(report_json, report)
    report_md.write_text(render_markdown(report), encoding="utf-8")
    report_html.write_text(render_html(report, charts), encoding="utf-8")
    return {"json": report_json, "markdown": report_md, "html": report_html}


def demo_report(locale: str = "zh-CN") -> Tuple[Dict[str, Any], Dict[str, Any]]:
    tz = local_tz()
    start = datetime.now(tz).replace(hour=4, minute=0, second=0, microsecond=0)
    categories = [
        {"name": ["工作", "编码开发"], "rule": {"type": "regex", "regex": "Code|Terminal"}, "data": {"score": 10}},
        {"name": ["工作", "学习"], "rule": {"type": "regex", "regex": "Obsidian|Books"}},
        {"name": ["工作", "沟通协作"], "rule": {"type": "regex", "regex": "WeChat|Slack"}},
        {"name": ["娱乐休闲"], "rule": {"type": "regex", "regex": "YouTube|Bilibili"}},
    ]
    profile = default_profile(locale)
    profile["mappings"] = {
        "工作 / 编码开发": {"level": "focus", "status": "confirmed"},
        "工作 / 学习": {"level": "focus", "status": "confirmed"},
        "工作 / 沟通协作": {"level": "other_work", "status": "confirmed"},
        "娱乐休闲": {"level": "personal", "status": "confirmed"},
    }
    specs = [
        ("Visual Studio Code", ["工作", "编码开发"], 165, 8),
        ("Google Chrome", ["工作", "学习"], 90, 11),
        ("Obsidian", ["工作", "学习"], 70, 14),
        ("Terminal", ["工作", "编码开发"], 60, 16),
        ("WeChat", ["工作", "沟通协作"], 45, 18),
        ("Google Chrome", ["娱乐休闲"], 85, 20),
    ]
    events = []
    cursor = start + timedelta(hours=4)
    for app, category, minutes, hour in specs:
        cursor = start.replace(hour=hour, minute=0)
        events.append({"timestamp": iso(cursor), "duration": minutes * 60, "data": {"app": app, "$category": category, "title": "SENSITIVE DEMO TITLE"}})
    domains = [
        {"timestamp": iso(start.replace(hour=11)), "duration": 55 * 60, "data": {"domain": "chat.openai.com"}},
        {"timestamp": iso(start.replace(hour=12)), "duration": 45 * 60, "data": {"domain": "github.com"}},
        {"timestamp": iso(start.replace(hour=20)), "duration": 35 * 60, "data": {"domain": "youtube.com"}},
    ]
    daily_periods = []
    daily_events = []
    daily_domains = []
    for offset in range(28, -1, -1):
        d_start = start - timedelta(days=offset)
        d_end = d_start + timedelta(days=1)
        daily_periods.append((d_start, d_end))
        factor = 0.78 + ((28 - offset) % 7) * 0.035
        shifted = []
        for event in events:
            item = copy.deepcopy(event)
            event_start, _ = event_bounds(item)
            item["timestamp"] = iso(event_start - timedelta(days=offset))
            item["duration"] *= factor
            shifted.append(item)
        daily_events.append(shifted)
        shifted_domains = []
        for event in domains:
            item = copy.deepcopy(event)
            event_start, _ = event_bounds(item)
            item["timestamp"] = iso(event_start - timedelta(days=offset))
            item["duration"] *= factor
            shifted_domains.append(item)
        daily_domains.append(shifted_domains)
    report = build_report(
        {"mode": "demo", "host": "demo-mac", "window_bucket": "demo", "afk_bucket": "demo-afk", "browser_buckets": ["demo-web"]},
        (start, start + timedelta(hours=20), start.date().isoformat()), events, domains,
        daily_periods, daily_events, daily_domains, categories, profile,
        {"startOfDay": "04:00", "startOfWeek": "Monday"}, locale, True, True, 95 * 60,
    )
    return report, profile


def output_root(args: argparse.Namespace, period_id: str) -> Path:
    return Path(args.output).expanduser().resolve() / safe_slug(period_id)


def load_profile(path: Path, locale: str) -> Dict[str, Any]:
    if path.is_file():
        profile = read_json(path)
        if not isinstance(profile, dict):
            raise AnalyticsError("profile.json must contain an object.")
        return profile
    return default_profile(locale)


def command_analyze(args: argparse.Namespace) -> int:
    root = Path(args.output).expanduser().resolve()
    profile_path = Path(args.profile).expanduser().resolve() if args.profile else root / "profile.json"
    profile = load_profile(profile_path, args.locale)
    report, profile = collect(args, profile)
    write_json(profile_path, profile)
    paths = render_artifacts(report, output_root(args, report["period"]["id"]))
    print(json.dumps({key: str(path) for key, path in paths.items()}, ensure_ascii=False))
    return 0


def command_collect(args: argparse.Namespace) -> int:
    root = Path(args.output).expanduser().resolve()
    profile_path = Path(args.profile).expanduser().resolve() if args.profile else root / "profile.json"
    profile = load_profile(profile_path, args.locale)
    report, profile = collect(args, profile)
    write_json(profile_path, profile)
    path = output_root(args, report["period"]["id"]) / "facts.json"
    write_json(path, report)
    print(str(path))
    return 0


def command_render(args: argparse.Namespace) -> int:
    report_path = Path(args.report).expanduser().resolve()
    report = read_json(report_path)
    output = Path(args.output).expanduser().resolve() if args.output else report_path.parent
    paths = render_artifacts(report, output)
    print(json.dumps({key: str(path) for key, path in paths.items()}, ensure_ascii=False))
    return 0


def command_demo(args: argparse.Namespace) -> int:
    report, profile = demo_report(args.locale)
    root = Path(args.output).expanduser().resolve()
    write_json(root / "profile.json", profile)
    paths = render_artifacts(report, root / report["period"]["id"])
    print(json.dumps({key: str(path) for key, path in paths.items()}, ensure_ascii=False))
    return 0


def add_source_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--period", default="today", help="today, yesterday, this-week, last-week, or START/END")
    parser.add_argument("--source", choices=["auto", "api", "export"], default="auto")
    parser.add_argument("--export", help="ActivityWatch export JSON used by export mode or auto fallback")
    parser.add_argument("--settings", help="ActivityWatch settings.json override")
    parser.add_argument("--api-base", help="ActivityWatch base URL, default auto-detected or http://127.0.0.1:5600")
    parser.add_argument("--api-token", help="Local ActivityWatch bearer token if required")
    parser.add_argument("--host", help="ActivityWatch hostname to analyze")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--profile", help="Productivity profile path; defaults to <output>/profile.json")
    parser.add_argument("--locale", choices=["zh-CN", "en"], default="zh-CN")
    parser.add_argument("--output", default="activitywatch-reports")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate privacy-first offline ActivityWatch analytics reports.")
    parser.add_argument("--version", action="version", version=VERSION)
    subparsers = parser.add_subparsers(dest="command", required=True)
    analyze = subparsers.add_parser("analyze", help="Collect, analyze, and render all report formats")
    add_source_args(analyze)
    analyze.set_defaults(func=command_analyze)
    collect_parser = subparsers.add_parser("collect", help="Collect a privacy-safe facts JSON")
    add_source_args(collect_parser)
    collect_parser.set_defaults(func=command_collect)
    render = subparsers.add_parser("render", help="Render artifacts from an existing report JSON")
    render.add_argument("--report", required=True)
    render.add_argument("--output")
    render.set_defaults(func=command_render)
    demo = subparsers.add_parser("demo", help="Generate a synthetic report without ActivityWatch")
    demo.add_argument("--locale", choices=["zh-CN", "en"], default="zh-CN")
    demo.add_argument("--output", default="activitywatch-demo")
    demo.set_defaults(func=command_demo)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except AnalyticsError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
