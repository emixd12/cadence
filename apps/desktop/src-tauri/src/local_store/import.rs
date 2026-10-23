use super::{
    behavior,
    db::{self, error, Result},
    rows::*,
    GraphRows, Request,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowWrite<T> {
    pub expected: Option<T>,
    pub next: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportGraphWrite {
    pub expected_revision: Option<i64>,
    pub graph: GraphRows,
    pub configuration_events: Vec<BehaviorConfigurationEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    CreateMissingOnly,
    MergeByUserApprovedPlan,
    RestoreApply,
}
impl ImportMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CreateMissingOnly => "create_missing_only",
            Self::MergeByUserApprovedPlan => "merge_by_user_approved_plan",
            Self::RestoreApply => "restore_apply",
        }
    }
    pub fn is_restore(&self) -> bool {
        matches!(self, Self::RestoreApply)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalImportWritePlan {
    pub mode: ImportMode,
    pub apply_run: BehaviorLogImportRun,
    pub category_creates: Vec<Category>,
    pub graph_writes: Vec<ImportGraphWrite>,
    pub definition_events: Vec<BehaviorDefinitionEvent>,
    pub occurrence_writes: Vec<RowWrite<Occurrence>>,
    pub occurrence_deletes: Vec<Occurrence>,
    pub status_events: Vec<OccurrenceStatusEvent>,
    pub time_session_writes: Vec<RowWrite<OccurrenceTimeSession>>,
    pub imported_note_writes: Vec<RowWrite<ImportedNote>>,
    pub imported_note_deletes: Vec<ImportedNote>,
    pub imported_intervention_writes: Vec<RowWrite<ImportedIntervention>>,
    pub imported_intervention_deletes: Vec<ImportedIntervention>,
    pub mappings: Vec<BehaviorLogImportRecordMapping>,
    pub result: Value,
}

pub fn domain_revision(db: &Connection, profile_id: &str) -> Result<i64> {
    db.query_row(
        "SELECT revision FROM local_data_revision WHERE user_id=?1",
        [profile_id],
        |row| row.get(0),
    )
    .map_err(error)
}

pub fn snapshot(db: &Connection, profile_id: &str) -> Result<Value> {
    Ok(json!({
        "revision":domain_revision(db,profile_id)?,"profile":db::profile(db)?,
        "categories":db::read::<Category>(db,"SELECT * FROM categories WHERE user_id=?1 ORDER BY id",&[profile_id.to_string().into()])?,"graphs":behavior::read_graphs(db,profile_id)?,
        "definitionEvents":db::owned::<BehaviorDefinitionEvent>(db,profile_id)?,
        "configurationEvents":db::owned::<BehaviorConfigurationEvent>(db,profile_id)?,
        "occurrences":db::owned::<Occurrence>(db,profile_id)?,"statusEvents":db::owned::<OccurrenceStatusEvent>(db,profile_id)?,
        "timeSessions":db::owned::<OccurrenceTimeSession>(db,profile_id)?,
        "reminderDeliveries":db::owned::<ReminderDelivery>(db,profile_id)?,"nativeReminders":db::owned::<NativeReminderState>(db,profile_id)?,
        "importRuns":db::owned::<BehaviorLogImportRun>(db,profile_id)?,"mappings":db::owned::<BehaviorLogImportRecordMapping>(db,profile_id)?,
        "importedNotes":db::owned::<ImportedNote>(db,profile_id)?,"importedInterventions":db::owned::<ImportedIntervention>(db,profile_id)?,
        "noteShortcutStates":super::note_shortcut::read_states(db,profile_id)?,
        "travelSettings":super::travel::read_value(db,profile_id)?,
        "placeLabelSettings":db::owned::<PlaceLabelSettings>(db,profile_id)?,"placeMarkers":db::owned::<PlaceMarker>(db,profile_id)?,
        "completionPlaceLabels":db::owned::<CompletionPlaceLabel>(db,profile_id)?,
        "whereSuggestionDismissals":db::owned::<WhereSuggestionDismissal>(db,profile_id)?
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportRunKind {
    Import,
    Restore,
}

pub fn read_runs(
    db: &Connection,
    profile_id: &str,
    limit: i64,
    kind: Option<&ImportRunKind>,
) -> Result<Vec<BehaviorLogImportRun>> {
    if !(1..=100).contains(&limit) {
        return Err("Import run limit must be between1 and100.".into());
    }
    let filter = match kind {
        None => "1",
        Some(ImportRunKind::Import) => "import_mode NOT LIKE 'restore_%'",
        Some(ImportRunKind::Restore) => "import_mode LIKE 'restore_%'",
    };
    db::read(db,&format!("SELECT * FROM behaviorlog_import_runs WHERE user_id=?1 AND ({filter}) ORDER BY (substr(started_at,1,19)||'.'||substr((CASE WHEN substr(started_at,20,1)='.' THEN substr(started_at,21,length(started_at)-21) ELSE '' END)||'000000000',1,9)) DESC,id DESC LIMIT ?2"),&[profile_id.to_string().into(),limit.into()])
}

fn fingerprint(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("A preview fingerprint must be a lowercase SHA-256 value.".into());
    }
    Ok(())
}

fn preview_fingerprints(
    run: &BehaviorLogImportRun,
) -> Result<(String, String, String, Option<String>)> {
    let summary = &run.dry_run_summary;
    let read = |key: &str| -> Result<String> {
        let value = summary[key]
            .as_str()
            .ok_or("The preview fingerprint binding is missing.")?;
        fingerprint(value)?;
        Ok(value.to_string())
    };
    let preview = read("previewFingerprint")?;
    let local = read("localDataFingerprint")?;
    let bundle = read("bundleFingerprint")?;
    if run.bundle_fingerprint.as_deref() != Some(&bundle) {
        return Err("The preview bundle fingerprint does not match its ledger.".into());
    }
    let optional =
        |key: &str| -> Result<Option<String>> { summary.get(key).map(|_| read(key)).transpose() };
    let payload = optional("bundlePayloadFingerprint")?;
    let archive = optional("archiveFingerprint")?;
    if payload.is_some() && archive.is_some() && payload != archive {
        return Err("The preview archive fingerprint bindings disagree.".into());
    }
    let payload = payload.or(archive);
    if run.import_mode == "restore_preview" && payload.is_none() {
        return Err("Restore preview requires the exact archive fingerprint.".into());
    }
    Ok((preview, local, bundle, payload))
}

fn valid_preview(run: &BehaviorLogImportRun) -> Result<()> {
    let summary = &run.dry_run_summary;
    if summary["valid"] != true
        || summary
            .get("errorCount")
            .is_some_and(|count| count.as_i64() != Some(0))
        || summary
            .get("errors")
            .is_some_and(|rows| rows.as_array().is_none_or(|rows| !rows.is_empty()))
    {
        return Err("The preview is not valid for apply.".into());
    }
    if run.import_mode == "restore_preview" {
        if summary["statusHistoryPolicy"]["selected"] != "preserve_append_only_history"
            || summary["statusHistoryPolicy"]["applySupportedInThisTicket"] != true
            || summary["summary"]["unsupportedActionCount"] != 0
            || summary["summary"]["skippedCount"] != 0
        {
            return Err("Restore preview includes an unsupported action or history policy.".into());
        }
    } else if summary["mergePreview"]["conflictCount"] != 0 {
        return Err("Import preview still contains unresolved merge conflicts.".into());
    }
    Ok(())
}

fn restore_actions(
    db: &Connection,
    profile: &str,
    run: &BehaviorLogImportRun,
    plan: &LocalImportWritePlan,
) -> Result<()> {
    if !plan.mode.is_restore() {
        return Ok(());
    }
    let actions = &run.dry_run_summary["actions"];
    let permits = |group: &str, id: &str, kinds: &[&str]| -> bool {
        actions[group].as_array().is_some_and(|rows| {
            rows.iter().any(|row| {
                row["localId"] == id
                    && row["action"]
                        .as_str()
                        .is_some_and(|kind| kinds.contains(&kind))
            })
        })
    };
    for row in &plan.occurrence_deletes {
        if !permits("occurrences", &row.id, &["delete"]) {
            return Err("Occurrence deletion is outside the accepted restore actions.".into());
        }
    }
    for row in &plan.imported_note_deletes {
        if !permits("importedNotes", &row.id, &["delete"]) {
            return Err("Note deletion is outside the accepted restore actions.".into());
        }
    }
    for row in &plan.imported_intervention_deletes {
        if !permits("importedInterventions", &row.id, &["delete"]) {
            return Err("Intervention deletion is outside the accepted restore actions.".into());
        }
    }
    for write in &plan.graph_writes {
        if write.expected_revision.is_some()
            && !permits("behaviors", &write.graph.behavior.id, &["replace"])
        {
            let before = behavior::graph(db, profile, &write.graph.behavior.id)?;
            let mut allowed = before.behavior.clone();
            allowed.current_configuration_event_id =
                write.graph.behavior.current_configuration_event_id.clone();
            allowed.updated_at = write.graph.behavior.updated_at.clone();
            if permits("behaviors", &write.graph.behavior.id, &["archive"]) {
                allowed.active = false;
                allowed.archived_at = allowed
                    .archived_at
                    .or_else(|| write.graph.behavior.archived_at.clone());
                if allowed.archived_at.is_none()
                    || allowed != write.graph.behavior
                    || before.schedules != write.graph.schedules
                    || before.slots != write.graph.slots
                {
                    return Err(
                        "An archive action cannot replace Behavior fields or schedules.".into(),
                    );
                }
                continue;
            }
            if allowed != write.graph.behavior {
                return Err("Behavior replacement is outside the accepted restore actions.".into());
            }
            for slot in &before.slots {
                if !write.graph.slots.contains(slot)
                    && !permits("schedules", &slot.id, &["replace", "delete"])
                {
                    return Err(
                        "Schedule replacement is outside the accepted restore actions.".into(),
                    );
                }
            }
        }
    }
    for write in &plan.occurrence_writes {
        if write.expected.is_some() && !permits("occurrences", &write.next.id, &["replace"]) {
            let mut allowed = write
                .expected
                .clone()
                .ok_or("Missing expected Occurrence.")?;
            if plan
                .status_events
                .iter()
                .any(|event| event.occurrence_id == write.next.id)
            {
                allowed.status = write.next.status.clone();
                allowed.completed_at = write.next.completed_at.clone();
                allowed.status_marked_at = write.next.status_marked_at.clone();
            }
            if permits(
                "inlineOccurrenceNotes",
                &write.next.id,
                &["replace", "delete"],
            ) {
                allowed.note = write.next.note.clone();
            }
            allowed.updated_at = write.next.updated_at.clone();
            if allowed != write.next {
                return Err(
                    "Occurrence replacement is outside the accepted restore actions.".into(),
                );
            }
        }
    }
    for write in &plan.time_session_writes {
        if write.expected.is_some() && !permits("timeSessions", &write.next.id, &["replace"]) {
            return Err("Time-session replacement is outside the accepted restore actions.".into());
        }
    }
    for write in &plan.imported_note_writes {
        if write.expected.is_some() && !permits("importedNotes", &write.next.id, &["replace"]) {
            return Err("Note replacement is outside the accepted restore actions.".into());
        }
    }
    for write in &plan.imported_intervention_writes {
        if write.expected.is_some()
            && !permits("importedInterventions", &write.next.id, &["replace"])
        {
            return Err("Intervention replacement is outside the accepted restore actions.".into());
        }
    }
    for mapping in &plan.mappings {
        let group = match mapping.record_type.as_str() {
            "behavior" => "behaviors",
            "schedule" => "schedules",
            "occurrence" => "occurrences",
            "status_event" => "statusEvents",
            "behavior_definition_event" => "definitionEvents",
            "time_session" => "timeSessions",
            "note" => "importedNotes",
            "intervention" => "importedInterventions",
            _ => return Err("Unknown restore mapping type.".into()),
        };
        let permitted = actions[group].as_array().is_some_and(|rows| {
            rows.iter().any(|row| {
                row["externalId"] == mapping.external_id
                    && (row["action"] == "create"
                        || (matches!(row["action"].as_str(), Some("replace" | "keep"))
                            && row["localId"] == mapping.local_id))
            })
        });
        if !permitted {
            return Err("Provenance mapping is outside the accepted restore actions.".into());
        }
    }
    Ok(())
}

pub fn prepare(db: &Connection, request: &Request) -> Result<Value> {
    let Request::PrepareBehaviorLogImport {
        profile_id,
        now,
        expected_revision,
        preview_run,
        plan,
        ..
    } = request
    else {
        return Err("Expected an import preview operation.".into());
    };
    if domain_revision(db, profile_id)? != *expected_revision {
        return Err("Data changed while preparing the preview. Preview the bundle again.".into());
    }
    db::validate_row(profile_id, preview_run)?;
    if !matches!(
        preview_run.import_mode.as_str(),
        "merge_preview" | "restore_preview"
    ) || preview_run.status != "previewed"
        || preview_run.accepted_preview_run_id.is_some()
        || preview_run.accepted_preview_fingerprint.is_some()
    {
        return Err("The preview ledger has an invalid mode or acceptance state.".into());
    }
    let (preview, local, bundle, payload) = preview_fingerprints(preview_run)?;
    if let Some(plan) = plan {
        valid_preview(preview_run)?;
        db::validate_row(profile_id, &plan.apply_run)?;
        if plan.apply_run.id == preview_run.id
            || plan.apply_run.import_mode != plan.mode.as_str()
            || plan.mode.is_restore() != (preview_run.import_mode == "restore_preview")
            || plan.apply_run.status != "previewed"
            || plan.apply_run.completed_at.is_some()
            || plan.apply_run.failure_message.is_some()
            || plan.apply_run.accepted_preview_run_id.as_deref() != Some(&preview_run.id)
            || plan.apply_run.accepted_preview_fingerprint.as_deref() != Some(&preview)
            || plan.apply_run.bundle_fingerprint.as_deref() != Some(&bundle)
            || !plan.result.is_object()
            || !plan.apply_run.dry_run_summary.is_object()
        {
            return Err("The stored apply plan does not match its accepted preview ledger.".into());
        }
        super::import_write::validate(db, profile_id, plan)?;
        restore_actions(db, profile_id, preview_run, plan)?;
    }
    let encoded = plan
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| "The reviewed plan could not be encoded.")?;
    let existing:Option<(i64,Option<String>,Option<String>)>=db.query_row("SELECT prepared_revision,plan_json,result_json FROM behaviorlog_local_previews WHERE user_id=?1 AND preview_run_id=?2",params![profile_id,preview_run.id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(error)?;
    if let Some((revision, prior, result)) = existing {
        if revision != *expected_revision
            || result.is_some()
            || db::by_id::<BehaviorLogImportRun>(db, profile_id, &preview_run.id)? != *preview_run
        {
            return Err("The existing preview changed or became stale before plan binding.".into());
        }
        if prior.is_some() && prior != encoded {
            return Err("A reviewed nonempty plan cannot be replaced or cleared.".into());
        }
        db.execute("UPDATE behaviorlog_local_previews SET plan_json=?3 WHERE user_id=?1 AND preview_run_id=?2",params![profile_id,preview_run.id,encoded]).map_err(error)?;
        return Ok(json!({"previewRun":preview_run,"revision":expected_revision}));
    }
    db::insert(db, profile_id, preview_run)?;
    db.execute("INSERT INTO behaviorlog_local_previews(user_id,preview_run_id,prepared_revision,preview_fingerprint,local_data_fingerprint,bundle_fingerprint,bundle_payload_fingerprint,plan_json,prepared_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![profile_id,preview_run.id,expected_revision,preview,local,bundle,payload,encoded,now]).map_err(error)?;
    Ok(json!({"previewRun":preview_run,"revision":expected_revision}))
}

pub fn after_prepare(
    db: &Connection,
    profile_id: &str,
    preview_id: &str,
    _sequence: i64,
) -> Result<Value> {
    let sequence = domain_revision(db, profile_id)?;
    db.execute("UPDATE behaviorlog_local_previews SET prepared_revision=?3 WHERE user_id=?1 AND preview_run_id=?2",params![profile_id,preview_id,sequence]).map_err(error)?;
    Ok(
        json!({"previewRun":db::by_id::<BehaviorLogImportRun>(db,profile_id,preview_id)?,"revision":sequence}),
    )
}

pub fn apply(db: &Connection, request: &Request) -> Result<Value> {
    let Request::ApplyBehaviorLogImport {
        profile_id,
        mutation_id,
        now,
        preview_run_id,
        import_mode,
        preview_fingerprint,
        local_data_fingerprint,
        bundle_fingerprint,
        bundle_payload_fingerprint,
        ..
    } = request
    else {
        return Err("Expected an import apply operation.".into());
    };
    db::valid_id(preview_run_id)?;
    for value in [
        preview_fingerprint,
        local_data_fingerprint,
        bundle_fingerprint,
    ] {
        fingerprint(value)?;
    }
    if let Some(value) = bundle_payload_fingerprint {
        fingerprint(value)?;
    }
    let bound:Option<(i64,String,String,String,Option<String>,Option<String>,Option<String>)>=db.query_row("SELECT prepared_revision,preview_fingerprint,local_data_fingerprint,bundle_fingerprint,bundle_payload_fingerprint,plan_json,result_json FROM behaviorlog_local_previews WHERE user_id=?1 AND preview_run_id=?2",params![profile_id,preview_run_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?))).optional().map_err(error)?;
    let Some((revision, preview, local, bundle, payload, plan, prior)) = bound else {
        return Err("The accepted local preview was not found.".into());
    };
    if &preview != preview_fingerprint
        || &local != local_data_fingerprint
        || &bundle != bundle_fingerprint
        || &payload != bundle_payload_fingerprint
    {
        return Err("Apply does not match the exact reviewed preview and bundle.".into());
    }
    let plan: LocalImportWritePlan =
        serde_json::from_str(&plan.ok_or("The preview has no applicable write plan.")?)
            .map_err(|_| "The stored reviewed plan is invalid.")?;
    if plan.mode.as_str() != import_mode.as_str() {
        return Err("The requested import mode does not match the stored reviewed plan.".into());
    }
    if let Some(prior) = prior {
        let mut result: Value =
            serde_json::from_str(&prior).map_err(|_| "The stored apply result is invalid.")?;
        result["alreadyApplied"] = json!(result["status"] == "applied");
        return Ok(result);
    }
    let preview_run: BehaviorLogImportRun = db::by_id(db, profile_id, preview_run_id)?;
    valid_preview(&preview_run)?;
    if preview_run.status != "previewed" {
        return Err("The accepted preview is not available to apply.".into());
    }
    let mut run = plan.apply_run.clone();
    run.started_at = now.clone();
    run.updated_at = now.clone();
    db::insert(db, profile_id, &run)?;
    db.execute_batch("SAVEPOINT behaviorlog_product_write")
        .map_err(error)?;
    let outcome: Result<()> = (|| {
        if domain_revision(db, profile_id)? != revision {
            return Err(
                "Local data changed since the accepted preview. Preview the bundle again.".into(),
            );
        }
        super::import_write::apply(db, profile_id, mutation_id, now, &plan)?;
        let violations:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check WHERE \"table\" <> 'tombstones')",[],|row|row.get(0)).map_err(error)?;
        if violations {
            return Err("The import plan has an invalid ownership or lineage reference.".into());
        }
        Ok(())
    })();
    let result = match outcome {
        Ok(()) => {
            db.execute_batch("RELEASE behaviorlog_product_write")
                .map_err(error)?;
            run.status = "applied".into();
            run.failure_message = None;
            run.dry_run_summary
                .as_object_mut()
                .ok_or("The apply summary must be an object.")?
                .insert("applyResult".into(), plan.result.clone());
            json!({"status":"applied","result":plan.result,"alreadyApplied":false})
        }
        Err(message) => {
            db.execute_batch(
                "ROLLBACK TO behaviorlog_product_write; RELEASE behaviorlog_product_write",
            )
            .map_err(error)?;
            run.status = "failed".into();
            run.failure_message = Some(message.clone());
            json!({"status":"failed","error":message,"alreadyApplied":false})
        }
    };
    run.completed_at = Some(now.clone());
    db::update(db, profile_id, &run.id, &run)?;
    let mut result = result;
    result["importRun"] = json!(run);
    db.execute("UPDATE behaviorlog_local_previews SET result_json=?3,apply_run_id=?4 WHERE user_id=?1 AND preview_run_id=?2",params![profile_id,preview_run_id,result.to_string(),run.id]).map_err(error)?;
    Ok(result)
}
