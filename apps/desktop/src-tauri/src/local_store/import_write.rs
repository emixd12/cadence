use super::{
    behavior,
    db::{self, error, Result},
    import::{ImportMode, LocalImportWritePlan, RowWrite},
    rows::*,
    tombstone,
};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet, VecDeque};

fn row_id<T: StoredRow>(row: &T) -> Result<String> {
    serde_json::to_value(row).map_err(|_| "The imported row could not be encoded.")?["id"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "An imported row requires an ID.".into())
}
fn exists<T: StoredRow>(db: &Connection, profile: &str, id: &str) -> Result<bool> {
    db.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM {} WHERE user_id=?1 AND id=?2)",
            T::TABLE
        ),
        params![profile, id],
        |row| row.get(0),
    )
    .map_err(error)
}
fn unique_rows<T: StoredRow>(profile: &str, rows: &[T]) -> Result<()> {
    if rows.len() > db::READ_LIMIT {
        return Err("An import collection exceeds100,000 rows.".into());
    }
    let mut ids = HashSet::new();
    for row in rows {
        db::validate_row(profile, row)?;
        if !ids.insert(row_id(row)?) {
            return Err("An import collection contains duplicate row IDs.".into());
        }
    }
    Ok(())
}
fn expected<T: StoredRow + PartialEq>(db: &Connection, profile: &str, row: &T) -> Result<()> {
    db::validate_row(profile, row)?;
    if db::by_id::<T>(db, profile, &row_id(row)?)? != *row {
        return Err("A record changed after import preview.".into());
    }
    Ok(())
}
fn validate_writes<T: StoredRow + PartialEq>(
    db: &Connection,
    profile: &str,
    writes: &[RowWrite<T>],
    deletes: &[T],
) -> Result<()> {
    if writes.len() > db::READ_LIMIT {
        return Err("An import collection exceeds100,000 rows.".into());
    }
    unique_rows(profile, deletes)?;
    let mut ids: HashSet<String> = deletes.iter().map(row_id).collect::<Result<_>>()?;
    for row in deletes {
        expected(db, profile, row)?;
    }
    for write in writes {
        let id = row_id(&write.next)?;
        db::validate_row(profile, &write.next)?;
        if !ids.insert(id.clone()) {
            return Err("An import plan writes or deletes the same record more than once.".into());
        }
        if let Some(old) = &write.expected {
            if row_id(old)? != id {
                return Err("Import cannot replace a record with a different ID.".into());
            }
            expected(db, profile, old)?;
            let before = serde_json::to_value(old).map_err(|_| "Invalid expected import row.")?;
            let next = serde_json::to_value(&write.next).map_err(|_| "Invalid next import row.")?;
            if before["created_at"] != next["created_at"] {
                return Err("Import cannot rewrite existing record creation history.".into());
            }
        } else if exists::<T>(db, profile, &id)? {
            return Err("An import create target already exists.".into());
        }
    }
    Ok(())
}

