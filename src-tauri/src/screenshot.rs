use std::io::Cursor;
#[cfg(target_os = "windows")]
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use screenshots::{
    image::{imageops, ImageOutputFormat, RgbaImage},
    Screen,
};
use serde::Serialize;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, LPARAM, RECT},
    Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetShellWindow, GetWindow, GetWindowLongPtrW,
        GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, GWL_EXSTYLE, GW_OWNER, WS_EX_TOOLWINDOW,
    },
};

const MIN_WINDOW_WIDTH: i32 = 180;
const MIN_WINDOW_HEIGHT: i32 = 120;
const MAX_WINDOW_CAPTURES: usize = 8;

const DEFAULT_EXCLUDED_KEYWORDS: &[&str] = &[
    "1password",
    "bitwarden",
    "dashlane",
    "keepass",
    "lastpass",
    "password",
    "secret",
    "token",
    "authenticator",
    "bank",
    "wallet",
    "xiaohei_daily",
    "xiaohei-daily.exe",
    "墨记",
];

const SYSTEM_OVERLAY_KEYWORDS: &[&str] = &[
    "baidunetdisk",
    "cua-driver",
    "nvidia overlay",
    "textinputhost",
];

#[derive(Serialize)]
pub struct CapturedWindow {
    hwnd: String,
    pid: u32,
    title: String,
    process_name: String,
    process_path: String,
    is_foreground: bool,
    z_index: usize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    image_base64: String,
}

#[tauri::command]
pub fn take_screenshot() -> Result<String, String> {
    let screen = primary_screen()?;
    let image = screen
        .capture()
        .map_err(|error| format!("Failed to capture screenshot: {error}"))?;

    encode_png(image)
}

#[tauri::command]
pub fn capture_visible_windows(
    excluded_keywords: Option<Vec<String>>,
    capture_images: Option<bool>,
) -> Result<Vec<CapturedWindow>, String> {
    capture_visible_windows_impl(
        excluded_keywords.unwrap_or_default(),
        capture_images.unwrap_or(false),
    )
}

fn primary_screen() -> Result<Screen, String> {
    let mut screens =
        Screen::all().map_err(|error| format!("Failed to enumerate screens: {error}"))?;

    if screens.is_empty() {
        return Err("No screens available for capture".to_string());
    }

    let primary_index = screens
        .iter()
        .position(|screen| screen.display_info.is_primary)
        .unwrap_or(0);

    Ok(screens.swap_remove(primary_index))
}

fn encode_png(image: RgbaImage) -> Result<String, String> {
    let mut png_bytes = Cursor::new(Vec::new());
    screenshots::image::DynamicImage::ImageRgba8(image)
        .write_to(&mut png_bytes, ImageOutputFormat::Png)
        .map_err(|error| format!("Failed to encode screenshot as PNG: {error}"))?;

    Ok(STANDARD.encode(png_bytes.into_inner()))
}

fn excluded_match(title: &str, process_name: &str, excluded_keywords: &[String]) -> bool {
    let haystack = format!("{title} {process_name}").to_lowercase();
    DEFAULT_EXCLUDED_KEYWORDS
        .iter()
        .any(|keyword| haystack.contains(&keyword.to_lowercase()))
        || excluded_keywords
            .iter()
            .map(|keyword| keyword.trim().to_lowercase())
            .filter(|keyword| !keyword.is_empty())
            .any(|keyword| haystack.contains(&keyword))
}

#[cfg(target_os = "windows")]
fn window_exclusion(
    title: &str,
    process_name: &str,
    excluded_keywords: &[String],
) -> Option<ExclusionKind> {
    if excluded_match(title, process_name, excluded_keywords) {
        return Some(ExclusionKind::Privacy);
    }

    let haystack = format!("{title} {process_name}").to_lowercase();
    SYSTEM_OVERLAY_KEYWORDS
        .iter()
        .any(|keyword| haystack.contains(&keyword.to_lowercase()))
        .then_some(ExclusionKind::SystemOverlay)
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct WindowCandidate {
    hwnd: HWND,
    pid: u32,
    title: String,
    process_name: String,
    process_path: String,
    rect: RECT,
    area: i64,
    is_foreground: bool,
    z_index: usize,
    exclusion: Option<ExclusionKind>,
}

#[cfg(target_os = "windows")]
struct ProcessInfo {
    pid: u32,
    name: String,
    path: String,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, PartialEq, Eq)]
