mod adoption;
mod behavior;
mod category;
mod db;
mod export;
mod import;
mod import_write;
mod note_shortcut;
mod occurrence;
mod place_labels;
mod recovery;
mod reminder;
#[cfg(test)]
mod repair_tests;
pub mod rows;
mod sync_apply;
mod travel;
#[cfg(test)]
mod tests;

use db::{error, Result};
use rows::*;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Mutex};
use tauri::State;

pub use recovery::RecoveryReport;

pub struct LocalStore(pub Mutex<Connection>);
pub fn adopt_previous_identity(directory: &Path) -> Result<()> {
    adoption::adopt(directory)
}
pub fn open(path: &Path) -> Result<LocalStore> {
    Ok(LocalStore(Mutex::new(db::open(path)?)))
}

pub fn storage_recovery_report(live_path: &Path) -> Result<Option<RecoveryReport>> {
    recovery::report(live_path)
}

pub fn delete_storage_recovery_backup(
    store: &LocalStore,
    live_path: &Path,
) -> Result<RecoveryReport> {
    let db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    db::validate_backup(&db)?;
    let report = recovery::delete_backup(live_path)?;
    db::validate_backup(&db)?;
    Ok(report)
}

pub fn is_local_mode(db: &Connection) -> Result<bool> {
    db.query_row(
        "SELECT NOT EXISTS(SELECT 1 FROM account_link_metadata)",
        [],
        |row| row.get(0),
    )
    .map_err(error)
}

pub fn require_local_mode(db: &Connection) -> Result<()> {
    if is_local_mode(db)? {
        Ok(())
    } else {
        Err("Disconnect the account before restoring a database.".into())
    }
}

pub fn backup_database(store: &LocalStore, live_path: &Path, destination: &Path) -> Result<()> {
    let source = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    db::backup(&source, live_path, destination)
}

pub fn protected_backup_database(
    store: &LocalStore,
    live_path: &Path,
) -> Result<std::path::PathBuf> {
    let source = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    db::protected_backup(&source, live_path)
}

pub fn disconnect_keep_local_copy(store: &LocalStore) -> Result<String> {
    let mut db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    db::disconnect_keep_local_copy(&mut db)
}

pub fn disconnect_remove_account_data(
    store: &LocalStore,
    live_path: &Path,
) -> Result<(std::path::PathBuf, String)> {
    let mut db = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    let backup = db::protected_backup(&db, live_path)?;
    let profile_id = db::disconnect_remove_account_data(&mut db)?;
    Ok((backup, profile_id))
}

pub fn restore_database(
    store: &LocalStore,
    live_path: &Path,
    source: &Path,
) -> Result<std::path::PathBuf> {
    let mut live = store.0.lock().map_err(|_| "SQLite lock is unavailable.")?;
    require_local_mode(&live)?;
    db::restore(&mut live, live_path, source)
}