pub fn validate(db: &Connection, profile: &str, plan: &LocalImportWritePlan) -> Result<()> {
    if plan.graph_writes.len() > db::READ_LIMIT {
        return Err("An import graph collection exceeds100,000 rows.".into());
    }
    unique_rows(profile, &plan.category_creates)?;
    unique_rows(profile, &plan.definition_events)?;
    unique_rows(profile, &plan.status_events)?;
    unique_rows(profile, &plan.mappings)?;
    validate_writes(
        db,
        profile,
        &plan.occurrence_writes,
        &plan.occurrence_deletes,
    )?;
    validate_writes(db, profile, &plan.time_session_writes, &[])?;
    validate_writes(
        db,
        profile,
        &plan.imported_note_writes,
        &plan.imported_note_deletes,
    )?;
    validate_writes(
        db,
        profile,
        &plan.imported_intervention_writes,
        &plan.imported_intervention_deletes,
    )?;
    let mut graph_ids = HashSet::new();
    for write in &plan.graph_writes {
        behavior::validate_graph(profile, &write.graph)?;
        if !graph_ids.insert(&write.graph.behavior.id) {
            return Err("An import Behavior graph is duplicated.".into());
        }
        unique_rows(profile, &write.configuration_events)?;
        if let Some(revision) = write.expected_revision {
            if behavior::revision(db, profile, &write.graph.behavior.id)? != revision {
                return Err("Behavior changed after preview.".into());
            }
            if matches!(plan.mode, ImportMode::CreateMissingOnly) {
                return Err("Create-only import cannot rewrite an existing Behavior.".into());
            }
            if !plan.mode.is_restore() {
                let before = behavior::graph(db, profile, &write.graph.behavior.id)?;
                let mut allowed = before.behavior.clone();
                allowed.current_configuration_event_id =
                    write.graph.behavior.current_configuration_event_id.clone();
                allowed.updated_at = write.graph.behavior.updated_at.clone();
                if allowed != write.graph.behavior
                    || before
                        .schedules
                        .iter()
                        .any(|old| !write.graph.schedules.contains(old))
                    || before
                        .slots
                        .iter()
                        .any(|old| !write.graph.slots.contains(old))
                {
                    return Err("Approved merge may append schedules but cannot replace existing Behavior configuration.".into());
                }
            }
        } else if exists::<Behavior>(db, profile, &write.graph.behavior.id)? {
            return Err("An imported Behavior create target already exists.".into());
        }
    }
    for event in &plan.definition_events {
        if event.source != "import"
            || event.changed_fields.is_empty()
            || event
                .changed_fields
                .iter()
                .any(|field| !matches!(field.as_str(), "title" | "description"))
            || exists::<BehaviorDefinitionEvent>(db, profile, &event.id)?
        {
            return Err("Imported definition history must append new import events.".into());
        }
    }
    for event in &plan.status_events {
        if exists::<OccurrenceStatusEvent>(db, profile, &event.id)? {
            return Err("Import cannot rewrite existing status history.".into());
        }
    }
    if !plan.mode.is_restore() {
        if !plan.occurrence_deletes.is_empty()
            || !plan.imported_note_deletes.is_empty()
            || !plan.imported_intervention_deletes.is_empty()
            || plan
                .time_session_writes
                .iter()
                .any(|row| row.expected.is_some())
            || plan
                .imported_note_writes
                .iter()
                .any(|row| row.expected.is_some())
            || plan
                .imported_intervention_writes
                .iter()
                .any(|row| row.expected.is_some())
        {
            return Err(
                "Import merge cannot delete records or replace passive history and time sessions."
                    .into(),
            );
        }
        for write in &plan.occurrence_writes {
            if let Some(old) = &write.expected {
                if matches!(plan.mode, ImportMode::CreateMissingOnly) {
                    return Err("Create-only import cannot modify existing Occurrences.".into());
                }
                let mut allowed = old.clone();
                allowed.status = write.next.status.clone();
                allowed.completed_at = write.next.completed_at.clone();
                allowed.status_marked_at = write.next.status_marked_at.clone();
                allowed.note = write.next.note.clone();
                allowed.updated_at = write.next.updated_at.clone();
                if allowed != write.next
                    || (old
                        .note
                        .as_ref()
                        .is_some_and(|note| !note.trim().is_empty())
                        && old.note != write.next.note)
                {
                    return Err(
                        "Merge must preserve existing schedule identity and nonblank notes.".into(),
                    );
                }
            }
        }
    }
    for write in &plan.time_session_writes {
        if let Some(stop) = &write.next.stopped_at {
            if db::instant_key(stop)? < db::instant_key(&write.next.started_at)? {
                return Err("Imported session stops before it starts.".into());
            }
        }
    }
    for mapping in &plan.mappings {
        if mapping.import_run_id != plan.apply_run.id || mapping.external_id.trim().is_empty() {
            return Err("Import mappings must belong to the exact apply ledger.".into());
        }
        db::valid_id(&mapping.local_id)?;
    }
    for write in &plan.imported_note_writes {
        if write.next.note_role == "ai_generated"
            || write.next.target_type == "review" && write.next.target_local_id.is_some()
        {
            return Err("Unsupported imported note target or role.".into());
        }
        if write.expected.is_none() && write.next.import_run_id != plan.apply_run.id {
            return Err("New imported notes require apply-ledger provenance.".into());
        }
    }
    for write in &plan.imported_intervention_writes {
        if write.expected.is_none() && write.next.import_run_id != plan.apply_run.id {
            return Err("New imported interventions require apply-ledger provenance.".into());
        }
    }
    Ok(())
}

