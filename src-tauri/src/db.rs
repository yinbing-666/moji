use rusqlite::{params, Connection, DatabaseName, OptionalExtension};
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
    #[serde(alias = "browserDomain")]
    pub browser_domain: Option<String>,
    #[serde(alias = "ideProject")]
    pub ide_project: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DbReportHistory {
    pub id: String,
    pub created_at: String,
    pub report_type: String,
    pub template: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DbWeeklyPlan {
    pub week_start: String,
    pub targets_json: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct DbStorageStats {
    pub database_bytes: u64,
    pub activity_count: u64,
    pub screenshot_count: u64,
    pub screenshot_bytes: u64,
    pub expired_count: u64,
    pub oldest_timestamp: Option<String>,
}

pub fn init_database(app_data_dir: &PathBuf) -> Result<Connection, String> {
    fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    let db_path = app_data_dir.join("moji.db");
    let existing_database = db_path.exists()
        && fs::metadata(&db_path).map(|metadata| metadata.len() > 0).unwrap_or(false);
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {e}"))?;

    if existing_database && schema_upgrade_required(&conn)? {
        create_upgrade_backup(&conn, app_data_dir)?;
    }

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activities (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            category TEXT NOT NULL,
            app_name TEXT NOT NULL,
            title TEXT,
            description TEXT NOT NULL,
            screenshot_base64 TEXT,
            duration_seconds INTEGER,
            browser_domain TEXT,
            ide_project TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_activities_ts ON activities(timestamp DESC);
        CREATE TABLE IF NOT EXISTS report_history (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            report_type TEXT NOT NULL,
            template TEXT NOT NULL DEFAULT 'standard',
            content TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_report_hist_created ON report_history(created_at DESC);
        CREATE TABLE IF NOT EXISTS weekly_plans (
            week_start TEXT PRIMARY KEY,
            targets_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("Failed to create tables: {e}"))?;

    migrate_schema(&conn)?;
    initialize_activity_search(&conn)?;

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
    if !column_exists(conn, "activities", "browser_domain")? {
        conn.execute("ALTER TABLE activities ADD COLUMN browser_domain TEXT", [])
            .map_err(|e| format!("迁移 activities.browser_domain 失败: {e}"))?;
    }
    if !column_exists(conn, "activities", "ide_project")? {
        conn.execute("ALTER TABLE activities ADD COLUMN ide_project TEXT", [])
            .map_err(|e| format!("迁移 activities.ide_project 失败: {e}"))?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS weekly_plans (
            week_start TEXT PRIMARY KEY,
            targets_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("迁移 weekly_plans 失败: {e}"))?;
    Ok(())
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?1)",
        params![table],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|e| format!("读取表信息失败: {e}"))
}

fn schema_upgrade_required(conn: &Connection) -> Result<bool, String> {
    if !table_exists(conn, "activities")? {
        return Ok(false);
    }
    Ok(
        !column_exists(conn, "activities", "browser_domain")?
            || !column_exists(conn, "activities", "ide_project")?
            || !table_exists(conn, "weekly_plans")?
            || !table_exists(conn, "activities_fts")?,
    )
}

fn create_upgrade_backup(conn: &Connection, app_data_dir: &PathBuf) -> Result<(), String> {
    let backup = app_data_dir.join("moji.db.pre-v012.backup");
    if backup.exists() {
        return Ok(());
    }
    conn.backup(DatabaseName::Main, &backup, None::<fn(rusqlite::backup::Progress)>)
        .map_err(|e| format!("创建升级前数据库备份失败: {e}"))?;
    let validation = Connection::open(&backup)
        .map_err(|e| format!("打开升级前数据库备份失败: {e}"))?;
    let integrity: String = validation
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| format!("校验升级前数据库备份失败: {e}"))?;
    if integrity.to_lowercase() != "ok" {
        return Err(format!("升级前数据库备份校验失败: {integrity}"));
    }
    Ok(())
}

fn initialize_activity_search(conn: &Connection) -> Result<(), String> {
    let needs_rebuild = !table_exists(conn, "activities_fts")?;
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS activities_fts USING fts5(
            app_name,
            title,
            description,
            browser_domain,
            ide_project,
            content='activities',
            content_rowid='rowid',
            tokenize='trigram'
        );
        CREATE TRIGGER IF NOT EXISTS activities_fts_insert AFTER INSERT ON activities BEGIN
            INSERT INTO activities_fts(rowid, app_name, title, description, browser_domain, ide_project)
            VALUES (new.rowid, new.app_name, new.title, new.description, new.browser_domain, new.ide_project);
        END;
        CREATE TRIGGER IF NOT EXISTS activities_fts_delete AFTER DELETE ON activities BEGIN
            INSERT INTO activities_fts(activities_fts, rowid, app_name, title, description, browser_domain, ide_project)
            VALUES ('delete', old.rowid, old.app_name, old.title, old.description, old.browser_domain, old.ide_project);
        END;
        CREATE TRIGGER IF NOT EXISTS activities_fts_update AFTER UPDATE ON activities BEGIN
            INSERT INTO activities_fts(activities_fts, rowid, app_name, title, description, browser_domain, ide_project)
            VALUES ('delete', old.rowid, old.app_name, old.title, old.description, old.browser_domain, old.ide_project);
            INSERT INTO activities_fts(rowid, app_name, title, description, browser_domain, ide_project)
            VALUES (new.rowid, new.app_name, new.title, new.description, new.browser_domain, new.ide_project);
        END;",
    )
    .map_err(|e| format!("初始化活动全文索引失败: {e}"))?;
    if needs_rebuild {
        conn.execute("INSERT INTO activities_fts(activities_fts) VALUES ('rebuild')", [])
            .map_err(|e| format!("重建活动全文索引失败: {e}"))?;
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
        browser_domain: row.get("browser_domain")?,
        ide_project: row.get("ide_project")?,
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

const UPSERT_ACTIVITY_SQL: &str =
    "INSERT INTO activities (id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds, browser_domain, ide_project)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(id) DO UPDATE SET
       timestamp = excluded.timestamp,
       category = excluded.category,
       app_name = excluded.app_name,
       title = excluded.title,
       description = excluded.description,
       screenshot_base64 = excluded.screenshot_base64,
       duration_seconds = excluded.duration_seconds,
       browser_domain = excluded.browser_domain,
       ide_project = excluded.ide_project";

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
    browser_domain: Option<String>,
    ide_project: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    conn.execute(
        UPSERT_ACTIVITY_SQL,
        params![id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds, browser_domain, ide_project],
    )
    .map_err(|e| format!("Failed to save activity: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn db_load_activities(db: tauri::State<'_, Database>) -> Result<Vec<DbActivity>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds, browser_domain, ide_project FROM activities ORDER BY timestamp DESC")
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
            "INSERT OR IGNORE INTO activities (id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds, browser_domain, ide_project)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                item.id,
                item.timestamp,
                item.category,
                item.app_name,
                item.title,
                item.description,
                item.screenshot_base64,
                item.duration_seconds,
                item.browser_domain,
                item.ide_project,
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

#[tauri::command]
pub fn db_replace_activities(
    db: tauri::State<'_, Database>,
    data: String,
) -> Result<usize, String> {
    let items: Vec<DbActivity> =
        serde_json::from_str(&data).map_err(|e| format!("Invalid JSON: {e}"))?;
    let mut conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    let transaction = conn.transaction()
        .map_err(|e| format!("Failed to start activity replacement: {e}"))?;
    transaction.execute("DELETE FROM activities", [])
        .map_err(|e| format!("Failed to clear activities before replacement: {e}"))?;
    for item in &items {
        transaction.execute(
            "INSERT INTO activities (id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds, browser_domain, ide_project)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                item.id,
                item.timestamp,
                item.category,
                item.app_name,
                item.title,
                item.description,
                item.screenshot_base64,
                item.duration_seconds,
                item.browser_domain,
                item.ide_project,
            ],
        )
        .map_err(|e| format!("Failed to replace activity: {e}"))?;
    }
    transaction.commit()
        .map_err(|e| format!("Failed to commit activity replacement: {e}"))?;
    Ok(items.len())
}

fn quoted_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

#[tauri::command]
pub fn db_search_activities(
    db: tauri::State<'_, Database>,
    query: String,
    start_at: Option<String>,
    end_at: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<DbActivity>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    let trimmed = query.trim();
    let limit = i64::from(limit.unwrap_or(200).clamp(1, 500));
    let use_fts = trimmed.chars().filter(|character| !character.is_whitespace()).count() >= 3;

    let mut result = Vec::new();
    if use_fts {
        let fts_query = quoted_fts_query(trimmed);
        let mut statement = conn.prepare(
            "SELECT a.id, a.timestamp, a.category, a.app_name, a.title, a.description,
                    a.screenshot_base64, a.duration_seconds, a.browser_domain, a.ide_project
             FROM activities_fts
             JOIN activities a ON a.rowid = activities_fts.rowid
             WHERE activities_fts MATCH ?1
               AND (?2 IS NULL OR a.timestamp >= ?2)
               AND (?3 IS NULL OR a.timestamp < ?3)
             ORDER BY a.timestamp DESC LIMIT ?4",
        ).map_err(|e| format!("Failed to prepare full-text search: {e}"))?;
        let rows = statement
            .query_map(params![fts_query, start_at, end_at, limit], row_to_activity)
            .map_err(|e| format!("Failed to search activities: {e}"))?;
        for row in rows {
            result.push(row.map_err(|e| format!("Failed to read search result: {e}"))?);
        }
    } else {
        let pattern = format!("%{}%", trimmed.replace('%', "\\%").replace('_', "\\_"));
        let mut statement = conn.prepare(
            "SELECT id, timestamp, category, app_name, title, description,
                    screenshot_base64, duration_seconds, browser_domain, ide_project
             FROM activities
             WHERE (?1 = '%%' OR app_name LIKE ?1 ESCAPE '\\' OR title LIKE ?1 ESCAPE '\\'
                    OR description LIKE ?1 ESCAPE '\\' OR browser_domain LIKE ?1 ESCAPE '\\'
                    OR ide_project LIKE ?1 ESCAPE '\\')
               AND (?2 IS NULL OR timestamp >= ?2)
               AND (?3 IS NULL OR timestamp < ?3)
             ORDER BY timestamp DESC LIMIT ?4",
        ).map_err(|e| format!("Failed to prepare activity search: {e}"))?;
        let rows = statement
            .query_map(params![pattern, start_at, end_at, limit], row_to_activity)
            .map_err(|e| format!("Failed to search activities: {e}"))?;
        for row in rows {
            result.push(row.map_err(|e| format!("Failed to read search result: {e}"))?);
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn db_get_storage_stats(
    db: tauri::State<'_, Database>,
    cutoff: Option<String>,
) -> Result<DbStorageStats, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    get_storage_stats(&conn, cutoff.as_deref())
}

fn get_storage_stats(conn: &Connection, cutoff: Option<&str>) -> Result<DbStorageStats, String> {
    let page_count: u64 = conn.query_row("PRAGMA page_count", [], |row| row.get(0))
        .map_err(|e| format!("读取数据库页数失败: {e}"))?;
    let page_size: u64 = conn.query_row("PRAGMA page_size", [], |row| row.get(0))
        .map_err(|e| format!("读取数据库页大小失败: {e}"))?;
    let activity_count: u64 = conn.query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .map_err(|e| format!("统计活动数量失败: {e}"))?;
    let screenshot_count: u64 = conn.query_row(
        "SELECT COUNT(*) FROM activities WHERE screenshot_base64 IS NOT NULL AND screenshot_base64 != ''",
        [],
        |row| row.get(0),
    ).map_err(|e| format!("统计缩略图数量失败: {e}"))?;
    let screenshot_bytes: u64 = conn.query_row(
        "SELECT COALESCE(SUM(length(screenshot_base64)), 0) FROM activities",
        [],
        |row| row.get(0),
    ).map_err(|e| format!("统计缩略图占用失败: {e}"))?;
    let expired_count = match cutoff {
        Some(value) => conn.query_row(
            "SELECT COUNT(*) FROM activities WHERE timestamp < ?1",
            params![value],
            |row| row.get(0),
        ).map_err(|e| format!("统计待清理活动失败: {e}"))?,
        None => 0,
    };
    let oldest_timestamp = conn.query_row(
        "SELECT MIN(timestamp) FROM activities",
        [],
        |row| row.get::<_, Option<String>>(0),
    ).map_err(|e| format!("读取最早活动时间失败: {e}"))?;
    Ok(DbStorageStats {
        database_bytes: page_count.saturating_mul(page_size),
        activity_count,
        screenshot_count,
        screenshot_bytes,
        expired_count,
        oldest_timestamp,
    })
}

#[tauri::command]
pub fn db_cleanup_activities(
    db: tauri::State<'_, Database>,
    cutoff: String,
) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    cleanup_activities(&conn, &cutoff)
}

fn cleanup_activities(conn: &Connection, cutoff: &str) -> Result<usize, String> {
    if cutoff.trim().is_empty() || !cutoff.contains('T') {
        return Err("清理截止时间无效".to_string());
    }
    let deleted = conn.execute("DELETE FROM activities WHERE timestamp < ?1", params![cutoff])
        .map_err(|e| format!("清理过期活动失败: {e}"))?;
    if deleted > 0 {
        conn.execute_batch("PRAGMA optimize; VACUUM;")
            .map_err(|e| format!("压缩清理后的数据库失败: {e}"))?;
    }
    Ok(deleted)
}

#[tauri::command]
pub fn db_save_weekly_plan(
    db: tauri::State<'_, Database>,
    week_start: String,
    targets_json: String,
    updated_at: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    save_weekly_plan(&conn, &week_start, &targets_json, &updated_at)
}

fn save_weekly_plan(
    conn: &Connection,
    week_start: &str,
    targets_json: &str,
    updated_at: &str,
) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(targets_json)
        .map_err(|e| format!("周计划格式无效: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO weekly_plans (week_start, targets_json, updated_at) VALUES (?1, ?2, ?3)",
        params![week_start, targets_json, updated_at],
    ).map_err(|e| format!("保存周计划失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn db_load_weekly_plan(
    db: tauri::State<'_, Database>,
    week_start: String,
) -> Result<Option<DbWeeklyPlan>, String> {
    let conn = db.0.lock().map_err(|e| format!("DB lock error: {e}"))?;
    load_weekly_plan(&conn, &week_start)
}

fn load_weekly_plan(conn: &Connection, week_start: &str) -> Result<Option<DbWeeklyPlan>, String> {
    conn.query_row(
        "SELECT week_start, targets_json, updated_at FROM weekly_plans WHERE week_start = ?1",
        params![week_start],
        |row| Ok(DbWeeklyPlan {
            week_start: row.get(0)?,
            targets_json: row.get(1)?,
            updated_at: row.get(2)?,
        }),
    ).optional().map_err(|e| format!("读取周计划失败: {e}"))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        connection.execute_batch(
            "CREATE TABLE activities (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                category TEXT NOT NULL,
                app_name TEXT NOT NULL,
                title TEXT,
                description TEXT NOT NULL,
                screenshot_base64 TEXT,
                duration_seconds INTEGER,
                browser_domain TEXT,
                ide_project TEXT
            );
            CREATE TABLE weekly_plans (
                week_start TEXT PRIMARY KEY,
                targets_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        ).expect("create test tables");
        initialize_activity_search(&connection).expect("initialize FTS");
        connection
    }

    #[test]
    fn activity_fts_tracks_insert_update_and_delete() {
        let connection = test_connection();

        connection.execute(
            "INSERT INTO activities (id, timestamp, category, app_name, title, description, browser_domain)
             VALUES ('1', '2026-08-22T00:00:00Z', 'dev', 'Code.exe', '墨记', 'ActivityWatch integration', 'github.com')",
            [],
        ).expect("insert activity");
        let inserted: i64 = connection.query_row(
            "SELECT COUNT(*) FROM activities_fts WHERE activities_fts MATCH ?1",
            params![quoted_fts_query("ActivityWatch")],
            |row| row.get(0),
        ).expect("search inserted activity");
        assert_eq!(inserted, 1);

        connection.execute("UPDATE activities SET description = 'local timeline search' WHERE id = '1'", [])
            .expect("update activity");
        let updated: i64 = connection.query_row(
            "SELECT COUNT(*) FROM activities_fts WHERE activities_fts MATCH ?1",
            params![quoted_fts_query("timeline")],
            |row| row.get(0),
        ).expect("search updated activity");
        assert_eq!(updated, 1);

        connection.execute(
            UPSERT_ACTIVITY_SQL,
            params![
                "1",
                "2026-08-22T00:00:00Z",
                "dev",
                "Code.exe",
                "墨记",
                "weekly plan comparison",
                Option::<String>::None,
                60,
                "github.com",
                "moji-clean",
            ],
        ).expect("upsert activity");
        let stale_after_upsert: i64 = connection.query_row(
            "SELECT COUNT(*) FROM activities_fts WHERE activities_fts MATCH ?1",
            params![quoted_fts_query("timeline")],
            |row| row.get(0),
        ).expect("search stale activity text");
        let current_after_upsert: i64 = connection.query_row(
            "SELECT COUNT(*) FROM activities_fts WHERE activities_fts MATCH ?1",
            params![quoted_fts_query("weekly")],
            |row| row.get(0),
        ).expect("search upserted activity text");
        assert_eq!(stale_after_upsert, 0);
        assert_eq!(current_after_upsert, 1);

        connection.execute("DELETE FROM activities WHERE id = '1'", []).expect("delete activity");
        let deleted: i64 = connection.query_row(
            "SELECT COUNT(*) FROM activities_fts WHERE activities_fts MATCH ?1",
            params![quoted_fts_query("weekly")],
            |row| row.get(0),
        ).expect("search deleted activity");
        assert_eq!(deleted, 0);
    }

    #[test]
    fn cleanup_deletes_only_expired_activities_and_updates_fts() {
        let connection = test_connection();
        for (id, timestamp, description) in [
            ("old", "2026-08-21T23:59:59Z", "expired activity"),
            ("boundary", "2026-08-22T00:00:00Z", "boundary activity"),
            ("new", "2026-08-22T12:00:00Z", "current activity"),
        ] {
            connection.execute(
                "INSERT INTO activities (id, timestamp, category, app_name, description)
                 VALUES (?1, ?2, 'dev', 'Code.exe', ?3)",
                params![id, timestamp, description],
            ).expect("insert cleanup fixture");
        }

        let stats = get_storage_stats(&connection, Some("2026-08-22T00:00:00Z"))
            .expect("read storage stats");
        assert_eq!(stats.activity_count, 3);
        assert_eq!(stats.expired_count, 1);

        let deleted = cleanup_activities(&connection, "2026-08-22T00:00:00Z")
            .expect("cleanup expired activity");
        assert_eq!(deleted, 1);

        let remaining: Vec<String> = connection.prepare(
            "SELECT id FROM activities ORDER BY timestamp",
        ).expect("prepare remaining query")
            .query_map([], |row| row.get(0)).expect("query remaining activities")
            .collect::<Result<_, _>>().expect("read remaining activities");
        assert_eq!(remaining, vec!["boundary", "new"]);

        let stale_fts: i64 = connection.query_row(
            "SELECT COUNT(*) FROM activities_fts WHERE activities_fts MATCH ?1",
            params![quoted_fts_query("expired")],
            |row| row.get(0),
        ).expect("search cleaned activity");
        assert_eq!(stale_fts, 0);
    }

    #[test]
    fn cleanup_rejects_invalid_cutoff_without_deleting_data() {
        let connection = test_connection();
        connection.execute(
            "INSERT INTO activities (id, timestamp, category, app_name, description)
             VALUES ('1', '2026-08-21T23:59:59Z', 'dev', 'Code.exe', 'keep me')",
            [],
        ).expect("insert cleanup fixture");

        assert!(cleanup_activities(&connection, "2026-08-22").is_err());
        let remaining: i64 = connection.query_row(
            "SELECT COUNT(*) FROM activities",
            [],
            |row| row.get(0),
        ).expect("count remaining activities");
        assert_eq!(remaining, 1);
    }

    #[test]
    fn weekly_plan_can_be_saved_overwritten_and_loaded() {
        let connection = test_connection();
        save_weekly_plan(
            &connection,
            "2026-08-17",
            r#"{"工作": 600}"#,
            "2026-08-22T08:00:00Z",
        ).expect("save weekly plan");
        save_weekly_plan(
            &connection,
            "2026-08-17",
            r#"{"工作": 900, "学习": 300}"#,
            "2026-08-22T09:00:00Z",
        ).expect("overwrite weekly plan");

        let plan = load_weekly_plan(&connection, "2026-08-17")
            .expect("load weekly plan")
            .expect("weekly plan exists");
        assert_eq!(plan.targets_json, r#"{"工作": 900, "学习": 300}"#);
        assert_eq!(plan.updated_at, "2026-08-22T09:00:00Z");
        assert!(save_weekly_plan(
            &connection,
            "2026-08-24",
            "not json",
            "2026-08-22T09:00:00Z",
        ).is_err());
    }
}