// Explicitly gated test transport. Production builds expose only the typed Tauri command.
#[cfg(feature = "contract-harness")]
pub fn run_contract(path: &Path) -> Result<()> {
    use std::io::{BufRead, Write};
    let directory = path
        .parent()
        .ok_or("A temporary database directory is required.")?
        .canonicalize()
        .map_err(|_| "The temporary database directory does not exist.")?;
    let temporary = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| "The system temporary directory is unavailable.")?;
    if !directory.starts_with(temporary) && !directory.starts_with("/private/tmp") {
        return Err("The contract harness requires a temporary database path.".into());
    }
    let mut db = db::open(path)?;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.map_err(|_| "The contract request could not be read.")?;
        let result = if line.len() > 64 * 1024 * 1024 {
            Err("The contract request exceeds 64 MiB.".into())
        } else {
            serde_json::from_str::<Request>(&line)
                .map_err(|error| format!("Invalid typed local request: {error}"))
                .and_then(|request| execute(&mut db, request))
        };
        let output = match result {
            Ok(result) => json!({"result":result}),
            Err(error) => json!({"error":error}),
        };
        writeln!(stdout, "{output}")
            .and_then(|_| stdout.flush())
            .map_err(|_| "The contract result could not be written.")?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct GraphRows {
    pub behavior: Behavior,
    pub schedules: Vec<BehaviorSchedule>,
    pub slots: Vec<BehaviorScheduleSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OccurrenceReplacement {
    pub expected: Occurrence,
    pub next: Occurrence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Definition {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimezoneGraphUpdate {
    pub graph: GraphRows,
    pub expected_revision: i64,
    pub configuration_event: Option<BehaviorConfigurationEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoverageReceipt {
    pub status: String,
    pub target_through: String,
    pub scheduled_through: String,
    pub first_unscheduled_at: Option<String>,
    pub expected_count: i64,
    pub scheduled_count: i64,
    pub missing_ids: Vec<String>,
    pub reason: Option<String>,
    pub verified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReminderObservation {
    pub id: String,
    pub status: String,
    pub error: Option<String>,
    pub delivery: Option<NativeDeliveryProof>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountSyncWrite {
    pub kind: sync_apply::AccountSyncEntityKind,
    pub id: String,
    pub operation: sync_apply::AccountSyncOperation,
    pub expected: Option<Value>,
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeDeliveryProof {
    pub request_id: String,
    pub fire_at: String,
    pub title: String,
    pub body: String,
    pub delivered_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TravelSettingsMutation {
    pub enabled: bool,
    pub base_location_text: Option<String>,
    pub mode: Option<String>,
    pub navigation_preference: Option<String>,
    pub routing_consent_at: Option<String>,
    pub onboarding_completed_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Request {
    ValidateAccountSyncSnapshot {
        entities: Vec<sync_apply::AccountSyncEntity>,
    },
    ReadProfile {},
    ReadTravelSettings {
        profile_id: String,
    },
    ReadCategories {
        profile_id: String,
    },
    ReadBehaviorGraphs {
        profile_id: String,
    },
    ReadOccurrence {
        profile_id: String,
        occurrence_id: String,
    },
    ReadOccurrences {
        profile_id: String,
        start_local_date: String,
        end_local_date: String,
        behavior_id: Option<String>,
        status: Option<String>,
    },
    ReadOccurrenceHistory {
        profile_id: String,
        occurrence_ids: Vec<String>,
    },
    ReadSyncState {
        profile_id: String,
    },
    ReadExportSnapshot {
        profile_id: String,
        start_local_date: Option<String>,
        end_local_date: String,
        include_time_tracking: bool,
        through_started_at: String,
    },
    ReadNativeReminderState {
        profile_id: String,
    },
    ReadImportSnapshot {
        profile_id: String,
    },
    ReadImportRuns {
        profile_id: String,
        limit: i64,
        kind: Option<import::ImportRunKind>,
    },
    ReadNoteShortcutStates {
        profile_id: String,
    },
    ReadPlaceLabels {
        profile_id: String,
    },
    ReadNoteShortcutContext {
        profile_id: String,
        behavior_id: Option<String>,
    },
    PrepareBehaviorLogImport {
        profile_id: String,
        mutation_id: String,
        now: String,
        expected_revision: i64,
        preview_run: BehaviorLogImportRun,
        plan: Option<import::LocalImportWritePlan>,
    },
    ApplyBehaviorLogImport {
        profile_id: String,
        mutation_id: String,
        now: String,
        preview_run_id: String,
        import_mode: import::ImportMode,
        preview_fingerprint: String,
        local_data_fingerprint: String,
        bundle_fingerprint: String,
        bundle_payload_fingerprint: Option<String>,
    },
    ApplyAccountSync {
        profile_id: String,
        writes: Vec<AccountSyncWrite>,
    },
    ApplyFirstLinkAccountSync {
        profile_id: String,
        hosted_user_id: String,
        choice: String,
        attempt_id: String,
        local_fingerprint: String,
        hosted_fingerprint: String,
        expected_revision: i64,
        idempotency_key: String,
        baseline_fingerprint: String,
        baseline_json: String,
        backup_path: Option<String>,
        completed_at: String,
        writes: Vec<AccountSyncWrite>,
    },
    ManageCategories {
        profile_id: String,
        mutation_id: String,
        now: String,
        expected_categories: Vec<Value>,
        next_categories: Vec<Value>,
        updates: Vec<TimezoneGraphUpdate>,
    },
    UpdateProfileTimezone {
        profile_id: String,
        mutation_id: String,
        now: String,
        expected_timezone: String,
        expected_sync_version: i64,
        timezone: String,
        updates: Vec<TimezoneGraphUpdate>,
    },
    CommitTravelSettings {
        profile_id: String,
        mutation_id: String,
        now: String,
        expected_updated_at: String,
        next: TravelSettingsMutation,
    },
    CommitNativeReminderPlan {
        profile_id: String,
        mutation_id: String,
        now: String,
        expected_revision: i64,
        reminders: Vec<NativeReminderState>,
        cancel_ids: Vec<String>,
    },
    RecordNativeReminderCoverage {
        profile_id: String,
        mutation_id: String,
        now: String,
        expected_revision: i64,
        coverage: CoverageReceipt,
        observed: Vec<ReminderObservation>,
    },
    CreateBehaviorGraph {
        profile_id: String,
        mutation_id: String,
        now: String,
        graph: GraphRows,
        definition_event: BehaviorDefinitionEvent,
        configuration_event: BehaviorConfigurationEvent,
    },
    UpdateBehaviorGraph {
        profile_id: String,
        mutation_id: String,
        now: String,
        graph: GraphRows,
        expected_revision: i64,
        expected_normalized_definition: Definition,
        definition_event: Option<BehaviorDefinitionEvent>,
        configuration_event: Option<BehaviorConfigurationEvent>,
    },
    ApplyOccurrenceGeneration {
        profile_id: String,
        mutation_id: String,
        now: String,
        behavior_id: String,
        expected_configuration_event_id: String,
        create: Vec<Occurrence>,
        update: Vec<OccurrenceReplacement>,
        delete: Vec<Occurrence>,
    },
    ApplyStatusTransition {
        profile_id: String,
        mutation_id: String,
        now: String,
        occurrence_id: String,
        expected_status: String,
        expected_latest_event_id: Option<String>,
        status: String,
        completed_at: Option<String>,
        status_marked_at: Option<String>,
        cancel_pending_reminders: bool,
        event: Option<OccurrenceStatusEvent>,
    },
    UpdateOccurrenceNote {
        profile_id: String,
        mutation_id: String,
        now: String,
        occurrence_id: String,
        expected_note: Option<String>,
        note: Option<String>,
        #[serde(default)]
        used_shortcut: Option<bool>,
    },
    CommitNoteShortcutState {
        profile_id: String,
        mutation_id: String,
        now: String,
        expected: note_shortcut::NoteShortcutContext,
        next: NoteShortcutState,
        require_enabled: bool,
    },
    CommitPlaceLabels {
        profile_id: String,
        mutation_id: String,
        now: String,
        mutation: place_labels::PlaceLabelMutation,
    },
    StartTimeSession {
        profile_id: String,
        mutation_id: String,
        now: String,
        session: OccurrenceTimeSession,
    },
    StopTimeSession {
        profile_id: String,
        mutation_id: String,
        now: String,
        occurrence_id: String,
        session_id: String,
        stopped_at: String,
    },
    ResetTimeSessions {
        profile_id: String,
        mutation_id: String,
        now: String,
        occurrence_id: String,
        expected_sessions: Vec<OccurrenceTimeSession>,
    },
    CommitSyncState {
        profile_id: String,
        mutation_id: String,
        now: String,
        expected_version: i64,
        state: OccurrenceSyncState,
    },
}

#[tauri::command]
pub async fn local_store(store: State<'_, LocalStore>, request: Request) -> Result<Value> {
    let mut db = store
        .0
        .lock()
        .map_err(|_| "The local database lock is unavailable.")?;
    execute(&mut db, request)
}

pub fn execute(db: &mut Connection, request: Request) -> Result<Value> {
    if let Request::ApplyFirstLinkAccountSync {
        profile_id,
        hosted_user_id,
        choice,
        attempt_id,
        local_fingerprint,
        hosted_fingerprint,
        expected_revision,
        idempotency_key,
        baseline_fingerprint,
        baseline_json,
        backup_path,
        completed_at,
        writes,
    } = &request
    {
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(error)?;
        db::owner(&tx, profile_id)?;
        let pending: Option<(String,String,String,String)> = tx.query_row("SELECT hosted_user_id,choice,attempt_id,local_fingerprint FROM account_first_link_attempts WHERE local_profile_id=?1", [profile_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(error)?;
        if pending.as_ref()
            != Some(&(
                hosted_user_id.clone(),
                choice.clone(),
                attempt_id.clone(),
                local_fingerprint.clone(),
            ))
            || import::domain_revision(&tx, profile_id)? != *expected_revision
        {
            return Err("Local data changed after first-link planning. Cancel the account link and start it again.".into());
        }
        if [idempotency_key, baseline_fingerprint, hosted_fingerprint]
            .iter()
            .any(|value| value.len() != 64)
            || baseline_json.len() > 64 * 1024 * 1024
            || serde_json::from_str::<Value>(baseline_json).is_err()
        {
            return Err("Account baseline is invalid.".into());
        }
        let outbox_high_water: i64 = tx.query_row("SELECT coalesce(max(sequence),0) FROM mutation_outbox WHERE user_id=?1 AND synced_at IS NULL", [profile_id], |row| row.get(0)).map_err(error)?;
        sync_apply::apply_first_link(&tx, profile_id, writes)?;
        tx.execute("INSERT INTO account_sync_baselines(local_profile_id,hosted_user_id,choice,idempotency_key,local_fingerprint,hosted_fingerprint,baseline_fingerprint,baseline_json,backup_path,completed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![profile_id,hosted_user_id,choice,idempotency_key,local_fingerprint,hosted_fingerprint,baseline_fingerprint,baseline_json,backup_path,completed_at]).map_err(error)?;
        tx.execute("UPDATE mutation_outbox SET synced_at=?2 WHERE user_id=?1 AND sequence<=?3 AND synced_at IS NULL", params![profile_id,completed_at,outbox_high_water]).map_err(error)?;
        tx.execute("DELETE FROM tombstones WHERE user_id=?1 AND mutation_id IN (SELECT mutation_id FROM mutation_outbox WHERE user_id=?1 AND sequence<=?2 AND synced_at IS NOT NULL)", params![profile_id,outbox_high_water]).map_err(error)?;
        tx.execute("INSERT INTO sync_cursors(user_id,name,value,updated_at) VALUES(?1,'account-sync',?2,?3) ON CONFLICT(user_id,name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![profile_id,baseline_fingerprint,completed_at]).map_err(error)?;
        tx.execute(
            "DELETE FROM account_first_link_attempts WHERE local_profile_id=?1",
            [profile_id],
        )
        .map_err(error)?;
        tx.commit().map_err(error)?;
        return Ok(json!({"appliedCount": writes.len()}));
    }
    if let Request::ApplyAccountSync { profile_id, writes } = &request {
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(error)?;
        db::owner(&tx, profile_id)?;
        sync_apply::apply(&tx, profile_id, writes)?;
        tx.commit().map_err(error)?;
        return Ok(json!({"appliedCount": writes.len()}));
    }
    if let Some((profile_id, mutation_id, now)) = request.mutation_context() {
        db::valid_id(mutation_id)?;
        db::instant_key(now)?;
        let payload = serde_json::to_string(&request)
            .map_err(|_| "The local request could not be encoded.")?;
        let note_shortcut_commit = matches!(&request, Request::CommitNoteShortcutState { .. });
        // Place markers and labels must not outlive opt-out in the mutation journal.
        let place_label_commit = matches!(&request, Request::CommitPlaceLabels { .. });
        // Full-history restore carries both expected rows and their replacements.
        let payload_limit = if note_shortcut_commit
            || matches!(&request, Request::PrepareBehaviorLogImport { .. })
        {
            64 * 1024 * 1024
        } else {
            32 * 1024 * 1024
        };
        if payload.len() > payload_limit {
            return Err("The local mutation exceeds its allowed size.".into());
        }
        let reminder_commit = matches!(
            &request,
            Request::CommitNativeReminderPlan { .. } | Request::RecordNativeReminderCoverage { .. }
        );
        let journal_payload = if note_shortcut_commit || reminder_commit || place_label_commit {
            json!(format!("{:x}", Sha256::digest(payload.as_bytes()))).to_string()
        } else {
            payload.clone()
        };
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(error)?;
        db::owner(&tx, profile_id)?;
        let prior: Option<(String,String)> = tx.query_row("SELECT request_json,result_json FROM mutation_outbox WHERE user_id=?1 AND mutation_id=?2", params![profile_id,mutation_id], |row| Ok((row.get(0)?,row.get(1)?))).optional().map_err(error)?;
        if let Some((prior_payload, result)) = prior {
            if prior_payload != journal_payload {
                return Err("The mutation ID was already used for a different plan.".into());
            }
            if let Request::CommitNoteShortcutState { next, .. } = &request {
                return Ok(json!(next));
            }
            if reminder_commit {
                return reminder::read(&tx, profile_id);
            }
            if place_label_commit {
                return place_labels::read(&tx, profile_id);
            }
            return serde_json::from_str(&result)
                .map_err(|_| "The prior mutation result is invalid.".into());
        }
        let mut result = apply(&tx, &request)?;
        let operation = serde_json::to_value(&request)
            .map_err(|_| "The local request could not be encoded.")?["operation"]
            .as_str()
            .ok_or("Missing local operation.")?
            .to_string();
        let journal_result = if note_shortcut_commit || reminder_commit || place_label_commit {
            "null".into()
        } else {
            result.to_string()
        };
        if reminder_commit {
            tx.execute(
                "DELETE FROM mutation_outbox WHERE user_id=?1 AND operation=?2",
                params![profile_id, operation],
            )
            .map_err(error)?;
            tx.execute("INSERT INTO mutation_outbox (mutation_id,user_id,operation,request_json,result_json,created_at,synced_at) VALUES (?1,?2,?3,?4,?5,?6,?6)", params![mutation_id,profile_id,operation,journal_payload,journal_result,now]).map_err(error)?;
        } else {
            tx.execute("INSERT INTO mutation_outbox (mutation_id,user_id,operation,request_json,result_json,created_at) VALUES (?1,?2,?3,?4,?5,?6)", params![mutation_id,profile_id,operation,journal_payload,journal_result,now]).map_err(error)?;
        }
        let sequence = tx.last_insert_rowid();
        reminder::after_mutation(&tx, &request, sequence)?;
        if let Request::PrepareBehaviorLogImport { preview_run, .. } = &request {
            result =
                import::after_prepare(&tx, profile_id, &preview_run.id, tx.last_insert_rowid())?;
            tx.execute(
                "UPDATE mutation_outbox SET result_json=?2 WHERE mutation_id=?1",
                params![mutation_id, result.to_string()],
            )
            .map_err(error)?;
        }
        if reminder_commit {
            result = reminder::read(&tx, profile_id)?;
            tx.execute(
                "UPDATE mutation_outbox SET result_json=?2 WHERE mutation_id=?1",
                params![mutation_id, json!({"revision":sequence}).to_string()],
            )
            .map_err(error)?;
        }
        tx.commit().map_err(error)?;
        return Ok(result);
    }
    // A coherent read transaction prevents histories or graphs from spanning different writes.
    let tx = db.transaction().map_err(error)?;
    let result = match &request {
        Request::ValidateAccountSyncSnapshot { entities } => {
            sync_apply::validate_snapshot(&db::profile(&tx)?.id, entities)?;
            Value::Null
        }
        Request::ReadProfile {} => json!(db::profile(&tx)?),
        Request::ReadTravelSettings { profile_id } => {
            db::owner(&tx, profile_id)?;
            travel::read_value(&tx, profile_id)?
        }
        Request::ReadCategories { profile_id } => {
            db::owner(&tx, profile_id)?;
            json!(db::read::<Category>(
                &tx,
                "SELECT * FROM categories WHERE user_id=?1 ORDER BY sort_order,name,id",
                &[profile_id.clone().into()]
            )?)
        }
        Request::ReadBehaviorGraphs { profile_id } => {
            db::owner(&tx, profile_id)?;
            behavior::read_graphs(&tx, profile_id)?
        }
        Request::ReadOccurrence {
            profile_id,
            occurrence_id,
        } => {
            db::owner(&tx, profile_id)?;
            db::valid_id(occurrence_id)?;
            json!(db::read::<Occurrence>(
                &tx,
                "SELECT * FROM occurrences WHERE user_id=?1 AND id=?2",
                &[profile_id.clone().into(), occurrence_id.clone().into()]
            )?
            .into_iter()
            .next())
        }
        Request::ReadOccurrences {
            profile_id,
            start_local_date,
            end_local_date,
            behavior_id,
            status,
        } => {
            db::owner(&tx, profile_id)?;
            occurrence::read_occurrences(
                &tx,
                profile_id,
                start_local_date,
                end_local_date,
                behavior_id.as_deref(),
                status.as_deref(),
            )?
        }
        Request::ReadOccurrenceHistory {
            profile_id,
            occurrence_ids,
        } => {
            db::owner(&tx, profile_id)?;
            occurrence::read_history(&tx, profile_id, occurrence_ids)?
        }
        Request::ReadSyncState { profile_id } => {
            db::owner(&tx, profile_id)?;
            json!(db::owned::<OccurrenceSyncState>(&tx, profile_id)?
                .into_iter()
                .next()
                .ok_or("Occurrence sync state is unavailable.")?)
        }
        Request::ReadNativeReminderState { profile_id } => {
            db::owner(&tx, profile_id)?;
            reminder::read(&tx, profile_id)?
        }
        Request::ReadImportSnapshot { profile_id } => {
            db::owner(&tx, profile_id)?;
            import::snapshot(&tx, profile_id)?
        }
        Request::ReadImportRuns {
            profile_id,
            limit,
            kind,
        } => {
            db::owner(&tx, profile_id)?;
            json!(import::read_runs(&tx, profile_id, *limit, kind.as_ref())?)
        }
        Request::ReadNoteShortcutStates { profile_id } => {
            db::owner(&tx, profile_id)?;
            json!(note_shortcut::read_states(&tx, profile_id)?)
        }
        Request::ReadPlaceLabels { profile_id } => {
            db::owner(&tx, profile_id)?;
            place_labels::read(&tx, profile_id)?
        }
        Request::ReadNoteShortcutContext {
            profile_id,
            behavior_id,
        } => {
            db::owner(&tx, profile_id)?;
            json!(note_shortcut::read_context(
                &tx,
                profile_id,
                behavior_id.as_deref()
            )?)
        }
        Request::ReadExportSnapshot {
            profile_id,
            start_local_date,
            end_local_date,
            include_time_tracking,
            through_started_at,
        } => {
            db::owner(&tx, profile_id)?;
            export::read(
                &tx,
                profile_id,
                start_local_date.as_deref(),
                end_local_date,
                *include_time_tracking,
                through_started_at,
            )?
        }
        _ => return Err("Unsupported local read.".into()),
    };
    tx.commit().map_err(error)?;
    Ok(result)
}

fn apply(db: &Connection, request: &Request) -> Result<Value> {
    match request {
        Request::PrepareBehaviorLogImport { .. } => import::prepare(db, request),
        Request::ApplyBehaviorLogImport { .. } => import::apply(db, request),
        Request::ManageCategories { .. } => category::apply(db, request),
        Request::UpdateProfileTimezone { .. } => behavior::update_timezone(db, request),
        Request::CommitTravelSettings {
            profile_id,
            now,
            expected_updated_at,
            next,
            ..
        } => travel::write(db, profile_id, now, expected_updated_at, next),
        Request::CommitNativeReminderPlan { .. } => reminder::plan(db, request),
        Request::RecordNativeReminderCoverage { .. } => reminder::record(db, request),
        Request::CreateBehaviorGraph {
            profile_id,
            mutation_id,
            now,
            graph,
            definition_event,
            configuration_event,
        } => behavior::write_graph(
            db,
            profile_id,
            mutation_id,
            now,
            graph,
            None,
            None,
            Some(definition_event),
            Some(configuration_event),
        ),
        Request::UpdateBehaviorGraph {
            profile_id,
            mutation_id,
            now,
            graph,
            expected_revision,
            expected_normalized_definition,
            definition_event,
            configuration_event,
        } => behavior::write_graph(
            db,
            profile_id,
            mutation_id,
            now,
            graph,
            Some(*expected_revision),
            Some(expected_normalized_definition),
            definition_event.as_ref(),
            configuration_event.as_ref(),
        ),
        Request::ApplyOccurrenceGeneration { .. } => occurrence::generate(db, request),
        Request::ApplyStatusTransition { .. } => occurrence::status(db, request),
        Request::UpdateOccurrenceNote {
            profile_id,
            now,
            occurrence_id,
            expected_note,
            note,
            used_shortcut,
            ..
        } => occurrence::note(
            db,
            profile_id,
            now,
            occurrence_id,
            expected_note,
            note,
            used_shortcut == &Some(true),
        ),
        Request::CommitNoteShortcutState {
            profile_id,
            now,
            expected,
            next,
            require_enabled,
            ..
        } => note_shortcut::commit(db, profile_id, now, expected, next, *require_enabled),
        Request::CommitPlaceLabels {
            profile_id,
            now,
            mutation,
            ..
        } => place_labels::commit(db, profile_id, now, mutation),
        Request::StartTimeSession {
            profile_id,
            session,
            ..
        } => occurrence::start_time(db, profile_id, session),
        Request::StopTimeSession {
            profile_id,
            now,
            occurrence_id,
            session_id,
            stopped_at,
            ..
        } => occurrence::stop_time(db, profile_id, now, occurrence_id, session_id, stopped_at),
        Request::ResetTimeSessions {
            profile_id,
            mutation_id,
            now,
            occurrence_id,
            expected_sessions,
        } => occurrence::reset_time(
            db,
            profile_id,
            mutation_id,
            now,
            occurrence_id,
            expected_sessions,
        ),
        Request::CommitSyncState {
            profile_id,
            now,
            expected_version,
            state,
            ..
        } => occurrence::sync_state(db, profile_id, now, *expected_version, state),
        _ => Err("Unsupported local mutation.".into()),
    }
}

impl Request {
    fn mutation_context(&self) -> Option<(&str, &str, &str)> {
        match self {
            Self::PrepareBehaviorLogImport {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::ApplyBehaviorLogImport {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::ManageCategories {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::UpdateProfileTimezone {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::CommitTravelSettings {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::CommitNativeReminderPlan {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::RecordNativeReminderCoverage {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::CreateBehaviorGraph {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::UpdateBehaviorGraph {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::ApplyOccurrenceGeneration {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::ApplyStatusTransition {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::UpdateOccurrenceNote {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::CommitNoteShortcutState {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::CommitPlaceLabels {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::StartTimeSession {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::StopTimeSession {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::ResetTimeSessions {
                profile_id,
                mutation_id,
                now,
                ..
            }
            | Self::CommitSyncState {
                profile_id,
                mutation_id,
                now,
                ..
            } => Some((profile_id, mutation_id, now)),
            _ => None,
        }
    }
}

pub(super) fn tombstone(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    table: &str,
    id: &str,
) -> Result<()> {
    db.execute("INSERT INTO tombstones (user_id,entity_type,entity_id,deleted_at,mutation_id) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(user_id,entity_type,entity_id) DO UPDATE SET deleted_at=excluded.deleted_at,mutation_id=excluded.mutation_id", params![profile_id,table,id,now,mutation_id]).map_err(error)?;
    Ok(())
}
