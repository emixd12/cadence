use super::{
    db::{self, error, Result},
    rows::*,
    tombstone, Request,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn read_occurrences(
    db: &Connection,
    profile_id: &str,
    start: &str,
    end: &str,
    behavior_id: Option<&str>,
    status: Option<&str>,
) -> Result<Value> {
    db::valid_date(start)?;
    db::valid_date(end)?;
    if start > end {
        return Err("The occurrence date range is reversed.".into());
    }
    if let Some(id) = behavior_id {
        db::valid_id(id)?;
    }
    if status.is_some_and(|value| !valid_status(value)) {
        return Err("Invalid occurrence status filter.".into());
    }
    Ok(json!(db::read::<Occurrence>(db,"SELECT * FROM occurrences WHERE user_id=?1 AND local_date>=?2 AND local_date<=?3 AND (?4 IS NULL OR behavior_id=?4) AND (?5 IS NULL OR status=?5) ORDER BY local_date,scheduled_for,id", &[profile_id.to_string().into(),start.to_string().into(),end.to_string().into(),behavior_id.map_or(rusqlite::types::Value::Null,|value|value.to_string().into()),status.map_or(rusqlite::types::Value::Null,|value|value.to_string().into())])?))
}

pub fn read_history(db: &Connection, profile_id: &str, occurrence_ids: &[String]) -> Result<Value> {
    if occurrence_ids.len() > db::READ_LIMIT {
        return Err("The occurrence history request exceeds 100,000 IDs.".into());
    }
    for id in occurrence_ids {
        db::valid_id(id)?;
    }
    let mut ids = occurrence_ids.to_vec();
    ids.sort();
    ids.dedup();
    let mut events = history_rows::<OccurrenceStatusEvent>(db, profile_id, &ids)?;
    events.sort_by_key(|row| {
        (
            db::instant_key(&row.recorded_at).unwrap_or_default(),
            db::instant_key(&row.created_at).unwrap_or_default(),
            row.id.clone(),
        )
    });
    let mut sessions = history_rows::<OccurrenceTimeSession>(db, profile_id, &ids)?;
    sessions.sort_by_key(|row| {
        (
            db::instant_key(&row.started_at).unwrap_or_default(),
            row.id.clone(),
        )
    });
    Ok(json!({"statusEvents":events,"timeSessions":sessions}))
}

fn history_rows<T: StoredRow>(db: &Connection, profile_id: &str, ids: &[String]) -> Result<Vec<T>> {
    let mut output = Vec::new();
    for batch in ids.chunks(500) {
        let placeholders = vec!["?"; batch.len()].join(",");
        let mut values = vec![rusqlite::types::Value::Text(profile_id.into())];
        values.extend(batch.iter().cloned().map(rusqlite::types::Value::Text));
        let rows = db::read::<T>(
            db,
            &format!(
                "SELECT * FROM {} WHERE user_id=? AND occurrence_id IN ({placeholders})",
                T::TABLE
            ),
            &values,
        )?;
        if output.len() + rows.len() > db::READ_LIMIT {
            return Err(
                "The local history exceeds 100,000 rows; no partial result was returned.".into(),
            );
        }
        output.extend(rows);
    }
    Ok(output)
}

fn protected(
    db: &Connection,
    profile_id: &str,
    row: &Occurrence,
    now: &str,
    allow_elapsed: bool,
) -> Result<bool> {
    let has_session:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM occurrence_time_sessions WHERE user_id=?1 AND occurrence_id=?2)",params![profile_id,row.id],|row|row.get(0)).map_err(error)?;
    Ok(row.status != "unresolved"
        || (!allow_elapsed && db::instant_key(&row.scheduled_for)? <= db::instant_key(now)?)
        || !row
            .note
            .as_deref()
            .unwrap_or("")
            .trim_matches(' ')
            .is_empty()
        || has_session)
}

fn generated_row(
    profile_id: &str,
    behavior_id: &str,
    configuration_id: &str,
    row: &Occurrence,
) -> Result<()> {
    db::validate_row(profile_id, row)?;
    if row.behavior_id != behavior_id
        || row.behavior_configuration_event_id.as_deref() != Some(configuration_id)
        || row.status != "unresolved"
        || row.completed_at.is_some()
        || row.status_marked_at.is_some()
        || row.note.is_some()
    {
        return Err("A generated Occurrence must be unresolved with current owned lineage and no status or note history.".into());
    }
    Ok(())
}

