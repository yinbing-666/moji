//! 通过 Windows UI Automation 只读采集窗口内的结构化文本。
//!
//! 用途：替代截图 + 视觉模型。拿到窗口内控件文本（标签页、文件路径、列表项、
//! 文本块等），喂给纯文本 LLM 做活动分类与描述，从而彻底去掉多模态模型。
//!
//! 只读、纯文本、不上云；跳过密码框等敏感控件。
//!
//! 仅 Windows 实现；非 Windows 平台返回空文本（由前端降级为进程名+标题分析）。

use serde::Serialize;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTreeWalker,
    UIA_EditControlTypeId,
    UIA_DocumentControlTypeId,
    UIA_TextControlTypeId,
    UIA_ValuePatternId, IUIAutomationValuePattern,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextLengthW, GetWindowTextW};

#[cfg(target_os = "windows")]
/// UIA 客户端库在多线程并发初始化时存在竞态（并发调用会 E_FAIL）。
/// 用全局锁串行化所有 UIA 访问；读取本身很快（毫秒级），对并发采集影响可忽略。
static UIA_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(target_os = "windows")]
/// 常见浏览器/系统窗口的「界面装饰」控件名，对活动识别是纯噪声，直接跳过。
/// 只跳过这些标签本身；其子控件（如扩展名、书签、标签页标题）仍会继续遍历采集。
fn is_chrome_noise(name: &str) -> bool {
    const NOISE: &[&str] = &[
        // 标题栏 / 窗口按钮
        "最小化", "最大化", "最小化窗口", "最大化窗口", "恢复", "还原", "关闭", "关闭窗口",
        // 浏览器导航
        "返回", "前进", "重新加载", "停止加载", "主页", "刷新",
        // 地址栏 / 站点信息
        "查看网站信息", "地址和搜索栏", "搜索栏", "为此标签页添加书签", "为所有标签页添加书签",
        // 扩展 / 身份
        "扩展程序", "管理扩展程序", "验证身份", "信息栏",
        // 书签 / 标签页
        "书签", "书签栏", "新建标签页", "新建窗口", "标签页搜索",
        // 菜单 / 工具
        "历史记录", "下载内容", "下载", "打印", "缩放", "网页翻译", "翻译此页",
        "更多工具", "设置及更多", "自定义及控制", "自定义和控制", "在页面中查找",
        "页面菜单", "应用菜单", "浏览器菜单", "工具栏", "显示侧边栏",
        "为此标签页静音", "分享", "复制链接", "投射", "查找", "沉浸式阅读器", "阅读器",
        "将此页面添加到阅读列表", "添加书签",
        // 通用容器
        "菜单", "系统", "窗口", "关闭按钮",
    ];
    let n = name.trim().to_lowercase();
    NOISE.iter().any(|label| n == *label)
}

/// 单个窗口采集出的结果
#[derive(Serialize, Clone)]
pub struct WindowText {
    pub hwnd: String,
    /// 窗口标题（与截图方案一致，便于回填展示）
    pub title: String,
    /// 窗口内采集到的控件文本，按行拼接
    pub text: String,
    /// 采集到的控件数量
    pub element_count: usize,
}