fn write_rows<T: StoredRow>(db: &Connection, profile: &str, writes: &[RowWrite<T>]) -> Result<()> {
    for write in writes {
        if write.expected.is_some() {
            db::update(db, profile, &row_id(&write.next)?, &write.next)?;
        } else {
            db::insert(db, profile, &write.next)?;
        }
    }
    Ok(())
}
fn delete_rows<T: StoredRow>(
    db: &Connection,
    profile: &str,
    mutation: &str,
    now: &str,
    rows: &[T],
) -> Result<()> {
    for row in rows {
        let id = row_id(row)?;
        tombstone(db, profile, mutation, now, T::TABLE, &id)?;
        db.execute(
            &format!("DELETE FROM {} WHERE user_id=?1 AND id=?2", T::TABLE),
            params![profile, id],
        )
        .map_err(error)?;
    }
    Ok(())
}

fn append_statuses(db: &Connection, profile: &str, events: &[OccurrenceStatusEvent]) -> Result<()> {
    let by_id: HashMap<_, _> = events
        .iter()
        .map(|event| (event.id.as_str(), event))
        .collect();
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut queue = VecDeque::new();
    for event in events {
        if let Some(prior) = &event.revises_event_id {
            if let Some(previous) = by_id.get(prior.as_str()) {
                if previous.occurrence_id != event.occurrence_id {
                    return Err("A status revision must belong to the same Occurrence.".into());
                }
                children.entry(prior).or_default().push(&event.id);
            } else {
                let previous: OccurrenceStatusEvent = db::by_id(db, profile, prior)?;
                if previous.occurrence_id != event.occurrence_id {
                    return Err("A status revision must belong to the same Occurrence.".into());
                }
                queue.push_back(event.id.as_str());
            }
        } else {
            queue.push_back(event.id.as_str());
        }
    }
    let mut count = 0;
    while let Some(id) = queue.pop_front() {
        db::insert(
            db,
            profile,
            *by_id.get(id).ok_or("Missing imported status event.")?,
        )?;
        count += 1;
        if let Some(next) = children.get(id) {
            queue.extend(next.iter().copied());
        }
    }
    if count != events.len() {
        return Err("Imported status revisions contain a cycle.".into());
    }
    Ok(())
}

fn validate_mapped_target(
    db: &Connection,
    profile: &str,
    mapping: &BehaviorLogImportRecordMapping,
) -> Result<()> {
    let found = match mapping.record_type.as_str() {
        "behavior" => exists::<Behavior>(db, profile, &mapping.local_id)?,
        "schedule" => exists::<BehaviorScheduleSlot>(db, profile, &mapping.local_id)?,
        "occurrence" => exists::<Occurrence>(db, profile, &mapping.local_id)?,
        "status_event" => exists::<OccurrenceStatusEvent>(db, profile, &mapping.local_id)?,
        "behavior_definition_event" => {
            exists::<BehaviorDefinitionEvent>(db, profile, &mapping.local_id)?
        }
        "time_session" => exists::<OccurrenceTimeSession>(db, profile, &mapping.local_id)?,
        "note" => exists::<ImportedNote>(db, profile, &mapping.local_id)?,
        "intervention" => exists::<ImportedIntervention>(db, profile, &mapping.local_id)?,
        _ => false,
    };
    if !found {
        return Err("A provenance mapping target is missing or belongs to another profile.".into());
    }
    Ok(())
}