pub fn generate(db: &Connection, request: &Request) -> Result<Value> {
    let Request::ApplyOccurrenceGeneration {
        profile_id,
        mutation_id,
        now,
        behavior_id,
        expected_configuration_event_id,
        create,
        update,
        delete,
    } = request
    else {
        return Err("Invalid occurrence operation.".into());
    };
    let behavior: Behavior = db::by_id(db, profile_id, behavior_id)?;
    if behavior.current_configuration_event_id.as_ref() != Some(expected_configuration_event_id) {
        return Err("Behavior configuration changed after occurrence planning.".into());
    }
    if behavior.end_date.as_ref().is_some_and(|end| {
        create.iter().any(|row| &row.local_date >= end)
            || update
                .iter()
                .any(|replacement| &replacement.next.local_date >= end)
    }) {
        return Err("Behavior end date changed after occurrence planning.".into());
    }
    if create.len() + update.len() + delete.len() > db::READ_LIMIT {
        return Err("The generation plan exceeds 100,000 rows.".into());
    }
    let mut ids = HashSet::new();
    for row in create {
        generated_row(
            profile_id,
            behavior_id,
            expected_configuration_event_id,
            row,
        )?;
        if !ids.insert(&row.id) {
            return Err("An occurrence generation plan repeats an ID.".into());
        }
    }
    for replacement in update {
        let before: Occurrence = db::by_id(db, profile_id, &replacement.expected.id)?;
        let next = &replacement.next;
        db::validate_row(profile_id, next)?;
        if !ids.insert(&next.id)
            || before != replacement.expected
            || next.id != before.id
            || before.behavior_id != *behavior_id
            || next.behavior_id != *behavior_id
            || protected(db, profile_id, &before, now, false)?
            || before.behavior_configuration_event_id.is_none()
            || next.behavior_configuration_event_id.as_ref()
                != Some(expected_configuration_event_id)
        {
            return Err("An occurrence update target changed or is protected.".into());
        }
        if next.created_at != before.created_at
            || next.status != before.status
            || next.note != before.note
            || next.completed_at != before.completed_at
            || next.status_marked_at != before.status_marked_at
            || next.local_date != before.local_date
            || next.schedule_start_time != before.schedule_start_time
            || next.schedule_kind != before.schedule_kind
            || next.schedule_end_time != before.schedule_end_time
        {
            return Err("An occurrence generation update cannot rewrite status, note, creation, or range identity.".into());
        }
    }
    for expected in delete {
        let before: Occurrence = db::by_id(db, profile_id, &expected.id)?;
        if !ids.insert(&expected.id)
            || before != *expected
            || before.behavior_id != *behavior_id
            || protected(
                db,
                profile_id,
                &before,
                now,
                behavior
                    .end_date
                    .as_ref()
                    .is_some_and(|end| &before.local_date >= end),
            )?
        {
            return Err("An occurrence delete target changed or is protected.".into());
        }
    }
    // Stale inserts fail instead of ignoring unique conflicts; the whole plan and outbox roll back.
    for row in create {
        db::insert(db, profile_id, row)?;
    }
    for replacement in update {
        db::update(db, profile_id, &replacement.next.id, &replacement.next)?;
    }
    for row in delete {
        for table in [
            "reminder_deliveries",
            "native_reminder_state",
            "occurrence_status_events",
        ] {
            let mut statement = db
                .prepare(&format!(
                    "SELECT id FROM {table} WHERE user_id=?1 AND occurrence_id=?2"
                ))
                .map_err(error)?;
            let child_ids = statement
                .query_map(params![profile_id, row.id], |row| row.get::<_, String>(0))
                .map_err(error)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(error)?;
            for id in child_ids {
                tombstone(db, profile_id, mutation_id, now, table, &id)?;
            }
        }
        tombstone(db, profile_id, mutation_id, now, "occurrences", &row.id)?;
        db.execute(
            "DELETE FROM occurrences WHERE user_id=?1 AND id=?2",
            params![profile_id, row.id],
        )
        .map_err(error)?;
    }
    Ok(
        json!({"insertedCount":create.len(),"updatedCount":update.len(),"deletedCount":delete.len()}),
    )
}