enum ExclusionKind {
    Privacy,
    SystemOverlay,
}

#[cfg(target_os = "windows")]
fn capture_visible_windows_impl(
    excluded_keywords: Vec<String>,
    capture_images: bool,
) -> Result<Vec<CapturedWindow>, String> {
    let mut candidates = enumerate_windows(&excluded_keywords)?;
    let all_windows = candidates.clone();

    candidates.retain(|candidate| candidate.exclusion.is_none());
    candidates.sort_by(|a, b| {
        b.is_foreground
            .cmp(&a.is_foreground)
            .then(a.z_index.cmp(&b.z_index))
            .then(b.area.cmp(&a.area))
    });

    let screens = if capture_images {
        Some(
            Screen::all()
                .map_err(|error| format!("Failed to enumerate screens: {error}"))?,
        )
    } else {
        None
    };

    let mut captured = Vec::new();

    for candidate in candidates.into_iter().take(MAX_WINDOW_CAPTURES) {
        // A desktop crop is not guaranteed to contain only the requested HWND.
        // If any higher-Z excluded window intersects it, do not return an image
        // under the candidate window's identity.
        if capture_images && is_obscured_by_excluded_window(&candidate, &all_windows) {
            continue;
        }

        // capture_images=false 时跳过截图（活动识别基于窗口文本，不需要图像），
        // 仅返回窗口元数据；缩略图/预览功能开启时才真正截屏。
        if !capture_images {
            captured.push(CapturedWindow {
                hwnd: format!("{:?}", candidate.hwnd),
                pid: candidate.pid,
                title: candidate.title,
                process_name: candidate.process_name,
                process_path: candidate.process_path,
                is_foreground: candidate.is_foreground,
                z_index: candidate.z_index,
                x: candidate.rect.left,
                y: candidate.rect.top,
                width: (candidate.rect.right - candidate.rect.left).max(0) as u32,
                height: (candidate.rect.bottom - candidate.rect.top).max(0) as u32,
                image_base64: String::new(),
            });
            continue;
        }

        let screens = screens
            .as_ref()
            .expect("screens must be available when image capture is enabled");

        if let Some(image) = capture_window_from_screens(&candidate.rect, screens)? {
            captured.push(CapturedWindow {
                hwnd: format!("{:?}", candidate.hwnd),
                pid: candidate.pid,
                title: candidate.title,
                process_name: candidate.process_name,
                process_path: candidate.process_path,
                is_foreground: candidate.is_foreground,
                z_index: candidate.z_index,
                x: candidate.rect.left,
                y: candidate.rect.top,
                width: image.width(),
                height: image.height(),
                image_base64: encode_png(image)?,
            });
        }
    }

    Ok(captured)
}

#[cfg(not(target_os = "windows"))]
fn capture_visible_windows_impl(
    excluded_keywords: Vec<String>,
    _capture_images: bool,
) -> Result<Vec<CapturedWindow>, String> {
    let foreground = crate::system::get_foreground_window()?;
    if excluded_match(&foreground.title, &foreground.process_name, &excluded_keywords) {
        return Ok(Vec::new());
    }
    Ok(vec![CapturedWindow {
        hwnd: "foreground".to_string(),
        pid: 0,
        title: foreground.title,
        process_name: foreground.process_name,
        process_path: String::new(),
        is_foreground: true,
        z_index: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        image_base64: String::new(),
    }])
}

#[cfg(target_os = "windows")]
fn enumerate_windows(excluded_keywords: &[String]) -> Result<Vec<WindowCandidate>, String> {
    struct EnumState {
        excluded_keywords: Vec<String>,
        foreground_hwnd: HWND,
        next_z_index: usize,
        windows: Vec<WindowCandidate>,
    }

    unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> i32 {
        let state = &mut *(lparam as *mut EnumState);
        if let Some(candidate) = window_candidate(
            hwnd,
            &state.excluded_keywords,
            state.foreground_hwnd,
            state.next_z_index,
        ) {
            state.windows.push(candidate);
        }
        state.next_z_index += 1;
        1
    }

    let mut state = EnumState {
        excluded_keywords: excluded_keywords.to_vec(),
        foreground_hwnd: unsafe { GetForegroundWindow() },
        next_z_index: 0,
        windows: Vec::new(),
    };

    let ok = unsafe { EnumWindows(Some(enum_window), &mut state as *mut EnumState as LPARAM) };
    if ok == 0 {
        return Err("Failed to enumerate visible windows".to_string());
    }

    Ok(state.windows)
}

