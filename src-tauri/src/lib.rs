mod aw;
mod ai;
mod aw_analytics;
mod data_source;
mod db;
mod desktop;
mod local_api;
pub mod mcp;
mod pdf;
pub mod query;
mod sync;
mod screenshot;
mod system;
mod uia;

use db::Database;
use std::sync::Mutex;
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        desktop::toggle_main_window(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            let conn = db::init_database(&app_data_dir)
                .expect("failed to initialize SQLite database");

            app.manage(Database(Mutex::new(conn)));
            app.manage(aw::start_internal_server(app.handle())?);
            app.manage(local_api::LocalApiServer::default());

            // 系统托盘：常驻后台采集，关窗不退出
            let show = MenuItem::with_id(app, "show", "显示墨记", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let tray = TrayIconBuilder::with_id("moji-tray")
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("墨记 - 工作日报助手")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // 左键单击直接唤起主窗口
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            tray.set_visible(true).ok();

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮 → 隐藏到托盘，保持后台采集；真正退出走托盘菜单
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // screenshot (existing)
            screenshot::take_screenshot,
            screenshot::capture_visible_windows,
            // db: activities
            db::db_save_activity,
            db::db_load_activities,
            db::db_delete_activity,
            db::db_clear_activities,
            db::db_import_activities,
            db::db_replace_activities,
            db::db_search_activities,
            db::db_get_storage_stats,
            db::db_cleanup_activities,
            db::db_save_weekly_plan,
            db::db_load_weekly_plan,
            local_api::start_local_api,
            local_api::stop_local_api,
            local_api::local_api_status,
            data_source::list_activity_sources,
            sync::sync_with_folder,
            desktop::desktop_integration_status,
            desktop::set_autostart,
            desktop::set_global_shortcut,
            desktop::request_notification_permission,
            desktop::send_system_notification,
            desktop::pick_sync_folder,
            pdf::export_report_pdf,
            mcp::mcp_server_info,
            // db: report history
            db::db_save_report_history,
            db::db_load_report_history,
            db::db_delete_report_history,
            // backup / restore
            db::save_backup,
            db::load_backup,
            db::restore_backup_to_db,
            // system detection
            system::get_foreground_window,
            system::get_idle_seconds,
            system::is_screen_locked,
            system::diagnose_db,
            // activitywatch
            aw::aw_fetch_events,
            aw::aw_health,
            aw::aw_write_window_event,
            // uia text extraction (vision-free activity analysis)
            uia::read_window_text,
            // ai chat completions proxy (bypasses CORS)
            ai::chat_completions,
            // 保留 HTML 导出兼容 IPC；主界面使用内置本地报告。
            aw_analytics::run_aw_analytics,
            aw_analytics::open_aw_report,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                local_api::stop_on_exit(app);
                aw::stop_internal_server(app);
            }
        });
}
