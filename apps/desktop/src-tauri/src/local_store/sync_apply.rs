use super::{db, rows::*, AccountSyncWrite};
use chrono::{DateTime, Duration, Timelike, Utc};
use rusqlite::{params, Connection};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountSyncEntityKind {
    Profile,
    Category,
    Behavior,
    Schedule,
    ScheduleSlot,
    DefinitionEvent,
    ConfigurationEvent,
    Occurrence,
    StatusEvent,
    TimeSession,
    ImportRun,
    Mapping,
    ImportedNote,
    ImportedIntervention,
    ReminderDelivery,
    NoteShortcutState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AccountSyncOperation {
    Upsert,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountSyncEntity {
    kind: AccountSyncEntityKind,
    id: String,
    value: Value,
}

// Use the same native row types as apply, before any hosted or local commit.
pub fn validate_snapshot(profile: &str, entities: &[AccountSyncEntity]) -> db::Result<()> {
    validate_entity_counts(entities.iter().map(|entity| entity.kind))?;
    for entity in entities {
        let value = owned_value(profile, &entity.value)?;
        match entity.kind {
            AccountSyncEntityKind::Profile => {
                validate_profile_value(&entity.value)?;
            }
            AccountSyncEntityKind::Category => { decode_row::<Category>(value)?; }
            AccountSyncEntityKind::Behavior => { decode_row::<Behavior>(value)?; }
            AccountSyncEntityKind::Schedule => { decode_row::<BehaviorSchedule>(value)?; }
            AccountSyncEntityKind::ScheduleSlot => { decode_row::<BehaviorScheduleSlot>(value)?; }
            AccountSyncEntityKind::DefinitionEvent => { decode_row::<BehaviorDefinitionEvent>(value)?; }
            AccountSyncEntityKind::ConfigurationEvent => { decode_row::<BehaviorConfigurationEvent>(value)?; }
            AccountSyncEntityKind::Occurrence => { decode_row::<Occurrence>(value)?; }
            AccountSyncEntityKind::StatusEvent => { decode_row::<OccurrenceStatusEvent>(value)?; }
            AccountSyncEntityKind::TimeSession => { decode_row::<OccurrenceTimeSession>(value)?; }
            AccountSyncEntityKind::ImportRun => { decode_row::<BehaviorLogImportRun>(value)?; }
            AccountSyncEntityKind::Mapping => { decode_row::<BehaviorLogImportRecordMapping>(value)?; }
            AccountSyncEntityKind::ImportedNote => { decode_row::<ImportedNote>(value)?; }
            AccountSyncEntityKind::ImportedIntervention => { decode_row::<ImportedIntervention>(value)?; }
            AccountSyncEntityKind::ReminderDelivery => { decode_row::<ReminderDelivery>(value)?; }
            AccountSyncEntityKind::NoteShortcutState => { decode_row::<NoteShortcutState>(value)?; }
        }
    }
    Ok(())
}

fn decode_row<T: DeserializeOwned>(value: Value) -> db::Result<T> {
    serde_json::from_value(value).map_err(|error| {
        if error.to_string().starts_with("unknown field `") {
            "Update Cadence before synchronizing account data."
        } else {
            "A synced row does not match the local model."
        }.to_string()
    })
}

pub fn apply(db: &Connection, profile: &str, writes: &[AccountSyncWrite]) -> db::Result<()> {
    apply_mode(db, profile, writes, false)
}

pub fn apply_first_link(
    db: &Connection,
    profile: &str,
    writes: &[AccountSyncWrite],
) -> db::Result<()> {
    apply_mode(db, profile, writes, true)
}

fn apply_mode(
    db: &Connection,
    profile: &str,
    writes: &[AccountSyncWrite],
    replacement: bool,
) -> db::Result<()> {
    if replacement {
        db.execute_batch("PRAGMA defer_foreign_keys = ON;")
            .map_err(db::error)?;
    }
    validate_entity_counts(writes.iter().map(|write| write.kind))?;
    let occurrence_deletes: HashSet<String> = writes
        .iter()
        .filter(|write| {
            write.kind == AccountSyncEntityKind::Occurrence
                && write.operation == AccountSyncOperation::Delete
        })
        .map(|write| write.id.clone())
        .collect();
    let mut keys = HashSet::new();
    for write in writes {
        db::valid_id(&write.id).or_else(|error| {
            if (matches!(write.kind, AccountSyncEntityKind::Profile) && write.id == "profile")
                || (matches!(write.kind, AccountSyncEntityKind::NoteShortcutState)
                    && write.id == "global")
            {
                Ok(())
            } else {
                Err(error)
            }
        })?;
        if !keys.insert(format!("{:?}:{}", write.kind, write.id)) {
            return Err("The account sync plan writes the same record twice.".into());
        }
        validate_write(db, profile, write, replacement, &occurrence_deletes, writes)?;
    }
    let status_depths = dependency_depths(
        writes,
        |write| matches!(write.kind, AccountSyncEntityKind::StatusEvent),
        "revises_event_id",
    )?;
    let import_depths = dependency_depths(
        writes,
        |write| matches!(write.kind, AccountSyncEntityKind::ImportRun),
        "accepted_preview_run_id",
    )?;
    let mut ordered: Vec<&AccountSyncWrite> = writes.iter().collect();
    ordered.sort_by_key(|write| {
        let depth = match write.kind {
            AccountSyncEntityKind::StatusEvent => {
                status_depths.get(write.id.as_str()).copied().unwrap_or(0)
            }
            AccountSyncEntityKind::ImportRun => {
                import_depths.get(write.id.as_str()).copied().unwrap_or(0)
            }
            _ => 0,
        };
        (
            mutation_order(write, replacement),
            if write.operation == AccountSyncOperation::Delete {
                usize::MAX - depth
            } else {
                depth
            },
            write.id.as_str(),
        )
    });
    for write in ordered {
        match write.kind {
            AccountSyncEntityKind::Profile => profile_write(db, profile, write)?,
            AccountSyncEntityKind::Category => {
                row_write::<Category>(db, profile, write, false, false)?
            }
            AccountSyncEntityKind::Behavior => behavior_write(db, profile, write)?,
            AccountSyncEntityKind::Schedule => {
                row_write::<BehaviorSchedule>(db, profile, write, false, false)?
            }
            AccountSyncEntityKind::ScheduleSlot => {
                row_write::<BehaviorScheduleSlot>(db, profile, write, false, false)?
            }
            AccountSyncEntityKind::DefinitionEvent => {
                row_write::<BehaviorDefinitionEvent>(db, profile, write, !replacement, false)?
            }
            AccountSyncEntityKind::ConfigurationEvent => {
                row_write::<BehaviorConfigurationEvent>(db, profile, write, !replacement, false)?
            }
            AccountSyncEntityKind::Occurrence => {
                row_write::<Occurrence>(db, profile, write, false, !replacement)?
            }
            AccountSyncEntityKind::StatusEvent => {
                row_write::<OccurrenceStatusEvent>(db, profile, write, !replacement, false)?
            }
            AccountSyncEntityKind::TimeSession => {
                row_write::<OccurrenceTimeSession>(db, profile, write, false, false)?
            }
            AccountSyncEntityKind::ImportRun => {
                row_write::<BehaviorLogImportRun>(db, profile, write, false, false)?
            }
            AccountSyncEntityKind::Mapping => row_write::<BehaviorLogImportRecordMapping>(
                db,
                profile,
                write,
                !replacement,
                false,
            )?,
            AccountSyncEntityKind::ImportedNote => {
                row_write::<ImportedNote>(db, profile, write, false, false)?
            }
            AccountSyncEntityKind::ImportedIntervention => {
                row_write::<ImportedIntervention>(db, profile, write, false, false)?
            }
            AccountSyncEntityKind::ReminderDelivery => {
                row_write::<ReminderDelivery>(db, profile, write, false, false)?
            }
            AccountSyncEntityKind::NoteShortcutState => {
                row_write::<NoteShortcutState>(db, profile, write, false, false)?
            }
        }
    }
    Ok(())
}

fn dependency_depths<'a>(
    writes: &'a [AccountSyncWrite],
    matches_kind: impl Fn(&AccountSyncWrite) -> bool,
    parent_field: &str,
) -> db::Result<HashMap<&'a str, usize>> {
    let parents: HashMap<&str, Option<&str>> = writes
        .iter()
        .filter(|write| matches_kind(write))
        .map(|write| {
            let row = match write.operation {
                AccountSyncOperation::Upsert => write.value.as_ref(),
                AccountSyncOperation::Delete => write.expected.as_ref(),
            };
            (
                write.id.as_str(),
                row.and_then(|value| value.get(parent_field))
                    .and_then(Value::as_str),
            )
        })
        .collect();
    let mut depths = HashMap::new();
    for id in parents.keys().copied() {
        if depths.contains_key(id) {
            continue;
        }
        let mut path = Vec::new();
        let mut seen = HashSet::new();
        let mut current = id;
        while !depths.contains_key(current) {
            if !seen.insert(current) {
                return Err("Account sync history contains a dependency cycle.".into());
            }
            path.push(current);
            let Some(parent) = parents
                .get(current)
                .copied()
                .flatten()
                .filter(|parent| parents.contains_key(parent))
            else {
                depths.insert(current, 0);
                path.pop();
                break;
            };
            current = parent;
        }
        let mut depth = depths.get(current).copied().unwrap_or(0);
        while let Some(child) = path.pop() {
            depth += 1;
            depths.insert(child, depth);
        }
    }
    Ok(depths)
}

fn validate_entity_counts(kinds: impl Iterator<Item = AccountSyncEntityKind>) -> db::Result<()> {
    let mut counts = HashMap::new();
    for kind in kinds {
        let count = counts.entry(kind).or_insert(0usize);
        *count += 1;
        if *count > db::READ_LIMIT {
            return Err("An account sync collection exceeds 100,000 writes.".into());
        }
    }
    Ok(())
}

fn behavior_write(db: &Connection, profile: &str, write: &AccountSyncWrite) -> db::Result<()> {
    let current = db::read::<Behavior>(
        db,
        "SELECT * FROM behaviors WHERE user_id=?1 AND id=?2",
        &[profile.to_string().into(), write.id.clone().into()],
    )?
    .into_iter()
    .next();
    let changes_behavior = write.operation == AccountSyncOperation::Upsert
        && match current.as_ref() {
            None => true,
            Some(row) => Some(normalized(row)?) != write.value,
        };
    row_write::<Behavior>(db, profile, write, false, false)?;
    if changes_behavior {
        let changed = db.execute(
            "INSERT INTO behavior_revisions(user_id,behavior_id,revision) VALUES(?1,?2,1) ON CONFLICT(behavior_id) DO UPDATE SET revision=behavior_revisions.revision+1 WHERE behavior_revisions.user_id=excluded.user_id",
            params![profile, write.id],
        ).map_err(db::error)?;
        if changed != 1 {
            return Err("A synced Behavior revision belongs to another profile.".into());
        }
    }
    Ok(())
}