fn latest_event(
    db: &Connection,
    profile_id: &str,
    occurrence_id: &str,
) -> Result<Option<OccurrenceStatusEvent>> {
    let mut events = db::read::<OccurrenceStatusEvent>(
        db,
        "SELECT * FROM occurrence_status_events WHERE user_id=?1 AND occurrence_id=?2",
        &[
            profile_id.to_string().into(),
            occurrence_id.to_string().into(),
        ],
    )?;
    events.sort_by_key(|row| {
        (
            db::instant_key(&row.recorded_at).unwrap_or_default(),
            db::instant_key(&row.created_at).unwrap_or_default(),
            row.id.clone(),
        )
    });
    Ok(events.pop())
}

fn valid_status(value: &str) -> bool {
    matches!(value, "unresolved" | "completed" | "not_completed")
}

pub fn status(db: &Connection, request: &Request) -> Result<Value> {
    let Request::ApplyStatusTransition {
        profile_id,
        now,
        occurrence_id,
        expected_status,
        expected_latest_event_id,
        status,
        completed_at,
        status_marked_at,
        cancel_pending_reminders,
        event,
        ..
    } = request
    else {
        return Err("Invalid status operation.".into());
    };
    if !valid_status(expected_status)
        || !valid_status(status)
        || *cancel_pending_reminders != (status != "unresolved")
    {
        return Err("The status plan has invalid status or reminder-cancellation intent.".into());
    }
    let mut current: Occurrence = db::by_id(db, profile_id, occurrence_id)?;
    let latest = latest_event(db, profile_id, occurrence_id)?;
    if current.status != *expected_status {
        if current.status == *status
            && latest.as_ref().is_some_and(|latest| {
                latest.previous_status.as_ref() == Some(expected_status)
                    && latest.status == *status
                    && latest.revises_event_id == *expected_latest_event_id
                    && event
                        .as_ref()
                        .is_some_and(|event| event.status_semantics == latest.status_semantics)
            })
        {
            return Ok(
                json!({"statusChanged":false,"concurrentDuplicate":true,"occurrence":current,"statusEvent":null}),
            );
        }
        return Err("Occurrence status changed. Review the latest status and try again.".into());
    }
    if latest.as_ref().map(|event| &event.id) != expected_latest_event_id.as_ref() {
        return Err(
            "Occurrence status history changed. Review the latest status and try again.".into(),
        );
    }
    match status.as_str() {
        "unresolved" if completed_at.is_some() || status_marked_at.is_some() => {
            return Err("Unresolved snapshots cannot keep status timestamps.".into())
        }
        "completed" if completed_at.is_none() || status_marked_at.is_none() => {
            return Err("Completed snapshots require both status timestamps.".into())
        }
        "not_completed" if completed_at.is_some() || status_marked_at.is_none() => {
            return Err("Not Completed snapshots require only a status-mark timestamp.".into())
        }
        _ => (),
    }
    for instant in [completed_at, status_marked_at].into_iter().flatten() {
        db::instant_key(instant)?;
    }
    let changed = current.status != *status;
    if changed {
        let event = event
            .as_ref()
            .ok_or("A changed status requires its planned event.")?;
        db::validate_row(profile_id, event)?;
        let behavior: Behavior = db::by_id(db, profile_id, &current.behavior_id)?;
        let semantics = if expected_status == "unresolved" && expected_latest_event_id.is_none() {
            "explicit_user_mark"
        } else {
            "explicit_user_correction"
        };
        if event.occurrence_id != current.id
            || event.behavior_id != current.behavior_id
            || event.previous_status.as_ref() != Some(expected_status)
            || event.status != *status
            || event.revises_event_id != *expected_latest_event_id
            || event.status_semantics != semantics
            || event.source_capture_method != "manual_tap"
            || event.source_confidence != "high"
            || event.local_date != current.local_date
            || event.timezone != behavior.timezone
            || event.reason_code.is_some()
        {
            return Err(
                "The status event does not match the accepted transition and owned Occurrence."
                    .into(),
            );
        }
        let expected_effective = if status == "completed" {
            completed_at
        } else if status == "not_completed" {
            status_marked_at
        } else {
            &None
        };
        if event.effective_at != *expected_effective
            || (status != "unresolved" && Some(&event.recorded_at) != status_marked_at.as_ref())
        {
            return Err("The status event timestamps do not match the snapshot plan.".into());
        }
        db::insert(db, profile_id, event)?;
    } else {
        if event.is_some() {
            return Err("An unchanged status cannot append history.".into());
        }
        if current
            .completed_at
            .as_ref()
            .is_some_and(|value| Some(value) != completed_at.as_ref())
            || current
                .status_marked_at
                .as_ref()
                .is_some_and(|value| Some(value) != status_marked_at.as_ref())
        {
            return Err("An unchanged status cannot rewrite existing timestamps.".into());
        }
    }
    current.status = status.clone();
    current.completed_at = completed_at.clone();
    current.status_marked_at = status_marked_at.clone();
    current.updated_at = now.clone();
    db::update(db, profile_id, occurrence_id, &current)?;
    if status != "completed" {
        // Ticket 216: leaving Completed deletes the occurrence's place label.
        super::place_labels::delete_label(db, profile_id, occurrence_id)?;
    }
    if *cancel_pending_reminders {
        db.execute("UPDATE reminder_deliveries SET status='cancelled',error=NULL,updated_at=?3 WHERE user_id=?1 AND occurrence_id=?2 AND status='pending'",params![profile_id,occurrence_id,now]).map_err(error)?;
        db.execute("UPDATE native_reminder_state SET status='cancelled',error=NULL,verified_at=NULL,updated_at=?3 WHERE user_id=?1 AND occurrence_id=?2 AND status IN ('planned','scheduled')",params![profile_id,occurrence_id,now]).map_err(error)?;
    }
    Ok(
        json!({"statusChanged":changed,"concurrentDuplicate":false,"occurrence":current,"statusEvent":event}),
    )
}