/// 读取指定窗口（按 HWND）内的 UIA 文本。
/// `max_chars` 限制返回文本长度，默认 2000。
#[tauri::command]
pub fn read_window_text(hwnd: String, max_chars: Option<usize>) -> Result<WindowText, String> {
    #[cfg(target_os = "windows")]
    {
        let max_chars = max_chars.unwrap_or(2000).clamp(128, 12000);
        let parsed = parse_hwnd(&hwnd).ok_or_else(|| format!("无效的窗口句柄: {hwnd}"))?;
        let title = window_title(parsed).unwrap_or_default();
        let collected = collect_window_text(parsed, max_chars)?;

        return Ok(WindowText {
            hwnd,
            title,
            element_count: collected.element_count,
            text: collected.text,
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(WindowText {
            hwnd,
            title: String::new(),
            element_count: 0,
            text: String::new(),
        })
    }
}

#[cfg(target_os = "windows")]
/// 解析前端传来的 HWND 字符串。Rust 截图端用 `format!("{:?}", hwnd)` 生成，
/// 形如 `HWND(0x1a08ee)`；同时兼容裸 `0x...` 十六进制与十进制。
fn parse_hwnd(hwnd: &str) -> Option<HWND> {
    let trimmed = hwnd.trim();
    // 剥离 `HWND(0x...)` 包装（Debug 格式）
    let inner = trimmed
        .strip_prefix("HWND(")
        .and_then(|s| s.strip_suffix(")"))
        .unwrap_or(trimmed);
    let (radix, digits) = if inner.len() > 2 && (inner.starts_with("0x") || inner.starts_with("0X")) {
        (16, &inner[2..])
    } else {
        (10, inner)
    };
    let value = u64::from_str_radix(digits, radix).ok()?;
    Some(HWND(value as usize as *mut core::ffi::c_void))
}

#[cfg(target_os = "windows")]
fn window_title(hwnd: HWND) -> Option<String> {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buf);
        Some(String::from_utf16_lossy(&buf[..copied as usize]))
    }
}

#[cfg(target_os = "windows")]
struct CollectedText {
    text: String,
    element_count: usize,
}

#[cfg(target_os = "windows")]
/// 遍历窗口内所有后代控件，采出 Name 与 Value 文本并去重拼接。
fn collect_window_text(hwnd: HWND, max_chars: usize) -> Result<CollectedText, String> {
    // 串行化 UIA 访问，避免并发初始化的竞态
    let _guard = UIA_LOCK
        .lock()
        .map_err(|_| "UI Automation 全局锁失效".to_string())?;

    // 初始化 COM（UIA 需要）。可能在多线程调用下已被初始化，返回 S_FALSE/RPC_E_CHANGED_MODE 均视为可继续。
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }

    let automation: IUIAutomation =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e| format!("初始化 UI Automation 失败: {e}"))?;

    let root: IUIAutomationElement = unsafe { automation.ElementFromHandle(hwnd) }
        .map_err(|e| format!("获取窗口元素失败: {e}"))?;

    let walker: IUIAutomationTreeWalker = unsafe { automation.ControlViewWalker() }
        .map_err(|e| format!("获取控件树遍历器失败: {e}"))?;

    let mut lines: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut byte_budget = max_chars;
    let mut element_count = 0usize;

    walk_element(&walker, &root, &mut lines, &mut seen, &mut byte_budget, &mut element_count, 0);

    Ok(CollectedText {
        text: lines.join("\n"),
        element_count,
    })
}

#[cfg(target_os = "windows")]
/// 递归遍历的最大深度，避免畸形 UIA 树导致栈溢出或采集耗时失控。
const MAX_WALK_DEPTH: usize = 20;

