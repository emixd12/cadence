use super::recovery;
use super::rows::{Behavior, Profile, StoredRow};
use icu_normalizer::ComposingNormalizerBorrowed;
use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension,
    TransactionBehavior,
};
use serde_json::{json, Map, Value};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub type Result<T> = std::result::Result<T, String>;
pub(super) const STORAGE_RECOVERY_SCHEMA_VERSION: i64 = 14;
pub const READ_LIMIT: usize = 100_000;
pub(super) const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "current_local_model",
        include_str!("../../migrations/0001_current_local_model.sql"),
    ),
    (
        2,
        "native_reminder_coverage",
        include_str!("../../migrations/0002_native_reminder_coverage.sql"),
    ),
    (
        3,
        "bound_behaviorlog_plans",
        include_str!("../../migrations/0003_bound_behaviorlog_plans.sql"),
    ),
    (
        4,
        "status_history_cascade",
        include_str!("../../migrations/0004_status_history_cascade.sql"),
    ),
    (
        5,
        "domain_preview_revision",
        include_str!("../../migrations/0005_domain_preview_revision.sql"),
    ),
    (
        6,
        "passive_intervention_channels",
        include_str!("../../migrations/0006_passive_intervention_channels.sql"),
    ),
    (
        7,
        "account_link_metadata",
        include_str!("../../migrations/0007_account_link_metadata.sql"),
    ),
    (
        8,
        "account_sync_baseline",
        include_str!("../../migrations/0008_account_sync_baseline.sql"),
    ),
    (
        9,
        "first_link_attempt",
        include_str!("../../migrations/0009_first_link_attempt.sql"),
    ),
    (
        10,
        "first_link_attempt_baseline",
        include_str!("../../migrations/0010_first_link_attempt_baseline.sql"),
    ),
    (
        11,
        "category_descriptions",
        include_str!("../../migrations/0011_category_descriptions.sql"),
    ),
    (
        12,
        "behavior_archive_notes",
        include_str!("../../migrations/0012_behavior_archive_notes.sql"),
    ),
    (
        13,
        "note_shortcut_states",
        include_str!("../../migrations/0013_note_shortcut_states.sql"),
    ),
    (
        14,
        "bounded_native_reminder_receipts",
        include_str!("../../migrations/0014_bounded_native_reminder_receipts.sql"),
    ),
    (
        15,
        "behavior_duration_and_scheduled_archive",
        include_str!("../../migrations/0015_behavior_duration_and_scheduled_archive.sql"),
    ),
    (
        16,
        "travel_settings",
        include_str!("../../migrations/0016_travel_settings.sql"),
    ),
    (
        17,
        "canonicalize_configuration_location",
        include_str!("../../migrations/0017_canonicalize_configuration_location.sql"),
    ),
    (
        18,
        "behavior_where",
        include_str!("../../migrations/0018_behavior_where.sql"),
    ),
    (
        19,
        "travel_habits",
        include_str!("../../migrations/0019_travel_habits.sql"),
    ),
];

pub fn open(path: &Path) -> Result<Connection> {
    let mut db = connect(path)?;
    let latest = schema_version(&db)?;
    if latest == 0 {
        migrate(&mut db, MIGRATIONS)?;
        seed(&mut db)?;
    } else if latest >= STORAGE_RECOVERY_SCHEMA_VERSION {
        seed(&mut db)?;
        recovery::run(&mut db, path)?;
        migrate(&mut db, MIGRATIONS)?;
    } else {
        recovery::preflight_initial(path)?;
        let recovery_index = MIGRATIONS
            .iter()
            .position(|migration| migration.0 == STORAGE_RECOVERY_SCHEMA_VERSION)
            .ok_or("The storage recovery migration is unavailable.")?;
        migrate(&mut db, &MIGRATIONS[..recovery_index])?;
        seed(&mut db)?;
        recovery::run(&mut db, path)?;
        migrate(&mut db, MIGRATIONS)?;
    }
    Ok(db)
}

pub(super) fn connect(path: &Path) -> Result<Connection> {
    let db = Connection::open(path).map_err(error)?;
    #[cfg(unix)]
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|_| "The local database permissions could not be restricted.")?;
    db.busy_timeout(Duration::from_secs(5)).map_err(error)?;
    db.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(error)?;
    Ok(db)
}

pub(super) fn schema_version(db: &Connection) -> Result<i64> {
    let has_ledger: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='schema_migrations')",
            [],
            |row| row.get(0),
        )
        .map_err(error)?;
    if !has_ledger {
        return Ok(0);
    }
    db.query_row(
        "SELECT coalesce(max(version),0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
    .map_err(error)
}

pub(super) fn validate_backup(db: &Connection) -> Result<()> {
    let integrity: String = db
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(error)?;
    if integrity != "ok" {
        return Err("The selected database failed its integrity check.".into());
    }
    let foreign_key_error: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
            [],
            |row| row.get(0),
        )
        .map_err(error)?;
    if foreign_key_error {
        return Err("The selected database has invalid record relationships.".into());
    }
    let latest: i64 = db
        .query_row(
            "SELECT coalesce(max(version),0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "The selected file is not a Cadence database.".to_string())?;
    if latest < 1 || latest > MIGRATIONS.last().map_or(0, |migration| migration.0) {
        return Err(
            if latest > MIGRATIONS.last().map_or(0, |migration| migration.0) {
                "This backup needs a newer Cadence version."
            } else {
                "This backup is missing its Cadence schema history."
            }
            .into(),
        );
    }
    let known_migrations = MIGRATIONS
        .iter()
        .take_while(|migration| migration.0 <= latest)
        .copied()
        .collect::<Vec<_>>();
    for (version, name, source) in &known_migrations {
        let stored: (String, String) = db
            .query_row(
                "SELECT name, source FROM schema_migrations WHERE version=?1",
                [version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| "The selected database has incomplete migration history.".to_string())?;
        if stored.0 != *name || stored.1 != *source {
            return Err("The selected database schema does not match this Cadence build.".into());
        }
    }
    let mut reference = Connection::open_in_memory().map_err(error)?;
    reference
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(error)?;
    migrate(&mut reference, &known_migrations)?;
    if schema(db)? != schema(&reference)? {
        return Err("The selected database schema does not match this Cadence build.".into());
    }
    let profile = profile(db)?;
    for behavior in owned::<Behavior>(db, &profile.id)? {
        validate_row(&profile.id, &behavior)?;
    }
    Ok(())
}

fn schema(db: &Connection) -> Result<Vec<(String, String, String, String)>> {
    let mut statement = db
        .prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name")
        .map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(error)?;
    Ok(rows)
}

fn unique_sibling(path: &Path, label: &str) -> Result<PathBuf> {
    let parent = path.parent().ok_or("The database folder is unavailable.")?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "The system clock is unavailable.")?
        .as_nanos();
    Ok(parent.join(format!(
        ".cadence-{label}-{}-{nonce}.sqlite3",
        std::process::id()
    )))
}