pub fn note(
    db: &Connection,
    profile_id: &str,
    now: &str,
    occurrence_id: &str,
    expected_note: &Option<String>,
    note: &Option<String>,
    used_shortcut: bool,
) -> Result<Value> {
    if note.as_ref().is_some_and(|text| text.len() > 1_048_576) {
        return Err("The note exceeds one MiB.".into());
    }
    let mut row: Occurrence = db::by_id(db, profile_id, occurrence_id)?;
    if row.note != *expected_note {
        return Err("The Occurrence note changed. Review it before saving again.".into());
    }
    row.note = note.clone();
    row.updated_at = now.into();
    db::update(db, profile_id, occurrence_id, &row)?;
    if used_shortcut {
        let existing = db::read::<NoteShortcutState>(
            db,
            "SELECT * FROM note_shortcut_states WHERE user_id=?1 AND id=?2",
            &[
                profile_id.to_string().into(),
                row.behavior_id.clone().into(),
            ],
        )?
        .into_iter()
        .next();
        let insert = existing.is_none();
        let mut state = existing.unwrap_or_else(|| NoteShortcutState {
            id: row.behavior_id.clone(),
            user_id: profile_id.into(),
            behavior_id: Some(row.behavior_id.clone()),
            enabled: false,
            entries: vec![],
            excluded_occurrence_ids: vec![],
            revision: 0,
            updated_at: now.into(),
        });
        if !state
            .excluded_occurrence_ids
            .iter()
            .any(|id| id == occurrence_id)
        {
            if state.excluded_occurrence_ids.len() == 100_000 {
                return Err("Note shortcut exclusions exceed 100,000 Occurrences.".into());
            }
            state.excluded_occurrence_ids.push(occurrence_id.into());
            state.revision += 1;
            state.updated_at = now.into();
            if insert {
                db::insert(db, profile_id, &state)?;
            } else {
                db::update(db, profile_id, &state.id, &state)?;
            }
        }
    }
    Ok(json!(row))
}

pub fn start_time(
    db: &Connection,
    profile_id: &str,
    session: &OccurrenceTimeSession,
) -> Result<Value> {
    db::validate_row(profile_id, session)?;
    if session.stopped_at.is_some() {
        return Err("A new running session cannot have a stop instant.".into());
    }
    let occurrence: Occurrence = db::by_id(db, profile_id, &session.occurrence_id)?;
    if occurrence.behavior_id != session.behavior_id {
        return Err("The time session belongs to another Behavior.".into());
    }
    let running:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM occurrence_time_sessions WHERE user_id=?1 AND occurrence_id=?2 AND stopped_at IS NULL)",params![profile_id,session.occurrence_id],|row|row.get(0)).map_err(error)?;
    if running {
        return Ok(Value::Null);
    }
    db::insert(db, profile_id, session)?;
    Ok(json!(session))
}

