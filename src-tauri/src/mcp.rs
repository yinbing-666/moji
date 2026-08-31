use serde::Serialize;
use serde_json::{json, Value};
use std::{
    env,
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;

use crate::query::{self, ActivityQuery};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub executable: String,
    pub args: Vec<&'static str>,
    pub database_path: String,
    pub tools: Vec<&'static str>,
}

fn mcp_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "moji-mcp.exe"
    } else {
        "moji-mcp"
    }
}

fn mcp_server_command(
    current_exe: &Path,
    exists: impl Fn(&Path) -> bool,
) -> (PathBuf, Vec<&'static str>) {
    let standalone = current_exe.with_file_name(mcp_binary_name());
    if exists(&standalone) {
        (standalone, Vec::new())
    } else {
        (current_exe.to_path_buf(), vec!["--mcp"])
    }
}

fn default_database_path() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("com.xiaohei.daily").join("moji.db"))
    } else if cfg!(target_os = "macos") {
        env::var_os("HOME")
            .map(PathBuf::from)
            .map(|path| path.join("Library/Application Support/com.xiaohei.daily/moji.db"))
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                env::var_os("HOME")
                    .map(PathBuf::from)
                    .map(|path| path.join(".local/share"))
            })
            .map(|path| path.join("com.xiaohei.daily").join("moji.db"))
    }
}

fn database_path() -> Result<PathBuf, String> {
    let args: Vec<String> = env::args().collect();
    if let Some(index) = args.iter().position(|arg| arg == "--db") {
        return args
            .get(index + 1)
            .map(PathBuf::from)
            .ok_or_else(|| "--db 缺少路径".to_string());
    }
    env::var_os("MOJI_DB_PATH")
        .map(PathBuf::from)
        .or_else(default_database_path)
        .ok_or_else(|| "无法确定墨记数据库路径，请设置 MOJI_DB_PATH".to_string())
}

fn tool_result(value: Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": value.to_string() }],
        "structuredContent": value,
        "isError": false
    })
}

fn tool_error(message: String) -> Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true
    })
}

fn handle(request: &Value, db_path: &PathBuf) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method")?.as_str()?;
    if id.is_none() {
        return None;
    }
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2025-06-18",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "moji", "version": env!("CARGO_PKG_VERSION") }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({
            "tools": [
                {
                    "name": "search_activities",
                    "description": "只读搜索墨记活动记录",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "from": { "type": "string", "description": "ISO 8601 起始时间，包含边界" },
                            "to": { "type": "string", "description": "ISO 8601 结束时间，不包含边界" },
                            "keyword": { "type": "string" },
                            "limit": { "type": "integer", "minimum": 1, "maximum": 500, "default": 200 }
                        },
                        "additionalProperties": false
                    }
                },
                {
                    "name": "get_activity_summary",
                    "description": "只读汇总墨记活动时长、分类和应用",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "from": { "type": "string", "description": "ISO 8601 起始时间，包含边界" },
                            "to": { "type": "string", "description": "ISO 8601 结束时间，不包含边界" }
                        },
                        "additionalProperties": false
                    }
                },
                {
                    "name": "get_moji_health",
                    "description": "读取墨记数据库健康状态，不返回活动内容",
                    "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
                }
            ]
        })),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let value = match name {
                "search_activities" => serde_json::from_value::<ActivityQuery>(arguments)
                    .map_err(|_| "活动查询参数格式有误".to_string())
                    .and_then(|query| query::load_activities(db_path, &query).map(Value::Array)),
                "get_activity_summary" => {
                    let from = arguments.get("from").and_then(Value::as_str);
                    let to = arguments.get("to").and_then(Value::as_str);
                    query::summary(db_path, from, to)
                }
                "get_moji_health" => query::health(db_path).and_then(|health| {
                    serde_json::to_value(health)
                        .map_err(|error| format!("序列化健康状态失败：{error}"))
                }),
                _ => Err("未找到对应 MCP 工具".to_string()),
            };
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": match value { Ok(value) => tool_result(value), Err(error) => tool_error(error) }
            }));
        }
        _ => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": "未找到对应方法" }
            }))
        }
    };
    Some(
        json!({ "jsonrpc": "2.0", "id": id, "result": result.unwrap_or_else(|error| tool_error(error)) }),
    )
}

pub fn run_stdio() {
    let db_path = match database_path() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let request = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(response) = handle(&request, &db_path) {
            if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
                break;
            }
        }
    }
}

#[tauri::command]
pub fn mcp_server_info(app: tauri::AppHandle) -> Result<McpServerInfo, String> {
    let current_exe =
        env::current_exe().map_err(|error| format!("读取墨记程序路径失败：{error}"))?;
    let (executable, args) = mcp_server_command(&current_exe, Path::exists);
    let database_path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("读取墨记数据目录失败：{error}"))?
        .join("moji.db");
    Ok(McpServerInfo {
        executable: executable.to_string_lossy().to_string(),
        args,
        database_path: database_path.to_string_lossy().to_string(),
        tools: vec![
            "search_activities",
            "get_activity_summary",
            "get_moji_health",
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_read_only_tools() {
        let response = handle(
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
            &PathBuf::from("missing.db"),
        )
        .expect("tools list response");
        let tools = response["result"]["tools"].as_array().expect("tools array");
        assert_eq!(tools.len(), 3);
        assert!(tools
            .iter()
            .all(|tool| !tool["name"].as_str().unwrap_or("").contains("write")));
    }

    #[test]
    fn prefers_standalone_mcp_binary_next_to_desktop_app() {
        let current_exe = PathBuf::from("install").join(if cfg!(target_os = "windows") {
            "moji-daily.exe"
        } else {
            "moji-daily"
        });
        let expected = current_exe.with_file_name(mcp_binary_name());

        let (executable, args) = mcp_server_command(&current_exe, |path| path == expected);

        assert_eq!(executable, expected);
        assert!(args.is_empty());
    }

    #[test]
    fn falls_back_to_desktop_app_when_standalone_binary_is_missing() {
        let current_exe = PathBuf::from("target").join("debug").join("moji-daily");

        let (executable, args) = mcp_server_command(&current_exe, |_| false);

        assert_eq!(executable, current_exe);
        assert_eq!(args, vec!["--mcp"]);
    }
}
