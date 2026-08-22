use serde::Serialize;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_notification::NotificationExt;

pub const WINDOW_SHORTCUT: &str = "CommandOrControl+Shift+M";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIntegrationStatus {
    pub autostart_enabled: bool,
    pub shortcut_enabled: bool,
    pub shortcut: &'static str,
    pub notification_permission: String,
}

pub fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn desktop_integration_status(
    app: tauri::AppHandle,
) -> Result<DesktopIntegrationStatus, String> {
    let autostart_enabled = app
        .autolaunch()
        .is_enabled()
        .map_err(|error| format!("读取开机自启状态失败：{error}"))?;
    let shortcut_enabled = app.global_shortcut().is_registered(WINDOW_SHORTCUT);
    let notification_permission = format!(
        "{:?}",
        app.notification()
            .permission_state()
            .map_err(|error| format!("读取通知权限失败：{error}"))?
    );
    Ok(DesktopIntegrationStatus {
        autostart_enabled,
        shortcut_enabled,
        shortcut: WINDOW_SHORTCUT,
        notification_permission,
    })
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        app.autolaunch()
            .enable()
            .map_err(|error| format!("启用开机自启失败：{error}"))?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|error| format!("关闭开机自启失败：{error}"))?;
    }
    app.autolaunch()
        .is_enabled()
        .map_err(|error| format!("确认开机自启状态失败：{error}"))
}

#[tauri::command]
pub fn set_global_shortcut(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.global_shortcut();
    let registered = manager.is_registered(WINDOW_SHORTCUT);
    if enabled && !registered {
        manager.register(WINDOW_SHORTCUT).map_err(|error| {
            format!("注册快捷键 {WINDOW_SHORTCUT} 失败，可能与其他应用冲突：{error}")
        })?;
    } else if !enabled && registered {
        manager
            .unregister(WINDOW_SHORTCUT)
            .map_err(|error| format!("关闭全局快捷键失败：{error}"))?;
    }
    Ok(manager.is_registered(WINDOW_SHORTCUT))
}

#[tauri::command]
pub fn request_notification_permission(app: tauri::AppHandle) -> Result<String, String> {
    app.notification()
        .request_permission()
        .map(|state| format!("{state:?}"))
        .map_err(|error| format!("请求通知权限失败：{error}"))
}

#[tauri::command]
pub fn send_system_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    let title = title.trim();
    let body = body.trim();
    if title.is_empty()
        || title.chars().count() > 40
        || body.is_empty()
        || body.chars().count() > 160
    {
        return Err("通知标题或正文长度无效".to_string());
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("发送系统通知失败：{error}"))
}

#[tauri::command]
pub async fn pick_sync_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("选择墨记同步目录")
            .blocking_pick_folder()
            .map(|path| {
                path.into_path()
                    .map(|value| value.to_string_lossy().to_string())
            })
            .transpose()
            .map_err(|error| format!("读取同步目录失败：{error}"))
    })
    .await
    .map_err(|error| format!("打开目录选择器失败：{error}"))?
}
