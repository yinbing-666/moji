use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct ForegroundWindowInfo {
    pub process_name: String,
    pub title: String,
}

pub fn window_capture_capability() -> (bool, String) {
    if cfg!(target_os = "windows") {
        (true, "支持窗口元数据和 UI Automation 文本".to_string())
    } else if cfg!(target_os = "macos") {
        (true, "支持前台应用和窗口标题；需要辅助功能权限".to_string())
    } else if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        (false, "Wayland 不允许通用前台窗口采集，可继续使用导入和 ActivityWatch".to_string())
    } else if std::env::var_os("DISPLAY").is_some() {
        (true, "通过 X11 读取前台窗口元数据".to_string())
    } else {
        (false, "当前桌面会话不提供前台窗口采集".to_string())
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn get_foreground_window() -> Result<ForegroundWindowInfo, String> {
    use windows_sys::Win32::{
        Foundation::HWND,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
            GetWindowThreadProcessId,
        },
    };
    use std::path::Path;

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.is_null() {
            return Ok(ForegroundWindowInfo {
                process_name: "Unknown".to_string(),
                title: String::new(),
            });
        }

        // title
        let title_len = GetWindowTextLengthW(hwnd);
        let title = if title_len > 0 {
            let mut buf = vec![0u16; title_len as usize + 1];
            let copied = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            String::from_utf16_lossy(&buf[..copied as usize])
        } else {
            String::new()
        };

        // process name
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let process_name = if pid != 0 {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !handle.is_null() {
                let mut buf = vec![0u16; 32768];
                let mut size = buf.len() as u32;
                let ok =
                    QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
                let _ = windows_sys::Win32::Foundation::CloseHandle(handle);
                if ok != 0 && size > 0 {
                    let path = String::from_utf16_lossy(&buf[..size as usize]);
                    Path::new(&path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string()
                } else {
                    "Unknown".to_string()
                }
            } else {
                "Unknown".to_string()
            }
        } else {
            "Unknown".to_string()
        };

        Ok(ForegroundWindowInfo {
            process_name,
            title,
        })
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn get_foreground_window() -> Result<ForegroundWindowInfo, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to tell (first application process whose frontmost is true) to return name & linefeed & name of front window",
            ])
            .output()
            .map_err(|error| format!("启动 macOS 前台窗口查询失败：{error}"))?;
        if !output.status.success() {
            return Err("无法读取前台窗口，请在系统设置中授予墨记辅助功能权限".to_string());
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut lines = text.lines();
        let process_name = lines.next().unwrap_or("").trim().to_string();
        let title = lines.collect::<Vec<_>>().join("\n").trim().to_string();
        if process_name.is_empty() {
            return Err("macOS 未返回前台应用".to_string());
        }
        return Ok(ForegroundWindowInfo { process_name, title });
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return Err("Wayland 会话暂不支持通用前台窗口采集".to_string());
        }
        let root = std::process::Command::new("xprop")
            .args(["-root", "_NET_ACTIVE_WINDOW"])
            .output()
            .map_err(|_| "Linux X11 采集需要 xprop".to_string())?;
        if !root.status.success() {
            return Err("X11 未返回前台窗口".to_string());
        }
        let root_text = String::from_utf8_lossy(&root.stdout);
        let window_id = root_text.split_whitespace().last().unwrap_or("").trim();
        if window_id.is_empty() || window_id == "0x0" {
            return Err("X11 当前没有可读取的前台窗口".to_string());
        }
        let details = std::process::Command::new("xprop")
            .args(["-id", window_id, "WM_CLASS", "_NET_WM_NAME", "WM_NAME"])
            .output()
            .map_err(|_| "Linux X11 采集需要 xprop".to_string())?;
        if !details.status.success() {
            return Err("无法读取 X11 前台窗口属性".to_string());
        }
        let details = String::from_utf8_lossy(&details.stdout);
        let quoted = |line: &str| {
            line.split('"').enumerate().filter_map(|(index, part)| (index % 2 == 1).then_some(part)).collect::<Vec<_>>()
        };
        let process_name = details.lines().find(|line| line.starts_with("WM_CLASS"))
            .map(quoted).and_then(|parts| parts.last().copied().map(str::to_string))
            .unwrap_or_else(|| "Unknown".to_string());
        let title = details.lines().find(|line| line.starts_with("_NET_WM_NAME"))
            .or_else(|| details.lines().find(|line| line.starts_with("WM_NAME")))
            .map(quoted).and_then(|parts| parts.first().copied().map(str::to_string))
            .unwrap_or_default();
        return Ok(ForegroundWindowInfo { process_name, title });
    }

    #[allow(unreachable_code)]
    Err("当前平台暂不支持前台窗口采集".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn get_idle_seconds() -> Result<u32, String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetLastInputInfo;

    unsafe {
        let mut lii = windows_sys::Win32::UI::Input::KeyboardAndMouse::LASTINPUTINFO {
            cbSize: std::mem::size_of::<windows_sys::Win32::UI::Input::KeyboardAndMouse::LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut lii) == 0 {
            return Err("Failed to get last input info".to_string());
        }
        let tick = windows_sys::Win32::System::SystemInformation::GetTickCount();
        Ok((tick.saturating_sub(lii.dwTime)) / 1000)
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn get_idle_seconds() -> Result<u32, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("ioreg")
            .args(["-c", "IOHIDSystem"])
            .output()
            .map_err(|error| format!("启动 macOS 空闲时间查询失败：{error}"))?;
        let text = String::from_utf8_lossy(&output.stdout);
        let value = text.lines().find(|line| line.contains("HIDIdleTime"))
            .and_then(|line| line.split('=').nth(1))
            .and_then(|value| value.trim().parse::<u64>().ok())
            .ok_or_else(|| "macOS 未返回空闲时间".to_string())?;
        return Ok((value / 1_000_000_000).min(u32::MAX as u64) as u32);
    }
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return Err("Wayland 会话无法通用读取空闲时间".to_string());
        }
        let output = std::process::Command::new("xprintidle")
            .output()
            .map_err(|_| "Linux X11 空闲检测需要 xprintidle".to_string())?;
        let milliseconds = String::from_utf8_lossy(&output.stdout).trim().parse::<u64>()
            .map_err(|_| "xprintidle 返回值无效".to_string())?;
        return Ok((milliseconds / 1000).min(u32::MAX as u64) as u32);
    }
    #[allow(unreachable_code)]
    Err("当前平台暂不支持空闲时间检测".to_string())
}

