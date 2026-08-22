use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::Manager;

use crate::query::{self, ActivityQuery};

struct RunningApi {
    port: u16,
    shutdown: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct LocalApiServer(Mutex<Option<RunningApi>>);

#[derive(Serialize)]
pub struct LocalApiStatus {
    pub running: bool,
    pub port: Option<u16>,
}

fn response(stream: &mut TcpStream, status: &str, value: Value) {
    let body = value.to_string();
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        body.as_bytes().len(),
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn url_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        decoded.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn parse_target(target: &str) -> (String, HashMap<String, String>) {
    let mut parts = target.splitn(2, '?');
    let path = parts.next().unwrap_or("/").to_string();
    let mut query = HashMap::new();
    if let Some(raw) = parts.next() {
        for pair in raw.split('&') {
            let mut entry = pair.splitn(2, '=');
            let key = url_decode(entry.next().unwrap_or(""));
            let value = url_decode(entry.next().unwrap_or(""));
            if !key.is_empty() {
                query.insert(key, value);
            }
        }
    }
    (path, query)
}

fn authorized(headers: &[&str], token: &str) -> bool {
    headers.iter().any(|header| {
        header
            .split_once(':')
            .map(|(name, value)| {
                let mut parts = value.split_whitespace();
                name.trim().eq_ignore_ascii_case("authorization")
                    && parts
                        .next()
                        .map(|scheme| scheme.eq_ignore_ascii_case("bearer"))
                        .unwrap_or(false)
                    && parts
                        .next()
                        .map(|supplied| supplied == token)
                        .unwrap_or(false)
                    && parts.next().is_none()
            })
            .unwrap_or(false)
    })
}

fn handle_connection(mut stream: TcpStream, db_path: &Path, token: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buffer = [0u8; 16_384];
    let size = match stream.read(&mut buffer) {
        Ok(size) if size > 0 => size,
        _ => return,
    };
    let request = String::from_utf8_lossy(&buffer[..size]);
    let mut lines = request.split("\r\n");
    let Some(request_line) = lines.next() else {
        return;
    };
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("");
    let target = request_parts.next().unwrap_or("/");
    if method != "GET" {
        response(
            &mut stream,
            "405 Method Not Allowed",
            json!({ "error": "只支持 GET" }),
        );
        return;
    }
    let headers: Vec<_> = lines.take_while(|line| !line.is_empty()).collect();
    if !authorized(&headers, token) {
        response(
            &mut stream,
            "401 Unauthorized",
            json!({ "error": "访问令牌无效" }),
        );
        return;
    }

    let (path, query) = parse_target(target);
    let result = match path.as_str() {
        "/health" => Ok(json!({ "status": "ok", "service": "moji-local-api" })),
        "/v1/activities" => query::load_activities(
            db_path,
            &ActivityQuery {
                from: query.get("from").filter(|value| !value.is_empty()).cloned(),
                to: query.get("to").filter(|value| !value.is_empty()).cloned(),
                keyword: query.get("q").cloned().unwrap_or_default(),
                limit: query
                    .get("limit")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(200)
                    .clamp(1, 500),
            },
        )
        .map(Value::Array),
        "/v1/summary" => query::summary(
            db_path,
            query
                .get("from")
                .filter(|value| !value.is_empty())
                .map(String::as_str),
            query
                .get("to")
                .filter(|value| !value.is_empty())
                .map(String::as_str),
        ),
        _ => {
            response(
                &mut stream,
                "404 Not Found",
                json!({ "error": "接口不存在" }),
            );
            return;
        }
    };
    match result {
        Ok(value) => response(&mut stream, "200 OK", value),
        Err(error) => response(
            &mut stream,
            "500 Internal Server Error",
            json!({ "error": error }),
        ),
    }
}

fn stop_running(running: &mut RunningApi) {
    running.shutdown.store(true, Ordering::Relaxed);
    let _ = TcpStream::connect(("127.0.0.1", running.port));
    if let Some(handle) = running.thread.take() {
        let _ = handle.join();
    }
}

#[tauri::command]
pub fn start_local_api(
    state: tauri::State<'_, LocalApiServer>,
    app_handle: tauri::AppHandle,
    port: u16,
    token: String,
) -> Result<LocalApiStatus, String> {
    if port < 1024 {
        return Err("本地 API 端口必须大于等于 1024".to_string());
    }
    if token.chars().count() < 24 {
        return Err("本地 API 访问令牌至少需要 24 个字符".to_string());
    }
    let db_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("读取应用数据目录失败: {error}"))?
        .join("moji.db");
    let mut guard = state
        .0
        .lock()
        .map_err(|error| format!("本地 API 状态锁失败: {error}"))?;
    if let Some(mut running) = guard.take() {
        stop_running(&mut running);
    }
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|error| format!("本地 API 无法监听 127.0.0.1:{port}: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("配置本地 API 监听失败: {error}"))?;
    let shutdown = Arc::new(AtomicBool::new(false));
    let thread_shutdown = shutdown.clone();
    let thread = thread::spawn(move || {
        while !thread_shutdown.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => handle_connection(stream, &db_path, &token),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
    });
    *guard = Some(RunningApi {
        port,
        shutdown,
        thread: Some(thread),
    });
    Ok(LocalApiStatus {
        running: true,
        port: Some(port),
    })
}

#[tauri::command]
pub fn stop_local_api(state: tauri::State<'_, LocalApiServer>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|error| format!("本地 API 状态锁失败: {error}"))?;
    if let Some(mut running) = guard.take() {
        stop_running(&mut running);
    }
    Ok(())
}

#[tauri::command]
pub fn local_api_status(state: tauri::State<'_, LocalApiServer>) -> Result<LocalApiStatus, String> {
    let guard = state
        .0
        .lock()
        .map_err(|error| format!("本地 API 状态锁失败: {error}"))?;
    Ok(LocalApiStatus {
        running: guard.is_some(),
        port: guard.as_ref().map(|running| running.port),
    })
}

pub fn stop_on_exit(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<LocalApiServer>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut running) = guard.take() {
                stop_running(&mut running);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_query_parameters_and_decodes_utf8() {
        let (path, query) =
            parse_target("/v1/activities?q=ActivityWatch&limit=20&from=2026-08-01T00%3A00%3A00Z");
        assert_eq!(path, "/v1/activities");
        assert_eq!(query.get("q").map(String::as_str), Some("ActivityWatch"));
        assert_eq!(query.get("limit").map(String::as_str), Some("20"));
        assert_eq!(
            query.get("from").map(String::as_str),
            Some("2026-08-01T00:00:00Z")
        );
    }

    #[test]
    fn bearer_token_is_required_and_case_sensitive() {
        let token = "Abcdefghijklmnopqrstuvwxyz123456";
        assert!(authorized(
            &["Authorization: Bearer Abcdefghijklmnopqrstuvwxyz123456"],
            token
        ));
        assert!(authorized(
            &["authorization: bearer Abcdefghijklmnopqrstuvwxyz123456"],
            token
        ));
        assert!(!authorized(
            &["Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"],
            token
        ));
        assert!(!authorized(&[], token));
    }
}
