use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path};

#[derive(Default, Deserialize)]
pub struct ActivityQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(default, alias = "q")]
    pub keyword: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    200
}

impl ActivityQuery {
    pub fn normalized(mut self) -> Self {
        self.limit = self.limit.clamp(1, 500);
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHealth {
    pub database_readable: bool,
    pub activity_count: i64,
    pub latest_timestamp: Option<String>,
}

pub fn open_read_only(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "无法读取墨记数据库，请确认应用已至少启动一次".to_string())
}

pub fn load_activities(path: &Path, query: &ActivityQuery) -> Result<Vec<Value>, String> {
    let query = ActivityQuery {
        from: query.from.clone(),
        to: query.to.clone(),
        keyword: query.keyword.clone(),
        limit: query.limit,
    }
    .normalized();
    let connection = open_read_only(path)?;
    let pattern = if query.keyword.trim().is_empty() {
        "%%".to_string()
    } else {
        format!("%{}%", query.keyword.trim())
    };
    let mut statement = connection
        .prepare(
            "SELECT id, timestamp, category, app_name, title, description, duration_seconds,
                    browser_domain, ide_project
             FROM activities
             WHERE (?1 IS NULL OR timestamp >= ?1)
               AND (?2 IS NULL OR timestamp < ?2)
               AND (?3 = '%%' OR app_name LIKE ?3 OR title LIKE ?3 OR description LIKE ?3
                    OR browser_domain LIKE ?3 OR ide_project LIKE ?3)
             ORDER BY timestamp DESC LIMIT ?4",
        )
        .map_err(|error| format!("准备活动查询失败：{error}"))?;
    let rows = statement
        .query_map(
            params![query.from, query.to, pattern, query.limit as i64],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "timestamp": row.get::<_, String>(1)?,
                    "category": row.get::<_, String>(2)?,
                    "app": row.get::<_, String>(3)?,
                    "title": row.get::<_, Option<String>>(4)?,
                    "description": row.get::<_, String>(5)?,
                    "durationSeconds": row.get::<_, Option<i64>>(6)?,
                    "browserDomain": row.get::<_, Option<String>>(7)?,
                    "ideProject": row.get::<_, Option<String>>(8)?,
                }))
            },
        )
        .map_err(|error| format!("查询活动失败：{error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取活动失败：{error}"))
}

pub fn summary_from_connection(
    connection: &Connection,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Value, String> {
    let (activity_count, active_seconds): (i64, i64) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN duration_seconds > 0 THEN duration_seconds ELSE 0 END), 0)
             FROM activities
             WHERE (?1 IS NULL OR timestamp >= ?1) AND (?2 IS NULL OR timestamp < ?2)",
            params![from, to],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("汇总活动失败：{error}"))?;

    let mut categories = BTreeMap::new();
    let mut category_statement = connection
        .prepare(
            "SELECT category, COALESCE(SUM(CASE WHEN duration_seconds > 0 THEN duration_seconds ELSE 0 END), 0)
             FROM activities
             WHERE (?1 IS NULL OR timestamp >= ?1) AND (?2 IS NULL OR timestamp < ?2)
             GROUP BY category",
        )
        .map_err(|error| format!("准备分类汇总失败：{error}"))?;
    let category_rows = category_statement
        .query_map(params![from, to], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| format!("查询分类汇总失败：{error}"))?;
    for row in category_rows {
        let (category, seconds) = row.map_err(|error| format!("读取分类汇总失败：{error}"))?;
        categories.insert(category, seconds);
    }

    let mut top_apps = Vec::new();
    let mut app_statement = connection
        .prepare(
            "SELECT app_name, COALESCE(SUM(CASE WHEN duration_seconds > 0 THEN duration_seconds ELSE 0 END), 0) AS seconds
             FROM activities
             WHERE (?1 IS NULL OR timestamp >= ?1) AND (?2 IS NULL OR timestamp < ?2)
             GROUP BY app_name
             ORDER BY seconds DESC, app_name ASC
             LIMIT 10",
        )
        .map_err(|error| format!("准备应用汇总失败：{error}"))?;
    let app_rows = app_statement
        .query_map(params![from, to], |row| {
            Ok(json!({ "app": row.get::<_, String>(0)?, "seconds": row.get::<_, i64>(1)? }))
        })
        .map_err(|error| format!("查询应用汇总失败：{error}"))?;
    for row in app_rows {
        top_apps.push(row.map_err(|error| format!("读取应用汇总失败：{error}"))?);
    }

    Ok(json!({
        "from": from,
        "to": to,
        "activityCount": activity_count,
        "activeSeconds": active_seconds,
        "categories": categories,
        "topApps": top_apps,
    }))
}

pub fn summary(path: &Path, from: Option<&str>, to: Option<&str>) -> Result<Value, String> {
    let connection = open_read_only(path)?;
    summary_from_connection(&connection, from, to)
}

pub fn health(path: &Path) -> Result<QueryHealth, String> {
    let connection = open_read_only(path)?;
    let (activity_count, latest_timestamp) = connection
        .query_row(
            "SELECT COUNT(*), MAX(timestamp) FROM activities",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("读取数据库状态失败：{error}"))?;
    Ok(QueryHealth {
        database_readable: true,
        activity_count,
        latest_timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_counts_more_than_default_activity_limit() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch(
                "CREATE TABLE activities (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    category TEXT NOT NULL,
                    app_name TEXT NOT NULL,
                    duration_seconds INTEGER
                );",
            )
            .expect("create activities");
        let transaction = connection.transaction().expect("start transaction");
        {
            let mut statement = transaction
                .prepare(
                    "INSERT INTO activities (id, timestamp, category, app_name, duration_seconds)
                     VALUES (?1, '2026-08-22T00:00:00Z', 'dev', 'Code.exe', 1)",
                )
                .expect("prepare insert");
            for index in 0..10_001 {
                statement
                    .execute(params![index.to_string()])
                    .expect("insert activity");
            }
        }
        transaction.commit().expect("commit activities");

        let value = summary_from_connection(&connection, None, None).expect("summarize activities");
        assert_eq!(value["activityCount"], 10_001);
        assert_eq!(value["activeSeconds"], 10_001);
        assert_eq!(value["categories"]["dev"], 10_001);
    }
}
