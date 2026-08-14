mod aw;
mod ai;
mod aw_analytics;
mod db;
mod screenshot;
mod system;
mod uia;

use db::Database;
use std::sync::Mutex;
use tauri::Manager;

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
            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