fn validate_write(
    db: &Connection,
    profile: &str,
    write: &AccountSyncWrite,
    replacement: bool,
    occurrence_deletes: &HashSet<String>,
    writes: &[AccountSyncWrite],
) -> db::Result<()> {
    if !replacement
        && write.operation == AccountSyncOperation::Delete
        && matches!(
            write.kind,
            AccountSyncEntityKind::Behavior
                | AccountSyncEntityKind::ImportRun
                | AccountSyncEntityKind::ImportedNote
                | AccountSyncEntityKind::ImportedIntervention
                | AccountSyncEntityKind::TimeSession
        )
    {
        return Err(
            "Account sync cannot delete synchronized provenance or delivery history.".into(),
        );
    }
    match write.kind {
        AccountSyncEntityKind::Profile => validate_profile_write(db, write),
        AccountSyncEntityKind::Category => {
            validate_row_write::<Category>(db, profile, write, false, false)
        }
        AccountSyncEntityKind::Behavior => {
            if write.operation == AccountSyncOperation::Upsert {
                let value = write
                    .value
                    .as_ref()
                    .and_then(Value::as_object)
                    .ok_or("An account sync upsert requires a value.")?;
                if [
                    "default_duration_minutes",
                    "end_date",
                    "auto_archived_at",
                    "location_text",
                    "where_kind",
                ]
                .iter()
                    .any(|field| !value.contains_key(*field))
                {
                    return Err("Update Cadence before synchronizing Behavior changes.".into());
                }
            }
            validate_row_write::<Behavior>(db, profile, write, false, false)
        }
        AccountSyncEntityKind::Schedule => {
            validate_row_write::<BehaviorSchedule>(db, profile, write, false, false)
        }
        AccountSyncEntityKind::ScheduleSlot => {
            validate_row_write::<BehaviorScheduleSlot>(db, profile, write, false, false)
        }
        AccountSyncEntityKind::DefinitionEvent => {
            validate_row_write::<BehaviorDefinitionEvent>(db, profile, write, !replacement, false)
        }
        AccountSyncEntityKind::ConfigurationEvent => {
            validate_row_write::<BehaviorConfigurationEvent>(
                db,
                profile,
                write,
                !replacement,
                false,
            )
        }
        AccountSyncEntityKind::Occurrence => {
            validate_row_write::<Occurrence>(db, profile, write, false, !replacement)?;
            if !replacement && write.operation == AccountSyncOperation::Delete {
                validate_occurrence_delete(db, profile, write, writes)?;
            }
            Ok(())
        }
        AccountSyncEntityKind::StatusEvent => {
            validate_row_write::<OccurrenceStatusEvent>(db, profile, write, !replacement, false)
        }
        AccountSyncEntityKind::TimeSession => {
            validate_row_write::<OccurrenceTimeSession>(db, profile, write, false, false)
        }
        AccountSyncEntityKind::ImportRun => {
            validate_row_write::<BehaviorLogImportRun>(db, profile, write, false, false)
        }
        AccountSyncEntityKind::Mapping => validate_row_write::<BehaviorLogImportRecordMapping>(
            db,
            profile,
            write,
            !replacement,
            false,
        ),
        AccountSyncEntityKind::ImportedNote => {
            validate_row_write::<ImportedNote>(db, profile, write, false, false)
        }
        AccountSyncEntityKind::ImportedIntervention => {
            validate_row_write::<ImportedIntervention>(db, profile, write, false, false)
        }
        AccountSyncEntityKind::ReminderDelivery if !replacement => {
            validate_reminder_write(db, profile, write, occurrence_deletes)
        }
        AccountSyncEntityKind::ReminderDelivery => {
            validate_row_write::<ReminderDelivery>(db, profile, write, false, false)
        }
        AccountSyncEntityKind::NoteShortcutState => {
            validate_row_write::<NoteShortcutState>(db, profile, write, false, false)
        }
    }
}

fn validate_reminder_write(
    db: &Connection,
    profile: &str,
    write: &AccountSyncWrite,
    occurrence_deletes: &HashSet<String>,
) -> db::Result<()> {
    validate_row_write::<ReminderDelivery>(db, profile, write, false, false)?;
    if write.operation == AccountSyncOperation::Delete {
        let occurrence_id = write
            .expected
            .as_ref()
            .and_then(|value| value.get("occurrence_id"))
            .and_then(Value::as_str)
            .ok_or("A reminder deletion is missing its Occurrence reference.")?;
        if !occurrence_deletes.contains(occurrence_id) {
            return Err("Account sync can delete a reminder only with its Occurrence.".into());
        }
        return Ok(());
    }
    if write
        .value
        .as_ref()
        .and_then(|value| value.get("occurrence_id"))
        .and_then(Value::as_str)
        .is_some_and(|occurrence_id| occurrence_deletes.contains(occurrence_id))
    {
        return Err("Account sync cannot retain a reminder whose Occurrence is deleted.".into());
    }
    let Some(previous) = write.expected.as_ref() else {
        return Ok(());
    };
    let next = write
        .value
        .as_ref()
        .ok_or("An account sync upsert requires a value.")?;
    let old_status = previous.get("status").and_then(Value::as_str);
    let new_status = next.get("status").and_then(Value::as_str);
    if matches!(old_status, Some("sent" | "failed")) && new_status == Some("pending") {
        return Err("A terminal reminder delivery cannot return to pending.".into());
    }
    if previous
        .get("processing_started_at")
        .is_some_and(|value| !value.is_null())
        && next.get("processing_started_at").is_none_or(Value::is_null)
    {
        return Err("A reminder delivery processing claim cannot be cleared.".into());
    }
    Ok(())
}

fn validate_occurrence_delete(
    db: &Connection,
    profile: &str,
    write: &AccountSyncWrite,
    writes: &[AccountSyncWrite],
) -> db::Result<()> {
    let occurrence = write
        .expected
        .as_ref()
        .ok_or("An Occurrence deletion requires its expected row.")?;
    let protected = occurrence.get("status").and_then(Value::as_str) != Some("unresolved")
        || occurrence
            .get("note")
            .and_then(Value::as_str)
            .is_some_and(|note| !note.trim().is_empty())
        || db.query_row(
            "SELECT EXISTS(SELECT 1 FROM occurrence_status_events WHERE user_id=?1 AND occurrence_id=?2) OR EXISTS(SELECT 1 FROM occurrence_time_sessions WHERE user_id=?1 AND occurrence_id=?2)",
            params![profile, write.id],
            |row| row.get::<_, bool>(0),
        ).map_err(db::error)?;
    if protected {
        return Err("Account sync cannot delete an Occurrence with a Note, status history, tracked time, or resolved status.".into());
    }
    let reminder_ids = db::read::<ReminderDelivery>(
        db,
        "SELECT * FROM reminder_deliveries WHERE user_id=?1 AND occurrence_id=?2",
        &[profile.to_string().into(), write.id.clone().into()],
    )?;
    for reminder in reminder_ids {
        if !writes.iter().any(|candidate| {
            candidate.kind == AccountSyncEntityKind::ReminderDelivery
                && candidate.operation == AccountSyncOperation::Delete
                && candidate.id == reminder.id
        }) {
            return Err(
                "Account sync must delete every attached reminder before its Occurrence.".into(),
            );
        }
    }
    Ok(())
}

fn validate_profile_write(db: &Connection, write: &AccountSyncWrite) -> db::Result<()> {
    if write.operation == AccountSyncOperation::Delete {
        return Err("Account sync cannot delete the local profile.".into());
    }
    let current = db::profile(db)?;
    let expected = write
        .expected
        .as_ref()
        .and_then(|value| value.get("timezone"))
        .and_then(Value::as_str);
    if expected != Some(current.timezone.as_str()) && write.expected.is_some() {
        return Err("A local record changed after sync planning.".into());
    }
    if write
        .value
        .as_ref()
        .and_then(|value| value.get("timezone"))
        .and_then(Value::as_str)
        .is_none()
    {
        return Err("The synced profile timezone is invalid.".into());
    }
    Ok(())
}

fn validate_row_write<T>(
    db: &Connection,
    profile: &str,
    write: &AccountSyncWrite,
    immutable: bool,
    protected_occurrence: bool,
) -> db::Result<()>
where
    T: StoredRow + PartialEq + DeserializeOwned,
{
    let current = db::read::<T>(
        db,
        &format!("SELECT * FROM {} WHERE user_id=?1 AND id=?2", T::TABLE),
        &[profile.to_string().into(), write.id.clone().into()],
    )?
    .into_iter()
    .next();
    let current_json = current.as_ref().map(normalized).transpose()?;
    if current_json.as_ref() != write.expected.as_ref() {
        return Err("A local record changed after sync planning.".into());
    }
    if immutable && current.is_some() {
        return Err(if write.operation == AccountSyncOperation::Delete {
            "Account sync cannot delete append-only history."
        } else {
            "Account sync cannot rewrite append-only history."
        }
        .into());
    }
    if protected_occurrence
        && write.operation == AccountSyncOperation::Delete
        && current_json
            .as_ref()
            .is_some_and(|row| row["status"] != "unresolved")
    {
        return Err("Account sync cannot delete a resolved Occurrence.".into());
    }
    if write.operation == AccountSyncOperation::Upsert {
        let next = owned_value(
            profile,
            write
                .value
                .as_ref()
                .ok_or("An account sync upsert requires a value.")?,
        )?;
        let row: T = decode_row(next)?;
        if normalized(&row)?["id"] != write.id {
            return Err("Account sync cannot change a record ID.".into());
        }
    }
    Ok(())
}

fn mutation_order(write: &AccountSyncWrite, replacement: bool) -> (u8, u8) {
    let parent_first = match write.kind {
        AccountSyncEntityKind::Profile => 0,
        AccountSyncEntityKind::Category | AccountSyncEntityKind::ImportRun => 1,
        AccountSyncEntityKind::Behavior => 2,
        AccountSyncEntityKind::Schedule
        | AccountSyncEntityKind::DefinitionEvent
        | AccountSyncEntityKind::ConfigurationEvent => 3,
        AccountSyncEntityKind::ScheduleSlot => 4,
        AccountSyncEntityKind::Occurrence => 5,
        AccountSyncEntityKind::StatusEvent
        | AccountSyncEntityKind::TimeSession
        | AccountSyncEntityKind::Mapping
        | AccountSyncEntityKind::ImportedNote
        | AccountSyncEntityKind::ImportedIntervention => 6,
        AccountSyncEntityKind::ReminderDelivery => 8,
        AccountSyncEntityKind::NoteShortcutState => 9,
    };
    let rank = if write.operation == AccountSyncOperation::Delete {
        u8::MAX - parent_first
    } else {
        parent_first
    };
    (
        if replacement {
            (write.operation == AccountSyncOperation::Upsert) as u8
        } else if write.operation == AccountSyncOperation::Delete
            && matches!(write.kind, AccountSyncEntityKind::Occurrence | AccountSyncEntityKind::ReminderDelivery)
        {
            // Validated disposable rows must leave their unique schedule slot before replacement.
            0
        } else {
            1 + (write.operation == AccountSyncOperation::Delete) as u8
        },
        rank,
    )
}