fn reserve_protected_path(directory: &Path) -> Result<PathBuf> {
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    for sequence in 0..100 {
        let path = unique_sibling(
            &directory.join("cadence-pre-restore.sqlite3"),
            &format!("protected-{sequence}"),
        )?;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        match options.open(&path) {
            Ok(_) => return Ok(path),
            Err(failure) if failure.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("A protected backup file could not be created.".into()),
        }
    }
    Err("A unique protected backup file could not be reserved.".into())
}

pub(super) fn online_copy(source: &Connection, destination: &Path) -> Result<()> {
    let mut output = Connection::open(destination).map_err(error)?;
    let backup = rusqlite::backup::Backup::new(source, &mut output).map_err(error)?;
    backup
        .run_to_completion(128, Duration::from_millis(10), None)
        .map_err(error)?;
    drop(backup);
    validate_backup(&output)?;
    output
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
        .map_err(error)?;
    #[cfg(unix)]
    std::fs::set_permissions(destination, std::fs::Permissions::from_mode(0o600))
        .map_err(|_| "Backup permissions could not be restricted.")?;
    Ok(())
}

pub fn backup(source: &Connection, live_path: &Path, destination: &Path) -> Result<()> {
    if destination == live_path {
        return Err("Choose a backup destination, not the live database.".into());
    }
    let temporary = unique_sibling(destination, "backup")?;
    let result: Result<()> = (|| {
        online_copy(source, &temporary)?;
        std::fs::rename(&temporary, destination).map_err(|failure| failure.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|_| "The backup could not be saved. The previous file was not replaced.".into())
}

pub fn protected_backup(source: &Connection, live_path: &Path) -> Result<PathBuf> {
    let directory = live_path
        .parent()
        .ok_or("The database folder is unavailable.")?
        .join("Backups");
    std::fs::create_dir_all(&directory)
        .map_err(|_| "The protected backup folder could not be created.")?;
    let destination = reserve_protected_path(&directory)?;
    if let Err(failure) = online_copy(source, &destination) {
        let _ = std::fs::remove_file(&destination);
        return Err(failure);
    }
    Ok(destination)
}

pub fn disconnect_keep_local_copy(db: &mut Connection) -> Result<String> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let profile_id = linked_profile_id(&tx)?;
    tx.execute(
        "DELETE FROM account_first_link_attempts WHERE local_profile_id=?1",
        [&profile_id],
    )
    .map_err(error)?;
    tx.execute(
        "DELETE FROM account_sync_baselines WHERE local_profile_id=?1",
        [&profile_id],
    )
    .map_err(error)?;
    tx.execute(
        "DELETE FROM account_link_metadata WHERE local_profile_id=?1",
        [&profile_id],
    )
    .map_err(error)?;
    tx.execute("DELETE FROM sync_cursors WHERE user_id=?1", [&profile_id])
        .map_err(error)?;
    tx.commit().map_err(error)?;
    Ok(profile_id)
}

pub fn disconnect_remove_account_data(db: &mut Connection) -> Result<String> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let linked_profile = linked_profile_id(&tx)?;
    let deleted = tx
        .execute("DELETE FROM profiles WHERE id=?1", [&linked_profile])
        .map_err(error)?;
    if deleted != 1 {
        return Err("The linked local profile is unavailable.".into());
    }
    if let Some(profile_id) = tx
        .query_row("SELECT id FROM profiles LIMIT 1", [], |row| row.get(0))
        .optional()
        .map_err(error)?
    {
        tx.commit().map_err(error)?;
        return Ok(profile_id);
    }
    let now: String = tx
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
            row.get(0)
        })
        .map_err(error)?;
    let id = uuid(&tx)?;
    tx.execute("INSERT INTO profiles (id,email,display_name,timezone,created_at,updated_at) VALUES (?1,'',NULL,'America/New_York',?2,?2)", params![id,now]).map_err(error)?;
    for (order, name) in [
        "Medical",
        "Grooming",
        "Fitness",
        "Food / Drink",
        "Home",
        "Measurements",
        "Admin",
        "Other",
    ]
    .iter()
    .enumerate()
    {
        tx.execute("INSERT INTO categories (id,user_id,name,sort_order,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)", params![uuid(&tx)?,id,name,order as i64,now]).map_err(error)?;
    }
    tx.execute("INSERT INTO occurrence_sync_state (user_id,timezone,last_synced_local_date,synced_through_local_date,last_successful_sync_at,stale,stale_reason,last_sync_behavior_count,last_sync_created_count,last_sync_updated_count,last_sync_deleted_count,state_version,created_at,updated_at) VALUES (?1,'America/New_York',NULL,NULL,NULL,1,'never_synced',0,0,0,0,0,?2,?2)", params![id,now]).map_err(error)?;
    tx.execute("INSERT INTO mutation_outbox (mutation_id,user_id,operation,request_json,result_json,created_at) VALUES (?1,?2,'initializeProfile','{}',?3,?4)", params![uuid(&tx)?,id,json!({"profileId":id}).to_string(),now]).map_err(error)?;
    tx.commit().map_err(error)?;
    Ok(id)
}

