//! AI 请求代理：把 /chat/completions 调用从前端 fetch 搬到 Rust 后端。
//!
//! 为什么：浏览器里的 fetch 受 CORS 限制，遇到没配 Access-Control-Allow-Origin
//! 的 API 网关（如自建中转）会报 "fail to fetch"。reqwest 在服务端发起请求，
//! 不受 CORS 约束，同时 API Key 不再暴露在 WebView 的 JS 上下文里。

use serde::Deserialize;

#[derive(Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCompletionsRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
}

fn default_max_tokens() -> u32 {
    200
}
fn default_temperature() -> f64 {
    0.1
}

fn describe_http_error(status: u16) -> String {
    match status {
        401 => "API Key 无效或已过期，请到「设置」更新".to_string(),
        403 => "无权访问该模型，请检查 API Key 权限或模型名称".to_string(),
        404 => "模型或接口不存在，请检查 Base URL 与模型名称".to_string(),
        429 => "请求过于频繁或额度不足，请稍后重试".to_string(),
        s if s >= 500 => format!("AI 服务端异常（HTTP {s}），请稍后重试"),
        s => format!("AI 请求失败：HTTP {s}"),
    }
}

/// 调用 OpenAI 兼容的 /chat/completions，返回助手消息的 content 字符串。
#[tauri::command]
pub async fn chat_completions(req: ChatCompletionsRequest) -> Result<String, String> {
    let url = format!("{}/chat/completions", req.base_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;

    let messages: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let body = serde_json::json!({
        "model": req.model,
        "messages": messages,
        "max_tokens": req.max_tokens,
        "temperature": req.temperature,
        // 关闭 thinking/reasoning 模式：活动分析与报告都不需要深度推理，
        // 关闭后更快、更省 tokens、避免 thinking 吃掉配额导致 content 截断/为空。
        // 部分 OpenAI 兼容平台支持此参数；不认识的模型会忽略它。
        "enable_thinking": false,
    });

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", req.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败（网络不可达或地址有误）：{e}"))?;

    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;

    if status != 200 {
        return Err(describe_http_error(status));
    }

    let data: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {e}"))?;

    let content = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    if content.is_empty() {
        return Err("AI 返回了空内容".to_string());
    }

    Ok(content)
}