fn profile_write(db: &Connection, profile: &str, write: &AccountSyncWrite) -> db::Result<()> {
    if write.operation == AccountSyncOperation::Delete {
        return Err("Account sync cannot delete the local profile.".into());
    }
    let current = profile_value(db, profile)?;
    if write.expected.as_ref() != Some(&current) && write.expected.is_some() {
        return Err("A local record changed after sync planning.".into());
    }
    let next = write
        .value
        .as_ref()
        .ok_or("The synced profile value is missing.")?;
    validate_profile_value(next)?;
    db.execute(
        "UPDATE profiles SET timezone=?2 WHERE id=?1",
        params![profile, next["timezone"].as_str().unwrap()],
    )
    .map_err(db::error)?;
    db.execute(
        "UPDATE travel_settings SET enabled=?2,base_location_text=?3,mode=?4,navigation_preference=?5,routing_consent_at=?6,onboarding_completed_at=?7,updated_at=?8,preparation_minutes=?9,arrival_buffer_minutes=?10,place_modes=?11,leave_feedback=?12,habits_updated_at=?13 WHERE user_id=?1",
        params![profile, next["travel_enabled"].as_bool().unwrap(), next["base_location_text"].as_str(),
            next["travel_mode"].as_str(), next["navigation_preference"].as_str(), next["routing_consent_at"].as_str(),
            next["onboarding_completed_at"].as_str(), next["updated_at"].as_str().unwrap(),
            next["travel_preparation_minutes"].as_i64(), next["travel_arrival_buffer_minutes"].as_i64(),
            next["travel_place_modes"].to_string(), next["travel_leave_feedback"].to_string(),
            next["travel_habits_updated_at"].as_str()],
    ).map_err(db::error)?;
    Ok(())
}

fn profile_value(db: &Connection, profile: &str) -> db::Result<Value> {
    let row = db::owned::<TravelSettings>(db, profile)?.into_iter().next()
        .ok_or("Travel settings are unavailable.")?;
    Ok(json!({
        "timezone": db::profile(db)?.timezone,
        "travel_enabled": row.enabled,
        "base_location_text": row.base_location_text,
        "travel_mode": row.mode,
        "navigation_preference": row.navigation_preference,
        "routing_consent_at": row.routing_consent_at.as_deref().and_then(normalize_utc_instant),
        "onboarding_completed_at": row.onboarding_completed_at.as_deref().and_then(normalize_utc_instant),
        "updated_at": normalize_utc_instant(&row.updated_at).ok_or("Travel settings timestamp is invalid.")?,
        // Ticket 217 learned habits share the profile entity with the travel preferences.
        "travel_preparation_minutes": row.preparation_minutes,
        "travel_arrival_buffer_minutes": row.arrival_buffer_minutes,
        "travel_place_modes": row.place_modes,
        "travel_leave_feedback": row.leave_feedback,
        "travel_habits_updated_at": row.habits_updated_at.as_deref().and_then(normalize_utc_instant),
    }))
}

fn validate_profile_value(value: &Value) -> db::Result<()> {
    let row = value.as_object().ok_or("The synced profile value is invalid.")?;
    let expected = ["timezone", "travel_enabled", "base_location_text", "travel_mode", "navigation_preference",
        "routing_consent_at", "onboarding_completed_at", "updated_at", "travel_preparation_minutes",
        "travel_arrival_buffer_minutes", "travel_place_modes", "travel_leave_feedback", "travel_habits_updated_at"];
    if row.len() != expected.len() || expected.iter().any(|key| !row.contains_key(*key))
        || !value["timezone"].is_string() || !value["travel_enabled"].is_boolean()
        || !matches!(value["base_location_text"], Value::Null | Value::String(_))
        || !matches!(value["travel_mode"], Value::Null | Value::String(_))
        || !matches!(value["navigation_preference"], Value::Null | Value::String(_))
        || !matches!(value["routing_consent_at"], Value::Null | Value::String(_))
        || !matches!(value["onboarding_completed_at"], Value::Null | Value::String(_))
        || !value["updated_at"].is_string()
        || !matches!(value["travel_preparation_minutes"], Value::Null | Value::Number(_))
        || !matches!(value["travel_arrival_buffer_minutes"], Value::Null | Value::Number(_))
        || !value["travel_place_modes"].is_array()
        || !value["travel_leave_feedback"].is_array()
        || !matches!(value["travel_habits_updated_at"], Value::Null | Value::String(_))
    {
        return Err("Update Cadence before synchronizing account data.".into());
    }
    let minutes = |key: &str, max: i64| match &value[key] {
        Value::Null => true,
        number => number.as_i64().is_some_and(|minutes| (0..=max).contains(&minutes)),
    };
    let habits_present = !value["travel_preparation_minutes"].is_null() || !value["travel_arrival_buffer_minutes"].is_null()
        || value["travel_place_modes"].as_array().is_some_and(|entries| !entries.is_empty())
        || value["travel_leave_feedback"].as_array().is_some_and(|entries| !entries.is_empty());
    if !minutes("travel_preparation_minutes", 60) || !minutes("travel_arrival_buffer_minutes", 30)
        || super::travel::validate_place_modes(&value["travel_place_modes"]).is_err()
        || super::travel::validate_leave_feedback(&value["travel_leave_feedback"]).is_err()
        || (habits_present && value["travel_habits_updated_at"].is_null())
        || value["travel_habits_updated_at"].as_str().is_some_and(|at| normalize_utc_instant(at).is_none())
    {
        return Err("The synced travel habits are invalid.".into());
    }
    let mode = value["travel_mode"].as_str();
    let navigation = value["navigation_preference"].as_str();
    if mode.is_some_and(|item| !matches!(item, "walking" | "cycling" | "transit" | "driving"))
        || navigation.is_some_and(|item| !matches!(item, "google_maps" | "apple_maps"))
        || (value["travel_enabled"] == true && (mode.is_none() || value["routing_consent_at"].is_null()))
    {
        return Err("The synced travel settings are invalid.".into());
    }
    Ok(())
}

fn row_write<T>(
    db: &Connection,
    profile: &str,
    write: &AccountSyncWrite,
    history: bool,
    protected_occurrence: bool,
) -> db::Result<()>
where
    T: StoredRow + PartialEq + DeserializeOwned,
{
    let current = db::read::<T>(
        db,
        &format!("SELECT * FROM {} WHERE user_id=?1 AND id=?2", T::TABLE),
        &[profile.to_string().into(), write.id.clone().into()],
    )?
    .into_iter()
    .next();
    let current_json = current.as_ref().map(normalized).transpose()?;
    if current_json.as_ref() != write.expected.as_ref() {
        return Err("A local record changed after sync planning.".into());
    }
    match write.operation {
        AccountSyncOperation::Upsert => {
            let next = owned_value(
                profile,
                write
                    .value
                    .as_ref()
                    .ok_or("An account sync upsert requires a value.")?,
            )?;
            let row: T = decode_row(next)?;
            if normalized(&row)?["id"] != write.id {
                return Err("Account sync cannot change a record ID.".into());
            }
            if history && current.is_some() {
                return Err("Account sync cannot rewrite append-only history.".into());
            }
            if current.is_some() {
                db::update(db, profile, &write.id, &row)
            } else {
                db::insert(db, profile, &row)
            }
        }
        AccountSyncOperation::Delete => {
            if history {
                return Err("Account sync cannot delete append-only history.".into());
            }
            if protected_occurrence
                && current_json
                    .as_ref()
                    .is_some_and(|row| row["status"] != "unresolved")
            {
                return Err("Account sync cannot delete a resolved Occurrence.".into());
            }
            let count = db
                .execute(
                    &format!("DELETE FROM {} WHERE user_id=?1 AND id=?2", T::TABLE),
                    params![profile, write.id],
                )
                .map_err(db::error)?;
            if count != 1 {
                return Err("A local record changed after sync planning.".into());
            }
            Ok(())
        }
    }
}

fn owned_value(profile: &str, value: &Value) -> db::Result<Value> {
    let mut object: Map<String, Value> = value
        .as_object()
        .cloned()
        .ok_or("A synced row must be an object.")?;
    object.insert("user_id".into(), Value::String(profile.into()));
    Ok(Value::Object(object))
}

fn normalized<T: Serialize>(row: &T) -> db::Result<Value> {
    let mut value =
        serde_json::to_value(row).map_err(|_| "A local row could not be encoded.".to_string())?;
    let object = value
        .as_object_mut()
        .ok_or("A local row must be an object.")?;
    object.remove("user_id");
    object.remove("schedule_range_identity");
    for (key, item) in object.iter_mut() {
        if key.ends_with("_at") || key == "scheduled_for" {
            if let Some(normalized) = item.as_str().and_then(normalize_utc_instant) {
                *item = Value::String(normalized);
            }
        }
    }
    Ok(value)
}