fn linked_profile_id(db: &Connection) -> Result<String> {
    db.query_row(
        "SELECT local_profile_id FROM account_link_metadata LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(error)?
    .ok_or_else(|| "No account is linked to this local database.".into())
}

pub fn restore(live: &mut Connection, live_path: &Path, source_path: &Path) -> Result<PathBuf> {
    if source_path == live_path {
        return Err("Choose a Cadence backup, not the live database.".into());
    }
    let source =
        Connection::open_with_flags(source_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| "The selected backup could not be opened.".to_string())?;
    validate_backup(&source)?;
    let staged = unique_sibling(live_path, "restore-stage")?;
    online_copy(&source, &staged)?;
    let mut staged_db = Connection::open(&staged).map_err(error)?;
    staged_db
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(error)?;
    migrate(&mut staged_db, MIGRATIONS)?;
    validate_backup(&staged_db)?;
    staged_db
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
        .map_err(error)?;
    staged_db.close().map_err(|(_, failure)| error(failure))?;
    let protected = match protected_backup(live, live_path) {
        Ok(path) => path,
        Err(failure) => {
            let _ = std::fs::remove_file(&staged);
            return Err(failure);
        }
    };
    live.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(error)?;
    let placeholder = Connection::open_in_memory().map_err(error)?;
    let old = std::mem::replace(live, placeholder);
    drop(old);
    remove_sidecars(live_path);
    if let Err(failure) = std::fs::rename(&staged, live_path) {
        *live = open(live_path)?;
        let _ = std::fs::remove_file(&staged);
        return Err(failure.to_string());
    }
    *live = open(live_path)?;
    Ok(protected)
}

pub(super) fn remove_sidecars(path: &Path) {
    let text = path.as_os_str().to_string_lossy();
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{text}{suffix}"));
    }
}

pub(super) fn migrate(db: &mut Connection, migrations: &[(i64, &str, &str)]) -> Result<()> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;").map_err(error)?;
    let latest: i64 = tx
        .query_row(
            "SELECT coalesce(max(version),0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(error)?;
    if latest > migrations.last().map_or(0, |migration| migration.0) {
        return Err("The local database needs a newer Cadence version.".into());
    }
    for (version, name, sql) in migrations {
        let applied: Option<(String, String)> = tx
            .query_row(
                "SELECT name, source FROM schema_migrations WHERE version=?1",
                [version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(error)?;
        if let Some((old_name, old_sql)) = applied {
            if old_name != *name || old_sql != *sql {
                return Err("An applied SQLite migration differs from this build. The database was not changed.".into());
            }
        } else {
            if *version == 14 {
                recovery::compact_receipts(&tx)?;
            }
            tx.execute_batch(sql).map_err(error)?;
            tx.execute("INSERT INTO schema_migrations VALUES (?1,?2,?3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params![version,name,sql]).map_err(error)?;
        }
    }
    tx.commit().map_err(error)
}

pub(super) fn seed(db: &mut Connection) -> Result<()> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let exists: bool = tx
        .query_row("SELECT EXISTS(SELECT 1 FROM profiles)", [], |row| {
            row.get(0)
        })
        .map_err(error)?;
    if !exists {
        let now: String = tx
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                row.get(0)
            })
            .map_err(error)?;
        let id = uuid(&tx)?;
        tx.execute("INSERT INTO profiles (id,email,display_name,timezone,created_at,updated_at) VALUES (?1,'',NULL,'America/New_York',?2,?2)", params![id,now]).map_err(error)?;
        for (order, name) in [
            "Medical",
            "Grooming",
            "Fitness",
            "Food / Drink",
            "Home",
            "Measurements",
            "Admin",
            "Other",
        ]
        .iter()
        .enumerate()
        {
            tx.execute("INSERT INTO categories (id,user_id,name,sort_order,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)", params![uuid(&tx)?,id,name,order as i64,now]).map_err(error)?;
        }
        tx.execute("INSERT INTO occurrence_sync_state (user_id,timezone,last_synced_local_date,synced_through_local_date,last_successful_sync_at,stale,stale_reason,last_sync_behavior_count,last_sync_created_count,last_sync_updated_count,last_sync_deleted_count,state_version,created_at,updated_at) VALUES (?1,'America/New_York',NULL,NULL,NULL,1,'never_synced',0,0,0,0,0,?2,?2)", params![id,now]).map_err(error)?;
        tx.execute("INSERT INTO mutation_outbox (mutation_id,user_id,operation,request_json,result_json,created_at) VALUES (?1,?2,'initializeProfile','{}',?3,?4)", params![uuid(&tx)?,id,json!({"profileId":id}).to_string(),now]).map_err(error)?;
    }
    tx.commit().map_err(error)
}

fn uuid(db: &Connection) -> Result<String> {
    db.query_row("SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))", [], |row| row.get(0)).map_err(error)
}

pub fn profile(db: &Connection) -> Result<Profile> {
    read::<Profile>(db, "SELECT * FROM profiles", &[])?
        .into_iter()
        .next()
        .ok_or_else(|| "Local profile is unavailable.".into())
}

pub fn owner(db: &Connection, profile_id: &str) -> Result<()> {
    valid_id(profile_id)?;
    if profile(db)?.id != profile_id {
        return Err("The operation does not belong to the local profile.".into());
    }
    Ok(())
}

pub fn read<T: StoredRow>(db: &Connection, sql: &str, values: &[SqlValue]) -> Result<Vec<T>> {
    let mut statement = db.prepare(sql).map_err(error)?;
    let columns: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect();
    let mut cursor = statement.query(params_from_iter(values)).map_err(error)?;
    let mut output = Vec::new();
    while let Some(row) = cursor.next().map_err(error)? {
        if output.len() == READ_LIMIT {
            return Err(
                "The local read exceeds 100,000 rows; no partial result was returned.".into(),
            );
        }
        let mut object = Map::new();
        for (index, name) in columns.iter().enumerate() {
            let raw: SqlValue = row.get(index).map_err(error)?;
            let value = match raw {
                SqlValue::Null => Value::Null,
                SqlValue::Integer(number) if T::BOOL_COLUMNS.contains(&name.as_str()) => {
                    Value::Bool(number != 0)
                }
                SqlValue::Integer(number) => json!(number),
                SqlValue::Text(text) if T::JSON_COLUMNS.contains(&name.as_str()) => {
                    serde_json::from_str(&text).map_err(|_| "Stored JSON is invalid.")?
                }
                SqlValue::Text(text) => Value::String(text),
                _ => return Err("A stored row has an unsupported field type.".into()),
            };
            object.insert(name.clone(), value);
        }
        output.push(
            serde_json::from_value(Value::Object(object))
                .map_err(|_| "A stored row does not match the current model.")?,
        );
    }
    Ok(output)
}

