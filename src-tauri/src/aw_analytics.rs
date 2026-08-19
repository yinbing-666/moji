//! 集成 ActivityWatch Analytics Skill(Python 脚本)。
//! 调用 scripts/activitywatch_analytics.py 生成隐私保护的效率报告,
//! 解析 report.json 返回关键指标供前端展示。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
pub struct AwLevel {
    pub level: String,
    pub seconds: f64,
    pub percent: f64,
    pub points: f64,
}

#[derive(Serialize, Deserialize)]
struct AwReport {
    summary: Option<AwSummary>,
}

#[derive(Serialize, Deserialize)]
struct AwSummary {
    pulse: f64,
    score_status: Option<String>,
    active_seconds: Option<f64>,
    productive_percent: Option<f64>,
    levels: Option<Vec<AwLevel>>,
    ai_seconds: Option<f64>,
    deep_work: Option<AwDeepWork>,
}

#[derive(Serialize, Deserialize)]
struct AwDeepWork {
    seconds: f64,
    longest_seconds: f64,
    block_count: u64,
}

/// 分析结果摘要(返回给前端)
#[derive(Serialize, Clone)]
pub struct AwAnalyticsResult {
    pub period_id: String,
    pub pulse: f64,
    pub score_status: String,
    pub active_seconds: f64,
    pub productive_percent: f64,
    pub ai_seconds: f64,
    pub deep_work_seconds: f64,
    pub deep_work_blocks: u64,
    pub levels: Vec<AwLevel>,
    pub report_json: String,
    pub report_html: String,
}

/// 安装包优先从资源目录读取；开发环境回退到仓库内的 vendored 脚本。
fn script_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("tools/activitywatch-analytics"));
    }
    if let Some(project_root) = manifest.parent() {
        candidates.push(project_root.join("tools/activitywatch-analytics"));
    }

    for dir in &candidates {
        if dir.join("scripts/activitywatch_analytics.py").exists() {
            return Ok(dir.clone());
        }
    }

    let checked = candidates
        .iter()
        .map(|dir| dir.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!("ActivityWatch 分析脚本不存在，已检查: {checked}"))
}

/// 运行 AW 分析脚本并解析 report.json,返回关键指标。
/// period: today / yesterday / this-week / last-week
#[tauri::command]
pub async fn run_aw_analytics(
    app_handle: tauri::AppHandle,
    period: String,
    host: Option<String>,
    port: Option<u16>,
) -> Result<AwAnalyticsResult, String> {
    let dir = script_dir(&app_handle)?;
    let script = dir.join("scripts/activitywatch_analytics.py");

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let output_root = app_data_dir.join("aw-reports");
    std::fs::create_dir_all(&output_root).map_err(|e| format!("创建输出目录失败: {e}"))?;

    let mut python_args = vec![
        script.to_string_lossy().to_string(),
        "analyze".to_string(),
        "--period".to_string(),
        period.clone(),
        "--locale".to_string(),
        "zh-CN".to_string(),
        "--output".to_string(),
        output_root.to_string_lossy().to_string(),
    ];

    if let Some(host) = host.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        python_args.push("--api-base".to_string());
        python_args.push(format!("http://{}:{}", host, port.unwrap_or(5600)));
    }

    let output = match Command::new("python").args(&python_args).output() {
        Ok(output) => output,
        Err(error)
            if cfg!(target_os = "windows")
                && error.kind() == std::io::ErrorKind::NotFound =>
        {
            Command::new("py")
                .arg("-3")
                .args(&python_args)
                .output()
                .map_err(|fallback| format!("无法启动 Python 3（已尝试 python 和 py -3）: {fallback}"))?
        }
        Err(error) => return Err(format!("无法启动 Python(请确认已安装 Python 3): {error}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "分析脚本执行失败: {}",
            stderr.lines().next_back().unwrap_or("未知错误")
        ));
    }

    // 解析 stdout 中的 {"json": ..., "html": ...} 路径
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut report_json: Option<PathBuf> = None;
    let mut report_html: Option<PathBuf> = None;
    for line in stdout.lines() {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(j) = v.get("json").and_then(|x| x.as_str()) {
                report_json = Some(PathBuf::from(j));
            }
            if let Some(h) = v.get("html").and_then(|x| x.as_str()) {
                report_html = Some(PathBuf::from(h));
            }
        }
    }
    // 兜底:直接找 output_root 下最新的 report.json
    let report_json = report_json.or_else(|| find_report_json(&output_root));
    let report_json = report_json.ok_or_else(|| "未找到生成的 report.json".to_string())?;
    let report_html = report_html.unwrap_or_else(|| report_json.with_file_name("report.html"));

    // 解析 report.json
    let text = std::fs::read_to_string(&report_json)
        .map_err(|e| format!("读取 report.json 失败: {e}"))?;
    let data: AwReport = serde_json::from_str(&text).map_err(|e| format!("解析 report.json 失败: {e}"))?;
    let summary = data.summary.ok_or_else(|| "report.json 缺少 summary".to_string())?;

    let period_id = report_json
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "report".to_string());

    let deep = summary.deep_work.unwrap_or(AwDeepWork {
        seconds: 0.0,
        longest_seconds: 0.0,
        block_count: 0,
    });

    Ok(AwAnalyticsResult {
        period_id,
        pulse: summary.pulse,
        score_status: summary.score_status.unwrap_or_else(|| "unknown".to_string()),
        active_seconds: summary.active_seconds.unwrap_or(0.0),
        productive_percent: summary.productive_percent.unwrap_or(0.0),
        ai_seconds: summary.ai_seconds.unwrap_or(0.0),
        deep_work_seconds: deep.seconds,
        deep_work_blocks: deep.block_count,
        levels: summary.levels.unwrap_or_default(),
        report_json: report_json.to_string_lossy().to_string(),
        report_html: report_html.to_string_lossy().to_string(),
    })
}

/// 用系统默认浏览器打开本地 HTML 报告
#[tauri::command]
pub async fn open_aw_report(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("打开报告失败: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("xdg-open").arg(&path).spawn();
        let _ = Command::new("open").arg(&path).spawn();
    }
    Ok(())
}

/// 探测并启动 ActivityWatch(常见安装路径)。返回启动的可执行文件路径。
#[tauri::command]
pub async fn launch_activitywatch() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(home) = std::env::var("USERPROFILE") {
            candidates.push(PathBuf::from(&home).join("ActivityWatch/aw-qt.exe"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local).join("Programs/activitywatch/aw-qt.exe"));
            candidates.push(PathBuf::from(&local).join("Programs/ActivityWatch/aw-qt.exe"));
        }
        candidates.push(PathBuf::from("C:/Program Files/ActivityWatch/aw-qt.exe"));

        for path in &candidates {
            if path.exists() {
                Command::new(path)
                    .spawn()
                    .map_err(|e| format!("启动 ActivityWatch 失败: {e}"))?;
                return Ok(path.to_string_lossy().to_string());
            }
        }
        Err("未找到 ActivityWatch，请先手动安装或启动".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("非 Windows 平台暂不支持自动启动".to_string())
    }
}

fn find_report_json(root: &Path) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(root).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            let candidate = path.join("report.json");
            if candidate.exists() {
                let mtime = std::fs::metadata(&candidate).ok()?.modified().ok()?;
                if best.as_ref().map(|(t, _)| mtime > *t).unwrap_or(true) {
                    best = Some((mtime, candidate));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}