pub fn apply(
    db: &Connection,
    profile: &str,
    mutation: &str,
    now: &str,
    plan: &LocalImportWritePlan,
) -> Result<()> {
    validate(db, profile, plan)?;
    delete_rows(
        db,
        profile,
        mutation,
        now,
        &plan.imported_intervention_deletes,
    )?;
    delete_rows(db, profile, mutation, now, &plan.imported_note_deletes)?;
    // Record every cascading child before accepted Occurrence deletion.
    for occurrence in &plan.occurrence_deletes {
        for table in [
            "occurrence_status_events",
            "occurrence_time_sessions",
            "reminder_deliveries",
            "native_reminder_state",
        ] {
            let mut statement = db
                .prepare(&format!(
                    "SELECT id FROM {table} WHERE user_id=?1 AND occurrence_id=?2"
                ))
                .map_err(error)?;
            let ids = statement
                .query_map(params![profile, occurrence.id], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(error)?;
            for id in ids {
                tombstone(db, profile, mutation, now, table, &id.map_err(error)?)?;
            }
        }
    }
    delete_rows(db, profile, mutation, now, &plan.occurrence_deletes)?;
    for category in &plan.category_creates {
        db::insert(db, profile, category)?;
    }
    let mut written_definitions = HashSet::new();
    // Sub-behaviors: parents and standalone Behaviors exist before any row names a parent.
    let mut graph_writes: Vec<_> = plan.graph_writes.iter().collect();
    graph_writes.sort_by_key(|write| write.graph.behavior.parent_behavior_id.is_some());
    for write in graph_writes {
        let definitions: Vec<_> = plan
            .definition_events
            .iter()
            .filter(|row| row.behavior_id == write.graph.behavior.id)
            .cloned()
            .collect();
        behavior::write_import_graph(
            db,
            profile,
            mutation,
            now,
            &write.graph,
            write.expected_revision,
            &write.configuration_events,
            &definitions,
        )?;
        written_definitions.extend(definitions.into_iter().map(|row| row.id));
    }
    for definition in &plan.definition_events {
        if !written_definitions.contains(&definition.id) {
            db::insert(db, profile, definition)?;
        }
    }
    // Reserve generated uniqueness keys only for rows explicitly being replaced.
    for write in &plan.occurrence_writes {
        if let Some(previous) = &write.expected {
            db.execute("UPDATE occurrences SET schedule_start_time='reserved:'||id WHERE user_id=?1 AND id=?2",params![profile,previous.id]).map_err(error)?;
        }
    }
    write_rows(db, profile, &plan.occurrence_writes)?;
    append_statuses(db, profile, &plan.status_events)?;
    // Close replaced sessions before opening any restored running session for the same Occurrence.
    for write in &plan.time_session_writes {
        if let Some(previous) = &write.expected {
            db.execute("UPDATE occurrence_time_sessions SET stopped_at=started_at WHERE user_id=?1 AND id=?2",params![profile,previous.id]).map_err(error)?;
        }
    }
    write_rows(db, profile, &plan.time_session_writes)?;
    write_rows(db, profile, &plan.imported_note_writes)?;
    write_rows(db, profile, &plan.imported_intervention_writes)?;
    for write in &plan.imported_note_writes {
        let row = &write.next;
        if let Some(id) = &row.target_local_id {
            let found = match row.target_type.as_str() {
                "behavior" => exists::<Behavior>(db, profile, id)?,
                "occurrence" => exists::<Occurrence>(db, profile, id)?,
                "status_event" => exists::<OccurrenceStatusEvent>(db, profile, id)?,
                _ => false,
            };
            if !found {
                return Err("An imported note target is not owned or no longer exists.".into());
            }
        } else if row.target_type != "review" {
            return Err("An imported note target is missing.".into());
        }
    }
    for mapping in &plan.mappings {
        validate_mapped_target(db, profile, mapping)?;
        db::insert(db, profile, mapping)?;
    }
    // Product changes retain cancellation intent; the TypeScript scheduler handles actual OS cleanup.
    db.execute("UPDATE native_reminder_state SET status='cancelled',verified_at=NULL,error=NULL,updated_at=?2 WHERE user_id=?1 AND status IN ('planned','scheduled','failed')",params![profile,now]).map_err(error)?;
    db.execute("UPDATE reminder_deliveries SET status='cancelled',updated_at=?2 WHERE user_id=?1 AND status='pending'",params![profile,now]).map_err(error)?;
    db.execute("UPDATE occurrence_sync_state SET stale=1,stale_reason='behaviorlog_import_applied',state_version=state_version+1,updated_at=?2 WHERE user_id=?1",params![profile,now]).map_err(error)?;
    Ok(())
}
