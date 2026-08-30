use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::db::{Database, DbActivity, DbReportHistory, DbWeeklyPlan};

const MAGIC: &[u8] = b"MOJISYNC1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncSnapshot {
    version: u8,
    created_at: u64,
    activities: Vec<DbActivity>,
    report_history: Vec<DbReportHistory>,
    weekly_plans: Vec<DbWeeklyPlan>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub imported_activities: usize,
    pub imported_reports: usize,
    pub updated_weekly_plans: usize,
    pub conflicts: usize,
    pub snapshot_count: usize,
    pub snapshot_path: String,
}

fn unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| format!("读取系统时间失败：{error}"))
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    if password.chars().count() < 8 {
        return Err("同步密码至少需要 8 个字符".to_string());
    }
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| "无法生成同步密钥".to_string())?;
    Ok(key)
}

fn encrypt_snapshot(snapshot: &SyncSnapshot, password: &str) -> Result<Vec<u8>, String> {
    let plaintext =
        serde_json::to_vec(snapshot).map_err(|error| format!("序列化同步快照失败：{error}"))?;
    encrypt_plaintext(&plaintext, password)
}

fn encrypt_plaintext(plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);
    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "无法初始化同步加密".to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref())
        .map_err(|_| "加密同步快照失败".to_string())?;
    let mut output = Vec::with_capacity(MAGIC.len() + SALT_LEN + NONCE_LEN + ciphertext.len());
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

fn decrypt_snapshot(bytes: &[u8], password: &str) -> Result<SyncSnapshot, String> {
    let header_len = MAGIC.len() + SALT_LEN + NONCE_LEN;
    if bytes.len() <= header_len || !bytes.starts_with(MAGIC) {
        return Err("同步文件格式无效".to_string());
    }
    let salt = &bytes[MAGIC.len()..MAGIC.len() + SALT_LEN];
    let nonce = &bytes[MAGIC.len() + SALT_LEN..header_len];
    let key = derive_key(password, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "无法初始化同步解密".to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), &bytes[header_len..])
        .map_err(|_| "同步密码错误或同步文件已损坏".to_string())?;
    let snapshot: SyncSnapshot =
        serde_json::from_slice(&plaintext).map_err(|_| "同步文件内容无效".to_string())?;
    if snapshot.version != 1 {
        return Err(format!("暂不支持同步文件版本 {}", snapshot.version));
    }
    Ok(snapshot)
}

