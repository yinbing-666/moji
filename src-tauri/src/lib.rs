mod aw;
mod ai;
mod aw_analytics;
mod db;
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
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            let conn = db::init_database(&app_data_dir)
                .expect("failed to initialize SQLite database");

            app.manage(Database(Mutex::new(conn)));

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
            db::db_load_activities_paginated,
            db::db_delete_activity,
            db::db_clear_activities,
            db::db_import_activities,
            db::db_replace_activities,
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
            // uia text extraction (vision-free activity analysis)
            uia::read_window_text,
            // ai chat completions proxy (bypasses CORS)
            ai::chat_completions,
            // activitywatch analytics skill integration
            aw_analytics::run_aw_analytics,
            aw_analytics::open_aw_report,
            aw_analytics::launch_activitywatch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