pub fn owned<T: StoredRow>(db: &Connection, profile_id: &str) -> Result<Vec<T>> {
    read(
        db,
        &format!("SELECT * FROM {} WHERE user_id=?1", T::TABLE),
        &[profile_id.to_string().into()],
    )
}

pub fn by_id<T: StoredRow>(db: &Connection, profile_id: &str, id: &str) -> Result<T> {
    if !(T::TABLE == "note_shortcut_states" && id == "global") {
        valid_id(id)?;
    }
    read(
        db,
        &format!("SELECT * FROM {} WHERE user_id=?1 AND id=?2", T::TABLE),
        &[profile_id.to_string().into(), id.to_string().into()],
    )?
    .into_iter()
    .next()
    .ok_or_else(|| "The owned record was not found.".into())
}

fn fields<T: StoredRow>(row: &T) -> Result<Vec<(String, SqlValue)>> {
    let object = serde_json::to_value(row).map_err(|_| "The row could not be encoded.")?;
    let object = object.as_object().ok_or("A row must be an object.")?;
    let mut fields = Vec::new();
    for (key, value) in object {
        if key == "schedule_range_identity" {
            continue;
        }
        let converted = match value {
            Value::Null => SqlValue::Null,
            Value::Bool(value) => SqlValue::Integer(i64::from(*value)),
            Value::Number(value) => SqlValue::Integer(
                value
                    .as_i64()
                    .ok_or("A stored number must be an integer.")?,
            ),
            Value::String(value) if !T::JSON_COLUMNS.contains(&key.as_str()) => {
                SqlValue::Text(value.clone())
            }
            _ if T::JSON_COLUMNS.contains(&key.as_str()) => SqlValue::Text(value.to_string()),
            _ => return Err("Unexpected row field type.".into()),
        };
        fields.push((key.clone(), converted));
    }
    Ok(fields)
}

pub fn insert<T: StoredRow>(db: &Connection, profile_id: &str, row: &T) -> Result<()> {
    validate_row(profile_id, row)?;
    let fields = fields(row)?;
    let columns = fields
        .iter()
        .map(|(name, _)| name.as_str())
        .collect::<Vec<_>>()
        .join(",");
    let placeholders = vec!["?"; fields.len()].join(",");
    db.execute(
        &format!(
            "INSERT INTO {} ({columns}) VALUES ({placeholders})",
            T::TABLE
        ),
        params_from_iter(fields.into_iter().map(|(_, value)| value)),
    )
    .map_err(error)?;
    Ok(())
}

pub fn update<T: StoredRow>(db: &Connection, profile_id: &str, id: &str, row: &T) -> Result<()> {
    validate_row(profile_id, row)?;
    let object = serde_json::to_value(row).map_err(|_| "The row could not be encoded.")?;
    if object["id"] != id {
        return Err("A mutation cannot change a record ID.".into());
    }
    let fields: Vec<_> = fields(row)?
        .into_iter()
        .filter(|(name, _)| name != "id" && name != "user_id")
        .collect();
    let assignments = fields
        .iter()
        .map(|(name, _)| format!("{name}=?"))
        .collect::<Vec<_>>()
        .join(",");
    let mut values: Vec<_> = fields.into_iter().map(|(_, value)| value).collect();
    values.extend([profile_id.to_string().into(), id.to_string().into()]);
    let count = db
        .execute(
            &format!(
                "UPDATE {} SET {assignments} WHERE user_id=? AND id=?",
                T::TABLE
            ),
            params_from_iter(values),
        )
        .map_err(error)?;
    if count != 1 {
        return Err("The owned record changed before commit.".into());
    }
    Ok(())
}

pub fn validate_row<T: StoredRow>(profile_id: &str, row: &T) -> Result<()> {
    let value = serde_json::to_value(row).map_err(|_| "The row could not be encoded.")?;
    // Import ledgers aggregate records; keep their ceiling aligned with import requests.
    let size_limit = if T::TABLE == "behaviorlog_import_runs" {
        32 * 1_048_576
    } else if T::TABLE == "note_shortcut_states" {
        8 * 1_048_576
    } else {
        1_048_576
    };
    if value.to_string().len() > size_limit {
        return Err("A local row exceeds its allowed size.".into());
    }
    if value["user_id"] != profile_id {
        return Err("A row belongs to another profile.".into());
    }
    if let Some(id) = value.get("id").and_then(Value::as_str) {
        if !(T::TABLE == "note_shortcut_states" && id == "global") {
            valid_id(id)?;
        }
    }
    for (field, value) in value.as_object().ok_or("A row must be an object.")? {
        if let Some(text) = value.as_str() {
            if field.ends_with("_at") || field == "scheduled_for" {
                instant_key(text)?;
            }
            if field == "local_date" || field.ends_with("_local_date") {
                valid_date(text)?;
            }
            if matches!(
                field.as_str(),
                "scheduled_time"
                    | "start_time"
                    | "end_time"
                    | "schedule_start_time"
                    | "schedule_end_time"
            ) {
                valid_time(text)?;
            }
        }
    }
    if T::TABLE == "behaviors" {
        validate_archive_notes(&value["archive_notes"])?;
        if value["default_duration_minutes"]
            .as_i64()
            .is_some_and(|minutes| !(1..=1_440).contains(&minutes))
            || !value["default_duration_minutes"].is_null()
                && value["default_duration_minutes"].as_i64().is_none()
        {
            return Err("A Behavior default duration must be 1 through 1,440 minutes.".into());
        }
        if let Some(end_date) = value["end_date"].as_str() {
            valid_date(end_date)?;
        } else if !value["end_date"].is_null() {
            return Err("A Behavior end date is invalid.".into());
        }
        if !value["auto_archived_at"].is_null()
            && (value["active"] != false || value["archived_at"].is_null())
        {
            return Err("An automatic archive marker requires an archived Behavior.".into());
        }
        // A missing Where is a row written before Ticket 215; SQLite triggers
        // enforce the place-text rule once migration 0018 has run.
        match value["where_kind"].as_str() {
            Some("place") if value["location_text"].is_null() => {
                return Err("A Behavior place needs its text.".into())
            }
            Some("anywhere" | "home") if !value["location_text"].is_null() => {
                return Err("Only a Behavior place keeps place text.".into())
            }
            Some("anywhere" | "home" | "place") => {}
            Some(_) => return Err("A Behavior Where is invalid.".into()),
            None if !value["where_kind"].is_null() => {
                return Err("A Behavior Where is invalid.".into())
            }
            None => {}
        }
    } else if T::TABLE == "note_shortcut_states" {
        validate_note_shortcut_state(&value)?;
    }
    Ok(())
}