pub fn stop_time(
    db: &Connection,
    profile_id: &str,
    now: &str,
    occurrence_id: &str,
    session_id: &str,
    stopped_at: &str,
) -> Result<Value> {
    let mut session: OccurrenceTimeSession = db::by_id(db, profile_id, session_id)?;
    if session.occurrence_id != occurrence_id {
        return Err("The session belongs to another Occurrence.".into());
    }
    if session.stopped_at.is_some() {
        return Ok(Value::Null);
    }
    if db::instant_key(stopped_at)? < db::instant_key(&session.started_at)? {
        return Err("The session stop instant precedes its start.".into());
    }
    session.stopped_at = Some(stopped_at.into());
    session.updated_at = now.into();
    db::update(db, profile_id, session_id, &session)?;
    Ok(json!(session))
}

pub fn reset_time(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    occurrence_id: &str,
    expected: &[OccurrenceTimeSession],
) -> Result<Value> {
    let _: Occurrence = db::by_id(db, profile_id, occurrence_id)?;
    let mut current = db::read::<OccurrenceTimeSession>(
        db,
        "SELECT * FROM occurrence_time_sessions WHERE user_id=?1 AND occurrence_id=?2",
        &[
            profile_id.to_string().into(),
            occurrence_id.to_string().into(),
        ],
    )?;
    current.sort_by(|a, b| a.id.cmp(&b.id));
    let mut expected = expected.to_vec();
    expected.sort_by(|a, b| a.id.cmp(&b.id));
    if current != expected {
        return Err("Time sessions changed before reset. Review the current sessions.".into());
    }
    for session in &current {
        tombstone(
            db,
            profile_id,
            mutation_id,
            now,
            "occurrence_time_sessions",
            &session.id,
        )?;
    }
    db.execute(
        "DELETE FROM occurrence_time_sessions WHERE user_id=?1 AND occurrence_id=?2",
        params![profile_id, occurrence_id],
    )
    .map_err(error)?;
    Ok(json!({"deletedIds":current.iter().map(|row|&row.id).collect::<Vec<_>>()}))
}

pub fn sync_state(
    db: &Connection,
    profile_id: &str,
    now: &str,
    expected_version: i64,
    state: &OccurrenceSyncState,
) -> Result<Value> {
    db::validate_row(profile_id, state)?;
    let current = db::owned::<OccurrenceSyncState>(db, profile_id)?
        .into_iter()
        .next()
        .ok_or("Occurrence sync state is unavailable.")?;
    if current.state_version != expected_version {
        return Err("Occurrence sync state changed during planning.".into());
    }
    if state.created_at != current.created_at || state.timezone != db::profile(db)?.timezone {
        return Err("The sync plan has a different creation instant or profile timezone.".into());
    }
    if [
        state.last_sync_behavior_count,
        state.last_sync_created_count,
        state.last_sync_updated_count,
        state.last_sync_deleted_count,
    ]
    .iter()
    .any(|count| *count < 0)
    {
        return Err("Sync counts cannot be negative.".into());
    }
    if !state.stale {
        if state.last_synced_local_date.is_none()
            || state.synced_through_local_date.is_none()
            || state.last_successful_sync_at.is_none()
        {
            return Err("Fresh sync state requires a verified date horizon and instant.".into());
        }
        if state.last_synced_local_date > state.synced_through_local_date {
            return Err("The sync horizon is reversed.".into());
        }
    }
    let mut next = state.clone();
    next.state_version = current.state_version + 1;
    next.updated_at = now.into();
    db.execute("UPDATE occurrence_sync_state SET timezone=?2,last_synced_local_date=?3,synced_through_local_date=?4,last_successful_sync_at=?5,stale=?6,stale_reason=?7,last_sync_behavior_count=?8,last_sync_created_count=?9,last_sync_updated_count=?10,last_sync_deleted_count=?11,state_version=?12,updated_at=?13 WHERE user_id=?1",params![profile_id,next.timezone,next.last_synced_local_date,next.synced_through_local_date,next.last_successful_sync_at,next.stale,next.stale_reason,next.last_sync_behavior_count,next.last_sync_created_count,next.last_sync_updated_count,next.last_sync_deleted_count,next.state_version,next.updated_at]).map_err(error)?;
    Ok(json!(next))
}
