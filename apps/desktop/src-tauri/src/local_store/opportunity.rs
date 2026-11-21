// Behaviors of Opportunity (docs/RECURRENCE_RULES.md, "Behaviors of Opportunity"): the
// local writers of added Occurrences, with the hosted add_opportunity_occurrence and
// remove_opportunity_occurrence rules. TypeScript plans the row (today in the Behavior
// timezone, the instant, the exact run check); this module refuses a stale or malformed
// plan and keeps the write atomic with its status event, outbox entry and tombstones.
use super::{
    db::{self, error, Result},
    occurrence::run_stops_whole_day,
    rows::*,
    tombstone,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn whole_minute(time: &str) -> bool {
    time.len() == 8 && time.ends_with(":00")
}

pub fn add(
    db: &Connection,
    profile_id: &str,
    now: &str,
    occurrence: &Occurrence,
    status_event: Option<&OccurrenceStatusEvent>,
) -> Result<Value> {
    db::validate_row(profile_id, occurrence)?;
    if !occurrence.is_opportunity() {
        return Err("Only an opportunity Occurrence can be added.".into());
    }
    let added_by = occurrence.added_by.as_deref().unwrap_or_default();
    if let Some(existing) = db::read::<Occurrence>(
        db,
        "SELECT * FROM occurrences WHERE id=?1",
        &[occurrence.id.clone().into()],
    )?
    .into_iter()
    .next()
    {
        // The same planned ID and fields replay the row it made.
        if existing.user_id == profile_id
            && existing.behavior_id == occurrence.behavior_id
            && existing.is_opportunity()
            && existing.added_by == occurrence.added_by
            && existing.local_date == occurrence.local_date
            && existing.schedule_start_time == occurrence.schedule_start_time
            && existing.schedule_end_time == occurrence.schedule_end_time
            && existing.schedule_preset == occurrence.schedule_preset
        {
            return Ok(json!({"created":false,"occurrence":existing,"statusEvent":null}));
        }
        return Err("The Occurrence ID is already in use.".into());
    }
    let behavior = db::by_id::<Behavior>(db, profile_id, &occurrence.behavior_id)
        .map_err(|_| "Behavior not found.".to_string())?;
    if !behavior.is_opportunity {
        return Err("This Behavior is not available as an opportunity.".into());
    }
    if !behavior.active || behavior.archived_at.is_some() {
        return Err("An archived Behavior cannot be added.".into());
    }
    if run_stops_whole_day(&behavior, &occurrence.local_date) {
        return Err("This Behavior is not running at that time.".into());
    }
    if !whole_minute(&occurrence.schedule_start_time)
        || occurrence
            .schedule_end_time
            .as_deref()
            .is_some_and(|end| !whole_minute(end))
    {
        return Err("Opportunity times must be whole minutes.".into());
    }
    match occurrence.schedule_kind.as_str() {
        "exact" if occurrence.schedule_preset.is_some() => {
            return Err("An exact time cannot have a time-of-day preset.".into())
        }
        "range" if occurrence.schedule_end_time.as_ref() == Some(&occurrence.schedule_start_time) => {
            return Err("A time range needs an end that differs from its start.".into())
        }
        _ => {}
    }
    if occurrence.behavior_schedule_slot_id.is_some()
        || occurrence.behavior_configuration_event_id != behavior.current_configuration_event_id
        || occurrence.note.is_some()
    {
        return Err("An added Occurrence must carry the current Behavior lineage and no schedule or note.".into());
    }
    match status_event {
        None => {
            if occurrence.status != "unresolved"
                || occurrence.completed_at.is_some()
                || occurrence.status_marked_at.is_some()
            {
                return Err("An added Occurrence starts Unresolved unless it is Done now.".into());
            }
        }
        Some(event) => {
            if added_by == "daily_brief" {
                return Err("A Daily Brief suggestion cannot mark an Occurrence Completed.".into());
            }
            db::validate_row(profile_id, event)?;
            let method = if added_by == "user" { "manual_tap" } else { "manual_text" };
            if occurrence.status != "completed"
                || occurrence.completed_at.as_deref() != Some(now)
                || occurrence.status_marked_at.as_deref() != Some(now)
                || event.occurrence_id != occurrence.id
                || event.behavior_id != occurrence.behavior_id
                || event.previous_status.as_deref() != Some("unresolved")
                || event.status != "completed"
                || event.status_semantics != "explicit_user_mark"
                || event.source_capture_method != method
                || event.source_confidence != "high"
                || event.local_date != occurrence.local_date
                || event.timezone != behavior.timezone
                || event.revises_event_id.is_some()
                || event.reason_code.is_some()
                || event.recorded_at != now
                || event.effective_at.as_deref() != Some(now)
            {
                return Err("Done now must store Completed now with its status event.".into());
            }
        }
    }
    db::insert(db, profile_id, occurrence)?;
    if let Some(event) = status_event {
        db::insert(db, profile_id, event)?;
    }
    Ok(json!({"created":true,"occurrence":occurrence,"statusEvent":status_event}))
}

pub fn remove(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    occurrence_id: &str,
) -> Result<Value> {
    db::valid_id(occurrence_id)?;
    let occurrence = db::by_id::<Occurrence>(db, profile_id, occurrence_id)
        .map_err(|_| "Occurrence not found.".to_string())?;
    if !occurrence.is_opportunity() {
        return Err("Only an added opportunity can be removed.".into());
    }
    if occurrence.status != "unresolved" {
        return Err("Only an Unresolved opportunity can be removed.".into());
    }
    if !occurrence.note.as_deref().unwrap_or("").trim().is_empty() {
        return Err("An opportunity with a Note cannot be removed.".into());
    }
    let exists = |sql: &str| -> Result<bool> {
        db.query_row(sql, params![profile_id, occurrence_id], |row| row.get(0))
            .map_err(error)
    };
    if exists("SELECT EXISTS(SELECT 1 FROM occurrence_time_sessions WHERE user_id=?1 AND occurrence_id=?2)")? {
        return Err("An opportunity with tracked time cannot be removed.".into());
    }
    if exists("SELECT EXISTS(SELECT 1 FROM occurrence_status_events WHERE user_id=?1 AND occurrence_id=?2)")? {
        return Err("An opportunity with status history cannot be removed.".into());
    }
    if exists("SELECT EXISTS(SELECT 1 FROM occurrence_source_matches WHERE user_id=?1 AND occurrence_id=?2 AND state='active')")? {
        return Err("An opportunity with a connected activity cannot be removed.".into());
    }
    let cancelled = db
        .execute(
            "UPDATE reminder_deliveries SET status='cancelled',error=NULL,updated_at=?3 WHERE user_id=?1 AND occurrence_id=?2 AND status='pending'",
            params![profile_id, occurrence_id, now],
        )
        .map_err(error)?
        + db
            .execute(
                "UPDATE native_reminder_state SET status='cancelled',error=NULL,verified_at=NULL,updated_at=?3 WHERE user_id=?1 AND occurrence_id=?2 AND status IN ('planned','scheduled')",
                params![profile_id, occurrence_id, now],
            )
            .map_err(error)?;
    // The row and its reminder rows leave together, as a generation delete does.
    for table in ["reminder_deliveries", "native_reminder_state"] {
        let mut statement = db
            .prepare(&format!(
                "SELECT id FROM {table} WHERE user_id=?1 AND occurrence_id=?2"
            ))
            .map_err(error)?;
        let child_ids = statement
            .query_map(params![profile_id, occurrence_id], |row| row.get::<_, String>(0))
            .map_err(error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(error)?;
        for id in child_ids {
            tombstone(db, profile_id, mutation_id, now, table, &id)?;
        }
    }
    tombstone(db, profile_id, mutation_id, now, "occurrences", occurrence_id)?;
    db.execute(
        "DELETE FROM occurrences WHERE user_id=?1 AND id=?2",
        params![profile_id, occurrence_id],
    )
    .map_err(error)?;
    Ok(json!({"removed":true,"occurrence":occurrence,"cancelledReminderCount":cancelled}))
}