fn valid_hash(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        text.len() == 64
            && text
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn validate_note_shortcut_state(value: &Value) -> Result<()> {
    let object = value
        .as_object()
        .ok_or("A Note shortcut state must be an object.")?;
    let id = object["id"]
        .as_str()
        .ok_or("A Note shortcut state ID is invalid.")?;
    let behavior_id = object["behavior_id"].as_str();
    if id == "global" {
        if !object["behavior_id"].is_null()
            || object["entries"]
                .as_array()
                .is_none_or(|rows| !rows.is_empty())
            || object["excluded_occurrence_ids"]
                .as_array()
                .is_none_or(|rows| !rows.is_empty())
        {
            return Err("Global Note shortcut state cannot contain Behavior data.".into());
        }
    } else if behavior_id != Some(id) {
        return Err("A Note shortcut state must match its Behavior.".into());
    } else {
        valid_id(id)?;
    }
    if object["revision"]
        .as_i64()
        .is_none_or(|revision| !(0..=i64::from(i32::MAX)).contains(&revision))
    {
        return Err("A Note shortcut revision is invalid.".into());
    }
    let excluded = object["excluded_occurrence_ids"]
        .as_array()
        .ok_or("Note shortcut exclusions must be an array.")?;
    if excluded.len() > 100_000 {
        return Err("Note shortcut exclusions exceed 100,000 Occurrences.".into());
    }
    let mut excluded_ids = std::collections::HashSet::new();
    for id in excluded {
        let id = id
            .as_str()
            .ok_or("A Note shortcut exclusion ID is invalid.")?;
        valid_id(id)?;
        if !excluded_ids.insert(id.to_ascii_lowercase()) {
            return Err("A Note shortcut exclusion ID is duplicated.".into());
        }
    }
    let entries = object["entries"]
        .as_array()
        .ok_or("Note shortcut entries must be an array.")?;
    if entries.len() > 128 {
        return Err("Note shortcut history exceeds 128 entries.".into());
    }
    let mut keys = std::collections::HashSet::new();
    let mut accepted_texts = std::collections::HashSet::new();
    let mut accepted = 0;
    let mut proposed = 0;
    for entry in entries {
        let entry = entry
            .as_object()
            .ok_or("A Note shortcut entry is invalid.")?;
        if entry.len() != 7
            || ![
                "key",
                "text",
                "status",
                "source",
                "evidence",
                "created_at",
                "expires_at",
            ]
            .iter()
            .all(|field| entry.contains_key(*field))
            || !valid_hash(&entry["key"])
        {
            return Err("A Note shortcut entry has invalid fields.".into());
        }
        if !keys.insert(entry["key"].as_str().unwrap()) {
            return Err("A Note shortcut key is duplicated.".into());
        }
        instant_key(
            entry["created_at"]
                .as_str()
                .ok_or("A Note shortcut timestamp is invalid.")?,
        )?;
        if let Some(expires_at) = entry["expires_at"].as_str() {
            instant_key(expires_at)?;
        } else if !entry["expires_at"].is_null() {
            return Err("A Note shortcut expiry is invalid.".into());
        }
        if !matches!(entry["source"].as_str(), Some("repeated_text" | "model")) {
            return Err("A Note shortcut source is invalid.".into());
        }
        let evidence = entry["evidence"]
            .as_array()
            .ok_or("Note shortcut evidence must be an array.")?;
        if evidence.len() > 100 {
            return Err("Note shortcut evidence exceeds 100 Occurrences.".into());
        }
        let mut evidence_ids = std::collections::HashSet::new();
        for reference in evidence {
            let reference = reference
                .as_object()
                .ok_or("Note shortcut evidence is invalid.")?;
            if reference.len() != 2
                || !reference.contains_key("occurrence_id")
                || !valid_hash(&reference["note_hash"])
            {
                return Err("Note shortcut evidence has invalid fields.".into());
            }
            let occurrence_id = reference["occurrence_id"]
                .as_str()
                .ok_or("Note shortcut evidence ID is invalid.")?;
            valid_id(occurrence_id)?;
            if !evidence_ids.insert(occurrence_id.to_ascii_lowercase()) {
                return Err("Note shortcut evidence duplicates an Occurrence.".into());
            }
        }
        let status = entry["status"].as_str();
        match status {
            Some("proposed") => {
                proposed += 1;
                if evidence.len() < 3 || entry["expires_at"].is_null() {
                    return Err("A proposed Note shortcut requires evidence and expiry.".into());
                }
            }
            Some("accepted") => {
                accepted += 1;
                if !evidence.is_empty() || !entry["expires_at"].is_null() {
                    return Err(
                        "An accepted Note shortcut cannot retain evidence or expiry.".into(),
                    );
                }
            }
            Some("dismissed") => {
                if !entry["text"].is_null() || !evidence.is_empty() || entry["expires_at"].is_null()
                {
                    return Err("A dismissed Note shortcut retains only its key and expiry.".into());
                }
            }
            _ => return Err("A Note shortcut status is invalid.".into()),
        }
        if status != Some("dismissed") {
            let text = entry["text"]
                .as_str()
                .ok_or("Note shortcut text is invalid.")?;
            if text.is_empty()
                || text != text.trim()
                || text.chars().count() > 160
                || text.chars().any(char::is_control)
            {
                return Err(
                    "Note shortcut text must be trimmed and at most 160 characters.".into(),
                );
            }
            if status == Some("accepted") {
                let normalized = ComposingNormalizerBorrowed::new_nfkc()
                    .normalize(text)
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .to_lowercase();
                if !accepted_texts.insert(normalized) {
                    return Err("An accepted Note shortcut has duplicated text.".into());
                }
            }
        }
    }
    // Each accepted shortcut reserves a second suppression slot for later removal.
    if accepted > 20 || proposed > 5 || entries.len() + accepted > 128 {
        return Err("Note shortcut entry limits were exceeded.".into());
    }
    Ok(())
}

fn validate_archive_notes(value: &Value) -> Result<()> {
    let notes = value
        .as_array()
        .ok_or("Behavior archive notes must be an array.")?;
    let mut ids = std::collections::HashSet::new();
    for note in notes {
        let object = note
            .as_object()
            .ok_or("A Behavior archive note must be an object.")?;
        if object.len() != 4
            || !["id", "archived_at", "note", "updated_at"]
                .iter()
                .all(|field| object.contains_key(*field))
        {
            return Err("A Behavior archive note has invalid fields.".into());
        }
        let id = object["id"]
            .as_str()
            .ok_or("A Behavior archive note ID must be a UUID.")?;
        valid_id(id)?;
        if !ids.insert(id.to_ascii_lowercase()) {
            return Err("A Behavior archive note ID is duplicated.".into());
        }
        let archived_at = instant_key(
            object["archived_at"]
                .as_str()
                .ok_or("A Behavior archive note timestamp must be a UTC instant.")?,
        )?;
        let updated_at = instant_key(
            object["updated_at"]
                .as_str()
                .ok_or("A Behavior archive note timestamp must be a UTC instant.")?,
        )?;
        if updated_at < archived_at {
            return Err("A Behavior archive note cannot predate its archive cycle.".into());
        }
        if let Some(note) = object["note"].as_str() {
            if note.is_empty() || note != note.trim() || note.encode_utf16().count() > 2_000 {
                return Err(
                    "A Behavior archive note must be trimmed and at most 2,000 characters.".into(),
                );
            }
        } else if !object["note"].is_null() {
            return Err("A Behavior archive note must contain text or null.".into());
        }
    }
    Ok(())
}

pub fn valid_id(id: &str) -> Result<()> {
    if id.len() != 36
        || !id.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
    {
        return Err("A local identifier must be a UUID.".into());
    }
    Ok(())
}

pub fn valid_date(value: &str) -> Result<()> {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, c)| [4, 7].contains(&i) || c.is_ascii_digit())
    {
        return Err("A local date must use YYYY-MM-DD.".into());
    }
    let year = value[0..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..10].parse::<u32>().unwrap_or(0);
    let days = match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    if year == 0 || day == 0 || day > days {
        return Err("The local date is invalid.".into());
    }
    Ok(())
}

