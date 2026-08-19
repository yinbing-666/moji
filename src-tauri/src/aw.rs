use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    process::{Child, Command},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager};

pub const INTERNAL_AW_HOST: &str = "127.0.0.1";
pub const INTERNAL_AW_PORT: u16 = 5601;
const INTERNAL_BUCKET_ID: &str = "aw-watcher-window_moji";

pub struct InternalAwServer(pub Mutex<Option<Child>>);

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
    let host = host
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| INTERNAL_AW_HOST.to_string());
    let port = port.unwrap_or(INTERNAL_AW_PORT);
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
        .error_for_status()
        .map_err(|e| format!("ActivityWatch buckets 请求失败: {e}"))?
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
            "未找到内置 ActivityWatch 窗口数据（前缀 {}）",
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
        .error_for_status()
        .map_err(|e| format!("ActivityWatch events 请求失败: {e}"))?
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
    let host = host
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| INTERNAL_AW_HOST.to_string());
    let port = port.unwrap_or(INTERNAL_AW_PORT);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp: serde_json::Value = client
        .get(format!("http://{}:{}/api/0/info", host, port))
        .send()
        .await
        .map_err(|e| format!("ActivityWatch 未运行（{}:{}）: {}", host, port, e))?
        .error_for_status()
        .map_err(|e| format!("ActivityWatch 健康检查失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 info 响应失败: {}", e))?;

    Ok(resp)
}

/// 将墨记采集的前台窗口写入内置 ActivityWatch bucket。
/// 失败不影响墨记本地活动记录，调用方可安全降级。
#[tauri::command]
pub async fn aw_write_window_event(input: AwWindowEventInput) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("构建 ActivityWatch HTTP 客户端失败: {e}"))?;
    let base = format!("http://{INTERNAL_AW_HOST}:{INTERNAL_AW_PORT}");
    let bucket_url = format!("{base}/api/0/buckets/{}", urlencode(INTERNAL_BUCKET_ID));
    let bucket = serde_json::json!({
        "id": INTERNAL_BUCKET_ID,
        "type": "currentwindow",
        "client": "moji",
        "hostname": "moji",
        "created": chrono_now_iso(),
    });

    let bucket_status = client
        .get(&bucket_url)
        .send()
        .await
        .map_err(|e| format!("检查内置 ActivityWatch 数据桶失败: {e}"))?
        .status();
    if bucket_status == reqwest::StatusCode::NOT_FOUND {
        client
            .post(&bucket_url)
            .json(&bucket)
            .send()
            .await
            .map_err(|e| format!("创建内置 ActivityWatch 数据桶失败: {e}"))?
            .error_for_status()
            .map_err(|e| format!("创建内置 ActivityWatch 数据桶失败: {e}"))?;
    } else if !bucket_status.is_success() {
        return Err(format!("检查内置 ActivityWatch 数据桶失败: HTTP {bucket_status}"));
    }

    let event = serde_json::json!({
        "timestamp": input.timestamp,
        "duration": input.duration.clamp(1.0, 3600.0),
        "data": { "app": input.app, "title": input.title },
    });
    client
        .post(format!("{bucket_url}/events"))
        .json(&vec![event])
        .send()
        .await
        .map_err(|e| format!("写入内置 ActivityWatch 活动失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("写入内置 ActivityWatch 活动失败: {e}"))?;

    Ok(())
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
    // 不用额外依赖 chrono，按 UTC 输出与末尾 Z 一致的 ISO 时间。
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format_unix_millis(now.as_secs(), now.subsec_millis())
}

#[derive(Deserialize)]
pub struct AwWindowEventInput {
    pub app: String,
    pub title: String,
    pub duration: f64,
    pub timestamp: String,
}

/// 启动随墨记分发的 ActivityWatch server。采集器仍由墨记管理，不需要外部 watcher。
pub fn start_internal_server(app: &AppHandle) -> Result<InternalAwServer, String> {
    if server_is_healthy() {
        return Ok(InternalAwServer(Mutex::new(None)));
    }

    let binary = internal_server_binary(app)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取 ActivityWatch 数据目录: {e}"))?
        .join("activitywatch");
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("无法创建 ActivityWatch 数据目录: {e}"))?;

    let child = Command::new(&binary)
        .arg("--host")
        .arg(INTERNAL_AW_HOST)
        .arg("--port")
        .arg(INTERNAL_AW_PORT.to_string())
        .arg("--dbpath")
        .arg(&data_dir)
        .arg("--device-id")
        .arg("moji")
        .arg("--no-legacy-import")
        .spawn()
        .map_err(|e| format!("启动内置 ActivityWatch 服务失败（{}）: {e}", binary.display()))?;

    Ok(InternalAwServer(Mutex::new(Some(child))))
}

pub fn stop_internal_server(app: &AppHandle) {
    let Some(server) = app.try_state::<InternalAwServer>() else {
        return;
    };
    let Ok(mut child) = server.0.lock() else {
        return;
    };
    if let Some(mut child) = child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn internal_server_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("aw-server-rust.exe"));
    }
    if let Some(project_root) = manifest.parent() {
        candidates.push(project_root.join("vendor/activitywatch/aw-server-rust.exe"));
    }

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "内置 ActivityWatch 服务文件缺失，无法启动采集服务".to_string())
}

fn server_is_healthy() -> bool {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(300))
        .build()
        .and_then(|client| client.get(format!("http://{INTERNAL_AW_HOST}:{INTERNAL_AW_PORT}/api/0/info")).send())
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn format_unix_millis(secs: u64, millis: u32) -> String {
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
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

#[cfg(test)]
mod tests {
    use super::{format_unix_millis, urlencode};

    #[test]
    fn formats_utc_timestamp_with_z_suffix() {
        assert_eq!(format_unix_millis(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_unix_millis(8 * 3600, 123), "1970-01-01T08:00:00.123Z");
    }

    #[test]
    fn encodes_non_ascii_bucket_ids() {
        assert_eq!(urlencode("aw_测试"), "aw_%E6%B5%8B%E8%AF%95");
    }
}

