use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

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
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DbReportHistory {
    pub id: String,
    pub created_at: String,
    pub report_type: String,
    pub template: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct PaginatedResult {
    pub total: usize,
    pub items: Vec<DbActivity>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedParams {
    pub offset: usize,
    pub limit: usize,
    pub category: Option<String>,
    pub today_only: Option<bool>,
    pub keyword: Option<String>,
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
            screenshot_base64 TEXT
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
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO activities (id, timestamp, category, app_name, title, description, screenshot_base64)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, timestamp, category, app_name, title, description, screenshot_base64],
    )
    .map_err(|e| format!("Failed to save activity: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn db_load_activities(db: tauri::State<'_, Database>) -> Result<Vec<DbActivity>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT id, timestamp, category, app_name, title, description, screenshot_base64 FROM activities ORDER BY timestamp DESC")
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
pub fn db_load_activities_paginated(
    db: tauri::State<'_, Database>,
    params: PaginatedParams,
) -> Result<PaginatedResult, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;

    let mut conditions: Vec<String> = Vec::new();
    let mut bind_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref cat) = params.category {
        if !cat.is_empty() && cat != "all" {
            conditions.push(format!("category = ?{}", bind_values.len() + 1));
            bind_values.push(Box::new(cat.clone()));
        }
    }
    if params.today_only.unwrap_or(false) {
        conditions.push(format!(
            "date(timestamp) = date('now', 'localtime')"
        ));
    }
    if let Some(ref kw) = params.keyword {
        let kw_trimmed = kw.trim();
        if !kw_trimmed.is_empty() {
            conditions.push(format!(
                "(app_name LIKE ?{} OR title LIKE ?{} OR description LIKE ?{})",
                bind_values.len() + 1,
                bind_values.len() + 2,
                bind_values.len() + 3,
            ));
            let pattern = format!("%{}%", kw_trimmed);
            bind_values.push(Box::new(pattern.clone()));
            bind_values.push(Box::new(pattern.clone()));
            bind_values.push(Box::new(pattern));
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // count
    let count_sql = format!("SELECT COUNT(*) FROM activities {where_clause}");
    let count_params: Vec<&dyn rusqlite::types::ToSql> =
        bind_values.iter().map(|v| v.as_ref()).collect();
    let total: usize = conn
        .query_row(&count_sql, rusqlite::params_from_iter(&count_params), |row| {
            row.get(0)
        })
        .map_err(|e| format!("Failed to count activities: {e}"))?;

    // paginated query
    let query_sql = format!(
        "SELECT id, timestamp, category, app_name, title, description, screenshot_base64
         FROM activities {where_clause}
         ORDER BY timestamp DESC
         LIMIT ?{} OFFSET ?{}",
        bind_values.len() + 1,
        bind_values.len() + 2,
    );
    let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = bind_values;
    all_params.push(Box::new(params.limit as i64));
    all_params.push(Box::new(params.offset as i64));
    let query_params: Vec<&dyn rusqlite::types::ToSql> =
        all_params.iter().map(|v| v.as_ref()).collect();

    let mut stmt = conn
        .prepare(&query_sql)
        .map_err(|e| format!("Failed to prepare paginated query: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(&query_params), row_to_activity)
        .map_err(|e| format!("Failed to query activities: {e}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("Failed to read row: {e}"))?);
    }

    Ok(PaginatedResult { total, items })
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
            "INSERT OR IGNORE INTO activities (id, timestamp, category, app_name, title, description, screenshot_base64)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                item.id,
                item.timestamp,
                item.category,
                item.app_name,
                item.title,
                item.description,
                item.screenshot_base64,
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

#[tauri::command]
pub fn save_backup(
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let backup = backup_path(&app_data_dir);
    let source = app_data_dir.join("moji.db");

    fs::copy(&source, &backup)
        .map_err(|e| format!("Failed to save backup: {e}"))?;

    // vacuum the backup for size optimization
    if let Ok(backup_conn) = Connection::open(&backup) {
        let _ = backup_conn.execute_batch("PRAGMA journal_mode=DELETE; VACUUM;");
    }

    let _ = db; // keep state alive
    Ok(())
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
    let source = app_data_dir.join("moji.db");

    if !backup.exists() {
        return Ok(0);
    }

    // Restore backup over current DB
    fs::copy(&backup, &source)
        .map_err(|e| format!("Failed to restore backup: {e}"))?;

    // Reopen connection count
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    let total: usize = conn
        .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .map_err(|e| format!("Failed to count after restore: {e}"))?;

    Ok(total)
}
