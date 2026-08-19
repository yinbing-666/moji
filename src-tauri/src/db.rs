use rusqlite::{params, Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

pub struct Database(pub Mutex<Connection>);

#[derive(Serialize, Deserialize, Clone)]
pub struct DbActivity {
    pub id: String,
    pub timestamp: String,
    pub category: String,
    /// 前端旧版 localStorage 用 `app`，这里用 alias 兼容导入
    #[serde(alias = "app")]
    pub app_name: String,
    pub title: Option<String>,
    pub description: String,
    /// 前端旧版 localStorage 用 `screenshotBase64`，这里用 alias 兼容导入
    #[serde(alias = "screenshotBase64")]
    pub screenshot_base64: Option<String>,
    /// 活动持续秒数（AW 事件时长 / UIA 连续采集周期累计），NULL 表示未知
    #[serde(alias = "durationSeconds")]
    pub duration_seconds: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DbReportHistory {
    pub id: String,
    pub created_at: String,
    pub report_type: String,
    pub template: String,
    pub content: String,
}

pub fn init_database(app_data_dir: &PathBuf) -> Result<Connection, String> {
    fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    let db_path = app_data_dir.join("moji.db");
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {e}"))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activities (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            category TEXT NOT NULL,
            app_name TEXT NOT NULL,
            title TEXT,
            description TEXT NOT NULL,
            screenshot_base64 TEXT,
            duration_seconds INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_activities_ts ON activities(timestamp DESC);
        CREATE TABLE IF NOT EXISTS report_history (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            report_type TEXT NOT NULL,
            template TEXT NOT NULL DEFAULT 'standard',
            content TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_report_hist_created ON report_history(created_at DESC);",
    )
    .map_err(|e| format!("Failed to create tables: {e}"))?;

    migrate_schema(&conn)?;

    Ok(conn)
}

/// 旧版 schema 列名与当前代码不一致，启动时迁移（幂等）。
/// 旧版 activities 用 `app`，report_history 用 `type`；新版分别改为 `app_name` / `report_type`。
fn migrate_schema(conn: &Connection) -> Result<(), String> {
    if column_exists(conn, "activities", "app")? && !column_exists(conn, "activities", "app_name")? {
        conn.execute("ALTER TABLE activities RENAME COLUMN app TO app_name", [])
            .map_err(|e| format!("迁移 activities.app 失败: {e}"))?;
    }
    if column_exists(conn, "report_history", "type")? && !column_exists(conn, "report_history", "report_type")? {
        conn.execute("ALTER TABLE report_history RENAME COLUMN type TO report_type", [])
            .map_err(|e| format!("迁移 report_history.type 失败: {e}"))?;
    }
    // v0.2：活动时长列（旧库补列，新库建表时已包含）
    if !column_exists(conn, "activities", "duration_seconds")? {
        conn.execute("ALTER TABLE activities ADD COLUMN duration_seconds INTEGER", [])
            .map_err(|e| format!("迁移 activities.duration_seconds 失败: {e}"))?;
    }
    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| format!("读取表结构失败: {e}"))?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("读取列信息失败: {e}"))?;
    for name in names {
        if name.map_err(|e| format!("读取列名失败: {e}"))? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn row_to_activity(
    row: &rusqlite::Row,
) -> rusqlite::Result<DbActivity> {
    Ok(DbActivity {
        id: row.get("id")?,
        timestamp: row.get("timestamp")?,
        category: row.get("category")?,
        app_name: row.get("app_name")?,
        title: row.get("title")?,
        description: row.get("description")?,
        screenshot_base64: row.get("screenshot_base64")?,
        duration_seconds: row.get("duration_seconds")?,
    })
}

fn row_to_report_history(row: &rusqlite::Row) -> rusqlite::Result<DbReportHistory> {
    Ok(DbReportHistory {
        id: row.get("id")?,
        created_at: row.get("created_at")?,
        report_type: row.get("report_type")?,
        template: row.get("template")?,
        content: row.get("content")?,
    })
}

// ── Activity CRUD ──

#[tauri::command]
pub fn db_save_activity(
    db: tauri::State<'_, Database>,
    id: String,
    timestamp: String,
    category: String,
    app_name: String,
    title: Option<String>,
    description: String,
    screenshot_base64: Option<String>,
    duration_seconds: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO activities (id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds],
    )
    .map_err(|e| format!("Failed to save activity: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn db_load_activities(db: tauri::State<'_, Database>) -> Result<Vec<DbActivity>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds FROM activities ORDER BY timestamp DESC")
        .map_err(|e| format!("Failed to prepare query: {e}"))?;
    let rows = stmt
        .query_map([], row_to_activity)
        .map_err(|e| format!("Failed to query activities: {e}"))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Failed to read row: {e}"))?);
    }
    Ok(result)
}

#[tauri::command]
pub fn db_delete_activity(db: tauri::State<'_, Database>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    conn.execute("DELETE FROM activities WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete activity: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn db_clear_activities(db: tauri::State<'_, Database>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    conn.execute("DELETE FROM activities", [])
        .map_err(|e| format!("Failed to clear activities: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn db_import_activities(
    db: tauri::State<'_, Database>,
    data: String,
) -> Result<usize, String> {
    let items: Vec<DbActivity> =
        serde_json::from_str(&data).map_err(|e| format!("Invalid JSON: {e}"))?;

    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    for item in &items {
        conn.execute(
            "INSERT OR IGNORE INTO activities (id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                item.id,
                item.timestamp,
                item.category,
                item.app_name,
                item.title,
                item.description,
                item.screenshot_base64,
                item.duration_seconds,
            ],
        )
        .map_err(|e| format!("Failed to import activity: {e}"))?;
    }

    // re-count total after import (some may have been ignored due to duplicate IDs)
    let total: usize = conn
        .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .map_err(|e| format!("Failed to count after import: {e}"))?;

    Ok(total)
}

// ── Report History CRUD ──

#[tauri::command]
pub fn db_save_report_history(
    db: tauri::State<'_, Database>,
    id: String,
    created_at: String,
    report_type: String,
    template: String,
    content: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO report_history (id, created_at, report_type, template, content)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, created_at, report_type, template, content],
    )
    .map_err(|e| format!("Failed to save report history: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn db_load_report_history(
    db: tauri::State<'_, Database>,
) -> Result<Vec<DbReportHistory>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, created_at, report_type, template, content
             FROM report_history ORDER BY created_at DESC LIMIT 20",
        )
        .map_err(|e| format!("Failed to prepare query: {e}"))?;
    let rows = stmt
        .query_map([], row_to_report_history)
        .map_err(|e| format!("Failed to query report history: {e}"))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Failed to read row: {e}"))?);
    }
    Ok(result)
}