#[cfg(target_os = "windows")]
fn window_candidate(
    hwnd: HWND,
    excluded_keywords: &[String],
    foreground_hwnd: HWND,
    z_index: usize,
) -> Option<WindowCandidate> {
    unsafe {
        if hwnd.is_null()
            || hwnd == GetShellWindow()
            || IsWindowVisible(hwnd) == 0
            || IsIconic(hwnd) != 0
            || !GetWindow(hwnd, GW_OWNER).is_null()
            || is_tool_window(hwnd)
            || is_cloaked_window(hwnd)
        {
            return None;
        }

        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return None;
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return None;
        }

        let title = window_title(hwnd);
        let process = process_info(hwnd);
        let exclusion = window_exclusion(&title, &process.name, excluded_keywords);

        // Keep excluded windows even when they have no title or are smaller
        // than normal capture candidates, so they can still act as privacy
        // blockers for desktop-based crops.
        if exclusion.is_none()
            && (title.trim().is_empty()
                || width < MIN_WINDOW_WIDTH
                || height < MIN_WINDOW_HEIGHT)
        {
            return None;
        }

        Some(WindowCandidate {
            hwnd,
            pid: process.pid,
            title,
            process_name: process.name,
            process_path: process.path,
            rect,
            area: i64::from(width) * i64::from(height),
            is_foreground: hwnd == foreground_hwnd,
            z_index,
            exclusion,
        })
    }
}

#[cfg(target_os = "windows")]
fn is_obscured_by_excluded_window(
    candidate: &WindowCandidate,
    all_windows: &[WindowCandidate],
) -> bool {
    all_windows.iter().any(|window| {
        window.exclusion.is_some()
            && window.z_index < candidate.z_index
            && intersect_rect(&candidate.rect, &window.rect).is_some()
    })
}

#[cfg(target_os = "windows")]
fn is_tool_window(hwnd: HWND) -> bool {
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        ex_style & WS_EX_TOOLWINDOW != 0
    }
}

#[cfg(target_os = "windows")]
fn is_cloaked_window(hwnd: HWND) -> bool {
    unsafe {
        let mut cloaked = 0u32;
        let result = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            &mut cloaked as *mut u32 as *mut core::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
        result == 0 && cloaked != 0
    }
}

#[cfg(target_os = "windows")]
fn window_title(hwnd: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }

        let mut buffer = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        String::from_utf16_lossy(&buffer[..copied as usize])
    }
}

#[cfg(target_os = "windows")]
fn process_info(hwnd: HWND) -> ProcessInfo {
    unsafe {
        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == 0 {
            return ProcessInfo {
                pid: 0,
                name: "Unknown".to_string(),
                path: String::new(),
            };
        }

        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if handle.is_null() {
            return ProcessInfo {
                pid: process_id,
                name: "Unknown".to_string(),
                path: String::new(),
            };
        }

        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
        CloseHandle(handle);

        if ok == 0 || size == 0 {
            return ProcessInfo {
                pid: process_id,
                name: "Unknown".to_string(),
                path: String::new(),
            };
        }

        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        let name = Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Unknown")
            .to_string();

        ProcessInfo {
            pid: process_id,
            name,
            path,
        }
    }
}