pub fn valid_time(value: &str) -> Result<()> {
    let bytes = value.as_bytes();
    if bytes.len() < 8
        || bytes[2] != b':'
        || bytes[5] != b':'
        || !bytes[..8]
            .iter()
            .enumerate()
            .all(|(i, c)| [2, 5].contains(&i) || c.is_ascii_digit())
    {
        return Err("Local times must use HH:mm:ss, optionally with microseconds.".into());
    }
    if value[0..2].parse::<u32>().unwrap_or(99) > 23
        || value[3..5].parse::<u32>().unwrap_or(99) > 59
        || value[6..8].parse::<u32>().unwrap_or(99) > 59
    {
        return Err("The local time is invalid.".into());
    }
    if bytes.len() > 8
        && (bytes[8] != b'.'
            || bytes.len() < 10
            || bytes.len() > 15
            || !bytes[9..].iter().all(u8::is_ascii_digit))
    {
        return Err("Local times support at most six fractional digits.".into());
    }
    if bytes.len() > 8 && bytes.last() == Some(&b'0') {
        return Err(
            "Local times must omit trailing fractional zeroes to preserve unique identity.".into(),
        );
    }
    Ok(())
}

// Comparable UTC keys retain nanoseconds; SQLite's floating-point datetime functions do not.
pub fn instant_key(value: &str) -> Result<String> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes[10] != b'T' || bytes.last() != Some(&b'Z') || !value.is_ascii() {
        return Err("Instants must be UTC ISO strings ending in Z.".into());
    }
    valid_date(&value[..10])?;
    valid_time(&value[11..19])?;
    let fraction = &value[19..value.len() - 1];
    let digits = if fraction.is_empty() {
        ""
    } else {
        fraction
            .strip_prefix('.')
            .ok_or("Invalid UTC instant fraction.")?
    };
    if digits.len() > 9
        || (!fraction.is_empty() && digits.is_empty())
        || !digits.bytes().all(|c| c.is_ascii_digit())
    {
        return Err("UTC instants support at most nine fractional digits.".into());
    }
    Ok(format!("{}.{:0<9}", &value[..19], digits))
}

pub fn error(error: rusqlite::Error) -> String {
    match error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            "A local ownership, uniqueness, history, or data constraint rejected the transaction."
                .into()
        }
        _ => format!("Local SQLite operation failed: {error}"),
    }
}

#[cfg(test)]
mod database_control_tests {
    use super::*;

