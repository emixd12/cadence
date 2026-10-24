use crate::local_store::LocalStore;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{collections::HashSet, path::Path, sync::Mutex};
use tauri::State;

pub struct CalendarCache(pub Mutex<Connection>);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarCacheRequest {
    account_id: String,
    connection_generation: i64,
    selection_revision: i64,
    start_local_date: String,
    end_local_date: String,
    timezone: String,
    selected_calendar_ids: Vec<String>,
    hidden_calendar_ids: Vec<String>,
    visible: bool,
    show_all_day: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarCachedSnapshot {
    request: CalendarCacheRequest,
    snapshot_json: String,
}

pub fn open(path: &Path) -> Result<CalendarCache, String> {
    let db = Connection::open(path).map_err(error)?;
    #[cfg(unix)]
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|_| "Calendar cache permissions could not be restricted.".to_string())?;
    initialize(&db)?;
    Ok(CalendarCache(Mutex::new(db)))
}

fn initialize(db: &Connection) -> Result<(), String> {
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(error)?;
    db.execute_batch(
        "PRAGMA journal_mode=DELETE;
         PRAGMA secure_delete=ON;
         CREATE TABLE IF NOT EXISTS cache_fence(id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
         INSERT OR IGNORE INTO cache_fence(id,value) VALUES(1,0);
         CREATE TABLE IF NOT EXISTS pending_refresh(
           request_id TEXT PRIMARY KEY, fence INTEGER NOT NULL, account_id TEXT NOT NULL,
           connection_generation INTEGER NOT NULL, selection_revision INTEGER NOT NULL,
           start_local_date TEXT NOT NULL, end_local_date TEXT NOT NULL, timezone TEXT NOT NULL,
           selected_calendar_ids_json TEXT NOT NULL, hidden_calendar_ids_json TEXT NOT NULL,
           visible INTEGER NOT NULL, show_all_day INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS complete_snapshot(
           id INTEGER PRIMARY KEY CHECK(id=1), account_id TEXT NOT NULL,
           connection_generation INTEGER NOT NULL, selection_revision INTEGER NOT NULL,
           start_local_date TEXT NOT NULL, end_local_date TEXT NOT NULL, timezone TEXT NOT NULL,
           selected_calendar_ids_json TEXT NOT NULL, hidden_calendar_ids_json TEXT NOT NULL,
           visible INTEGER NOT NULL, show_all_day INTEGER NOT NULL, snapshot_json TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS connector_fence(provider TEXT PRIMARY KEY, value INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS connector_pending(
           provider TEXT PRIMARY KEY, request_id TEXT NOT NULL, fence INTEGER NOT NULL,
           account_id TEXT NOT NULL, scope_key TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS connector_snapshot(
           provider TEXT PRIMARY KEY, account_id TEXT NOT NULL, scope_key TEXT NOT NULL, snapshot_json TEXT NOT NULL
         );",
    ).map_err(error)
}

#[tauri::command]
pub fn calendar_cache_begin(
    cache: State<'_, CalendarCache>,
    store: State<'_, LocalStore>,
    request: CalendarCacheRequest,
    request_id: String,
) -> Result<(), String> {
    let auth = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    begin(&auth, &mut cache, &request, &request_id)
}

#[tauri::command]
pub fn calendar_cache_read(
    cache: State<'_, CalendarCache>,
    store: State<'_, LocalStore>,
    request: CalendarCacheRequest,
) -> Result<Option<String>, String> {
    let auth = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    read(&auth, &mut cache, &request)
}

#[tauri::command]
pub fn calendar_cache_read_current(
    cache: State<'_, CalendarCache>,
    store: State<'_, LocalStore>,
    account_id: String,
    start_local_date: String,
    end_local_date: String,
    timezone: String,
) -> Result<Option<CalendarCachedSnapshot>, String> {
    let auth = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    read_current(
        &auth,
        &mut cache,
        &account_id,
        &start_local_date,
        &end_local_date,
        &timezone,
    )
}

#[tauri::command]
pub fn calendar_cache_replace(
    cache: State<'_, CalendarCache>,
    store: State<'_, LocalStore>,
    request: CalendarCacheRequest,
    request_id: String,
    snapshot_json: String,
) -> Result<(), String> {
    let auth = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    replace(&auth, &mut cache, &request, &request_id, &snapshot_json)
}

#[tauri::command]
pub fn calendar_cache_clear(cache: State<'_, CalendarCache>) -> Result<(), String> {
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    clear(&mut cache)
}

fn account_id(auth: &Connection) -> Result<Option<String>, String> {
    auth.query_row(
        "SELECT hosted_user_id FROM account_link_metadata LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|_| "Account metadata could not be read.".into())
}

fn require_account(
    auth: &Connection,
    cache: &mut Connection,
    expected: &str,
) -> Result<(), String> {
    if account_id(auth)?.as_deref() == Some(expected) {
        return Ok(());
    }
    clear_all(cache)?;
    Err("Calendar cache does not match the linked account.".into())
}

fn validate_request(request: &CalendarCacheRequest) -> Result<String, String> {
    let ids: HashSet<&str> = request
        .selected_calendar_ids
        .iter()
        .map(String::as_str)
        .collect();
    let date = |value: &str| {
        value.len() == 10 && value.as_bytes()[4] == b'-' && value.as_bytes()[7] == b'-'
    };
    let hidden: HashSet<&str> = request
        .hidden_calendar_ids
        .iter()
        .map(String::as_str)
        .collect();
    if request.account_id.is_empty()
        || request.account_id.len() > 128
        || request.connection_generation < 1
        || request.selection_revision < 0
        || !date(&request.start_local_date)
        || !date(&request.end_local_date)
        || request.start_local_date > request.end_local_date
        || request.timezone.is_empty()
        || request.timezone.len() > 128
        || request.selected_calendar_ids.is_empty()
        || request.selected_calendar_ids.len() > 32
        || ids.len() != request.selected_calendar_ids.len()
        || hidden.len() != request.hidden_calendar_ids.len()
        || request
            .selected_calendar_ids
            .iter()
            .any(|id| id.is_empty() || id.len() > 1024)
        || request.hidden_calendar_ids.len() > 32
        || request
            .hidden_calendar_ids
            .iter()
            .any(|id| !ids.contains(id.as_str()))
    {
        return Err("Calendar cache request is invalid.".into());
    }
    serde_json::to_string(&request.selected_calendar_ids).map_err(error)
}

fn begin(
    auth: &Connection,
    cache: &mut Connection,
    request: &CalendarCacheRequest,
    request_id: &str,
) -> Result<(), String> {
    let ids = validate_request(request)?;
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Calendar refresh request is invalid.".into());
    }
    require_account(auth, cache, &request.account_id)?;
    let tx = cache
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let fence: i64 = tx
        .query_row("SELECT value FROM cache_fence WHERE id=1", [], |row| {
            row.get(0)
        })
        .map_err(error)?;
    tx.execute("DELETE FROM pending_refresh", [])
        .map_err(error)?;
    let hidden = serde_json::to_string(&request.hidden_calendar_ids).map_err(error)?;
    tx.execute("DELETE FROM complete_snapshot WHERE NOT (account_id=?1 AND connection_generation=?2 AND selection_revision=?3 AND start_local_date=?4 AND end_local_date=?5 AND timezone=?6 AND selected_calendar_ids_json=?7 AND hidden_calendar_ids_json=?8 AND visible=?9 AND show_all_day=?10)",
        params![request.account_id,request.connection_generation,request.selection_revision,request.start_local_date,request.end_local_date,request.timezone,ids,hidden,request.visible,request.show_all_day]).map_err(error)?;
    tx.execute("INSERT INTO pending_refresh(request_id,fence,account_id,connection_generation,selection_revision,start_local_date,end_local_date,timezone,selected_calendar_ids_json,hidden_calendar_ids_json,visible,show_all_day) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![request_id,fence,request.account_id,request.connection_generation,request.selection_revision,request.start_local_date,request.end_local_date,request.timezone,ids,hidden,request.visible,request.show_all_day]).map_err(error)?;
    tx.commit().map_err(error)
}

fn read(
    auth: &Connection,
    cache: &mut Connection,
    request: &CalendarCacheRequest,
) -> Result<Option<String>, String> {
    let ids = validate_request(request)?;
    require_account(auth, cache, &request.account_id)?;
    let hidden = serde_json::to_string(&request.hidden_calendar_ids).map_err(error)?;
    cache.query_row("SELECT snapshot_json FROM complete_snapshot WHERE id=1 AND account_id=?1 AND connection_generation=?2 AND selection_revision=?3 AND start_local_date=?4 AND end_local_date=?5 AND timezone=?6 AND selected_calendar_ids_json=?7 AND hidden_calendar_ids_json=?8 AND visible=?9 AND show_all_day=?10",
        params![request.account_id,request.connection_generation,request.selection_revision,request.start_local_date,request.end_local_date,request.timezone,ids,hidden,request.visible,request.show_all_day], |row| row.get(0))
        .optional().map_err(error)
}

fn read_current(
    auth: &Connection,
    cache: &mut Connection,
    account: &str,
    start: &str,
    end: &str,
    timezone: &str,
) -> Result<Option<CalendarCachedSnapshot>, String> {
    require_account(auth, cache, account)?;
    let stored: Option<(i64,i64,String,String,bool,bool,String)> = cache.query_row(
        "SELECT connection_generation,selection_revision,selected_calendar_ids_json,hidden_calendar_ids_json,visible,show_all_day,snapshot_json FROM complete_snapshot WHERE id=1 AND account_id=?1 AND start_local_date=?2 AND end_local_date=?3 AND timezone=?4",
        params![account,start,end,timezone],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
    ).optional().map_err(error)?;
    let Some((
        connection_generation,
        selection_revision,
        selected,
        hidden,
        visible,
        show_all_day,
        snapshot_json,
    )) = stored
    else {
        let has_snapshot: bool = cache.query_row("SELECT EXISTS(SELECT 1 FROM complete_snapshot)", [], |row| row.get(0)).map_err(error)?;
        if has_snapshot { clear(cache)?; }
        return Ok(None);
    };
    let request = CalendarCacheRequest {
        account_id: account.into(),
        connection_generation,
        selection_revision,
        start_local_date: start.into(),
        end_local_date: end.into(),
        timezone: timezone.into(),
        selected_calendar_ids: serde_json::from_str(&selected).map_err(error)?,
        hidden_calendar_ids: serde_json::from_str(&hidden).map_err(error)?,
        visible,
        show_all_day,
    };
    validate_request(&request)?;
    verify_snapshot(&snapshot_json, &request)?;
    Ok(Some(CalendarCachedSnapshot {
        request,
        snapshot_json,
    }))
}

fn replace(
    auth: &Connection,
    cache: &mut Connection,
    request: &CalendarCacheRequest,
    request_id: &str,
    snapshot_json: &str,
) -> Result<(), String> {
    let ids = validate_request(request)?;
    if snapshot_json.len() > 16 * 1024 * 1024 {
        return Err("Calendar snapshot is too large.".into());
    }
    verify_snapshot(snapshot_json, request)?;
    require_account(auth, cache, &request.account_id)?;
    let tx = cache
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let hidden = serde_json::to_string(&request.hidden_calendar_ids).map_err(error)?;
    let pending: Option<i64> = tx.query_row("SELECT fence FROM pending_refresh WHERE request_id=?1 AND account_id=?2 AND connection_generation=?3 AND selection_revision=?4 AND start_local_date=?5 AND end_local_date=?6 AND timezone=?7 AND selected_calendar_ids_json=?8 AND hidden_calendar_ids_json=?9 AND visible=?10 AND show_all_day=?11",
        params![request_id,request.account_id,request.connection_generation,request.selection_revision,request.start_local_date,request.end_local_date,request.timezone,ids,hidden,request.visible,request.show_all_day], |row| row.get(0)).optional().map_err(error)?;
    let fence: i64 = tx
        .query_row("SELECT value FROM cache_fence WHERE id=1", [], |row| {
            row.get(0)
        })
        .map_err(error)?;
    if pending != Some(fence) {
        return Err("Calendar refresh was cleared or superseded.".into());
    }
    tx.execute("DELETE FROM complete_snapshot", [])
        .map_err(error)?;
    tx.execute("INSERT INTO complete_snapshot(id,account_id,connection_generation,selection_revision,start_local_date,end_local_date,timezone,selected_calendar_ids_json,hidden_calendar_ids_json,visible,show_all_day,snapshot_json) VALUES(1,?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![request.account_id,request.connection_generation,request.selection_revision,request.start_local_date,request.end_local_date,request.timezone,ids,hidden,request.visible,request.show_all_day,snapshot_json]).map_err(error)?;
    tx.execute("DELETE FROM pending_refresh", [])
        .map_err(error)?;
    tx.commit().map_err(error)
}

fn verify_snapshot(snapshot_json: &str, request: &CalendarCacheRequest) -> Result<(), String> {
    let value: Value = serde_json::from_str(snapshot_json)
        .map_err(|_| "Calendar snapshot JSON is invalid.".to_string())?;
    let range = value
        .get("requestedRange")
        .and_then(Value::as_object)
        .ok_or("Calendar snapshot range is missing.")?;
    let selected = range
        .get("selectedCalendarIds")
        .and_then(Value::as_array)
        .and_then(|values| {
            values
                .iter()
                .map(|value| value.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()
        });
    let exact = value.get("schemaVersion").and_then(Value::as_str) == Some("1.0.0")
        && value.get("accountId").and_then(Value::as_str) == Some(request.account_id.as_str())
        && value.get("connectionGeneration").and_then(Value::as_i64)
            == Some(request.connection_generation)
        && value.get("completeness").and_then(Value::as_str) == Some("complete")
        && range.get("startLocalDate").and_then(Value::as_str)
            == Some(request.start_local_date.as_str())
        && range.get("endLocalDate").and_then(Value::as_str)
            == Some(request.end_local_date.as_str())
        && range.get("timezone").and_then(Value::as_str) == Some(request.timezone.as_str())
        && selected.as_ref() == Some(&request.selected_calendar_ids);
    if exact {
        Ok(())
    } else {
        Err("Calendar snapshot does not match the refresh request.".into())
    }
}

fn clear(cache: &mut Connection) -> Result<(), String> {
    let tx = cache
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    tx.execute("UPDATE cache_fence SET value=value+1 WHERE id=1", [])
        .map_err(error)?;
    tx.execute("DELETE FROM pending_refresh", [])
        .map_err(error)?;
    tx.execute("DELETE FROM complete_snapshot", [])
        .map_err(error)?;
    tx.commit().map_err(error)
}

// Ticket 238: one disposable snapshot per connector source, keyed by the
// client-computed scope key (provider, account, generation, range, timezone, and
// selection). It shares this file, outside cadence.sqlite3 and user backups,
// and never stores credentials. Each provider has its own fence, so clearing one
// source never cancels another source's refresh.
const CONNECTOR_PROVIDERS: &[&str] = &["outlook_calendar", "hevy", "icloud_calendar"];
const MAX_SCOPE_KEY: usize = 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorCachedSnapshot {
    scope_key: String,
    snapshot_json: String,
}

#[tauri::command]
pub fn connector_cache_begin(
    cache: State<'_, CalendarCache>,
    store: State<'_, LocalStore>,
    provider: String,
    account_id: String,
    scope_key: String,
    request_id: String,
) -> Result<(), String> {
    let auth = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    source_cache_begin(
        &auth,
        &mut cache,
        &provider,
        &account_id,
        &scope_key,
        &request_id,
    )
}

#[tauri::command]
pub fn connector_cache_read(
    cache: State<'_, CalendarCache>,
    store: State<'_, LocalStore>,
    provider: String,
    account_id: String,
    scope_key: String,
) -> Result<Option<String>, String> {
    let auth = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    source_cache_read(&auth, &mut cache, &provider, &account_id, &scope_key)
}

#[tauri::command]
pub fn connector_cache_read_current(
    cache: State<'_, CalendarCache>,
    store: State<'_, LocalStore>,
    provider: String,
    account_id: String,
) -> Result<Option<ConnectorCachedSnapshot>, String> {
    let auth = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    source_cache_read_current(&auth, &mut cache, &provider, &account_id)
}

#[tauri::command]
pub fn connector_cache_replace(
    cache: State<'_, CalendarCache>,
    store: State<'_, LocalStore>,
    provider: String,
    account_id: String,
    scope_key: String,
    request_id: String,
    snapshot_json: String,
) -> Result<(), String> {
    let auth = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    source_cache_replace(
        &auth,
        &mut cache,
        &provider,
        &account_id,
        &scope_key,
        &request_id,
        &snapshot_json,
    )
}

/// Clears one provider, or every connector source when `provider` is absent.
#[tauri::command]
pub fn connector_cache_clear(
    cache: State<'_, CalendarCache>,
    provider: Option<String>,
) -> Result<(), String> {
    let mut cache = cache
        .0
        .lock()
        .map_err(|_| "Calendar cache lock is unavailable.")?;
    source_cache_clear(&mut cache, provider.as_deref())
}

fn validate_provider(provider: &str) -> Result<(), String> {
    if CONNECTOR_PROVIDERS.contains(&provider) {
        Ok(())
    } else {
        Err("Connector cache source is invalid.".into())
    }
}

/// Parses `[provider, accountId, generation, ...]` and checks it names this provider and account.
fn validate_scope(provider: &str, account: &str, scope_key: &str) -> Result<i64, String> {
    validate_provider(provider)?;
    if account.is_empty()
        || account.len() > 128
        || scope_key.is_empty()
        || scope_key.len() > MAX_SCOPE_KEY
    {
        return Err("Connector cache request is invalid.".into());
    }
    let scope: Value = serde_json::from_str(scope_key)
        .map_err(|_| "Connector cache scope is invalid.".to_string())?;
    let parts = scope
        .as_array()
        .ok_or("Connector cache scope is invalid.")?;
    let generation = parts.get(2).and_then(Value::as_i64).unwrap_or(0);
    if parts.len() < 6
        || parts.first().and_then(Value::as_str) != Some(provider)
        || parts.get(1).and_then(Value::as_str) != Some(account)
        || generation < 1
    {
        return Err("Connector cache scope does not match the source or account.".into());
    }
    Ok(generation)
}

fn source_cache_fence(tx: &Connection, provider: &str) -> Result<i64, String> {
    tx.execute(
        "INSERT OR IGNORE INTO connector_fence(provider,value) VALUES(?1,0)",
        params![provider],
    )
    .map_err(error)?;
    tx.query_row(
        "SELECT value FROM connector_fence WHERE provider=?1",
        params![provider],
        |row| row.get(0),
    )
    .map_err(error)
}

fn source_cache_begin(
    auth: &Connection,
    cache: &mut Connection,
    provider: &str,
    account: &str,
    scope_key: &str,
    request_id: &str,
) -> Result<(), String> {
    validate_scope(provider, account, scope_key)?;
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Connector refresh request is invalid.".into());
    }
    require_account(auth, cache, account)?;
    let tx = cache
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let fence = source_cache_fence(&tx, provider)?;
    tx.execute(
        "DELETE FROM connector_snapshot WHERE provider=?1 AND NOT (account_id=?2 AND scope_key=?3)",
        params![provider, account, scope_key],
    )
    .map_err(error)?;
    tx.execute("INSERT OR REPLACE INTO connector_pending(provider,request_id,fence,account_id,scope_key) VALUES(?1,?2,?3,?4,?5)",
        params![provider, request_id, fence, account, scope_key]).map_err(error)?;
    tx.commit().map_err(error)
}

fn source_cache_read(
    auth: &Connection,
    cache: &mut Connection,
    provider: &str,
    account: &str,
    scope_key: &str,
) -> Result<Option<String>, String> {
    validate_scope(provider, account, scope_key)?;
    require_account(auth, cache, account)?;
    cache.query_row("SELECT snapshot_json FROM connector_snapshot WHERE provider=?1 AND account_id=?2 AND scope_key=?3",
        params![provider, account, scope_key], |row| row.get(0)).optional().map_err(error)
}

fn source_cache_read_current(
    auth: &Connection,
    cache: &mut Connection,
    provider: &str,
    account: &str,
) -> Result<Option<ConnectorCachedSnapshot>, String> {
    validate_provider(provider)?;
    require_account(auth, cache, account)?;
    let stored: Option<(String, String, String)> = cache
        .query_row(
            "SELECT account_id,scope_key,snapshot_json FROM connector_snapshot WHERE provider=?1",
            params![provider],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(error)?;
    let Some((owner, scope_key, snapshot_json)) = stored else {
        return Ok(None);
    };
    if owner != account || validate_scope(provider, account, &scope_key).is_err() {
        source_cache_clear(cache, Some(provider))?;
        return Ok(None);
    }
    Ok(Some(ConnectorCachedSnapshot {
        scope_key,
        snapshot_json,
    }))
}

fn source_cache_replace(
    auth: &Connection,
    cache: &mut Connection,
    provider: &str,
    account: &str,
    scope_key: &str,
    request_id: &str,
    snapshot_json: &str,
) -> Result<(), String> {
    let generation = validate_scope(provider, account, scope_key)?;
    if snapshot_json.len() > 16 * 1024 * 1024 {
        return Err("Connector snapshot is too large.".into());
    }
    let value: Value = serde_json::from_str(snapshot_json)
        .map_err(|_| "Connector snapshot JSON is invalid.".to_string())?;
    if value.get("source").and_then(Value::as_str) != Some(provider)
        || value.get("accountId").and_then(Value::as_str) != Some(account)
        || value.get("connectionGeneration").and_then(Value::as_i64) != Some(generation)
        || value.get("completeness").and_then(Value::as_str) != Some("complete")
    {
        return Err("Connector snapshot does not match the refresh request.".into());
    }
    require_account(auth, cache, account)?;
    let tx = cache
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let pending: Option<i64> = tx.query_row(
        "SELECT fence FROM connector_pending WHERE provider=?1 AND request_id=?2 AND account_id=?3 AND scope_key=?4",
        params![provider, request_id, account, scope_key], |row| row.get(0)).optional().map_err(error)?;
    let fence = source_cache_fence(&tx, provider)?;
    if pending != Some(fence) {
        return Err("Connector refresh was cleared or superseded.".into());
    }
    tx.execute("INSERT OR REPLACE INTO connector_snapshot(provider,account_id,scope_key,snapshot_json) VALUES(?1,?2,?3,?4)",
        params![provider, account, scope_key, snapshot_json]).map_err(error)?;
    tx.execute(
        "DELETE FROM connector_pending WHERE provider=?1",
        params![provider],
    )
    .map_err(error)?;
    tx.commit().map_err(error)
}

fn source_cache_clear(cache: &mut Connection, provider: Option<&str>) -> Result<(), String> {
    let providers: Vec<&str> = match provider {
        Some(value) => {
            validate_provider(value)?;
            vec![value]
        }
        None => CONNECTOR_PROVIDERS.to_vec(),
    };
    let tx = cache
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    for value in providers {
        tx.execute(
            "INSERT OR IGNORE INTO connector_fence(provider,value) VALUES(?1,0)",
            params![value],
        )
        .map_err(error)?;
        tx.execute(
            "UPDATE connector_fence SET value=value+1 WHERE provider=?1",
            params![value],
        )
        .map_err(error)?;
        tx.execute(
            "DELETE FROM connector_pending WHERE provider=?1",
            params![value],
        )
        .map_err(error)?;
        tx.execute(
            "DELETE FROM connector_snapshot WHERE provider=?1",
            params![value],
        )
        .map_err(error)?;
    }
    tx.commit().map_err(error)
}

fn clear_all(cache: &mut Connection) -> Result<(), String> {
    clear(cache)?;
    source_cache_clear(cache, None)
}

fn error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auth(account: Option<&str>) -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE account_link_metadata(hosted_user_id TEXT);")
            .unwrap();
        if let Some(id) = account {
            db.execute("INSERT INTO account_link_metadata VALUES(?1)", [id])
                .unwrap();
        }
        db
    }
    fn cache() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        db
    }
    fn request() -> CalendarCacheRequest {
        CalendarCacheRequest {
            account_id: "account-a".into(),
            connection_generation: 2,
            selection_revision: 3,
            start_local_date: "2026-09-16".into(),
            end_local_date: "2026-09-18".into(),
            timezone: "America/New_York".into(),
            selected_calendar_ids: vec!["primary".into()],
            hidden_calendar_ids: vec![],
            visible: true,
            show_all_day: true,
        }
    }
    fn snapshot(request: &CalendarCacheRequest) -> String {
        serde_json::json!({"schemaVersion":"1.0.0","accountId":request.account_id,"connectionGeneration":request.connection_generation,"completeness":"complete","requestedRange":{"startLocalDate":request.start_local_date,"endLocalDate":request.end_local_date,"timezone":request.timezone,"selectedCalendarIds":request.selected_calendar_ids}}).to_string()
    }

    #[test]
    fn isolates_accounts_and_exact_ranges() {
        let mut db = cache();
        let linked = auth(Some("account-a"));
        let request = request();
        begin(&linked, &mut db, &request, "one").unwrap();
        replace(&linked, &mut db, &request, "one", &snapshot(&request)).unwrap();
        assert!(read(&linked, &mut db, &request).unwrap().is_some());
        assert_eq!(
            read_current(
                &linked,
                &mut db,
                "account-a",
                "2026-09-16",
                "2026-09-18",
                "America/New_York"
            )
            .unwrap()
            .unwrap()
            .request
            .selection_revision,
            3
        );
        let mut changed = request.clone();
        changed.end_local_date = "2026-09-19".into();
        assert!(read(&linked, &mut db, &changed).unwrap().is_none());
        let mut hidden = request.clone();
        hidden.visible = false;
        assert!(read(&linked, &mut db, &hidden).unwrap().is_none());
        assert!(read(&auth(Some("account-b")), &mut db, &request).is_err());
        assert!(
            db.query_row::<i64, _, _>("SELECT count(*) FROM complete_snapshot", [], |row| row
                .get(0))
                .unwrap()
                == 0
        );
    }

    #[test]
    fn evicts_out_of_range_cache_on_offline_reconciliation() {
        let mut db = cache();
        let linked = auth(Some("account-a"));
        let request = request();
        begin(&linked, &mut db, &request, "one").unwrap();
        replace(&linked, &mut db, &request, "one", &snapshot(&request)).unwrap();
        assert!(read_current(&linked, &mut db, "account-a", "2026-09-17", "2026-09-19", "America/New_York").unwrap().is_none());
        assert!(read(&linked, &mut db, &request).unwrap().is_none());
    }

    #[test]
    fn clear_and_new_requests_fence_late_responses() {
        let mut db = cache();
        let linked = auth(Some("account-a"));
        let request = request();
        begin(&linked, &mut db, &request, "late").unwrap();
        clear(&mut db).unwrap();
        assert!(replace(&linked, &mut db, &request, "late", &snapshot(&request)).is_err());
        begin(&linked, &mut db, &request, "old").unwrap();
        begin(&linked, &mut db, &request, "new").unwrap();
        assert!(replace(&linked, &mut db, &request, "old", &snapshot(&request)).is_err());
        replace(&linked, &mut db, &request, "new", &snapshot(&request)).unwrap();
    }

    #[test]
    fn rejects_partial_or_mismatched_snapshots_without_replacement() {
        let mut db = cache();
        let linked = auth(Some("account-a"));
        let request = request();
        begin(&linked, &mut db, &request, "one").unwrap();
        let partial = snapshot(&request).replace("\"complete\"", "\"incomplete\"");
        assert!(replace(&linked, &mut db, &request, "one", &partial).is_err());
        assert!(read(&linked, &mut db, &request).unwrap().is_none());
    }

    fn scope(provider: &str, account: &str, generation: i64, end: &str) -> String {
        serde_json::json!([
            provider,
            account,
            generation,
            "2026-09-16",
            end,
            "America/New_York"
        ])
        .to_string()
    }
    fn connector_snapshot(provider: &str, account: &str, generation: i64) -> String {
        serde_json::json!({"source": provider, "accountId": account, "connectionGeneration": generation, "completeness": "complete"}).to_string()
    }

    #[test]
    fn connector_sources_are_isolated_from_each_other_and_from_google() {
        let mut db = cache();
        let linked = auth(Some("account-a"));
        let hevy = scope("hevy", "account-a", 1, "2026-09-16");
        let outlook = scope("outlook_calendar", "account-a", 2, "2026-09-18");
        source_cache_begin(&linked, &mut db, "hevy", "account-a", &hevy, "h1").unwrap();
        source_cache_replace(
            &linked,
            &mut db,
            "hevy",
            "account-a",
            &hevy,
            "h1",
            &connector_snapshot("hevy", "account-a", 1),
        )
        .unwrap();
        source_cache_begin(
            &linked,
            &mut db,
            "outlook_calendar",
            "account-a",
            &outlook,
            "o1",
        )
        .unwrap();
        source_cache_replace(
            &linked,
            &mut db,
            "outlook_calendar",
            "account-a",
            &outlook,
            "o1",
            &connector_snapshot("outlook_calendar", "account-a", 2),
        )
        .unwrap();
        let google = request();
        begin(&linked, &mut db, &google, "g1").unwrap();
        replace(&linked, &mut db, &google, "g1", &snapshot(&google)).unwrap();
        // Clearing Hevy leaves Outlook and Google; clearing Google leaves both connectors.
        source_cache_clear(&mut db, Some("hevy")).unwrap();
        assert!(source_cache_read(&linked, &mut db, "hevy", "account-a", &hevy)
            .unwrap()
            .is_none());
        assert!(
            source_cache_read(&linked, &mut db, "outlook_calendar", "account-a", &outlook)
                .unwrap()
                .is_some()
        );
        clear(&mut db).unwrap();
        assert!(read(&linked, &mut db, &google).unwrap().is_none());
        assert!(
            source_cache_read(&linked, &mut db, "outlook_calendar", "account-a", &outlook)
                .unwrap()
                .is_some()
        );
        // A Hevy snapshot cannot be stored under an Outlook scope or another account.
        source_cache_begin(
            &linked,
            &mut db,
            "outlook_calendar",
            "account-a",
            &outlook,
            "o2",
        )
        .unwrap();
        assert!(source_cache_replace(
            &linked,
            &mut db,
            "outlook_calendar",
            "account-a",
            &outlook,
            "o2",
            &connector_snapshot("hevy", "account-a", 2)
        )
        .is_err());
        assert!(source_cache_begin(
            &linked,
            &mut db,
            "hevy",
            "account-a",
            &scope("hevy", "account-b", 1, "2026-09-16"),
            "h2"
        )
        .is_err());
        assert!(source_cache_begin(&linked, &mut db, "hevy", "account-a", &outlook, "h3").is_err());
        assert!(
            source_cache_begin(&linked, &mut db, "google_calendar", "account-a", &hevy, "x").is_err()
        );
    }

    #[test]
    fn connector_clear_and_newer_scopes_fence_late_responses() {
        let mut db = cache();
        let linked = auth(Some("account-a"));
        let today = scope("hevy", "account-a", 1, "2026-09-16");
        source_cache_begin(&linked, &mut db, "hevy", "account-a", &today, "late").unwrap();
        source_cache_clear(&mut db, Some("hevy")).unwrap();
        assert!(source_cache_replace(
            &linked,
            &mut db,
            "hevy",
            "account-a",
            &today,
            "late",
            &connector_snapshot("hevy", "account-a", 1)
        )
        .is_err());
        assert!(
            source_cache_read_current(&linked, &mut db, "hevy", "account-a")
                .unwrap()
                .is_none()
        );
        // A newer scope replaces the pending request; the older response cannot land.
        source_cache_begin(&linked, &mut db, "hevy", "account-a", &today, "first").unwrap();
        let next_generation = scope("hevy", "account-a", 2, "2026-09-16");
        source_cache_begin(
            &linked,
            &mut db,
            "hevy",
            "account-a",
            &next_generation,
            "second",
        )
        .unwrap();
        assert!(source_cache_replace(
            &linked,
            &mut db,
            "hevy",
            "account-a",
            &today,
            "first",
            &connector_snapshot("hevy", "account-a", 1)
        )
        .is_err());
        source_cache_replace(
            &linked,
            &mut db,
            "hevy",
            "account-a",
            &next_generation,
            "second",
            &connector_snapshot("hevy", "account-a", 2),
        )
        .unwrap();
        let current = source_cache_read_current(&linked, &mut db, "hevy", "account-a")
            .unwrap()
            .unwrap();
        assert_eq!(current.scope_key, next_generation);
        // Incomplete snapshots never replace the cache.
        source_cache_begin(
            &linked,
            &mut db,
            "hevy",
            "account-a",
            &next_generation,
            "third",
        )
        .unwrap();
        let partial =
            connector_snapshot("hevy", "account-a", 2).replace("\"complete\"", "\"incomplete\"");
        assert!(source_cache_replace(
            &linked,
            &mut db,
            "hevy",
            "account-a",
            &next_generation,
            "third",
            &partial
        )
        .is_err());
        assert!(
            source_cache_read(&linked, &mut db, "hevy", "account-a", &next_generation)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn connector_cache_clears_every_source_when_the_linked_account_changes() {
        let mut db = cache();
        let linked = auth(Some("account-a"));
        let hevy = scope("hevy", "account-a", 1, "2026-09-16");
        source_cache_begin(&linked, &mut db, "hevy", "account-a", &hevy, "h1").unwrap();
        source_cache_replace(
            &linked,
            &mut db,
            "hevy",
            "account-a",
            &hevy,
            "h1",
            &connector_snapshot("hevy", "account-a", 1),
        )
        .unwrap();
        let switched = auth(Some("account-b"));
        assert!(source_cache_read_current(&switched, &mut db, "hevy", "account-a").is_err());
        assert!(
            source_cache_read_current(&linked, &mut db, "hevy", "account-a")
                .unwrap()
                .is_none()
        );
        let signed_out = auth(None);
        assert!(source_cache_begin(&signed_out, &mut db, "hevy", "account-a", &hevy, "h2").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn creates_an_owner_only_file_separate_from_the_main_store() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!(
            "cadence-calendar-cache-permissions-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cache = open(&path).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        drop(cache);
        std::fs::remove_file(path).unwrap();
    }
}