fn normalize_utc_instant(value: &str) -> Option<String> {
    let instant = DateTime::parse_from_rfc3339(value)
        .ok()?
        .with_timezone(&Utc);
    let nanos = instant.nanosecond();
    let micros = nanos / 1_000;
    let remainder = nanos % 1_000;
    let adjustment = if remainder > 500 || (remainder == 500 && micros % 2 == 1) {
        i64::from(1_000 - remainder)
    } else {
        -i64::from(remainder)
    };
    let rounded = instant.checked_add_signed(Duration::nanoseconds(adjustment))?;
    let micros = rounded.nanosecond() / 1_000;
    rounded
        .with_nanosecond(micros * 1_000)
        .map(|value| value.format("%Y-%m-%dT%H:%M:%S%.6fZ").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store::{behavior, execute, Request};
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    static DATABASE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn snapshot_compatibility_uses_native_rows_without_writing() {
        let (directory, mut connection, profile, category) = database();
        let graph = complete_graph(&profile, category, '8');
        let mut value = normalized(&graph.behavior).unwrap();
        value["default_duration_minutes"] = json!(45);
        value["end_date"] = json!("2026-10-01");
        let check = |db: &mut Connection, value: Value| {
            let request = serde_json::from_value::<Request>(json!({
                "operation": "validateAccountSyncSnapshot",
                "entities": [{"kind": "behavior", "id": graph.behavior.id, "value": value}]
            })).unwrap();
            execute(db, request)
        };
        let changes = connection.total_changes();
        assert_eq!(check(&mut connection, value.clone()).unwrap(), Value::Null);
        value["future_behavior_field"] = Value::Null;
        assert_eq!(check(&mut connection, value.clone()).unwrap_err(), "Update Cadence before synchronizing account data.");
        value.as_object_mut().unwrap().remove("future_behavior_field");
        value["default_duration_minutes"] = json!("invalid");
        assert_eq!(check(&mut connection, value).unwrap_err(), "A synced row does not match the local model.");
        assert_eq!(changes, connection.total_changes());
        drop(connection);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn utc_instant_normalization_uses_half_even_microseconds() {
        assert_eq!(
            normalize_utc_instant("2026-09-01T12:00:00.123456500Z").as_deref(),
            Some("2026-09-01T12:00:00.123456Z")
        );
        assert_eq!(
            normalize_utc_instant("2026-09-01T12:00:00.123457500Z").as_deref(),
            Some("2026-09-01T12:00:00.123458Z")
        );
        assert_eq!(
            normalize_utc_instant("2026-09-01T12:00:00.999999500Z").as_deref(),
            Some("2026-09-01T12:00:01.000000Z")
        );
    }

    #[test]
    fn account_sync_limits_each_collection_instead_of_the_aggregate() {
        validate_entity_counts(
            std::iter::repeat_n(AccountSyncEntityKind::Category, 60_000)
                .chain(std::iter::repeat_n(AccountSyncEntityKind::Behavior, 60_000)),
        )
        .unwrap();
        assert!(validate_entity_counts(std::iter::repeat_n(
            AccountSyncEntityKind::Occurrence,
            db::READ_LIMIT + 1,
        ))
        .is_err());
    }

    #[test]
    fn account_sync_orders_every_foreign_key_parent_before_its_child() {
        let write = |kind| AccountSyncWrite {
            kind,
            id: "10000000-0000-4000-8000-000000000001".into(),
            operation: AccountSyncOperation::Upsert,
            expected: None,
            value: None,
        };
        assert!(
            mutation_order(&write(AccountSyncEntityKind::ConfigurationEvent), false)
                < mutation_order(&write(AccountSyncEntityKind::Occurrence), false)
        );
        assert!(
            mutation_order(&write(AccountSyncEntityKind::ImportRun), false)
                < mutation_order(&write(AccountSyncEntityKind::ImportedIntervention), false)
        );
        assert!(
            mutation_order(&write(AccountSyncEntityKind::ImportedIntervention), false)
                < mutation_order(&write(AccountSyncEntityKind::ReminderDelivery), false)
        );
        assert!(
            mutation_order(&write(AccountSyncEntityKind::ReminderDelivery), false)
                < mutation_order(&write(AccountSyncEntityKind::NoteShortcutState), false)
        );
        let delete = |kind| AccountSyncWrite {
            operation: AccountSyncOperation::Delete,
            ..write(kind)
        };
        assert!(
            mutation_order(&delete(AccountSyncEntityKind::NoteShortcutState), false)
                < mutation_order(&delete(AccountSyncEntityKind::Behavior), false)
        );
        assert!(
            mutation_order(&delete(AccountSyncEntityKind::Category), true)
                < mutation_order(&write(AccountSyncEntityKind::Category), true)
        );
    }

    fn database() -> (std::path::PathBuf, rusqlite::Connection, String, Category) {
        let directory = std::env::temp_dir().join(format!(
            "cadence-sync-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            DATABASE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let connection = db::open(&directory.join("sync.sqlite3")).unwrap();
        let profile = db::profile(&connection).unwrap().id;
        let category = db::owned::<Category>(&connection, &profile)
            .unwrap()
            .remove(0);
        (directory, connection, profile, category)
    }

    struct CompleteGraph {
        category: Category,
        behavior: Behavior,
        schedule: BehaviorSchedule,
        slot: BehaviorScheduleSlot,
        occurrence: Occurrence,
        status: OccurrenceStatusEvent,
        time: OccurrenceTimeSession,
        reminder: ReminderDelivery,
    }

    fn complete_graph(profile: &str, category: Category, digit: char) -> CompleteGraph {
        let id = |suffix: u8| format!("{digit}0000000-0000-4000-8000-{suffix:012}");
        let stamp = "2026-09-01T12:00:00.000000Z".to_string();
        let behavior = Behavior {
            id: id(1),
            user_id: profile.into(),
            category_id: Some(category.id.clone()),
            title: "Graph".into(),
            description: None,
            location_text: None,
            where_kind: None,
            active: true,
            archive_notes: vec![],
            archived_at: None,
            auto_archived_at: None,
            default_duration_minutes: None,
            end_date: None,
            recurrence_rule: json!({"type":"daily","interval":1}),
            scheduled_time: "09:00:00".into(),
            timezone: "America/New_York".into(),
            browser_reminder_enabled: true,
            email_reminder_enabled: false,
            reminder_offset_minutes: 0,
            current_configuration_event_id: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let schedule = BehaviorSchedule {
            id: id(2),
            user_id: profile.into(),
            behavior_id: behavior.id.clone(),
            recurrence_rule: behavior.recurrence_rule.clone(),
            sort_order: 0,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let slot = BehaviorScheduleSlot {
            id: id(3),
            user_id: profile.into(),
            behavior_id: behavior.id.clone(),
            behavior_schedule_id: Some(schedule.id.clone()),
            kind: "exact".into(),
            preset: None,
            start_time: "09:00:00".into(),
            end_time: None,
            sort_order: 0,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let occurrence = Occurrence {
            id: id(4),
            user_id: profile.into(),
            behavior_id: behavior.id.clone(),
            behavior_configuration_event_id: None,
            behavior_schedule_slot_id: Some(slot.id.clone()),
            scheduled_for: "2026-09-01T13:00:00.000000Z".into(),
            local_date: "2026-09-01".into(),
            schedule_kind: "exact".into(),
            schedule_preset: None,
            schedule_start_time: "09:00:00".into(),
            schedule_end_time: None,
            schedule_range_identity: None,
            status: "completed".into(),
            completed_at: Some(stamp.clone()),
            status_marked_at: Some(stamp.clone()),
            note: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let status = OccurrenceStatusEvent {
            id: id(5),
            user_id: profile.into(),
            behavior_id: behavior.id.clone(),
            occurrence_id: occurrence.id.clone(),
            previous_status: Some("unresolved".into()),
            status: "completed".into(),
            reason_code: None,
            status_semantics: "explicit_user_mark".into(),
            source_capture_method: "manual".into(),
            source_confidence: "declared".into(),
            timezone: "America/New_York".into(),
            local_date: "2026-09-01".into(),
            effective_at: None,
            revises_event_id: None,
            recorded_at: stamp.clone(),
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let time = OccurrenceTimeSession {
            id: id(6),
            user_id: profile.into(),
            behavior_id: behavior.id.clone(),
            occurrence_id: occurrence.id.clone(),
            started_at: "2026-09-01T11:30:00.000000Z".into(),
            stopped_at: Some(stamp.clone()),
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let reminder = ReminderDelivery {
            id: id(7),
            user_id: profile.into(),
            occurrence_id: occurrence.id.clone(),
            channel: "browser_push".into(),
            scheduled_send_at: "2026-09-01T11:00:00.000000Z".into(),
            sent_at: Some(stamp.clone()),
            status: "sent".into(),
            error: None,
            processing_started_at: None,
            import_run_id: None,
            imported_intervention_id: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        CompleteGraph {
            category,
            behavior,
            schedule,
            slot,
            occurrence,
            status,
            time,
            reminder,
        }
    }

    fn insert_complete_graph(db: &Connection, profile: &str, graph: &CompleteGraph) {
        db::insert(db, profile, &graph.behavior).unwrap();
        db::insert(db, profile, &graph.schedule).unwrap();
        db::insert(db, profile, &graph.slot).unwrap();
        db::insert(db, profile, &graph.occurrence).unwrap();
        db::insert(db, profile, &graph.status).unwrap();
        db::insert(db, profile, &graph.time).unwrap();
        db::insert(db, profile, &graph.reminder).unwrap();
    }

    fn graph_rows(graph: &CompleteGraph) -> [(AccountSyncEntityKind, String, Value); 8] {
        [
            (
                AccountSyncEntityKind::Category,
                graph.category.id.clone(),
                normalized(&graph.category).unwrap(),
            ),
            (
                AccountSyncEntityKind::Behavior,
                graph.behavior.id.clone(),
                normalized(&graph.behavior).unwrap(),
            ),
            (
                AccountSyncEntityKind::Schedule,
                graph.schedule.id.clone(),
                normalized(&graph.schedule).unwrap(),
            ),
            (
                AccountSyncEntityKind::ScheduleSlot,
                graph.slot.id.clone(),
                normalized(&graph.slot).unwrap(),
            ),
            (
                AccountSyncEntityKind::Occurrence,
                graph.occurrence.id.clone(),
                normalized(&graph.occurrence).unwrap(),
            ),
            (
                AccountSyncEntityKind::StatusEvent,
                graph.status.id.clone(),
                normalized(&graph.status).unwrap(),
            ),
            (
                AccountSyncEntityKind::TimeSession,
                graph.time.id.clone(),
                normalized(&graph.time).unwrap(),
            ),
            (
                AccountSyncEntityKind::ReminderDelivery,
                graph.reminder.id.clone(),
                normalized(&graph.reminder).unwrap(),
            ),
        ]
    }

    #[test]
    fn account_sync_remaps_ownership_and_rejects_stale_rows_atomically() {
        let (_directory, mut connection, profile, category) = database();
        let mut expected = normalized(&category).unwrap();
        let mut next = expected.clone();
        next["name"] = json!("Synced category");
        execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![AccountSyncWrite {
                    kind: AccountSyncEntityKind::Category,
                    id: category.id.clone(),
                    operation: AccountSyncOperation::Upsert,
                    expected: Some(expected.clone()),
                    value: Some(next),
                }],
            },
        )
        .unwrap();
        assert_eq!(
            db::by_id::<Category>(&connection, &profile, &category.id)
                .unwrap()
                .name,
            "Synced category"
        );

        expected["name"] = json!("Synced category");
        let failure = execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::Profile,
                        id: "profile".into(),
                        operation: AccountSyncOperation::Upsert,
                        expected: Some(json!({"timezone":"America/New_York"})),
                        value: Some(json!({"timezone":"Europe/London"})),
                    },
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::Category,
                        id: category.id,
                        operation: AccountSyncOperation::Delete,
                        expected: Some(json!({"stale":true})),
                        value: None,
                    },
                ],
            },
        )
        .unwrap_err();
        assert_eq!(failure, "A local record changed after sync planning.");
        assert_eq!(
            db::profile(&connection).unwrap().timezone,
            "America/New_York"
        );
    }

    #[test]
    fn account_sync_applies_and_deletes_note_shortcut_state_with_cas() {
        let (_directory, mut connection, profile, _category) = database();
        let state = NoteShortcutState {
            id: "global".into(),
            user_id: profile.clone(),
            behavior_id: None,
            enabled: true,
            entries: vec![],
            excluded_occurrence_ids: vec![],
            revision: 1,
            updated_at: "2026-09-01T00:00:00.000000Z".into(),
        };
        let value = normalized(&state).unwrap();
        execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![AccountSyncWrite {
                    kind: AccountSyncEntityKind::NoteShortcutState,
                    id: "global".into(),
                    operation: AccountSyncOperation::Upsert,
                    expected: None,
                    value: Some(value.clone()),
                }],
            },
        )
        .unwrap();
        assert_eq!(
            db::by_id::<NoteShortcutState>(&connection, &profile, "global").unwrap(),
            state
        );

        let failure = execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::Profile,
                        id: "profile".into(),
                        operation: AccountSyncOperation::Upsert,
                        expected: Some(json!({"timezone":"America/New_York"})),
                        value: Some(json!({"timezone":"Europe/London"})),
                    },
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::NoteShortcutState,
                        id: "global".into(),
                        operation: AccountSyncOperation::Delete,
                        expected: Some(json!({"stale":true})),
                        value: None,
                    },
                ],
            },
        )
        .unwrap_err();
        assert_eq!(failure, "A local record changed after sync planning.");
        assert_eq!(
            db::profile(&connection).unwrap().timezone,
            "America/New_York"
        );

        execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![AccountSyncWrite {
                    kind: AccountSyncEntityKind::NoteShortcutState,
                    id: "global".into(),
                    operation: AccountSyncOperation::Delete,
                    expected: Some(value),
                    value: None,
                }],
            },
        )
        .unwrap();
        assert!(db::by_id::<NoteShortcutState>(&connection, &profile, "global").is_err());
    }

    #[test]
    fn account_sync_applies_profile_travel_habits_and_rejects_unsupported_shapes() {
        let (_directory, mut connection, profile, _category) = database();
        let current = profile_value(&connection, &profile).unwrap();
        assert_eq!(current["travel_place_modes"], json!([]));
        assert_eq!(current["travel_habits_updated_at"], Value::Null);
        let mut next = current.clone();
        next["travel_preparation_minutes"] = json!(15);
        next["travel_place_modes"] = json!([{"place_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","mode":"walking","chosen_at":"2026-09-01T00:00:00.000000Z"}]);
        next["travel_habits_updated_at"] = json!("2026-09-01T00:00:00.000000Z");
        let write = |expected: &Value, value: Value| Request::ApplyAccountSync {
            profile_id: profile.clone(),
            writes: vec![AccountSyncWrite {
                kind: AccountSyncEntityKind::Profile,
                id: "profile".into(),
                operation: AccountSyncOperation::Upsert,
                expected: Some(expected.clone()),
                value: Some(value),
            }],
        };
        execute(&mut connection, write(&current, next.clone())).unwrap();
        let saved = super::super::travel::read_value(&connection, &profile).unwrap();
        assert_eq!(saved["habits"]["preparationMinutes"], 15);
        assert_eq!(saved["habits"]["placeModes"][0]["mode"], "walking");
        assert_eq!(profile_value(&connection, &profile).unwrap(), next);

        // A build that predates Ticket 217 sends eight keys and fails closed.
        let legacy: Value = Value::Object(next.as_object().unwrap().iter()
            .filter(|(key, _)| !key.starts_with("travel_") || *key == "travel_enabled" || *key == "travel_mode")
            .map(|(key, value)| (key.clone(), value.clone())).collect());
        assert_eq!(execute(&mut connection, write(&next, legacy)).unwrap_err(), "Update Cadence before synchronizing account data.");
        let mut unordered = next.clone();
        unordered["travel_place_modes"] = json!([
            {"place_key":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","mode":"walking","chosen_at":"2026-09-01T00:00:00.000000Z"},
            {"place_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","mode":"walking","chosen_at":"2026-09-01T00:00:00.000000Z"}]);
        assert_eq!(execute(&mut connection, write(&next, unordered)).unwrap_err(), "The synced travel habits are invalid.");
        let mut unrevised = next.clone();
        unrevised["travel_habits_updated_at"] = Value::Null;
        assert_eq!(execute(&mut connection, write(&next, unrevised)).unwrap_err(), "The synced travel habits are invalid.");
    }

    #[test]
    fn account_sync_rejects_profile_and_history_deletion() {
        let (_directory, mut connection, profile, _category) = database();
        let failure = execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile,
                writes: vec![AccountSyncWrite {
                    kind: AccountSyncEntityKind::Profile,
                    id: "profile".into(),
                    operation: AccountSyncOperation::Delete,
                    expected: Some(json!({"timezone":"America/New_York"})),
                    value: None,
                }],
            },
        )
        .unwrap_err();
        assert_eq!(failure, "Account sync cannot delete the local profile.");
    }

    #[test]
    fn first_link_replacement_requires_the_pending_attempt_and_revision_atomically() {
        let (_directory, mut connection, profile, category) = database();
        let fingerprint = "a".repeat(64);
        connection.execute("INSERT INTO account_link_metadata(local_profile_id,hosted_user_id,email,authenticated_at) VALUES(?1,'hosted-one',NULL,'2026-09-01T00:00:00Z')", [&profile]).unwrap();
        connection.execute("INSERT INTO account_first_link_attempts(local_profile_id,hosted_user_id,choice,attempt_id,local_fingerprint,hosted_fingerprint,created_at,pre_attempt_baseline_json) VALUES(?1,'hosted-one','ignore','attempt',?2,?2,'2026-09-01T00:00:00Z','{\"entities\":[]}')", params![profile,fingerprint]).unwrap();
        let revision: i64 = connection
            .query_row(
                "SELECT revision FROM local_data_revision WHERE user_id=?1",
                [&profile],
                |row| row.get(0),
            )
            .unwrap();
        let deletion = AccountSyncWrite {
            kind: AccountSyncEntityKind::Category,
            id: category.id.clone(),
            operation: AccountSyncOperation::Delete,
            expected: Some(normalized(&category).unwrap()),
            value: None,
        };
        let request = |expected_revision, attempt_id: &str| Request::ApplyFirstLinkAccountSync {
            profile_id: profile.clone(),
            hosted_user_id: "hosted-one".into(),
            choice: "ignore".into(),
            attempt_id: attempt_id.into(),
            local_fingerprint: fingerprint.clone(),
            hosted_fingerprint: fingerprint.clone(),
            expected_revision,
            idempotency_key: fingerprint.clone(),
            baseline_fingerprint: fingerprint.clone(),
            baseline_json: "{\"entities\":[]}".into(),
            backup_path: Some("/tmp/backup".into()),
            completed_at: "2026-09-01T00:01:00Z".into(),
            writes: vec![deletion.clone()],
        };
        assert!(execute(&mut connection, request(revision + 1, "attempt")).is_err());
        assert!(db::by_id::<Category>(&connection, &profile, &category.id).is_ok());
        assert!(execute(&mut connection, request(revision, "replaced-attempt")).is_err());
        assert!(db::by_id::<Category>(&connection, &profile, &category.id).is_ok());
        connection.execute("INSERT INTO account_sync_baselines(local_profile_id,hosted_user_id,choice,idempotency_key,local_fingerprint,hosted_fingerprint,baseline_fingerprint,baseline_json,backup_path,completed_at) VALUES(?1,'hosted-one','ignore',?2,?2,?2,?2,'{\"entities\":[]}',NULL,'2026-09-01T00:00:00Z')", params![profile,fingerprint]).unwrap();
        assert!(execute(&mut connection, request(revision, "attempt")).is_err());
        assert!(db::by_id::<Category>(&connection, &profile, &category.id).is_ok());
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM account_first_link_attempts",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM mutation_outbox WHERE synced_at IS NULL",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        connection
            .execute("DELETE FROM account_sync_baselines", [])
            .unwrap();
        execute(&mut connection, request(revision, "attempt")).unwrap();
        assert!(db::by_id::<Category>(&connection, &profile, &category.id).is_err());
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM mutation_outbox WHERE synced_at IS NULL",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM account_sync_baselines", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM account_first_link_attempts",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn first_link_replacement_clears_unique_category_before_inserting_its_replacement() {
        let (_directory, mut connection, profile, category) = database();
        let replacement = Category {
            id: "90000000-0000-4000-8000-000000000001".into(),
            user_id: profile.clone(),
            ..category.clone()
        };
        let writes = vec![
            AccountSyncWrite {
                kind: AccountSyncEntityKind::Category,
                id: replacement.id.clone(),
                operation: AccountSyncOperation::Upsert,
                expected: None,
                value: Some(normalized(&replacement).unwrap()),
            },
            AccountSyncWrite {
                kind: AccountSyncEntityKind::Category,
                id: category.id.clone(),
                operation: AccountSyncOperation::Delete,
                expected: Some(normalized(&category).unwrap()),
                value: None,
            },
        ];
        let tx = connection.transaction().unwrap();
        apply_first_link(&tx, &profile, &writes).unwrap();
        tx.commit().unwrap();
        assert!(db::by_id::<Category>(&connection, &profile, &category.id).is_err());
        assert_eq!(
            db::by_id::<Category>(&connection, &profile, &replacement.id)
                .unwrap()
                .name,
            category.name
        );
    }

    #[test]
    fn first_link_replacement_swaps_a_complete_graph_without_foreign_key_damage() {
        let (_directory, mut connection, profile, category) = database();
        let local = complete_graph(&profile, category.clone(), '6');
        insert_complete_graph(&connection, &profile, &local);
        let replacement_category = Category {
            id: "70000000-0000-4000-8000-000000000008".into(),
            ..category
        };
        let hosted = complete_graph(&profile, replacement_category, '7');
        let writes = graph_rows(&local)
            .into_iter()
            .map(|(kind, id, expected)| AccountSyncWrite {
                kind,
                id,
                operation: AccountSyncOperation::Delete,
                expected: Some(expected),
                value: None,
            })
            .chain(
                graph_rows(&hosted)
                    .into_iter()
                    .map(|(kind, id, value)| AccountSyncWrite {
                        kind,
                        id,
                        operation: AccountSyncOperation::Upsert,
                        expected: None,
                        value: Some(value),
                    }),
            )
            .collect::<Vec<_>>();
        let tx = connection.transaction().unwrap();
        apply_first_link(&tx, &profile, &writes).unwrap();
        tx.commit().unwrap();
        assert!(db::by_id::<Behavior>(&connection, &profile, &local.behavior.id).is_err());
        assert!(db::by_id::<Occurrence>(&connection, &profile, &local.occurrence.id).is_err());
        assert_eq!(
            db::by_id::<Category>(&connection, &profile, &hosted.category.id)
                .unwrap()
                .name,
            local.category.name
        );
        assert_eq!(
            db::by_id::<Occurrence>(&connection, &profile, &hosted.occurrence.id)
                .unwrap()
                .behavior_id,
            hosted.behavior.id
        );
        assert_eq!(
            db::by_id::<OccurrenceStatusEvent>(&connection, &profile, &hosted.status.id)
                .unwrap()
                .occurrence_id,
            hosted.occurrence.id
        );
        assert_eq!(
            db::by_id::<OccurrenceTimeSession>(&connection, &profile, &hosted.time.id)
                .unwrap()
                .occurrence_id,
            hosted.occurrence.id
        );
        assert_eq!(
            db::by_id::<ReminderDelivery>(&connection, &profile, &hosted.reminder.id)
                .unwrap()
                .occurrence_id,
            hosted.occurrence.id
        );
        let foreign_key_errors: i64 = connection
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_errors, 0);
    }

    #[test]
    fn first_link_replacement_rolls_back_when_a_parent_delete_cascades_a_retained_child() {
        let (_directory, mut connection, profile, category) = database();
        let local = complete_graph(&profile, category.clone(), '8');
        insert_complete_graph(&connection, &profile, &local);
        let next_behavior = Behavior {
            id: "90000000-0000-4000-8000-000000000001".into(),
            ..local.behavior.clone()
        };
        let mut next_occurrence = local.occurrence.clone();
        next_occurrence.behavior_id = next_behavior.id.clone();
        next_occurrence.behavior_schedule_slot_id = None;
        let writes = vec![
            AccountSyncWrite {
                kind: AccountSyncEntityKind::Behavior,
                id: local.behavior.id.clone(),
                operation: AccountSyncOperation::Delete,
                expected: Some(normalized(&local.behavior).unwrap()),
                value: None,
            },
            AccountSyncWrite {
                kind: AccountSyncEntityKind::Behavior,
                id: next_behavior.id.clone(),
                operation: AccountSyncOperation::Upsert,
                expected: None,
                value: Some(normalized(&next_behavior).unwrap()),
            },
            AccountSyncWrite {
                kind: AccountSyncEntityKind::Occurrence,
                id: local.occurrence.id.clone(),
                operation: AccountSyncOperation::Upsert,
                expected: Some(normalized(&local.occurrence).unwrap()),
                value: Some(normalized(&next_occurrence).unwrap()),
            },
        ];
        let tx = connection.transaction().unwrap();
        assert_eq!(
            apply_first_link(&tx, &profile, &writes).unwrap_err(),
            "A local record changed after sync planning."
        );
        tx.rollback().unwrap();
        assert_eq!(
            db::by_id::<Behavior>(&connection, &profile, &local.behavior.id).unwrap(),
            local.behavior
        );
        assert_eq!(
            normalized(
                &db::by_id::<Occurrence>(&connection, &profile, &local.occurrence.id).unwrap()
            )
            .unwrap(),
            normalized(&local.occurrence).unwrap()
        );
        assert!(db::by_id::<Behavior>(&connection, &profile, &next_behavior.id).is_err());
        assert_eq!(
            db::by_id::<OccurrenceStatusEvent>(&connection, &profile, &local.status.id).unwrap(),
            local.status
        );
        assert_eq!(
            db::by_id::<OccurrenceTimeSession>(&connection, &profile, &local.time.id).unwrap(),
            local.time
        );
        assert_eq!(
            db::by_id::<ReminderDelivery>(&connection, &profile, &local.reminder.id).unwrap(),
            local.reminder
        );
        let foreign_key_errors: i64 = connection
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_errors, 0);
    }

    #[test]
    fn occurrence_sync_omits_derived_identity_but_rejects_stale_user_data_atomically() {
        let (_directory, mut connection, profile, category) = database();
        let behavior_id = "20000000-0000-4000-8000-000000000001";
        let occurrence_id = "20000000-0000-4000-8000-000000000002";
        connection.execute("INSERT INTO behaviors(id,user_id,category_id,title,description,recurrence_rule,scheduled_time,timezone,browser_reminder_enabled,email_reminder_enabled,reminder_offset_minutes,active,created_at,updated_at,archived_at,current_configuration_event_id) VALUES(?1,?2,?3,'Test',NULL,'{\"type\":\"daily\",\"interval\":1}','09:00:00','America/New_York',1,0,0,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL,NULL)", params![behavior_id,profile,category.id]).unwrap();
        connection.execute("INSERT INTO occurrences(id,user_id,behavior_id,behavior_configuration_event_id,behavior_schedule_slot_id,scheduled_for,local_date,schedule_kind,schedule_preset,schedule_start_time,schedule_end_time,status,completed_at,status_marked_at,note,created_at,updated_at) VALUES(?1,?2,?3,NULL,NULL,'2026-09-01T13:00:00Z','2026-09-01','exact',NULL,'09:00:00',NULL,'unresolved',NULL,NULL,NULL,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')", params![occurrence_id,profile,behavior_id]).unwrap();
        let occurrence = db::by_id::<Occurrence>(&connection, &profile, occurrence_id).unwrap();
        assert_eq!(occurrence.schedule_range_identity, Some(-1));
        let expected = normalized(&occurrence).unwrap();
        assert!(expected.get("schedule_range_identity").is_none());
        let mut next = expected.clone();
        next["note"] = json!("synced");
        execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![AccountSyncWrite {
                    kind: AccountSyncEntityKind::Occurrence,
                    id: occurrence_id.into(),
                    operation: AccountSyncOperation::Upsert,
                    expected: Some(expected.clone()),
                    value: Some(next),
                }],
            },
        )
        .unwrap();
        assert_eq!(
            db::by_id::<Occurrence>(&connection, &profile, occurrence_id)
                .unwrap()
                .note
                .as_deref(),
            Some("synced")
        );
        let mut stale = expected;
        stale["note"] = json!("stale");
        let failure = execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::Profile,
                        id: "profile".into(),
                        operation: AccountSyncOperation::Upsert,
                        expected: Some(json!({"timezone":"America/New_York"})),
                        value: Some(json!({"timezone":"Europe/London"})),
                    },
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::Occurrence,
                        id: occurrence_id.into(),
                        operation: AccountSyncOperation::Upsert,
                        expected: Some(stale),
                        value: Some(json!({})),
                    },
                ],
            },
        )
        .unwrap_err();
        assert_eq!(failure, "A local record changed after sync planning.");
        assert_eq!(
            db::profile(&connection).unwrap().timezone,
            "America/New_York"
        );
        assert_eq!(
            db::by_id::<Occurrence>(&connection, &profile, occurrence_id)
                .unwrap()
                .note
                .as_deref(),
            Some("synced")
        );
    }

    #[test]
    fn account_sync_orders_graph_creation_and_deletion_by_dependency() {
        let (_directory, mut connection, profile, _category) = database();
        let stamp = "2026-09-01T00:00:00Z".to_string();
        let category = Category {
            description: None,
            id: "10000000-0000-4000-8000-000000000001".into(),
            user_id: profile.clone(),
            name: "Graph".into(),
            sort_order: 10,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let behavior = Behavior {
            id: "10000000-0000-4000-8000-000000000002".into(),
            user_id: profile.clone(),
            category_id: Some(category.id.clone()),
            title: "Graph behavior".into(),
            description: None,
            location_text: None,
            where_kind: None,
            active: false,
            archive_notes: vec![BehaviorArchiveNote {
                id: "10000000-0000-4000-8000-000000000005".into(),
                archived_at: stamp.clone(),
                note: Some("Synced archive".into()),
                updated_at: stamp.clone(),
            }],
            archived_at: Some(stamp.clone()),
            auto_archived_at: Some(stamp.clone()),
            default_duration_minutes: Some(45),
            end_date: Some("2026-09-01".into()),
            recurrence_rule: json!({"type":"daily","interval":1}),
            scheduled_time: "09:00:00".into(),
            timezone: "America/New_York".into(),
            browser_reminder_enabled: true,
            email_reminder_enabled: false,
            reminder_offset_minutes: 0,
            current_configuration_event_id: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let schedule = BehaviorSchedule {
            id: "10000000-0000-4000-8000-000000000003".into(),
            user_id: profile.clone(),
            behavior_id: behavior.id.clone(),
            recurrence_rule: json!({"type":"daily","interval":1}),
            sort_order: 0,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let slot = BehaviorScheduleSlot {
            id: "10000000-0000-4000-8000-000000000004".into(),
            user_id: profile.clone(),
            behavior_id: behavior.id.clone(),
            behavior_schedule_id: Some(schedule.id.clone()),
            kind: "exact".into(),
            start_time: "09:00:00".into(),
            end_time: None,
            preset: None,
            sort_order: 0,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        };
        let rows = [
            (
                AccountSyncEntityKind::ScheduleSlot,
                slot.id.clone(),
                normalized(&slot).unwrap(),
            ),
            (
                AccountSyncEntityKind::Behavior,
                behavior.id.clone(),
                normalized(&behavior).unwrap(),
            ),
            (
                AccountSyncEntityKind::Category,
                category.id.clone(),
                normalized(&category).unwrap(),
            ),
            (
                AccountSyncEntityKind::Schedule,
                schedule.id.clone(),
                normalized(&schedule).unwrap(),
            ),
        ];
        execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: rows
                    .iter()
                    .map(|(kind, id, value)| AccountSyncWrite {
                        kind: *kind,
                        id: id.clone(),
                        operation: AccountSyncOperation::Upsert,
                        expected: None,
                        value: Some(value.clone()),
                    })
                    .collect(),
            },
        )
        .unwrap();
        let graphs = execute(
            &mut connection,
            Request::ReadBehaviorGraphs {
                profile_id: profile.clone(),
            },
        )
        .unwrap();
        assert_eq!(
            graphs
                .as_array()
                .unwrap()
                .iter()
                .find(|graph| graph["behavior"]["id"] == behavior.id)
                .unwrap()["revision"],
            1
        );
        let snapshot = execute(
            &mut connection,
            Request::ReadImportSnapshot {
                profile_id: profile.clone(),
            },
        )
        .unwrap();
        assert!(snapshot["graphs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|graph| graph["behavior"]["id"] == behavior.id));
        assert_eq!(
            db::by_id::<BehaviorScheduleSlot>(&connection, &profile, &slot.id)
                .unwrap()
                .behavior_id,
            behavior.id
        );
        let stored_behavior = db::by_id::<Behavior>(&connection, &profile, &behavior.id).unwrap();
        assert_eq!(stored_behavior.archive_notes, behavior.archive_notes);
        assert_eq!(stored_behavior.default_duration_minutes, Some(45));
        assert_eq!(stored_behavior.end_date.as_deref(), Some("2026-09-01"));
        assert_eq!(
            stored_behavior.auto_archived_at.as_deref(),
            Some("2026-09-01T00:00:00.000000Z")
        );

        let expected_behavior = normalized(&stored_behavior).unwrap();
        let mut legacy_behavior = expected_behavior.clone();
        let legacy_object = legacy_behavior.as_object_mut().unwrap();
        legacy_object.remove("default_duration_minutes");
        legacy_object.remove("end_date");
        legacy_object.remove("auto_archived_at");
        let failure = execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![AccountSyncWrite {
                    kind: AccountSyncEntityKind::Behavior,
                    id: behavior.id.clone(),
                    operation: AccountSyncOperation::Upsert,
                    expected: Some(expected_behavior.clone()),
                    value: Some(legacy_behavior),
                }],
            },
        )
        .unwrap_err();
        assert_eq!(
            failure,
            "Update Cadence before synchronizing Behavior changes."
        );
        assert_eq!(
            normalized(&db::by_id::<Behavior>(&connection, &profile, &behavior.id).unwrap())
                .unwrap(),
            expected_behavior
        );
        let mut detached_behavior = behavior.clone();
        detached_behavior.category_id = None;
        execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::Category,
                        id: category.id.clone(),
                        operation: AccountSyncOperation::Delete,
                        expected: Some(normalized(&category).unwrap()),
                        value: None,
                    },
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::Behavior,
                        id: behavior.id.clone(),
                        operation: AccountSyncOperation::Upsert,
                        expected: Some(normalized(&behavior).unwrap()),
                        value: Some(normalized(&detached_behavior).unwrap()),
                    },
                ],
            },
        )
        .unwrap();
        assert_eq!(
            db::by_id::<Behavior>(&connection, &profile, &behavior.id)
                .unwrap()
                .category_id,
            None
        );
        assert_eq!(
            behavior::revision(&connection, &profile, &behavior.id).unwrap(),
            2
        );
        execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![AccountSyncWrite {
                    kind: AccountSyncEntityKind::Behavior,
                    id: behavior.id.clone(),
                    operation: AccountSyncOperation::Upsert,
                    expected: Some(normalized(&detached_behavior).unwrap()),
                    value: Some(normalized(&detached_behavior).unwrap()),
                }],
            },
        )
        .unwrap();
        assert_eq!(
            behavior::revision(&connection, &profile, &behavior.id).unwrap(),
            2
        );
        execute(
            &mut connection,
            Request::ApplyAccountSync {
                profile_id: profile.clone(),
                writes: vec![
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::Schedule,
                        id: schedule.id.clone(),
                        operation: AccountSyncOperation::Delete,
                        expected: Some(normalized(&schedule).unwrap()),
                        value: None,
                    },
                    AccountSyncWrite {
                        kind: AccountSyncEntityKind::ScheduleSlot,
                        id: slot.id.clone(),
                        operation: AccountSyncOperation::Delete,
                        expected: Some(normalized(&slot).unwrap()),
                        value: None,
                    },
                ],
            },
        )
        .unwrap();
        assert!(db::owned::<BehaviorSchedule>(&connection, &profile)
            .unwrap()
            .iter()
            .all(|row| row.id != schedule.id));
        apply_first_link(
            &connection,
            &profile,
            &[AccountSyncWrite {
                kind: AccountSyncEntityKind::Behavior,
                id: behavior.id.clone(),
                operation: AccountSyncOperation::Delete,
                expected: Some(normalized(&detached_behavior).unwrap()),
                value: None,
            }],
        )
        .unwrap();
        assert!(behavior::revision(&connection, &profile, &behavior.id).is_err());
    }

    #[test]
    fn account_sync_orders_import_history_and_delivery_provenance_both_ways() {
        let (_directory, connection, profile, category) = database();
        let stamp = "2026-09-01T00:00:00Z".to_string();
        let behavior_id = "40000000-0000-4000-8000-000000000001";
        let occurrence_id = "40000000-0000-4000-8000-000000000002";
        connection.execute("INSERT INTO behaviors(id,user_id,category_id,title,description,recurrence_rule,scheduled_time,timezone,browser_reminder_enabled,email_reminder_enabled,reminder_offset_minutes,active,created_at,updated_at,archived_at,current_configuration_event_id) VALUES(?1,?2,?3,'Test',NULL,'{\"type\":\"daily\",\"interval\":1}','09:00:00','America/New_York',1,0,0,1,?4,?4,NULL,NULL)", params![behavior_id,profile,category.id,stamp]).unwrap();
        connection.execute("INSERT INTO occurrences(id,user_id,behavior_id,behavior_configuration_event_id,behavior_schedule_slot_id,scheduled_for,local_date,schedule_kind,schedule_preset,schedule_start_time,schedule_end_time,status,completed_at,status_marked_at,note,created_at,updated_at) VALUES(?1,?2,?3,NULL,NULL,'2026-09-01T13:00:00Z','2026-09-01','exact',NULL,'09:00:00',NULL,'unresolved',NULL,NULL,NULL,?4,?4)", params![occurrence_id,profile,behavior_id,stamp]).unwrap();
        let parent_id = "10000000-0000-4000-8000-000000000003";
        let child_id = "f0000000-0000-4000-8000-000000000004";
        let intervention_id = "40000000-0000-4000-8000-000000000005";
        let delivery_id = "40000000-0000-4000-8000-000000000006";
        let run = |id: &str, parent: Option<&str>| BehaviorLogImportRun {
            accepted_preview_fingerprint: parent.map(|_| "a".repeat(64)),
            accepted_preview_run_id: parent.map(str::to_string),
            bundle_fingerprint: None,
            bundle_format: "behaviorlog.bundle".into(),
            completed_at: Some(stamp.clone()),
            created_at: stamp.clone(),
            dry_run_summary: json!({}),
            failure_message: None,
            id: id.into(),
            import_mode: if parent.is_some() {
                "create_missing_only"
            } else {
                "preview_only"
            }
            .into(),
            manifest_sha256: None,
            privacy_redaction_level: None,
            producer_name: None,
            producer_version: None,
            schema_version: Some("0.3".into()),
            started_at: stamp.clone(),
            status: if parent.is_some() {
                "applied"
            } else {
                "previewed"
            }
            .into(),
            subject_id_strategy: None,
            updated_at: stamp.clone(),
            user_id: profile.clone(),
        };
        let parent = run(parent_id, None);
        let child = run(child_id, Some(parent_id));
        let intervention = ImportedIntervention {
            behavior_external_id: "behavior".into(),
            behavior_id: Some(behavior_id.into()),
            channel: "browser_push".into(),
            created_at: stamp.clone(),
            delivery_status: "sent".into(),
            external_id: "intervention".into(),
            failure_reason: None,
            id: intervention_id.into(),
            import_run_id: child_id.into(),
            intervention_type: Some("reminder".into()),
            metadata: json!({}),
            occurrence_external_id: "occurrence".into(),
            occurrence_id: Some(occurrence_id.into()),
            redacted_sensitivity_indicators: json!([]),
            scheduled_send_at: stamp.clone(),
            sent_at: Some(stamp.clone()),
            source_capture_method: "imported".into(),
            source_confidence: "declared".into(),
            source_original_id: None,
            updated_at: stamp.clone(),
            user_id: profile.clone(),
        };
        let delivery = ReminderDelivery {
            channel: "browser_push".into(),
            created_at: stamp.clone(),
            error: None,
            id: delivery_id.into(),
            import_run_id: Some(child_id.into()),
            imported_intervention_id: Some(intervention_id.into()),
            occurrence_id: occurrence_id.into(),
            processing_started_at: None,
            scheduled_send_at: stamp.clone(),
            sent_at: Some(stamp.clone()),
            status: "sent".into(),
            updated_at: stamp,
            user_id: profile.clone(),
        };
        let inserts = [
            (
                AccountSyncEntityKind::ReminderDelivery,
                delivery_id,
                normalized(&delivery).unwrap(),
            ),
            (
                AccountSyncEntityKind::ImportRun,
                child_id,
                normalized(&child).unwrap(),
            ),
            (
                AccountSyncEntityKind::ImportedIntervention,
                intervention_id,
                normalized(&intervention).unwrap(),
            ),
            (
                AccountSyncEntityKind::ImportRun,
                parent_id,
                normalized(&parent).unwrap(),
            ),
        ];
        apply_first_link(
            &connection,
            &profile,
            &inserts
                .iter()
                .map(|(kind, id, value)| AccountSyncWrite {
                    kind: *kind,
                    id: (*id).into(),
                    operation: AccountSyncOperation::Upsert,
                    expected: None,
                    value: Some(value.clone()),
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let deletes = [
            (
                AccountSyncEntityKind::ImportRun,
                parent_id,
                normalized(&parent).unwrap(),
            ),
            (
                AccountSyncEntityKind::ImportedIntervention,
                intervention_id,
                normalized(&intervention).unwrap(),
            ),
            (
                AccountSyncEntityKind::ImportRun,
                child_id,
                normalized(&child).unwrap(),
            ),
            (
                AccountSyncEntityKind::ReminderDelivery,
                delivery_id,
                normalized(&delivery).unwrap(),
            ),
        ];
        apply_first_link(
            &connection,
            &profile,
            &deletes
                .iter()
                .map(|(kind, id, expected)| AccountSyncWrite {
                    kind: *kind,
                    id: (*id).into(),
                    operation: AccountSyncOperation::Delete,
                    expected: Some(expected.clone()),
                    value: None,
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM behaviorlog_import_runs", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM reminder_deliveries", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn account_sync_orders_status_revisions_before_children() {
        let (_directory, connection, profile, category) = database();
        let behavior_id = "30000000-0000-4000-8000-000000000001";
        let occurrence_id = "30000000-0000-4000-8000-000000000002";
        connection.execute("INSERT INTO behaviors(id,user_id,category_id,title,description,recurrence_rule,scheduled_time,timezone,browser_reminder_enabled,email_reminder_enabled,reminder_offset_minutes,active,created_at,updated_at,archived_at,current_configuration_event_id) VALUES(?1,?2,?3,'Test',NULL,'{\"type\":\"daily\",\"interval\":1}','09:00:00','America/New_York',1,0,0,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL,NULL)", params![behavior_id,profile,category.id]).unwrap();
        connection.execute("INSERT INTO occurrences(id,user_id,behavior_id,behavior_configuration_event_id,behavior_schedule_slot_id,scheduled_for,local_date,schedule_kind,schedule_preset,schedule_start_time,schedule_end_time,status,completed_at,status_marked_at,note,created_at,updated_at) VALUES(?1,?2,?3,NULL,NULL,'2026-09-01T13:00:00Z','2026-09-01','exact',NULL,'09:00:00',NULL,'completed','2026-09-01T13:00:00Z','2026-09-01T13:00:00Z',NULL,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')", params![occurrence_id,profile,behavior_id]).unwrap();
        let parent_id = "f0000000-0000-4000-8000-000000000001";
        let child_id = "10000000-0000-4000-8000-000000000002";
        let event = |id: &str, revises_event_id: Option<&str>| OccurrenceStatusEvent {
            behavior_id: behavior_id.into(),
            created_at: "2026-09-01T13:00:00Z".into(),
            effective_at: None,
            id: id.into(),
            local_date: "2026-09-01".into(),
            occurrence_id: occurrence_id.into(),
            previous_status: Some(
                if revises_event_id.is_some() {
                    "completed"
                } else {
                    "unresolved"
                }
                .into(),
            ),
            reason_code: None,
            recorded_at: "2026-09-01T13:00:00Z".into(),
            revises_event_id: revises_event_id.map(str::to_string),
            source_capture_method: "manual".into(),
            source_confidence: "declared".into(),
            status: "completed".into(),
            status_semantics: "explicit_user_mark".into(),
            timezone: "America/New_York".into(),
            updated_at: "2026-09-01T13:00:00Z".into(),
            user_id: profile.clone(),
        };
        let child = event(child_id, Some(parent_id));
        let parent = event(parent_id, None);
        apply_first_link(
            &connection,
            &profile,
            &[
                AccountSyncWrite {
                    kind: AccountSyncEntityKind::StatusEvent,
                    id: child.id.clone(),
                    operation: AccountSyncOperation::Upsert,
                    expected: None,
                    value: Some(normalized(&child).unwrap()),
                },
                AccountSyncWrite {
                    kind: AccountSyncEntityKind::StatusEvent,
                    id: parent.id.clone(),
                    operation: AccountSyncOperation::Upsert,
                    expected: None,
                    value: Some(normalized(&parent).unwrap()),
                },
            ],
        )
        .unwrap();
        assert_eq!(
            db::by_id::<OccurrenceStatusEvent>(&connection, &profile, child_id)
                .unwrap()
                .revises_event_id
                .as_deref(),
            Some(parent_id)
        );
    }

    #[test]
    fn account_sync_replaces_an_untouched_duplicate_schedule_identity() {
        let (_directory, connection, profile, category) = database();
        let behavior_id = "50000000-0000-4000-8000-000000000001";
        let occurrence_id = "50000000-0000-4000-8000-000000000002";
        connection.execute("INSERT INTO behaviors(id,user_id,category_id,title,description,recurrence_rule,scheduled_time,timezone,browser_reminder_enabled,email_reminder_enabled,reminder_offset_minutes,active,created_at,updated_at,archived_at,current_configuration_event_id) VALUES(?1,?2,?3,'Test',NULL,'{\"type\":\"daily\",\"interval\":1}','09:00:00','America/New_York',1,0,0,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL,NULL)", params![behavior_id,profile,category.id]).unwrap();
        connection.execute("INSERT INTO occurrences(id,user_id,behavior_id,behavior_configuration_event_id,behavior_schedule_slot_id,scheduled_for,local_date,schedule_kind,schedule_preset,schedule_start_time,schedule_end_time,status,completed_at,status_marked_at,note,created_at,updated_at) VALUES(?1,?2,?3,NULL,NULL,'2026-09-01T13:00:00Z','2026-09-01','exact',NULL,'09:00:00',NULL,'unresolved',NULL,NULL,NULL,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')", params![occurrence_id,profile,behavior_id]).unwrap();
        let current = db::by_id::<Occurrence>(&connection, &profile, occurrence_id).unwrap();
        let hosted_id = "50000000-0000-4000-8000-000000000099";
        let mut hosted = normalized(&current).unwrap();
        hosted["id"] = json!(hosted_id);
        let writes = vec![
            AccountSyncWrite { kind: AccountSyncEntityKind::Occurrence, id: hosted_id.into(),
                operation: AccountSyncOperation::Upsert, expected: None, value: Some(hosted) },
            AccountSyncWrite { kind: AccountSyncEntityKind::Occurrence, id: occurrence_id.into(),
                operation: AccountSyncOperation::Delete, expected: Some(normalized(&current).unwrap()), value: None },
        ];
        apply(&connection, &profile, &writes).unwrap();
        assert_eq!(connection.query_row("SELECT count(*) FROM occurrences", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(db::by_id::<Occurrence>(&connection, &profile, hosted_id).unwrap().status, "unresolved");
    }

    #[test]
    fn account_sync_deletes_all_reminder_statuses_with_their_unprotected_occurrence() {
        let (_directory, connection, profile, category) = database();
        let behavior_id = "50000000-0000-4000-8000-000000000001";
        let occurrence_id = "50000000-0000-4000-8000-000000000002";
        connection.execute("INSERT INTO behaviors(id,user_id,category_id,title,description,recurrence_rule,scheduled_time,timezone,browser_reminder_enabled,email_reminder_enabled,reminder_offset_minutes,active,created_at,updated_at,archived_at,current_configuration_event_id) VALUES(?1,?2,?3,'Test',NULL,'{\"type\":\"daily\",\"interval\":1}','09:00:00','America/New_York',1,0,0,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL,NULL)", params![behavior_id,profile,category.id]).unwrap();
        connection.execute("INSERT INTO occurrences(id,user_id,behavior_id,behavior_configuration_event_id,behavior_schedule_slot_id,scheduled_for,local_date,schedule_kind,schedule_preset,schedule_start_time,schedule_end_time,status,completed_at,status_marked_at,note,created_at,updated_at) VALUES(?1,?2,?3,NULL,NULL,'2026-09-01T13:00:00Z','2026-09-01','exact',NULL,'09:00:00',NULL,'unresolved',NULL,NULL,NULL,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')", params![occurrence_id,profile,behavior_id]).unwrap();
        for (index, status) in ["pending", "sent", "failed", "cancelled"]
            .iter()
            .enumerate()
        {
            let id = format!("50000000-0000-4000-8000-{:012}", index + 3);
            let scheduled = format!("2026-09-01T12:{index:02}:00Z");
            connection.execute("INSERT INTO reminder_deliveries(id,user_id,occurrence_id,channel,scheduled_send_at,sent_at,status,error,processing_started_at,import_run_id,imported_intervention_id,created_at,updated_at) VALUES(?1,?2,?3,'browser_push',?4,NULL,?5,NULL,NULL,NULL,NULL,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')", params![id,profile,occurrence_id,scheduled,status]).unwrap();
        }
        let occurrence = db::by_id::<Occurrence>(&connection, &profile, occurrence_id).unwrap();
        let reminders = db::read::<ReminderDelivery>(
            &connection,
            "SELECT * FROM reminder_deliveries WHERE user_id=?1 AND occurrence_id=?2 ORDER BY id",
            &[profile.clone().into(), occurrence_id.to_string().into()],
        )
        .unwrap();
        let mut writes = vec![AccountSyncWrite {
            kind: AccountSyncEntityKind::Occurrence,
            id: occurrence_id.into(),
            operation: AccountSyncOperation::Delete,
            expected: Some(normalized(&occurrence).unwrap()),
            value: None,
        }];
        writes.extend(reminders.iter().map(|reminder| AccountSyncWrite {
            kind: AccountSyncEntityKind::ReminderDelivery,
            id: reminder.id.clone(),
            operation: AccountSyncOperation::Delete,
            expected: Some(normalized(reminder).unwrap()),
            value: None,
        }));

        apply(&connection, &profile, &writes).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM occurrences WHERE id=?1",
                    [occurrence_id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM reminder_deliveries WHERE occurrence_id=?1",
                    [occurrence_id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn account_sync_rejects_orphan_and_protected_occurrence_deletes_atomically() {
        let (_directory, connection, profile, category) = database();
        let behavior_id = "60000000-0000-4000-8000-000000000001";
        let occurrence_id = "60000000-0000-4000-8000-000000000002";
        let reminder_id = "60000000-0000-4000-8000-000000000003";
        connection.execute("INSERT INTO behaviors(id,user_id,category_id,title,description,recurrence_rule,scheduled_time,timezone,browser_reminder_enabled,email_reminder_enabled,reminder_offset_minutes,active,created_at,updated_at,archived_at,current_configuration_event_id) VALUES(?1,?2,?3,'Test',NULL,'{\"type\":\"daily\",\"interval\":1}','09:00:00','America/New_York',1,0,0,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL,NULL)", params![behavior_id,profile,category.id]).unwrap();
        connection.execute("INSERT INTO occurrences(id,user_id,behavior_id,behavior_configuration_event_id,behavior_schedule_slot_id,scheduled_for,local_date,schedule_kind,schedule_preset,schedule_start_time,schedule_end_time,status,completed_at,status_marked_at,note,created_at,updated_at) VALUES(?1,?2,?3,NULL,NULL,'2026-09-01T13:00:00Z','2026-09-01','exact',NULL,'09:00:00',NULL,'unresolved',NULL,NULL,'Protected Note','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')", params![occurrence_id,profile,behavior_id]).unwrap();
        connection.execute("INSERT INTO reminder_deliveries(id,user_id,occurrence_id,channel,scheduled_send_at,sent_at,status,error,processing_started_at,import_run_id,imported_intervention_id,created_at,updated_at) VALUES(?1,?2,?3,'browser_push','2026-09-01T12:00:00Z',NULL,'failed','error',NULL,NULL,NULL,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')", params![reminder_id,profile,occurrence_id]).unwrap();
        let occurrence = db::by_id::<Occurrence>(&connection, &profile, occurrence_id).unwrap();
        let reminder = db::by_id::<ReminderDelivery>(&connection, &profile, reminder_id).unwrap();
        let reminder_value = normalized(&reminder).unwrap();
        let occurrence_delete = AccountSyncWrite {
            kind: AccountSyncEntityKind::Occurrence,
            id: occurrence_id.into(),
            operation: AccountSyncOperation::Delete,
            expected: Some(normalized(&occurrence).unwrap()),
            value: None,
        };
        let reminder_delete = AccountSyncWrite {
            kind: AccountSyncEntityKind::ReminderDelivery,
            id: reminder_id.into(),
            operation: AccountSyncOperation::Delete,
            expected: Some(reminder_value.clone()),
            value: None,
        };
        let reminder_upsert = AccountSyncWrite {
            kind: AccountSyncEntityKind::ReminderDelivery,
            id: reminder_id.into(),
            operation: AccountSyncOperation::Upsert,
            expected: Some(reminder_value.clone()),
            value: Some(reminder_value),
        };

        assert_eq!(
            apply(
                &connection,
                &profile,
                std::slice::from_ref(&reminder_delete)
            )
            .unwrap_err(),
            "Account sync can delete a reminder only with its Occurrence."
        );
        assert_eq!(
            apply(
                &connection,
                &profile,
                &[reminder_upsert, occurrence_delete.clone()]
            )
            .unwrap_err(),
            "Account sync cannot retain a reminder whose Occurrence is deleted."
        );
        assert_eq!(apply(&connection, &profile, &[reminder_delete, occurrence_delete]).unwrap_err(), "Account sync cannot delete an Occurrence with a Note, status history, tracked time, or resolved status.");
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM occurrences WHERE id=?1",
                    [occurrence_id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM reminder_deliveries WHERE id=?1",
                    [reminder_id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }
}