    fn directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("cadence-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn online_backup_captures_wal_and_restore_reopens_with_protected_original() {
        let directory = directory("database-controls");
        let live_path = directory.join("cadence.sqlite3");
        let backup_path = directory.join("saved.sqlite3");
        let mut live = open(&live_path).unwrap();
        live.execute("UPDATE profiles SET timezone='Europe/London'", [])
            .unwrap();
        backup(&live, &live_path, &backup_path).unwrap();
        assert!(backup(&live, &live_path, &live_path)
            .unwrap_err()
            .contains("live database"));
        live.execute("UPDATE profiles SET timezone='America/Chicago'", [])
            .unwrap();
        let protected = restore(&mut live, &live_path, &backup_path).unwrap();
        assert!(live_path.exists());
        assert!(!std::fs::read_dir(&directory).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("restore-rollback")));
        assert_eq!(profile(&live).unwrap().timezone, "Europe/London");
        let original = Connection::open(protected).unwrap();
        assert_eq!(profile(&original).unwrap().timezone, "America/Chicago");
        drop(live);
        assert_eq!(
            profile(&open(&live_path).unwrap()).unwrap().timezone,
            "Europe/London"
        );
        let fake = directory.join("sidecar-test.sqlite3");
        std::fs::write(format!("{}-wal", fake.display()), b"stale").unwrap();
        std::fs::write(format!("{}-shm", fake.display()), b"stale").unwrap();
        remove_sidecars(&fake);
        assert!(!PathBuf::from(format!("{}-wal", fake.display())).exists());
        assert!(!PathBuf::from(format!("{}-shm", fake.display())).exists());
        let protected_directory = directory.join("reserved");
        std::fs::create_dir(&protected_directory).unwrap();
        let first = reserve_protected_path(&protected_directory).unwrap();
        let second = reserve_protected_path(&protected_directory).unwrap();
        assert_ne!(first, second);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn protected_backup_is_valid_owner_only_and_outside_the_live_path() {
        let directory = directory("protected-first-link-backup");
        let live_path = directory.join("cadence.sqlite3");
        let live = open(&live_path).unwrap();
        let profile_id = profile(&live).unwrap().id;
        live.execute("INSERT INTO note_shortcut_states(id,user_id,behavior_id,enabled,entries,excluded_occurrence_ids,revision,updated_at) VALUES('global',?1,NULL,1,'[]','[]',1,'2026-09-01T00:00:00Z')", [&profile_id]).unwrap();
        let path = protected_backup(&live, &live_path).unwrap();
        assert_ne!(path, live_path);
        assert_eq!(path.parent().unwrap(), directory.join("Backups"));
        let copy =
            Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        validate_backup(&copy).unwrap();
        assert_eq!(
            copy.query_row(
                "SELECT enabled FROM note_shortcut_states WHERE user_id=?1 AND id='global'",
                [&profile_id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        #[cfg(unix)]
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn schema_twelve_backup_restores_notes_then_backs_up_shortcut_state() {
        let directory = directory("restore-schema-twelve-note-shortcut");
        let live_path = directory.join("cadence.sqlite3");
        let source_path = directory.join("schema-12.sqlite3");
        let mut source = Connection::open(&source_path).unwrap();
        source.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        migrate(&mut source, &MIGRATIONS[..12]).unwrap();
        seed(&mut source).unwrap();
        let profile_id = profile(&source).unwrap().id;
        let behavior_id = "60000000-0000-4000-8000-000000000001";
        let occurrence_id = "60000000-0000-4000-8000-000000000002";
        source.execute("INSERT INTO behaviors(id,user_id,category_id,title,description,recurrence_rule,scheduled_time,timezone,browser_reminder_enabled,email_reminder_enabled,reminder_offset_minutes,active,created_at,updated_at,archived_at,current_configuration_event_id) VALUES(?1,?2,NULL,'Legacy',NULL,'{\"type\":\"daily\",\"interval\":1}','09:00:00','America/New_York',1,0,0,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL,NULL)", params![behavior_id,profile_id]).unwrap();
        source.execute("INSERT INTO occurrences(behavior_configuration_event_id,behavior_id,behavior_schedule_slot_id,completed_at,created_at,id,local_date,note,schedule_end_time,schedule_kind,schedule_preset,schedule_start_time,scheduled_for,status,status_marked_at,updated_at,user_id) VALUES(NULL,?1,NULL,NULL,'2026-09-01T00:00:00Z',?2,'2026-09-01','Preserved Note',NULL,'exact',NULL,'09:00:00','2026-09-01T13:00:00Z','unresolved',NULL,'2026-09-01T00:00:00Z',?3)", params![behavior_id,occurrence_id,profile_id]).unwrap();
        let schema_twelve_backup = protected_backup(&source, &source_path).unwrap();
        source.close().unwrap();

        let mut live = open(&live_path).unwrap();
        restore(&mut live, &live_path, &schema_twelve_backup).unwrap();
        let restored: super::super::rows::Behavior =
            by_id(&live, &profile_id, behavior_id).unwrap();
        assert!(restored.archive_notes.is_empty());
        assert_eq!(
            by_id::<super::super::rows::Occurrence>(&live, &profile_id, occurrence_id)
                .unwrap()
                .note
                .as_deref(),
            Some("Preserved Note")
        );
        assert_eq!(
            live.query_row("SELECT count(*) FROM note_shortcut_states", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );
        assert_eq!(
            live.query_row("SELECT max(version) FROM schema_migrations", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            MIGRATIONS.len() as i64
        );
        live.execute("INSERT INTO note_shortcut_states(id,user_id,behavior_id,enabled,entries,excluded_occurrence_ids,revision,updated_at) VALUES('global',?1,NULL,1,'[]','[]',1,'2026-09-01T00:00:00Z')", [&profile_id]).unwrap();
        let current_backup = protected_backup(&live, &live_path).unwrap();
        drop(live);
        let reopened = open(&current_backup).unwrap();
        assert_eq!(
            by_id::<super::super::rows::Occurrence>(&reopened, &profile_id, occurrence_id)
                .unwrap()
                .note
                .as_deref(),
            Some("Preserved Note")
        );
        assert!(
            by_id::<super::super::rows::NoteShortcutState>(&reopened, &profile_id, "global")
                .unwrap()
                .enabled
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn keep_local_copy_preserves_product_data_and_clears_only_account_link_state() {
        let directory = directory("disconnect-keep");
        let live_path = directory.join("cadence.sqlite3");
        let mut db = open(&live_path).unwrap();
        let profile_id = profile(&db).unwrap().id;
        let digest = "a".repeat(64);
        db.execute("INSERT INTO account_link_metadata VALUES(?1,'hosted-one','one@example.test','2026-09-01T00:00:00Z')", [&profile_id]).unwrap();
        db.execute("INSERT INTO account_first_link_attempts(local_profile_id,hosted_user_id,choice,attempt_id,local_fingerprint,hosted_fingerprint,created_at,pre_attempt_baseline_json) VALUES(?1,'hosted-one','import','attempt',?2,?2,'2026-09-01T00:00:00Z','{\"entities\":[]}')", params![profile_id,digest]).unwrap();
        db.execute("INSERT INTO account_sync_baselines VALUES(?1,'hosted-one','import',?2,?2,?2,?2,'{}',NULL,'2026-09-01T00:00:00Z')", params![profile_id,digest]).unwrap();
        db.execute(
            "INSERT INTO sync_cursors VALUES(?1,'account-sync',?2,'2026-09-01T00:00:00Z')",
            params![profile_id, digest],
        )
        .unwrap();
        let categories: i64 = db
            .query_row("SELECT count(*) FROM categories", [], |row| row.get(0))
            .unwrap();
        let outbox: i64 = db
            .query_row("SELECT count(*) FROM mutation_outbox", [], |row| row.get(0))
            .unwrap();

        assert_eq!(disconnect_keep_local_copy(&mut db).unwrap(), profile_id);
        assert_eq!(
            db.query_row("SELECT count(*) FROM categories", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            categories
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM mutation_outbox", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            outbox
        );
        for table in [
            "account_link_metadata",
            "account_first_link_attempts",
            "account_sync_baselines",
            "sync_cursors",
        ] {
            assert_eq!(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn remove_account_data_keeps_a_valid_backup_and_seeds_a_fresh_profile() {
        let directory = directory("disconnect-remove");
        let live_path = directory.join("cadence.sqlite3");
        let mut db = open(&live_path).unwrap();
        let old_profile = profile(&db).unwrap().id;
        let mutation_id: String = db
            .query_row(
                "SELECT mutation_id FROM mutation_outbox LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        db.execute(
            "INSERT INTO account_link_metadata VALUES(?1,'hosted-one',NULL,'2026-09-01T00:00:00Z')",
            [&old_profile],
        )
        .unwrap();
        db.execute("INSERT INTO tombstones(user_id,entity_type,entity_id,deleted_at,mutation_id) VALUES(?1,'behavior','gone','2026-09-01T00:00:00Z',?2)", params![old_profile,mutation_id]).unwrap();
        let backup = protected_backup(&db, &live_path).unwrap();

        let new_profile = disconnect_remove_account_data(&mut db).unwrap();
        assert_ne!(new_profile, old_profile);
        assert_eq!(profile(&db).unwrap().id, new_profile);
        assert_eq!(
            db.query_row("SELECT count(*) FROM categories", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            8
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM mutation_outbox", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        for table in [
            "account_link_metadata",
            "account_first_link_attempts",
            "account_sync_baselines",
            "tombstones",
            "sync_cursors",
        ] {
            assert_eq!(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        let backup_db = Connection::open(backup).unwrap();
        assert_eq!(profile(&backup_db).unwrap().id, old_profile);
        assert_eq!(
            backup_db
                .query_row("SELECT count(*) FROM tombstones", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn disconnect_requires_a_link_and_deletes_only_the_linked_profile() {
        let directory = directory("disconnect-ownership");
        let live_path = directory.join("cadence.sqlite3");
        let mut db = open(&live_path).unwrap();
        let linked = profile(&db).unwrap().id;
        assert!(disconnect_keep_local_copy(&mut db).is_err());
        assert!(disconnect_remove_account_data(&mut db).is_err());
        assert_eq!(profile(&db).unwrap().id, linked);

        db.execute("DROP INDEX local_profile_singleton", [])
            .unwrap();
        let other = "50000000-0000-4000-8000-000000000001";
        db.execute("INSERT INTO profiles(id,email,display_name,timezone,created_at,updated_at) VALUES(?1,'',NULL,'America/New_York','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')", [other]).unwrap();
        db.execute(
            "INSERT INTO account_link_metadata VALUES(?1,'hosted-one',NULL,'2026-09-01T00:00:00Z')",
            [&linked],
        )
        .unwrap();
        assert_eq!(disconnect_remove_account_data(&mut db).unwrap(), other);
        assert_eq!(
            db.query_row("SELECT count(*) FROM profiles", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("SELECT id FROM profiles", [], |row| row.get::<_, String>(0))
                .unwrap(),
            other
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn restore_rejects_corrupt_and_incompatible_files_without_changing_live_data() {
        let directory = directory("database-rejection");
        let live_path = directory.join("cadence.sqlite3");
        let mut live = open(&live_path).unwrap();
        let corrupt = directory.join("corrupt.sqlite3");
        std::fs::write(&corrupt, b"not sqlite").unwrap();
        assert!(restore(&mut live, &live_path, &corrupt).is_err());
        let incompatible = directory.join("incompatible.sqlite3");
        backup(&live, &live_path, &incompatible).unwrap();
        Connection::open(&incompatible)
            .unwrap()
            .execute(
                "UPDATE schema_migrations SET source='changed' WHERE version=6",
                [],
            )
            .unwrap();
        assert!(restore(&mut live, &live_path, &incompatible)
            .unwrap_err()
            .contains("does not match"));
        let altered = directory.join("altered.sqlite3");
        backup(&live, &live_path, &altered).unwrap();
        Connection::open(&altered)
            .unwrap()
            .execute("ALTER TABLE categories ADD COLUMN unexpected TEXT", [])
            .unwrap();
        assert!(restore(&mut live, &live_path, &altered)
            .unwrap_err()
            .contains("schema does not match"));
        let malformed = directory.join("malformed-archive-notes.sqlite3");
        backup(&live, &live_path, &malformed).unwrap();
        let malformed_db = Connection::open(&malformed).unwrap();
        let profile_id = profile(&malformed_db).unwrap().id;
        malformed_db.execute("INSERT INTO behaviors(id,user_id,category_id,title,description,recurrence_rule,scheduled_time,timezone,browser_reminder_enabled,email_reminder_enabled,reminder_offset_minutes,active,created_at,updated_at,archived_at,current_configuration_event_id,archive_notes) VALUES('70000000-0000-4000-8000-000000000001',?1,NULL,'Malformed',NULL,'{\"type\":\"daily\",\"interval\":1}','09:00:00','America/New_York',1,0,0,0,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL,'[{\"id\":\"not-a-uuid\"}]')", [profile_id]).unwrap();
        drop(malformed_db);
        assert!(restore(&mut live, &live_path, &malformed).is_err());
        assert_eq!(profile(&live).unwrap().timezone, "America/New_York");
        std::fs::remove_dir_all(directory).unwrap();
    }
}
