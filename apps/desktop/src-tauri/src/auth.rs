use crate::local_store::LocalStore;
use rusqlite::{OptionalExtension, TransactionBehavior};
use std::ffi::{c_char, CStr, CString};
use tauri::State;

const ALLOWED_KEYS: &[&str] = &[
    "supabase-session",
    "supabase-pkce",
    "pending-state",
    "pending-calendar-state",
    "pending-calendar-agent-state",
];

extern "C" {
    fn cadence_auth_open_url(value: *const c_char) -> bool;
    fn cadence_auth_secret_set(key: *const c_char, value: *const c_char) -> bool;
    fn cadence_auth_secret_get(key: *const c_char) -> *mut c_char;
    fn cadence_auth_secret_remove(key: *const c_char) -> bool;
    fn cadence_auth_free(value: *mut c_char);
}

fn key(value: &str) -> Result<CString, String> {
    if !ALLOWED_KEYS.contains(&value) {
        return Err("Unknown secure storage key.".into());
    }
    CString::new(value).map_err(|_| "Invalid secure storage key.".into())
}

#[tauri::command]
pub fn auth_open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.len() > 8192 {
        return Err("Cadence refused an invalid authentication URL.".into());
    }
    let value = CString::new(url).map_err(|_| "Cadence refused an invalid authentication URL.")?;
    if unsafe { cadence_auth_open_url(value.as_ptr()) } {
        Ok(())
    } else {
        Err("The system browser could not open.".into())
    }
}

#[tauri::command]
pub fn auth_secret_get(name: String) -> Result<Option<String>, String> {
    let name = key(&name)?;
    let pointer = unsafe { cadence_auth_secret_get(name.as_ptr()) };
    if pointer.is_null() {
        return Ok(None);
    }
    let value = unsafe { CStr::from_ptr(pointer).to_string_lossy().into_owned() };
    unsafe { cadence_auth_free(pointer) };
    Ok(Some(value))
}

#[tauri::command]
pub fn auth_secret_set(name: String, value: String) -> Result<(), String> {
    if value.len() > 64 * 1024 {
        return Err("The authentication session is too large.".into());
    }
    let name = key(&name)?;
    let value = CString::new(value).map_err(|_| "The authentication session is invalid.")?;
    if unsafe { cadence_auth_secret_set(name.as_ptr(), value.as_ptr()) } {
        Ok(())
    } else {
        Err("macOS Keychain did not save the authentication session.".into())
    }
}

