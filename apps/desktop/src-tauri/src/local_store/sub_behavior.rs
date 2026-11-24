// Sub-behaviors (migration 0028): group writes, sibling order and routine slot marks.
// TypeScript plans every row; these operations check the group shape and commit it in the
// caller's transaction, so one failure leaves nothing written.
use super::{
    behavior,
    db::{self, error, Result},
    occurrence,
    rows::*,
    Definition, GraphRows, Request,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

/// The hosted RPCs accept a parent and 1 to 50 sub-behaviors.
const GROUP_LIMIT: usize = 51;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupCreateItem {
    pub graph: GraphRows,
    pub definition_event: BehaviorDefinitionEvent,
    pub configuration_event: BehaviorConfigurationEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupUpdateItem {
    pub graph: GraphRows,
    pub expected_revision: i64,
    pub expected_normalized_definition: Definition,
    pub definition_event: Option<BehaviorDefinitionEvent>,
    pub configuration_event: Option<BehaviorConfigurationEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlotStatusTransition {
    pub occurrence_id: String,
    pub expected_status: String,
    pub expected_latest_event_id: Option<String>,
    pub status: String,
    pub completed_at: Option<String>,
    pub status_marked_at: Option<String>,
    pub cancel_pending_reminders: bool,
    #[serde(default)]
    pub time_tracking_stop: Option<super::TimeTrackingStopPlan>,
    pub event: Option<OccurrenceStatusEvent>,
}

/// A parent first, then its new sub-behaviors, each naming it.
pub fn create_group(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    items: &[GroupCreateItem],
) -> Result<Value> {
    let (parent, children) = items
        .split_first()
        .ok_or("A Behavior group needs a parent and 1 to 50 sub-behaviors.")?;
    if children.is_empty() || items.len() > GROUP_LIMIT {
        return Err("A Behavior group needs a parent and 1 to 50 sub-behaviors.".into());
    }
    if parent.graph.behavior.parent_behavior_id.is_some() {
        return Err("A sub-behavior cannot have sub-behaviors.".into());
    }
    let parent_id = &parent.graph.behavior.id;
    if children
        .iter()
        .any(|item| item.graph.behavior.parent_behavior_id.as_ref() != Some(parent_id))
    {
        return Err("Every new sub-behavior must name the new parent.".into());
    }
    let mut output = Vec::with_capacity(items.len());
    for item in items {
        output.push(behavior::write_graph(
            db,
            profile_id,
            mutation_id,
            now,
            &item.graph,
            None,
            None,
            Some(&item.definition_event),
            Some(&item.configuration_event),
        )?);
    }
    Ok(json!(output))
}

/// Several Behavior updates in one transaction, in order: a parent edit and the mirrors,
/// archives or restores it plans for its sub-behaviors.
pub fn update_group(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    items: &[GroupUpdateItem],
) -> Result<Value> {
    if items.is_empty() || items.len() > GROUP_LIMIT {
        return Err("A Behavior group update holds 1 to 51 Behaviors.".into());
    }
    let mut seen = HashSet::new();
    let mut output = Vec::with_capacity(items.len());
    for item in items {
        if !seen.insert(&item.graph.behavior.id) {
            return Err("A Behavior group update lists a Behavior twice.".into());
        }
        output.push(behavior::write_graph(
            db,
            profile_id,
            mutation_id,
            now,
            &item.graph,
            Some(item.expected_revision),
            Some(&item.expected_normalized_definition),
            item.definition_event.as_ref(),
            item.configuration_event.as_ref(),
        )?);
    }
    Ok(json!(output))
}

/// Dense sibling order for one parent's live sub-behaviors. Returns the rows that changed.
pub fn reorder(
    db: &Connection,
    profile_id: &str,
    now: &str,
    parent_behavior_id: &str,
    ordered_behavior_ids: &[String],
) -> Result<Value> {
    db::valid_id(parent_behavior_id)?;
    let siblings = db::read::<Behavior>(
        db,
        "SELECT * FROM behaviors WHERE user_id=?1 AND parent_behavior_id=?2 AND archived_at IS NULL",
        &[profile_id.to_string().into(), parent_behavior_id.to_string().into()],
    )?;
    let current: HashSet<&str> = siblings.iter().map(|row| row.id.as_str()).collect();
    let requested: HashSet<&str> = ordered_behavior_ids.iter().map(String::as_str).collect();
    if requested.len() != ordered_behavior_ids.len() || requested != current {
        return Err("Sub-behavior order must list each sub-behavior once.".into());
    }
    let mut changed = 0;
    for (index, id) in ordered_behavior_ids.iter().enumerate() {
        let order = index as i64;
        let row = siblings.iter().find(|row| &row.id == id).unwrap();
        if row.sub_behavior_sort_order == order {
            continue;
        }
        db.execute(
            "UPDATE behaviors SET sub_behavior_sort_order=?3,updated_at=?4 WHERE user_id=?1 AND id=?2",
            params![profile_id, id, order, now],
        )
        .map_err(error)?;
        db.execute(
            "UPDATE behavior_revisions SET revision=revision+1 WHERE user_id=?1 AND behavior_id=?2",
            params![profile_id, id],
        )
        .map_err(error)?;
        changed += 1;
    }
    Ok(json!(changed))
}

/// Marks every planned sub-behavior Occurrence of one parent slot: same parent, one local day.
pub fn parent_slot_status(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    parent_behavior_id: &str,
    transitions: &[SlotStatusTransition],
) -> Result<Value> {
    db::valid_id(parent_behavior_id)?;
    if transitions.is_empty() || transitions.len() > 50 {
        return Err("A routine mark holds 1 to 50 sub-behaviors.".into());
    }
    let mut seen = HashSet::new();
    let mut local_date: Option<String> = None;
    for transition in transitions {
        if !seen.insert(&transition.occurrence_id) {
            return Err("A routine mark lists an Occurrence twice.".into());
        }
        let row: Occurrence = db::by_id(db, profile_id, &transition.occurrence_id)?;
        let owner: Behavior = db::by_id(db, profile_id, &row.behavior_id)?;
        if owner.parent_behavior_id.as_deref() != Some(parent_behavior_id) {
            return Err("Every Occurrence in a routine mark must belong to its sub-behaviors.".into());
        }
        match &local_date {
            Some(day) if day != &row.local_date => {
                return Err("A routine mark covers one local day.".into())
            }
            _ => local_date = Some(row.local_date.clone()),
        }
    }
    let mut results = Vec::with_capacity(transitions.len());
    for transition in transitions {
        let request = Request::ApplyStatusTransition {
            profile_id: profile_id.to_string(),
            mutation_id: mutation_id.to_string(),
            now: now.to_string(),
            occurrence_id: transition.occurrence_id.clone(),
            expected_status: transition.expected_status.clone(),
            expected_latest_event_id: transition.expected_latest_event_id.clone(),
            status: transition.status.clone(),
            completed_at: transition.completed_at.clone(),
            status_marked_at: transition.status_marked_at.clone(),
            cancel_pending_reminders: transition.cancel_pending_reminders,
            time_tracking_stop: transition.time_tracking_stop.clone(),
            event: transition.event.clone(),
        };
        results.push(occurrence::status(db, &request)?);
    }
    Ok(json!(results))
}