#[cfg(target_os = "windows")]
fn walk_element(
    walker: &IUIAutomationTreeWalker,
    element: &IUIAutomationElement,
    lines: &mut Vec<String>,
    seen: &mut std::collections::HashSet<String>,
    byte_budget: &mut usize,
    element_count: &mut usize,
    depth: usize,
) {
    if *byte_budget == 0 || depth > MAX_WALK_DEPTH {
        return;
    }

    // 采集当前控件文本
    let control_type = unsafe { element.CurrentControlType().ok().map(|v| v.0) };
    let is_password = unsafe { element.CurrentIsPassword().ok().map(|v| v.as_bool()).unwrap_or(false) };

    let mut parts: Vec<String> = Vec::new();

    if let Ok(name) = unsafe { element.CurrentName() } {
        let name = name.to_string();
        // 跳过浏览器/系统窗口的装饰控件标签（其子控件仍会继续采集）
        if !name.is_empty() && !is_chrome_noise(&name) {
            parts.push(name);
        }
    }

    // 对于编辑框等有文本值的控件，取其 value；密码框和超大文本跳过。
    if !is_password
        && (control_type == Some(UIA_EditControlTypeId.0)
            || control_type == Some(UIA_DocumentControlTypeId.0)
            || control_type == Some(UIA_TextControlTypeId.0))
    {
        if let Ok(value) = read_value_text(element) {
            if !value.is_empty() && value.len() < 500 {
                parts.push(value);
            }
        }
    }

    if !parts.is_empty() {
        *element_count += 1;
        let line = parts.join("：");
        // 截断预算统一按字节计量（与 UTF-8 字符边界处理一致），
        // 避免之前字节数与字符数混用导致中文预算被低估、实际采集超支。
        if seen.insert(line.clone()) {
            let pushed = if line.len() > *byte_budget {
                let mut end = *byte_budget;
                while !line.is_char_boundary(end) {
                    end -= 1;
                }
                line[..end].to_string()
            } else {
                line
            };
            *byte_budget = byte_budget.saturating_sub(pushed.len());
            lines.push(pushed);
        }
    }

    // 深度优先遍历子元素（深度 +1，超出上限即停止）
    if let Ok(child) = unsafe { walker.GetFirstChildElement(element) } {
        walk_element(walker, &child, lines, seen, byte_budget, element_count, depth + 1);
    }

    // 兄弟元素（同深度）
    if let Ok(next) = unsafe { walker.GetNextSiblingElement(element) } {
        walk_element(walker, &next, lines, seen, byte_budget, element_count, depth);
    }
}

#[cfg(target_os = "windows")]
/// 通过 ValuePattern 读取控件的文本值（如编辑框内容）。
/// 控件不支持 ValuePattern 时返回空字符串。
fn read_value_text(element: &IUIAutomationElement) -> Result<String, String> {
    let pattern: IUIAutomationValuePattern = unsafe {
        element.GetCurrentPatternAs(UIA_ValuePatternId)
    }
    .map_err(|_| "该控件不支持 ValuePattern".to_string())?;

    let value = unsafe { pattern.CurrentValue() }.map_err(|e| format!("读取 value 失败: {e}"))?;
    Ok(value.to_string())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a live desktop with visible windows; run manually for verification"]
    fn reads_text_from_foreground_window() {
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }

        let hwnd = unsafe { GetForegroundWindow() };
        assert!(!hwnd.0.is_null(), "no foreground window available");

        let hwnd_str = format!("{:?}", hwnd);
        println!("foreground hwnd = {}", hwnd_str);

        let result = read_window_text(hwnd_str.clone(), Some(2000))
            .expect("read_window_text should succeed on the foreground window");
        println!("title = {}", result.title);
        println!("element_count = {}", result.element_count);
        println!("text (first 500 chars):\n{}", result.text.chars().take(500).collect::<String>());

        assert!(!result.hwnd.is_empty());
    }

    #[test]
    #[ignore = "requires a live desktop with visible windows; run manually for verification"]
    fn reads_text_from_worker_thread() {
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        // 模拟 Tauri 命令在后台工作线程执行的场景（每次线程不同 + COM 首次初始化）
        let hwnd = unsafe { GetForegroundWindow() };
        assert!(!hwnd.0.is_null(), "no foreground window available");
        let hwnd_str = format!("{:?}", hwnd);

        let handles: Vec<_> = (0..3)
            .map(|_| {
                let hwnd_str = hwnd_str.clone();
                std::thread::spawn(move || {
                    let result = read_window_text(hwnd_str, Some(800));
                    match result {
                        Ok(r) => format!("ok elements={} text_chars={}", r.element_count, r.text.chars().count()),
                        Err(e) => format!("err: {e}"),
                    }
                })
            })
            .collect();

        for handle in handles {
            let line = handle.join().expect("worker thread should not panic");
            println!("worker result: {line}");
            assert!(line.starts_with("ok"), "worker read failed: {line}");
        }
    }
}