#[cfg(target_os = "windows")]
fn capture_window_from_screens(
    rect: &RECT,
    screens: &[Screen],
) -> Result<Option<RgbaImage>, String> {
    let width = (rect.right - rect.left).max(0) as u32;
    let height = (rect.bottom - rect.top).max(0) as u32;
    if width == 0 || height == 0 {
        return Ok(None);
    }

    let mut output = RgbaImage::new(width, height);
    let mut wrote_pixels = false;

    for screen in screens {
        let screen_rect = screen_rect(screen);
        let Some(intersection) = intersect_rect(rect, &screen_rect) else {
            continue;
        };

        let crop_width = (intersection.right - intersection.left) as u32;
        let crop_height = (intersection.bottom - intersection.top) as u32;
        if crop_width == 0 || crop_height == 0 {
            continue;
        }

        let local_x = intersection.left - screen_rect.left;
        let local_y = intersection.top - screen_rect.top;
        let image = screen
            .capture_area(local_x, local_y, crop_width, crop_height)
            .map_err(|error| format!("Failed to capture window area: {error}"))?;

        imageops::overlay(
            &mut output,
            &image,
            i64::from(intersection.left - rect.left),
            i64::from(intersection.top - rect.top),
        );
        wrote_pixels = true;
    }

    Ok(wrote_pixels.then_some(output))
}

#[cfg(target_os = "windows")]
fn screen_rect(screen: &Screen) -> RECT {
    let info = screen.display_info;
    RECT {
        left: info.x,
        top: info.y,
        right: info.x + info.width as i32,
        bottom: info.y + info.height as i32,
    }
}

#[cfg(target_os = "windows")]
fn intersect_rect(a: &RECT, b: &RECT) -> Option<RECT> {
    let left = a.left.max(b.left);
    let top = a.top.max(b.top);
    let right = a.right.min(b.right);
    let bottom = a.bottom.min(b.bottom);

    (left < right && top < bottom).then_some(RECT {
        left,
        top,
        right,
        bottom,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "captures the current desktop; run manually for local verification"]
    fn captures_visible_windows_without_printing_image_data() {
        let windows = capture_visible_windows_impl(Vec::new(), true)
            .expect("visible window capture should not fail");

        println!("captured_windows={}", windows.len());
        for window in windows.iter().take(5) {
            println!(
                "window process={} size={}x{} title_chars={}",
                window.process_name,
                window.width,
                window.height,
                window.title.chars().count()
            );
            assert!(window.width > 0);
            assert!(window.height > 0);
            assert!(!window.image_base64.is_empty());
        }
    }

    #[test]
    #[ignore = "captures the current desktop; run manually with multiple visible windows"]
    fn captures_multiple_visible_windows_without_printing_image_data() {
        let windows = capture_visible_windows_impl(Vec::new(), true)
            .expect("visible window capture should not fail");

        println!("captured_windows={}", windows.len());
        let mut unique_processes = std::collections::BTreeSet::new();
        for window in &windows {
            unique_processes.insert(window.process_name.clone());
            println!(
                "window process={} size={}x{} title_chars={}",
                window.process_name,
                window.width,
                window.height,
                window.title.chars().count()
            );
            assert!(window.width > 0);
            assert!(window.height > 0);
            assert!(!window.image_base64.is_empty());
        }

        assert!(
            windows.len() >= 2,
            "expected at least two capturable windows, got {}",
            windows.len()
        );
        assert!(
            unique_processes.len() >= 2,
            "expected at least two different app processes, got {}",
            unique_processes.len()
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "prints sanitized window filtering diagnostics"]
    fn prints_window_filtering_diagnostics() {
        let candidates =
            enumerate_windows(&Vec::new()).expect("window enumeration should not fail");
        println!("candidate_windows={}", candidates.len());

        let privacy_rects: Vec<RECT> = candidates
            .iter()
            .filter(|candidate| candidate.exclusion == Some(ExclusionKind::Privacy))
            .map(|candidate| candidate.rect)
            .collect();

        for candidate in candidates.iter().take(20) {
            let intersects_privacy = privacy_rects
                .iter()
                .any(|rect| intersect_rect(&candidate.rect, rect).is_some());
            let exclusion = match candidate.exclusion {
                Some(ExclusionKind::Privacy) => "privacy",
                Some(ExclusionKind::SystemOverlay) => "overlay",
                None => "none",
            };
            println!(
                "candidate process={} size={}x{} title_chars={} exclusion={} intersects_privacy={}",
                candidate.process_name,
                candidate.rect.right - candidate.rect.left,
                candidate.rect.bottom - candidate.rect.top,
                candidate.title.chars().count(),
                exclusion,
                intersects_privacy
            );
        }
    }
}
