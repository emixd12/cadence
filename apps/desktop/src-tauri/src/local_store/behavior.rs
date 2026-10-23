use super::{
    db::{self, error, Result},
    rows::*,
    tombstone, Definition, GraphRows,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn read_graphs(db: &Connection, profile_id: &str) -> Result<Value> {
    let behaviors = db::read::<Behavior>(
        db,
        "SELECT * FROM behaviors WHERE user_id=?1 ORDER BY active DESC,scheduled_time,title,id",
        &[profile_id.to_string().into()],
    )?;
    let schedules = db::read::<BehaviorSchedule>(
        db,
        "SELECT * FROM behavior_schedules WHERE user_id=?1 ORDER BY sort_order,id",
        &[profile_id.to_string().into()],
    )?;
    let slots = db::read::<BehaviorScheduleSlot>(
        db,
        "SELECT * FROM behavior_schedule_slots WHERE user_id=?1 ORDER BY sort_order,start_time,id",
        &[profile_id.to_string().into()],
    )?;
    let mut output = Vec::new();
    for behavior in behaviors {
        let revision = revision(db, profile_id, &behavior.id)?;
        output.push(json!({"schedules":schedules.iter().filter(|row|row.behavior_id==behavior.id).collect::<Vec<_>>(),"slots":slots.iter().filter(|row|row.behavior_id==behavior.id).collect::<Vec<_>>(),"behavior":behavior,"revision":revision}));
    }
    Ok(json!(output))
}

pub(super) fn revision(db: &Connection, profile_id: &str, behavior_id: &str) -> Result<i64> {
    db.query_row(
        "SELECT revision FROM behavior_revisions WHERE user_id=?1 AND behavior_id=?2",
        params![profile_id, behavior_id],
        |row| row.get(0),
    )
    .map_err(error)
}

pub(super) fn graph(db: &Connection, profile_id: &str, behavior_id: &str) -> Result<GraphRows> {
    Ok(GraphRows {
        behavior:db::by_id(db,profile_id,behavior_id)?,
        schedules:db::read(db,"SELECT * FROM behavior_schedules WHERE user_id=?1 AND behavior_id=?2 ORDER BY sort_order,id", &[profile_id.to_string().into(),behavior_id.to_string().into()])?,
        slots:db::read(db,"SELECT * FROM behavior_schedule_slots WHERE user_id=?1 AND behavior_id=?2 ORDER BY sort_order,start_time,id", &[profile_id.to_string().into(),behavior_id.to_string().into()])?,
    })
}

pub(super) fn validate_graph(profile_id: &str, graph: &GraphRows) -> Result<()> {
    db::validate_row(profile_id, &graph.behavior)?;
    if graph.schedules.is_empty() || graph.schedules.len() > 1000 || graph.slots.len() > 10_000 {
        return Err("A Behavior requires a bounded, nonempty schedule graph.".into());
    }
    let mut ids = HashSet::new();
    for schedule in &graph.schedules {
        db::validate_row(profile_id, schedule)?;
        if schedule.behavior_id != graph.behavior.id || !ids.insert(&schedule.id) {
            return Err("A schedule has a duplicate ID or different Behavior.".into());
        }
        if !graph
            .slots
            .iter()
            .any(|slot| slot.behavior_schedule_id.as_ref() == Some(&schedule.id))
        {
            return Err("Every schedule requires at least one time entry.".into());
        }
    }
    let mut slot_ids = HashSet::new();
    for slot in &graph.slots {
        db::validate_row(profile_id, slot)?;
        if slot.behavior_id != graph.behavior.id
            || !slot_ids.insert(&slot.id)
            || !slot
                .behavior_schedule_id
                .as_ref()
                .is_some_and(|id| ids.contains(id))
        {
            return Err("A time entry has a duplicate ID or a different schedule owner.".into());
        }
    }
    if graph.behavior.current_configuration_event_id.is_none() {
        return Err("The Behavior must identify its current configuration event.".into());
    }
    Ok(())
}

pub(super) fn validate_archive_history(before: &Behavior, next: &Behavior) -> Result<()> {
    if next.archive_notes.len() < before.archive_notes.len() {
        return Err("A Behavior update cannot remove archive history.".into());
    }
    for (old, new) in before.archive_notes.iter().zip(&next.archive_notes) {
        if old.id != new.id || old.archived_at != new.archived_at {
            return Err("A Behavior update cannot replace archive history.".into());
        }
        if old != new && before.active {
            return Err("A Behavior archive note can be edited only while archived.".into());
        }
    }
    let appended = next.archive_notes.len() - before.archive_notes.len();
    if before.active && !next.active {
        if appended != 1
            || next
                .archive_notes
                .last()
                .map(|note| note.archived_at.as_str())
                != next.archived_at.as_deref()
        {
            return Err("Archiving a Behavior requires one matching archive-history entry.".into());
        }
    } else if appended != 0 {
        return Err("Archive history can grow only when a Behavior is archived.".into());
    }
    Ok(())
}

// This is a relational projection for plan validation. TypeScript owns normalization and history decisions.
fn snapshot(graph: &GraphRows) -> Value {
    let behavior = &graph.behavior;
    let mut schedules=graph.schedules.iter().map(|schedule| {
        let mut entries=graph.slots.iter().filter(|slot|slot.behavior_schedule_id.as_ref()==Some(&schedule.id)).map(|slot|json!({"kind":slot.kind,"preset":slot.preset,"startTime":slot.start_time,"endTime":slot.end_time,"sortOrder":slot.sort_order})).collect::<Vec<_>>();
        entries.sort_by_key(|entry| (entry["sortOrder"].as_i64().unwrap_or(0),entry["startTime"].as_str().unwrap_or("").to_string(),entry.to_string()));
        json!({"recurrenceRule":schedule.recurrence_rule,"sortOrder":schedule.sort_order,"timeEntries":entries})
    }).collect::<Vec<_>>();
    schedules.sort_by_key(|schedule| {
        (
            schedule["sortOrder"].as_i64().unwrap_or(0),
            schedule.to_string(),
        )
    });
    json!({"categoryId":behavior.category_id,"locationText":behavior.location_text,"whereKind":behavior.where_kind,"scheduleGraph":schedules,"browserReminderEnabled":behavior.browser_reminder_enabled,"emailReminderEnabled":behavior.email_reminder_enabled,"reminderOffsetMinutes":behavior.reminder_offset_minutes,"active":behavior.active,"timezone":behavior.timezone})
}

fn normalize_configuration_snapshot(value: &Value) -> Value {
    let mut normalized = value.clone();
    if let Some(object) = normalized.as_object_mut() {
        object
            .entry("locationText".to_string())
            .or_insert(Value::Null);
        // Snapshots written before Ticket 215 carry only location text, which meant A place.
        let derived = if object.get("locationText").is_some_and(Value::is_string) {
            json!("place")
        } else {
            Value::Null
        };
        object.entry("whereKind".to_string()).or_insert(derived);
    }
    normalized
}

fn validate_history(
    profile_id: &str,
    before: Option<&GraphRows>,
    next: &GraphRows,
    expected_normalized: Option<&Definition>,
    definition: Option<&BehaviorDefinitionEvent>,
    configuration: Option<&BehaviorConfigurationEvent>,
) -> Result<()> {
    let previous = before.map(|graph| &graph.behavior);
    if let Some(event) = definition {
        db::validate_row(profile_id, event)?;
        if event.behavior_id != next.behavior.id
            || event.next_title != next.behavior.title
            || event.next_description != next.behavior.description
            || event.previous_title != expected_normalized.map(|row| row.title.clone())
            || event.previous_description
                != expected_normalized.and_then(|row| row.description.clone())
        {
            return Err("The definition event does not match the accepted normalized predecessor and planned next definition.".into());
        }
        if event.changed_fields.is_empty()
            || event
                .changed_fields
                .iter()
                .any(|field| !matches!(field.as_str(), "title" | "description"))
        {
            return Err("The definition event has invalid changed fields.".into());
        }
        if previous.is_none() && event.recorded_at != next.behavior.created_at {
            return Err(
                "A definition baseline must preserve the Behavior creation instant.".into(),
            );
        }
    } else if previous.is_none_or(|row| {
        row.title != next.behavior.title || row.description != next.behavior.description
    }) {
        return Err("A changed definition requires its planned history event.".into());
    }
    let next_snapshot = snapshot(next);
    if let Some(event) = configuration {
        db::validate_row(profile_id, event)?;
        let expected_previous = before.map(snapshot);
        if event.behavior_id != next.behavior.id
            || next.behavior.current_configuration_event_id.as_ref() != Some(&event.id)
            || event.previous_configuration.as_ref().map(normalize_configuration_snapshot)
                != expected_previous
            || normalize_configuration_snapshot(&event.next_configuration) != next_snapshot
            || event.timezone != next.behavior.timezone
            || event.event_kind
                != if before.is_none() {
                    "baseline"
                } else {
                    "revision"
                }
        {
            return Err(
                "The configuration event does not match the locked graph and planned next graph."
                    .into(),
            );
        }
        let allowed = [
            "category_id",
            "schedule_graph",
            "browser_reminder_enabled",
            "email_reminder_enabled",
            "reminder_offset_minutes",
            "location_text",
            "where_kind",
            "active",
            "timezone",
        ];
        if event.changed_fields.is_empty()
            || event
                .changed_fields
                .iter()
                .any(|field| !allowed.contains(&field.as_str()))
        {
            return Err("The configuration event has invalid changed fields.".into());
        }
    } else if before.is_none_or(|row| {
        snapshot(row) != next_snapshot
            || row.behavior.current_configuration_event_id
                != next.behavior.current_configuration_event_id
    }) {
        return Err("A changed configuration requires its planned history event.".into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn write_graph(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    next: &GraphRows,
    expected_revision: Option<i64>,
    expected_normalized: Option<&Definition>,
    definition: Option<&BehaviorDefinitionEvent>,
    configuration: Option<&BehaviorConfigurationEvent>,
) -> Result<Value> {
    validate_graph(profile_id, next)?;
    let before = if let Some(expected) = expected_revision {
        if revision(db, profile_id, &next.behavior.id)? != expected {
            return Err("Behavior changed. Review the latest Behavior and try again.".into());
        }
        Some(graph(db, profile_id, &next.behavior.id)?)
    } else {
        None
    };
    if before.is_none() && !next.behavior.archive_notes.is_empty() {
        return Err("A newly created Behavior cannot start with archive history.".into());
    }
    if let Some(before) = &before {
        validate_archive_history(&before.behavior, &next.behavior)?;
        if before.behavior.created_at != next.behavior.created_at {
            return Err("An edit cannot rewrite Behavior creation history.".into());
        }
        for schedule in &next.schedules {
            if before
                .schedules
                .iter()
                .find(|row| row.id == schedule.id)
                .is_some_and(|row| row.created_at != schedule.created_at)
            {
                return Err("An edit cannot rewrite retained schedule creation history.".into());
            }
        }
        for slot in &next.slots {
            if before
                .slots
                .iter()
                .find(|row| row.id == slot.id)
                .is_some_and(|row| row.created_at != slot.created_at)
            {
                return Err("An edit cannot rewrite retained time-entry creation history.".into());
            }
        }
    }
    validate_history(
        profile_id,
        before.as_ref(),
        next,
        expected_normalized,
        definition,
        configuration,
    )?;
    persist_graph(
        db,
        profile_id,
        mutation_id,
        now,
        next,
        before.as_ref(),
        expected_revision,
        &definition.into_iter().cloned().collect::<Vec<_>>(),
        &configuration.into_iter().cloned().collect::<Vec<_>>(),
        true,
    )
}

#[allow(clippy::too_many_arguments)]
fn persist_graph(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    next: &GraphRows,
    before: Option<&GraphRows>,
    expected_revision: Option<i64>,
    definitions: &[BehaviorDefinitionEvent],
    configurations: &[BehaviorConfigurationEvent],
    invalidate: bool,
) -> Result<Value> {
    if before.is_some() {
        db::update(db, profile_id, &next.behavior.id, &next.behavior)?;
    } else {
        db::insert(db, profile_id, &next.behavior)?;
    }
    for event in definitions {
        db::insert(db, profile_id, event)?;
    }
    for event in configurations {
        db::insert(db, profile_id, event)?;
    }

    // Remove only retired rows. Retained IDs preserve historical Occurrence references.
    if let Some(before) = &before {
        for slot in &before.slots {
            if !next.slots.iter().any(|next| next.id == slot.id) {
                tombstone(
                    db,
                    profile_id,
                    mutation_id,
                    now,
                    "behavior_schedule_slots",
                    &slot.id,
                )?;
                db.execute(
                    "DELETE FROM behavior_schedule_slots WHERE user_id=?1 AND id=?2",
                    params![profile_id, slot.id],
                )
                .map_err(error)?;
            }
        }
        // Reserve unique keys while retained entries exchange times. These transaction-local
        // values cannot match a validated wall time and are all replaced before commit.
        db.execute("UPDATE behavior_schedule_slots SET start_time='reserved:'||id WHERE user_id=?1 AND behavior_id=?2",params![profile_id,next.behavior.id]).map_err(error)?;
    }
    for schedule in &next.schedules {
        if before
            .as_ref()
            .is_some_and(|before| before.schedules.iter().any(|row| row.id == schedule.id))
        {
            db::update(db, profile_id, &schedule.id, schedule)?;
        } else {
            db::insert(db, profile_id, schedule)?;
        }
    }
    // Duplicate start-time conflicts reject atomically, including any invalid ID moves.
    for slot in &next.slots {
        if before
            .as_ref()
            .is_some_and(|before| before.slots.iter().any(|row| row.id == slot.id))
        {
            db::update(db, profile_id, &slot.id, slot)?;
        } else {
            db::insert(db, profile_id, slot)?;
        }
    }
    if let Some(before) = &before {
        // Relocate retained slots first; removing their previous parent must not cascade them.
        for schedule in &before.schedules {
            if !next.schedules.iter().any(|next| next.id == schedule.id) {
                tombstone(
                    db,
                    profile_id,
                    mutation_id,
                    now,
                    "behavior_schedules",
                    &schedule.id,
                )?;
                db.execute(
                    "DELETE FROM behavior_schedules WHERE user_id=?1 AND id=?2",
                    params![profile_id, schedule.id],
                )
                .map_err(error)?;
            }
        }
    }
    let next_revision = expected_revision.unwrap_or(0) + 1;
    db.execute("INSERT INTO behavior_revisions(user_id,behavior_id,revision) VALUES (?1,?2,?3) ON CONFLICT(behavior_id) DO UPDATE SET revision=excluded.revision",params![profile_id,next.behavior.id,next_revision]).map_err(error)?;
    if invalidate {
        db.execute("UPDATE occurrence_sync_state SET stale=1,stale_reason='behavior_changed',state_version=state_version+1,updated_at=?2 WHERE user_id=?1",params![profile_id,now]).map_err(error)?;
    }
    let mut result = serde_json::to_value(graph(db, profile_id, &next.behavior.id)?)
        .map_err(|_| "The saved graph could not be encoded.")?;
    result["revision"] = json!(next_revision);
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn write_import_graph(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    next: &GraphRows,
    expected_revision: Option<i64>,
    configurations: &[BehaviorConfigurationEvent],
    definitions: &[BehaviorDefinitionEvent],
) -> Result<()> {
    validate_graph(profile_id, next)?;
    let before = if let Some(expected) = expected_revision {
        if revision(db, profile_id, &next.behavior.id)? != expected {
            return Err("Behavior changed after import preview.".into());
        }
        Some(graph(db, profile_id, &next.behavior.id)?)
    } else {
        None
    };
    if let Some(before) = &before {
        if before.behavior.created_at != next.behavior.created_at {
            return Err("Restore cannot change an existing Behavior creation instant.".into());
        }
        for row in &next.schedules {
            if before
                .schedules
                .iter()
                .find(|old| old.id == row.id)
                .is_some_and(|old| old.created_at != row.created_at)
            {
                return Err("Restore cannot change retained schedule creation history.".into());
            }
        }
        for row in &next.slots {
            if before
                .slots
                .iter()
                .find(|old| old.id == row.id)
                .is_some_and(|old| old.created_at != row.created_at)
            {
                return Err("Restore cannot change retained time-entry creation history.".into());
            }
        }
    }
    if before.as_ref().is_none_or(|old| {
        old.behavior.title != next.behavior.title
            || old.behavior.description != next.behavior.description
    }) && !definitions.iter().any(|event| {
        event.behavior_id == next.behavior.id
            && event.next_title == next.behavior.title
            && event.next_description == next.behavior.description
    }) {
        return Err("An imported definition change requires its append-only history event.".into());
    }
    let mut previous = before.as_ref().map(snapshot);
    let mut pointer = before
        .as_ref()
        .and_then(|graph| graph.behavior.current_configuration_event_id.clone());
    for event in configurations {
        db::validate_row(profile_id, event)?;
        if event.behavior_id != next.behavior.id
            || event.source != "import"
            || event.previous_configuration.as_ref().map(normalize_configuration_snapshot)
                != previous
            || event.event_kind
                != if previous.is_none() {
                    "baseline"
                } else {
                    "revision"
                }
            || event.next_configuration["timezone"] != event.timezone
            || event.changed_fields.is_empty()
        {
            return Err(
                "Imported configuration history does not follow the locked prior graph.".into(),
            );
        }
        previous = Some(normalize_configuration_snapshot(&event.next_configuration));
        pointer = Some(event.id.clone());
    }
    if previous != Some(snapshot(next)) || pointer != next.behavior.current_configuration_event_id {
        return Err(
            "Imported current configuration must match the final graph and lineage pointer.".into(),
        );
    }
    persist_graph(
        db,
        profile_id,
        mutation_id,
        now,
        next,
        before.as_ref(),
        expected_revision,
        definitions,
        configurations,
        false,
    )?;
    Ok(())
}

pub fn update_timezone(db: &Connection, request: &super::Request) -> Result<Value> {
    let super::Request::UpdateProfileTimezone {
        profile_id,
        now,
        expected_timezone,
        expected_sync_version,
        timezone,
        updates,
        ..
    } = request
    else {
        return Err("Expected a timezone operation.".into());
    };
    if timezone.is_empty()
        || timezone.len() > 128
        || !timezone
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"/_+-".contains(&c))
    {
        return Err("The timezone must be a bounded timezone identifier.".into());
    }
    let profile = db::profile(db)?;
    let version: i64 = db
        .query_row(
            "SELECT state_version FROM occurrence_sync_state WHERE user_id=?1",
            [profile_id],
            |row| row.get(0),
        )
        .map_err(error)?;
    if &profile.timezone != expected_timezone || version != *expected_sync_version {
        return Err("Profile or Behavior data changed. Refresh before changing timezone.".into());
    }
    let mut changed = timezone != expected_timezone;
    let active = db::read::<Behavior>(
        db,
        "SELECT * FROM behaviors WHERE user_id=?1 AND active=1",
        &[profile_id.clone().into()],
    )?;
    let expected_ids: HashSet<_> = active.iter().map(|row| row.id.as_str()).collect();
    let planned_ids: HashSet<_> = updates
        .iter()
        .map(|update| update.graph.behavior.id.as_str())
        .collect();
    if updates.len() != expected_ids.len() || planned_ids != expected_ids {
        return Err("The timezone plan must include every active Behavior exactly once.".into());
    }
    for update in updates {
        let next = &update.graph;
        if revision(db, profile_id, &next.behavior.id)? != update.expected_revision {
            return Err("Behavior changed. Refresh the timezone plan.".into());
        }
        let before = graph(db, profile_id, &next.behavior.id)?;
        let Some(event) = &update.configuration_event else {
            if before.behavior.timezone != *timezone || next != &before {
                return Err("A timezone no-op must preserve the exact graph already using the target timezone.".into());
            }
            continue;
        };
        if before.behavior.timezone == *timezone {
            return Err(
                "A Behavior already using this timezone must not create a revision.".into(),
            );
        }
        let mut expected = before.clone();
        expected.behavior.timezone = timezone.clone();
        expected.behavior.current_configuration_event_id = Some(event.id.clone());
        expected.behavior.updated_at = now.clone();
        if &expected != next || event.changed_fields != ["timezone"] {
            return Err(
                "A timezone operation cannot change other Behavior fields or schedules.".into(),
            );
        }
        validate_graph(profile_id, next)?;
        validate_history(profile_id, Some(&before), next, None, None, Some(event))?;
        db::insert(db, profile_id, event)?;
        db::update(db, profile_id, &next.behavior.id, &next.behavior)?;
        db.execute(
            "UPDATE behavior_revisions SET revision=revision+1 WHERE user_id=?1 AND behavior_id=?2",
            params![profile_id, next.behavior.id],
        )
        .map_err(error)?;
        changed = true;
    }
    if !changed {
        return Ok(json!(profile));
    }
    db.execute(
        "UPDATE profiles SET timezone=?2,updated_at=?3 WHERE id=?1",
        params![profile_id, timezone, now],
    )
    .map_err(error)?;
    db.execute("UPDATE occurrence_sync_state SET stale=1,stale_reason='timezone_changed',state_version=state_version+1,updated_at=?2 WHERE user_id=?1",params![profile_id,now]).map_err(error)?;
    Ok(json!(db::profile(db)?))
}
