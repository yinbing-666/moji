use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct ForegroundWindowInfo {
    pub process_name: String,
    pub title: String,
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
    Ok(ForegroundWindowInfo {
        process_name: "Unknown".to_string(),
        title: String::new(),
    })
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
    Ok(0)
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
        Ok(false)
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