#[tauri::command]
pub fn db_delete_report_history(
    db: tauri::State<'_, Database>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    conn.execute("DELETE FROM report_history WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete report history: {e}"))?;
    Ok(())
}

// ── Backup / Restore ──

fn backup_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("moji.db.backup")
}

fn temporary_backup_path(app_data_dir: &PathBuf) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get system time: {e}"))?
        .as_nanos();
    let process_id = std::process::id();

    for attempt in 0..100u32 {
        let path = app_data_dir.join(format!(
            ".moji.db.backup.{process_id}.{timestamp}.{attempt}.tmp"
        ));

        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => {
                drop(file);
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to prepare temporary backup: {e}"))?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(format!("Failed to create temporary backup: {e}")),
        }
    }

    Err("Failed to create a unique temporary backup path".to_string())
}

fn replace_backup(temp: &PathBuf, backup: &PathBuf) -> Result<(), String> {
    #[cfg(windows)]
    {
        let temp_wide: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let backup_wide: Vec<u16> = backup.as_os_str().encode_wide().chain(Some(0)).collect();

        const MOVEFILE_REPLACE_EXISTING: u32 = 0x00000001;
        const MOVEFILE_WRITE_THROUGH: u32 = 0x00000008;

        unsafe extern "system" {
            fn MoveFileExW(
                lp_existing_file_name: *const u16,
                lp_new_file_name: *const u16,
                dw_flags: u32,
            ) -> i32;
        }

        let result = unsafe {
            MoveFileExW(
                temp_wide.as_ptr(),
                backup_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };

        if result == 0 {
            return Err(format!(
                "Failed to atomically replace backup: {}",
                std::io::Error::last_os_error()
            ));
        }

        return Ok(());
    }

    #[cfg(not(windows))]
    {
        fs::rename(temp, backup)
            .map_err(|e| format!("Failed to atomically replace backup: {e}"))
    }
}

#[tauri::command]
pub fn save_backup(
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<u64, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    let backup = backup_path(&app_data_dir);
    let temp_backup = temporary_backup_path(&app_data_dir)?;

    let result = (|| -> Result<u64, String> {
        // VACUUM INTO 在打开中的连接上生成一份逻辑一致且已压缩的快照，
        // 写入同目录下的唯一临时文件，成功后再原子替换正式备份。
        let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
        conn.execute(
            "VACUUM INTO ?1",
            params![temp_backup.to_string_lossy().to_string()],
        )
        .map_err(|e| format!("Failed to save backup: {e}"))?;
        drop(conn);

        // 校验临时备份可打开且完整，避免损坏文件替换掉原有有效备份。
        let validation_conn = Connection::open(&temp_backup)
            .map_err(|e| format!("Failed to open temporary backup: {e}"))?;
        let integrity: String = validation_conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| format!("Failed to check temporary backup integrity: {e}"))?;
        if integrity.to_lowercase() != "ok" {
            return Err(format!(
                "Temporary backup integrity check failed: {integrity}"
            ));
        }
        drop(validation_conn);

        replace_backup(&temp_backup, &backup)?;

        fs::metadata(&backup)
            .map(|m| m.len())
            .map_err(|e| format!("Failed to stat backup: {e}"))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_backup);
    }

    result
}

#[tauri::command]
pub fn load_backup(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(backup_path(&app_data_dir).exists())
}

#[tauri::command]
pub fn restore_backup_to_db(
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let backup = backup_path(&app_data_dir);

    if !backup.exists() {
        return Ok(0);
    }

    // 用 SQLite 在线备份 API 把备份写回打开中的连接，
    // 不再 fs::copy 覆盖使用中的 moji.db（sharing violation + 旧连接页缓存与磁盘不一致），
    // 恢复完成后同一连接即可读到新数据
    let mut conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    conn.restore(DatabaseName::Main, &backup, None::<fn(rusqlite::backup::Progress)>)
        .map_err(|e| format!("Failed to restore backup: {e}"))?;

    let total: usize = conn
        .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .map_err(|e| format!("Failed to count after restore: {e}"))?;

    Ok(total)
}