#[tauri::command]
pub fn is_screen_locked() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        // Check if the logon desktop is not the current desktop (screen locked)
        // Simple heuristic: try to open the default input desktop
        use windows_sys::Win32::{
            System::StationsAndDesktops::{
                OpenInputDesktop, CloseDesktop,
            },
            Foundation::GetLastError,
        };
        unsafe {
            let desktop = OpenInputDesktop(0, 0, 0x0100); // GENERIC_READ
            if desktop.is_null() {
                let err = GetLastError();
                // ERROR_ACCESS_DENIED or similar when locked
                return Ok(err != 0);
            }
            CloseDesktop(desktop);
            Ok(false)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        {
            let output = std::process::Command::new("ioreg")
                .args(["-n", "Root", "-d1"])
                .output()
                .map_err(|error| format!("启动 macOS 锁屏查询失败：{error}"))?;
            let text = String::from_utf8_lossy(&output.stdout);
            return Ok(text.contains("CGSSessionScreenIsLocked") && text.contains("Yes"));
        }
        #[cfg(target_os = "linux")]
        {
            let session = std::env::var("XDG_SESSION_ID").map_err(|_| "Linux 会话 ID 不可用".to_string())?;
            let output = std::process::Command::new("loginctl")
                .args(["show-session", &session, "-p", "LockedHint", "--value"])
                .output()
                .map_err(|_| "Linux 锁屏检测需要 loginctl".to_string())?;
            return Ok(String::from_utf8_lossy(&output.stdout).trim().eq_ignore_ascii_case("yes"));
        }
        #[allow(unreachable_code)]
        Err("当前平台暂不支持锁屏检测".to_string())
    }
}

#[tauri::command]
pub fn diagnose_db(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let db_path = app_data_dir.join("moji.db");

    if !db_path.exists() {
        return Ok("数据库文件尚未创建（首次运行后自动生成）".to_string());
    }

    let size = std::fs::metadata(&db_path)
        .map(|m| m.len())
        .unwrap_or(0);

    let size_kb = size as f64 / 1024.0;
    Ok(format!("数据库正常，大小: {:.1} KB", size_kb))
}