#[tauri::command]
pub fn auth_secret_remove(name: String) -> Result<(), String> {
    let name = key(&name)?;
    if unsafe { cadence_auth_secret_remove(name.as_ptr()) } {
        Ok(())
    } else {
        Err("macOS Keychain did not remove the authentication session.".into())
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountMetadata {
    local_profile_id: String,
    hosted_user_id: String,
    email: Option<String>,
    authenticated_at: String,
}

#[tauri::command]
pub fn auth_account_metadata(
    store: State<'_, LocalStore>,
) -> Result<Option<AccountMetadata>, String> {
    let db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    read_account_metadata(&db)
}

fn read_account_metadata(db: &rusqlite::Connection) -> Result<Option<AccountMetadata>, String> {
    db.query_row(
        "SELECT local_profile_id,hosted_user_id,email,authenticated_at FROM account_link_metadata LIMIT 1",
        [],
        |row| Ok(AccountMetadata { local_profile_id: row.get(0)?, hosted_user_id: row.get(1)?, email: row.get(2)?, authenticated_at: row.get(3)? }),
    ).optional().map_err(|_| "Account metadata could not be read.".into())
}

#[tauri::command]
pub fn auth_record_account_metadata(
    store: State<'_, LocalStore>,
    hosted_user_id: String,
    email: Option<String>,
    authenticated_at: String,
) -> Result<(), String> {
    if hosted_user_id.is_empty()
        || hosted_user_id.len() > 128
        || email.as_ref().is_some_and(|value| value.len() > 320)
    {
        return Err("Account metadata is invalid.".into());
    }
    let db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    record_account_metadata(&db, hosted_user_id, email, authenticated_at)
}

#[tauri::command]
pub fn auth_clear_account_metadata(store: State<'_, LocalStore>) -> Result<(), String> {
    let db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    db.execute_batch("BEGIN IMMEDIATE; DELETE FROM account_first_link_attempts; DELETE FROM account_link_metadata; COMMIT;").map_err(|_| "Account metadata could not be cleared.".to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstLinkBaseline {
    hosted_user_id: String,
    idempotency_key: String,
    baseline_fingerprint: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSyncContext {
    hosted_user_id: String,
    baseline_fingerprint: String,
    baseline_json: String,
    outbox_high_water: i64,
    tombstones: Vec<AccountSyncTombstone>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSyncTombstone {
    entity_type: String,
    entity_id: String,
    deleted_at: String,
    mutation_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstLinkAttempt {
    attempt_id: String,
    local_fingerprint: String,
    hosted_fingerprint: String,
    pre_attempt_baseline_json: String,
}

#[tauri::command]
pub fn auth_begin_first_link(
    store: State<'_, LocalStore>,
    hosted_user_id: String,
    choice: String,
    attempt_id: String,
    local_fingerprint: String,
    hosted_fingerprint: String,
    pre_attempt_baseline_json: String,
    created_at: String,
) -> Result<FirstLinkAttempt, String> {
    if !["import", "ignore", "hydrate"].contains(&choice.as_str())
        || attempt_id.is_empty()
        || attempt_id.len() > 128
        || [&local_fingerprint, &hosted_fingerprint]
            .iter()
            .any(|value| value.len() != 64)
        || pre_attempt_baseline_json.len() > 64 * 1024 * 1024
        || serde_json::from_str::<serde_json::Value>(&pre_attempt_baseline_json).is_err()
    {
        return Err("Account link attempt is invalid.".into());
    }
    let db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let profile: String = db
        .query_row("SELECT id FROM profiles LIMIT 1", [], |row| row.get(0))
        .map_err(|_| "The local profile is unavailable.")?;
    let mapped: Option<String> = db
        .query_row(
            "SELECT hosted_user_id FROM account_link_metadata WHERE local_profile_id=?1",
            [&profile],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Account metadata could not be read.")?;
    if mapped.as_deref() != Some(hosted_user_id.as_str()) {
        return Err("Account link attempt does not match the authenticated account.".into());
    }
    db.execute("INSERT INTO account_first_link_attempts(local_profile_id,hosted_user_id,choice,attempt_id,local_fingerprint,hosted_fingerprint,created_at,pre_attempt_baseline_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(local_profile_id) DO NOTHING", rusqlite::params![profile,hosted_user_id,choice,attempt_id,local_fingerprint,hosted_fingerprint,created_at,pre_attempt_baseline_json]).map_err(|_| "Account link attempt could not be saved.".to_string())?;
    db.execute("UPDATE account_first_link_attempts SET pre_attempt_baseline_json=?1 WHERE local_profile_id=?2 AND hosted_user_id=?3 AND choice=?4 AND local_fingerprint=?5 AND pre_attempt_baseline_json IS NULL",
        rusqlite::params![pre_attempt_baseline_json,profile,hosted_user_id,choice,local_fingerprint]).map_err(|_| "Account link attempt could not be saved.".to_string())?;
    read_first_link_attempt(&db, &profile, &hosted_user_id, &choice)
}

fn read_first_link_attempt(
    db: &rusqlite::Connection,
    profile: &str,
    hosted_user_id: &str,
    choice: &str,
) -> Result<FirstLinkAttempt, String> {
    let saved: Option<(String,String,String,Option<String>)> = db.query_row("SELECT attempt_id,local_fingerprint,hosted_fingerprint,pre_attempt_baseline_json FROM account_first_link_attempts WHERE local_profile_id=?1 AND hosted_user_id=?2 AND choice=?3", rusqlite::params![profile,hosted_user_id,choice], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(|_| "Account link attempt could not be read.".to_string())?;
    let Some((attempt_id, local_fingerprint, hosted_fingerprint, Some(pre_attempt_baseline_json))) =
        saved
    else {
        return Err("The pending account link predates safe retry. Cancel the account link and start it again.".into());
    };
    Ok(FirstLinkAttempt {
        attempt_id,
        local_fingerprint,
        hosted_fingerprint,
        pre_attempt_baseline_json,
    })
}

#[tauri::command]
pub fn auth_first_link_baseline(
    store: State<'_, LocalStore>,
) -> Result<Option<FirstLinkBaseline>, String> {
    let db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    db.query_row("SELECT hosted_user_id,idempotency_key,baseline_fingerprint FROM account_sync_baselines LIMIT 1", [], |row| Ok(FirstLinkBaseline { hosted_user_id: row.get(0)?, idempotency_key: row.get(1)?, baseline_fingerprint: row.get(2)? }))
      .optional().map_err(|_| "Account baseline could not be read.".into())
}

#[tauri::command]
pub fn auth_account_sync_context(
    store: State<'_, LocalStore>,
) -> Result<Option<AccountSyncContext>, String> {
    let db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let baseline: Option<(String, String, String)> = db.query_row(
        "SELECT hosted_user_id,baseline_fingerprint,baseline_json FROM account_sync_baselines LIMIT 1", [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(|_| "Account synchronization state could not be read.")?;
    let Some((hosted_user_id, baseline_fingerprint, baseline_json)) = baseline else {
        return Ok(None);
    };
    let outbox_high_water = db
        .query_row(
            "SELECT coalesce(max(sequence),0) FROM mutation_outbox WHERE synced_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Account synchronization state could not be read.")?;
    let mut statement = db.prepare("SELECT entity_type,entity_id,deleted_at,mutation_id FROM tombstones ORDER BY entity_type,entity_id")
        .map_err(|_| "Account synchronization state could not be read.")?;
    let tombstones = statement
        .query_map([], |row| {
            Ok(AccountSyncTombstone {
                entity_type: row.get(0)?,
                entity_id: row.get(1)?,
                deleted_at: row.get(2)?,
                mutation_id: row.get(3)?,
            })
        })
        .map_err(|_| "Account synchronization state could not be read.")?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| "Account synchronization state could not be read.")?;
    Ok(Some(AccountSyncContext {
        hosted_user_id,
        baseline_fingerprint,
        baseline_json,
        outbox_high_water,
        tombstones,
    }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn auth_complete_account_sync(
    store: State<'_, LocalStore>,
    hosted_user_id: String,
    expected_baseline_fingerprint: String,
    idempotency_key: String,
    baseline_fingerprint: String,
    baseline_json: String,
    outbox_high_water: i64,
    completed_at: String,
) -> Result<(), String> {
    let mut db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    complete_account_sync(
        &mut db,
        hosted_user_id,
        expected_baseline_fingerprint,
        idempotency_key,
        baseline_fingerprint,
        baseline_json,
        outbox_high_water,
        completed_at,
    )
}

#[allow(clippy::too_many_arguments)]
fn complete_account_sync(
    db: &mut rusqlite::Connection,
    hosted_user_id: String,
    expected_baseline_fingerprint: String,
    idempotency_key: String,
    baseline_fingerprint: String,
    baseline_json: String,
    outbox_high_water: i64,
    completed_at: String,
) -> Result<(), String> {
    if baseline_json.len() > 64 * 1024 * 1024
        || outbox_high_water < 0
        || [
            &expected_baseline_fingerprint,
            &idempotency_key,
            &baseline_fingerprint,
        ]
        .iter()
        .any(|value| value.len() != 64)
        || serde_json::from_str::<serde_json::Value>(&baseline_json).is_err()
    {
        return Err("Account synchronization result is invalid.".into());
    }
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Account synchronization state could not be saved.")?;
    let profile: String = tx
        .query_row("SELECT id FROM profiles LIMIT 1", [], |row| row.get(0))
        .map_err(|_| "The local profile is unavailable.")?;
    let current: Option<(String, String)> = tx.query_row("SELECT hosted_user_id,baseline_fingerprint FROM account_sync_baselines WHERE local_profile_id=?1", [&profile], |row| Ok((row.get(0)?,row.get(1)?)))
        .optional().map_err(|_| "Account synchronization state could not be read.")?;
    if current.as_ref() != Some(&(hosted_user_id.clone(), expected_baseline_fingerprint)) {
        return Err("Account synchronization started from a stale baseline.".into());
    }
    tx.execute("UPDATE account_sync_baselines SET idempotency_key=?2,local_fingerprint=?3,hosted_fingerprint=?3,baseline_fingerprint=?3,baseline_json=?4,completed_at=?5 WHERE local_profile_id=?1",
        rusqlite::params![profile,idempotency_key,baseline_fingerprint,baseline_json,completed_at]).map_err(|_| "Account synchronization state could not be saved.")?;
    tx.execute("UPDATE mutation_outbox SET synced_at=?2 WHERE user_id=?1 AND sequence<=?3 AND synced_at IS NULL", rusqlite::params![profile,completed_at,outbox_high_water])
        .map_err(|_| "Account synchronization state could not be saved.")?;
    tx.execute("DELETE FROM tombstones WHERE user_id=?1 AND mutation_id IN (SELECT mutation_id FROM mutation_outbox WHERE user_id=?1 AND sequence<=?2 AND synced_at IS NOT NULL)", rusqlite::params![profile,outbox_high_water])
        .map_err(|_| "Account synchronization state could not be saved.")?;
    tx.execute("INSERT INTO sync_cursors(user_id,name,value,updated_at) VALUES(?1,'account-sync',?2,?3) ON CONFLICT(user_id,name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        rusqlite::params![profile,baseline_fingerprint,completed_at]).map_err(|_| "Account synchronization state could not be saved.")?;
    tx.commit()
        .map_err(|_| "Account synchronization state could not be saved.".to_string())
}

fn record_account_metadata(
    db: &rusqlite::Connection,
    hosted_user_id: String,
    email: Option<String>,
    authenticated_at: String,
) -> Result<(), String> {
    let profile: String = db
        .query_row("SELECT id FROM profiles LIMIT 1", [], |row| row.get(0))
        .map_err(|_| "The local profile is unavailable.")?;
    let existing: Option<String> = db
        .query_row(
            "SELECT hosted_user_id FROM account_link_metadata WHERE local_profile_id=?1",
            [&profile],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Account metadata could not be read.")?;
    if existing.as_deref().is_some_and(|id| id != hosted_user_id) {
        return Err(
            "Disconnect the current account before signing in with a different account.".into(),
        );
    }
    db.execute(
        "INSERT INTO account_link_metadata(local_profile_id,hosted_user_id,email,authenticated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(local_profile_id) DO UPDATE SET email=excluded.email,authenticated_at=excluded.authenticated_at WHERE account_link_metadata.hosted_user_id=excluded.hosted_user_id",
        rusqlite::params![profile, hosted_user_id, email, authenticated_at],
    ).map_err(|_| "Account metadata could not be saved.".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_metadata_keeps_local_identity_and_rejects_another_account() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE profiles(id TEXT PRIMARY KEY); INSERT INTO profiles VALUES('local-profile'); CREATE TABLE account_link_metadata(local_profile_id TEXT PRIMARY KEY, hosted_user_id TEXT NOT NULL UNIQUE, email TEXT, authenticated_at TEXT NOT NULL);").unwrap();
        record_account_metadata(
            &db,
            "hosted-one".into(),
            Some("one@example.test".into()),
            "2026-08-31T00:00:00Z".into(),
        )
        .unwrap();
        let saved = read_account_metadata(&db).unwrap().unwrap();
        assert_eq!(saved.local_profile_id, "local-profile");
        assert_eq!(saved.hosted_user_id, "hosted-one");
        assert!(record_account_metadata(
            &db,
            "hosted-two".into(),
            None,
            "2026-08-31T00:01:00Z".into()
        )
        .is_err());
    }

    #[test]
    fn first_link_attempt_baseline_survives_reopen() {
        let path = std::env::temp_dir().join(format!(
            "cadence-first-link-baseline-{}.sqlite3",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        {
            let db = rusqlite::Connection::open(&path).unwrap();
            db.execute_batch("CREATE TABLE profiles(id TEXT PRIMARY KEY); INSERT INTO profiles VALUES('local-profile'); CREATE TABLE account_link_metadata(local_profile_id TEXT PRIMARY KEY, hosted_user_id TEXT NOT NULL UNIQUE, email TEXT, authenticated_at TEXT NOT NULL); INSERT INTO account_link_metadata VALUES('local-profile','hosted-one',NULL,'2026-09-01T00:00:00Z');").unwrap();
            db.execute_batch(include_str!("../migrations/0009_first_link_attempt.sql"))
                .unwrap();
            db.execute_batch(include_str!(
                "../migrations/0010_first_link_attempt_baseline.sql"
            ))
            .unwrap();
            db.execute("INSERT INTO account_first_link_attempts(local_profile_id,hosted_user_id,choice,attempt_id,local_fingerprint,hosted_fingerprint,created_at,pre_attempt_baseline_json) VALUES('local-profile','hosted-one','import','attempt',?1,?1,'2026-09-01T00:00:00Z',?2)", rusqlite::params!["a".repeat(64), "{\"entities\":[{\"kind\":\"behavior\",\"id\":\"one\",\"value\":{\"id\":\"one\"}}]}"]).unwrap();
        }
        let reopened = rusqlite::Connection::open(&path).unwrap();
        let saved: String = reopened
            .query_row(
                "SELECT pre_attempt_baseline_json FROM account_first_link_attempts",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(saved.contains("\"behavior\""));
        drop(reopened);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn migrated_first_link_attempt_without_baseline_fails_with_cancel_instruction() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE profiles(id TEXT PRIMARY KEY); INSERT INTO profiles VALUES('local-profile');").unwrap();
        db.execute_batch(include_str!("../migrations/0009_first_link_attempt.sql"))
            .unwrap();
        db.execute_batch(include_str!(
            "../migrations/0010_first_link_attempt_baseline.sql"
        ))
        .unwrap();
        db.execute("INSERT INTO account_first_link_attempts(local_profile_id,hosted_user_id,choice,attempt_id,local_fingerprint,hosted_fingerprint,created_at) VALUES('local-profile','hosted-one','import','attempt',?1,?1,'2026-09-01T00:00:00Z')", ["a".repeat(64)]).unwrap();
        let error = read_first_link_attempt(&db, "local-profile", "hosted-one", "import")
            .err()
            .unwrap();
        assert!(error.contains("Cancel the account link and start it again"));
    }

    #[test]
    fn account_sync_completion_advances_only_the_captured_outbox_atomically() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE profiles(id TEXT PRIMARY KEY); INSERT INTO profiles VALUES('local-profile');
          CREATE TABLE account_sync_baselines(local_profile_id TEXT PRIMARY KEY,hosted_user_id TEXT,idempotency_key TEXT,local_fingerprint TEXT,hosted_fingerprint TEXT,baseline_fingerprint TEXT,baseline_json TEXT,completed_at TEXT);
          CREATE TABLE mutation_outbox(sequence INTEGER PRIMARY KEY,mutation_id TEXT UNIQUE,user_id TEXT, synced_at TEXT);
          CREATE TABLE tombstones(user_id TEXT,entity_type TEXT,entity_id TEXT,deleted_at TEXT,mutation_id TEXT);
          CREATE TABLE sync_cursors(user_id TEXT,name TEXT,value TEXT,updated_at TEXT,PRIMARY KEY(user_id,name));
          INSERT INTO account_sync_baselines VALUES('local-profile','hosted-one','old','a','a','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','2026-09-01T00:00:00Z');
          INSERT INTO mutation_outbox VALUES(1,'one','local-profile',NULL),(2,'two','local-profile',NULL);
          INSERT INTO tombstones VALUES('local-profile','behavior','gone','2026-09-01T00:01:00Z','one');").unwrap();
        let digest = "b".repeat(64);
        complete_account_sync(
            &mut db,
            "hosted-one".into(),
            "a".repeat(64),
            "c".repeat(64),
            digest.clone(),
            "{}".into(),
            1,
            "2026-09-01T00:02:00Z".into(),
        )
        .unwrap();
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM mutation_outbox WHERE synced_at IS NOT NULL",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM tombstones", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row("SELECT value FROM sync_cursors", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            digest
        );
        assert!(complete_account_sync(
            &mut db,
            "hosted-one".into(),
            "a".repeat(64),
            "d".repeat(64),
            "e".repeat(64),
            "{}".into(),
            2,
            "2026-09-01T00:03:00Z".into()
        )
        .is_err());
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM mutation_outbox WHERE synced_at IS NOT NULL",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }

    #[test]
    fn every_keychain_operation_uses_the_fixed_data_protection_query() {
        let source = include_str!("../native/auth.m");
        assert!(source.contains("kSecUseDataProtectionKeychain: @YES"));
        assert!(source.contains("kSecAttrSynchronizable: @NO"));
        for operation in [
            "SecItemUpdate",
            "SecItemAdd",
            "SecItemCopyMatching",
            "SecItemDelete",
        ] {
            assert!(source.contains(operation));
        }
        assert_eq!(source.matches("keychainQuery(").count(), 4);
    }
}
