use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct AwEvent {
    pub timestamp: String,
    pub duration: f64,
    pub data: serde_json::Value,
}

#[derive(Serialize)]
pub struct AwSyncResult {
    pub bucket_id: String,
    pub events: Vec<AwEvent>,
    pub fetched_at: String,
}

/// 拉取 ActivityWatch 的 window bucket 事件。
/// 返回原始事件 JSON（由前端做分类映射和去重写入）。
#[tauri::command]
pub async fn aw_fetch_events(
    host: Option<String>,
    port: Option<u16>,
    bucket_prefix: Option<String>,
    limit: Option<u32>,
) -> Result<AwSyncResult, String> {
    let host = host.unwrap_or_else(|| "127.0.0.1".to_string());
    let port = port.unwrap_or(5600);
    let bucket_prefix = bucket_prefix.unwrap_or_else(|| "aw-watcher-window".to_string());
    let limit = limit.unwrap_or(1000);

    let base = format!("http://{}:{}", host, port);

    // 1) 列出 buckets，找到第一个匹配 prefix 的 bucket
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let buckets: serde_json::Value = client
        .get(format!("{}/api/0/buckets/", base))
        .send()
        .await
        .map_err(|e| format!("连接 ActivityWatch 失败（{}:{}）: {}", host, port, e))?
        .json()
        .await
        .map_err(|e| format!("解析 buckets 响应失败: {}", e))?;

    let mut bucket_id: Option<String> = None;
    if let Some(map) = buckets.as_object() {
        for (id, meta) in map {
            let id_lower = id.to_lowercase();
            if id_lower.starts_with(&bucket_prefix.to_lowercase()) {
                // 校验 type 是 currentwindow 之类，避免抓到别的 bucket
                let meta_type = meta
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if meta_type == "currentwindow" || meta_type.contains("window") {
                    bucket_id = Some(id.clone());
                    break;
                }
            }
        }
    }

    let bucket_id = bucket_id.ok_or_else(|| {
        format!(
            "未找到 ActivityWatch 窗口 bucket（前缀 {}）。请确认 ActivityWatch 正在运行且 aw-watcher-window 已启动",
            bucket_prefix
        )
    })?;

    // 2) 拉事件
    let events_url = format!(
        "{}/api/0/buckets/{}/events?limit={}",
        base,
        urlencode(&bucket_id),
        limit
    );
    let events: Vec<AwEvent> = client
        .get(&events_url)
        .send()
        .await
        .map_err(|e| format!("拉取窗口事件失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析事件响应失败: {}", e))?;

    Ok(AwSyncResult {
        bucket_id,
        events,
        fetched_at: chrono_now_iso(),
    })
}

/// 健康检查：ActivityWatch 是否在线
#[tauri::command]
pub async fn aw_health(
    host: Option<String>,
    port: Option<u16>,
) -> Result<serde_json::Value, String> {
    let host = host.unwrap_or_else(|| "127.0.0.1".to_string());
    let port = port.unwrap_or(5600);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp: serde_json::Value = client
        .get(format!("http://{}:{}/api/0/info", host, port))
        .send()
        .await
        .map_err(|e| format!("ActivityWatch 未运行（{}:{}）: {}", host, port, e))?
        .json()
        .await
        .map_err(|e| format!("解析 info 响应失败: {}", e))?;

    Ok(resp)
}

fn urlencode(s: &str) -> String {
    // bucket id 形如 aw-watcher-window_我的电脑，包含中文，需要 URL 编码
    let mut out = String::new();
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}

fn chrono_now_iso() -> String {
    // 不用额外依赖 chrono，用系统时间格式化近似 ISO
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    // UTC+8 近似（本机时区）
    let local = secs + 8 * 3600;
    let days = local / 86400;
    let rem = local % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // 简单年/月/日计算（从 1970-01-01）
    let (y, mo, d) = civil_from_days(days as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, mo, d, h, m, s, millis
    )
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