fn load_snapshot(connection: &Connection) -> Result<SyncSnapshot, String> {
    let mut activities_statement = connection
        .prepare(
            "SELECT id, timestamp, category, app_name, title, description, screenshot_base64,
                    duration_seconds, browser_domain, ide_project
             FROM activities ORDER BY timestamp DESC",
        )
        .map_err(|error| format!("准备同步活动查询失败：{error}"))?;
    let activities = activities_statement
        .query_map([], |row| {
            Ok(DbActivity {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                category: row.get(2)?,
                app_name: row.get(3)?,
                title: row.get(4)?,
                description: row.get(5)?,
                screenshot_base64: row.get(6)?,
                duration_seconds: row.get(7)?,
                browser_domain: row.get(8)?,
                ide_project: row.get(9)?,
            })
        })
        .map_err(|error| format!("查询同步活动失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取同步活动失败：{error}"))?;

    let mut reports_statement = connection
        .prepare(
            "SELECT id, created_at, report_type, template, content,
                    origin_content, edited_at, generation_mode
             FROM report_history ORDER BY created_at DESC",
        )
        .map_err(|error| format!("准备同步报告查询失败：{error}"))?;
    let report_history = reports_statement
        .query_map([], |row| {
            Ok(DbReportHistory {
                id: row.get(0)?,
                created_at: row.get(1)?,
                report_type: row.get(2)?,
                template: row.get(3)?,
                content: row.get(4)?,
                origin_content: row.get(5)?,
                edited_at: row.get(6)?,
                generation_mode: row.get(7)?,
            })
        })
        .map_err(|error| format!("查询同步报告失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取同步报告失败：{error}"))?;

    let mut plans_statement = connection
        .prepare("SELECT week_start, targets_json, updated_at FROM weekly_plans")
        .map_err(|error| format!("准备同步周计划查询失败：{error}"))?;
    let weekly_plans = plans_statement
        .query_map([], |row| {
            Ok(DbWeeklyPlan {
                week_start: row.get(0)?,
                targets_json: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })
        .map_err(|error| format!("查询同步周计划失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取同步周计划失败：{error}"))?;

    Ok(SyncSnapshot {
        version: 1,
        created_at: unix_seconds()?,
        activities,
        report_history,
        weekly_plans,
    })
}

fn sanitize_device_id(value: &str) -> String {
    let result: String = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(48)
        .collect();
    if result.is_empty() {
        "device".to_string()
    } else {
        result
    }
}

fn snapshot_files(folder: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = fs::read_dir(folder)
        .map_err(|error| format!("读取同步目录失败：{error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(OsStr::to_str)
                .map(|name| name.starts_with("moji-sync-") && name.ends_with(".moji"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

fn merge_snapshots(local: SyncSnapshot, remotes: Vec<SyncSnapshot>) -> (SyncSnapshot, usize) {
    let mut conflicts = 0;
    let mut activities = local
        .activities
        .into_iter()
        .map(|item| (item.id.clone(), item))
        .collect::<BTreeMap<_, _>>();
    let mut reports = local
        .report_history
        .into_iter()
        .map(|item| (item.id.clone(), item))
        .collect::<BTreeMap<_, _>>();
    let mut plans = local
        .weekly_plans
        .into_iter()
        .map(|item| (item.week_start.clone(), item))
        .collect::<BTreeMap<_, _>>();

    for remote in remotes {
        for item in remote.activities {
            match activities.get(&item.id) {
                Some(existing)
                    if serde_json::to_value(existing).ok() != serde_json::to_value(&item).ok() =>
                {
                    conflicts += 1
                }
                Some(_) => {}
                None => {
                    activities.insert(item.id.clone(), item);
                }
            }
        }
        for item in remote.report_history {
            match reports.get(&item.id) {
                Some(existing)
                    if serde_json::to_value(existing).ok() != serde_json::to_value(&item).ok() =>
                {
                    conflicts += 1
                }
                Some(_) => {}
                None => {
                    reports.insert(item.id.clone(), item);
                }
            }
        }
        for item in remote.weekly_plans {
            match plans.get(&item.week_start) {
                Some(existing) if item.updated_at > existing.updated_at => {
                    plans.insert(item.week_start.clone(), item);
                }
                Some(existing)
                    if item.updated_at == existing.updated_at
                        && item.targets_json != existing.targets_json =>
                {
                    conflicts += 1
                }
                Some(_) => {}
                None => {
                    plans.insert(item.week_start.clone(), item);
                }
            }
        }
    }

    let mut activities = activities.into_values().collect::<Vec<_>>();
    activities.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    let mut report_history = reports.into_values().collect::<Vec<_>>();
    report_history.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    (
        SyncSnapshot {
            version: 1,
            created_at: unix_seconds().unwrap_or(0),
            activities,
            report_history,
            weekly_plans: plans.into_values().collect(),
        },
        conflicts,
    )
}

fn backup_before_sync(connection: &Connection, app_data_dir: &Path) -> Result<(), String> {
    let path = app_data_dir.join(format!(
        "moji.db.pre-sync-{}-{}.backup",
        unix_seconds()?,
        std::process::id()
    ));
    connection
        .backup(
            DatabaseName::Main,
            &path,
            None::<fn(rusqlite::backup::Progress)>,
        )
        .map_err(|error| format!("创建同步前数据库备份失败：{error}"))?;
    Ok(())
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe extern "system" {
        fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let result = unsafe { MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), 0x1 | 0x8) };
    if result == 0 {
        Err(format!(
            "替换同步文件失败：{}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination).map_err(|error| format!("替换同步文件失败：{error}"))
}

fn write_snapshot(folder: &Path, device_id: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let destination = folder.join(format!("moji-sync-{}.moji", sanitize_device_id(device_id)));
    let temporary = folder.join(format!(
        ".moji-sync-{}-{}.tmp",
        std::process::id(),
        unix_seconds()?
    ));
    fs::write(&temporary, bytes).map_err(|error| format!("写入临时同步文件失败：{error}"))?;
    if let Err(error) = atomic_replace(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(destination)
}

#[tauri::command]
pub fn sync_with_folder(
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
    folder: String,
    password: String,
    device_id: String,
) -> Result<SyncResult, String> {
    use tauri::Manager;

    let folder = PathBuf::from(folder.trim());
    if !folder.is_dir() {
        return Err("同步目录不存在或不可访问".to_string());
    }
    derive_key(&password, &[0u8; SALT_LEN])?;
    let paths = snapshot_files(&folder)?;
    let mut remote_snapshots = Vec::with_capacity(paths.len());
    for path in &paths {
        let bytes = fs::read(path).map_err(|error| format!("读取同步文件失败：{error}"))?;
        remote_snapshots.push(decrypt_snapshot(&bytes, &password)?);
    }

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("读取应用数据目录失败：{error}"))?;
    let mut connection =
        db.0.lock()
            .map_err(|error| format!("数据库状态锁失败：{error}"))?;
    let local = load_snapshot(&connection)?;
    let local_activity_count = local.activities.len();
    let local_report_count = local.report_history.len();
    let local_plan_map = local
        .weekly_plans
        .iter()
        .map(|item| (item.week_start.clone(), item.updated_at.clone()))
        .collect::<BTreeMap<_, _>>();
    let (merged, conflicts) = merge_snapshots(local, remote_snapshots);
    backup_before_sync(&connection, &app_data_dir)?;

    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始同步事务失败：{error}"))?;
    for item in &merged.activities {
        transaction.execute(
            "INSERT OR IGNORE INTO activities (id, timestamp, category, app_name, title, description, screenshot_base64, duration_seconds, browser_domain, ide_project)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![item.id, item.timestamp, item.category, item.app_name, item.title, item.description, item.screenshot_base64, item.duration_seconds, item.browser_domain, item.ide_project],
        ).map_err(|error| format!("合并同步活动失败：{error}"))?;
    }
    for item in &merged.report_history {
        transaction.execute(
            "INSERT OR IGNORE INTO report_history
             (id, created_at, report_type, template, content, origin_content, edited_at, generation_mode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                item.id,
                item.created_at,
                item.report_type,
                item.template,
                item.content,
                item.origin_content,
                item.edited_at,
                item.generation_mode,
            ],
        ).map_err(|error| format!("合并同步报告失败：{error}"))?;
    }
    for item in &merged.weekly_plans {
        let should_update = local_plan_map
            .get(&item.week_start)
            .map(|updated_at| item.updated_at > *updated_at)
            .unwrap_or(true);
        if should_update {
            transaction.execute(
                "INSERT OR REPLACE INTO weekly_plans (week_start, targets_json, updated_at) VALUES (?1, ?2, ?3)",
                params![item.week_start, item.targets_json, item.updated_at],
            ).map_err(|error| format!("合并同步周计划失败：{error}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("提交同步事务失败：{error}"))?;

    let final_snapshot = load_snapshot(&connection)?;
    let encrypted = encrypt_snapshot(&final_snapshot, &password)?;
    let snapshot_path = write_snapshot(&folder, &device_id, &encrypted)?;
    let updated_weekly_plans = final_snapshot
        .weekly_plans
        .iter()
        .filter(|item| {
            local_plan_map
                .get(&item.week_start)
                .map(|updated_at| item.updated_at > *updated_at)
                .unwrap_or(true)
        })
        .count();
    Ok(SyncResult {
        imported_activities: final_snapshot
            .activities
            .len()
            .saturating_sub(local_activity_count),
        imported_reports: final_snapshot
            .report_history
            .len()
            .saturating_sub(local_report_count),
        updated_weekly_plans,
        conflicts,
        snapshot_count: paths.len() + usize::from(!paths.iter().any(|path| path == &snapshot_path)),
        snapshot_path: snapshot_path.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_snapshot() -> SyncSnapshot {
        SyncSnapshot {
            version: 1,
            created_at: 1,
            activities: Vec::new(),
            report_history: Vec::new(),
            weekly_plans: Vec::new(),
        }
    }

    #[test]
    fn encrypted_snapshot_round_trips_and_rejects_wrong_password() {
        let bytes =
            encrypt_snapshot(&empty_snapshot(), "correct-password").expect("encrypt snapshot");
        assert!(!String::from_utf8_lossy(&bytes).contains("activities"));
        assert_eq!(
            decrypt_snapshot(&bytes, "correct-password")
                .expect("decrypt snapshot")
                .version,
            1
        );
        assert!(decrypt_snapshot(&bytes, "wrong-password").is_err());
    }

    #[test]
    fn report_metadata_round_trips_through_encrypted_snapshot() {
        let mut snapshot = empty_snapshot();
        snapshot.report_history.push(DbReportHistory {
            id: "report-1".into(),
            created_at: "2026-08-30T12:00:00Z".into(),
            report_type: "weekly".into(),
            template: "standard".into(),
            content: "edited".into(),
            origin_content: Some("original".into()),
            edited_at: Some(1_777_777_777_000),
            generation_mode: Some("local".into()),
        });

        let bytes = encrypt_snapshot(&snapshot, "correct-password").expect("encrypt snapshot");
        let restored = decrypt_snapshot(&bytes, "correct-password").expect("decrypt snapshot");
        let report = &restored.report_history[0];
        assert_eq!(report.origin_content.as_deref(), Some("original"));
        assert_eq!(report.edited_at, Some(1_777_777_777_000));
        assert_eq!(report.generation_mode.as_deref(), Some("local"));
    }

    #[test]
    fn legacy_encrypted_snapshot_defaults_missing_report_metadata() {
        let legacy = serde_json::json!({
            "version": 1,
            "createdAt": 1,
            "activities": [],
            "reportHistory": [{
                "id": "legacy-report",
                "created_at": "2026-08-22T00:00:00Z",
                "report_type": "daily",
                "template": "standard",
                "content": "legacy"
            }],
            "weeklyPlans": []
        });
        let plaintext = serde_json::to_vec(&legacy).expect("serialize legacy snapshot");
        let bytes = encrypt_plaintext(&plaintext, "correct-password").expect("encrypt legacy snapshot");
        let restored = decrypt_snapshot(&bytes, "correct-password").expect("decrypt legacy snapshot");
        let report = &restored.report_history[0];
        assert_eq!(report.origin_content, None);
        assert_eq!(report.edited_at, None);
        assert_eq!(report.generation_mode, None);
    }

    #[test]
    fn merge_is_idempotent_and_keeps_local_conflict() {
        let activity = DbActivity {
            id: "a1".into(),
            timestamp: "2026-08-22T00:00:00Z".into(),
            category: "dev".into(),
            app_name: "Code".into(),
            title: None,
            description: "local".into(),
            screenshot_base64: None,
            duration_seconds: Some(60),
            browser_domain: None,
            ide_project: None,
        };
        let mut local = empty_snapshot();
        local.activities.push(activity.clone());
        let mut remote = empty_snapshot();
        remote.activities.push(activity);
        let (merged, conflicts) = merge_snapshots(local, vec![remote]);
        assert_eq!(merged.activities.len(), 1);
        assert_eq!(conflicts, 0);
    }
}
