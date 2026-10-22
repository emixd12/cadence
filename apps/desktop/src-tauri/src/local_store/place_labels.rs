// Ticket 216: completion place labels, place markers and suggestion dismissals.
// TypeScript plans every row with the shared core rules; this module enforces the
// owner, keeps each mutation atomic and performs the deletions that hosted triggers
// perform, so account sync sees one deletion per row.
use super::{db, rows::*, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PlaceLabelMutation {
    SaveSettings {
        expected_updated_at: Option<String>,
        next: PlaceLabelSettings,
        retention_cutoff: Option<String>,
    },
    UpsertMarker {
        marker: PlaceMarker,
    },
    DeleteMarkers {
        id: Option<String>,
    },
    InsertLabel {
        label: CompletionPlaceLabel,
    },
    DeleteLabels {
        before_local_date: Option<String>,
    },
    UpsertDismissal {
        dismissal: WhereSuggestionDismissal,
    },
}

pub fn read(db: &Connection, profile_id: &str) -> Result<Value> {
    Ok(json!({
        "settings": db::owned::<PlaceLabelSettings>(db, profile_id)?.into_iter().next(),
        "markers": db::read::<PlaceMarker>(db, "SELECT * FROM place_markers WHERE user_id=?1 ORDER BY id", &[profile_id.to_string().into()])?,
        "labels": db::read::<CompletionPlaceLabel>(db, "SELECT * FROM completion_place_labels WHERE user_id=?1 ORDER BY local_date,id", &[profile_id.to_string().into()])?,
        "dismissals": db::owned::<WhereSuggestionDismissal>(db, profile_id)?,
    }))
}

pub fn commit(db: &Connection, profile_id: &str, now: &str, mutation: &PlaceLabelMutation) -> Result<Value> {
    match mutation {
        PlaceLabelMutation::SaveSettings { expected_updated_at, next, retention_cutoff } => {
            let current = db::owned::<PlaceLabelSettings>(db, profile_id)?.into_iter().next();
            if current.as_ref().map(|row| &row.updated_at) != expected_updated_at.as_ref() {
                return Err("Place label settings changed after they were loaded.".into());
            }
            if next.updated_at != now || next.id != "place_labels" {
                return Err("Place label settings are invalid.".into());
            }
            if let Some(cutoff) = retention_cutoff {
                db::valid_date(cutoff)?;
            }
            if current.is_some() {
                db::update(db, profile_id, "place_labels", next)?;
            } else {
                db::insert(db, profile_id, next)?;
            }
            if !next.enabled {
                // Turning labels off deletes everything location-derived.
                for table in ["completion_place_labels", "place_markers", "where_suggestion_dismissals"] {
                    db.execute(&format!("DELETE FROM {table} WHERE user_id=?1"), [profile_id]).map_err(db::error)?;
                }
            } else if let Some(cutoff) = retention_cutoff {
                delete_labels_before(db, profile_id, Some(cutoff))?;
            }
        }
        PlaceLabelMutation::UpsertMarker { marker } => {
            if !db::valid_place_ref(&marker.id) {
                return Err("The place marker is invalid.".into());
            }
            let exists = db::read::<PlaceMarker>(db, "SELECT * FROM place_markers WHERE user_id=?1 AND id=?2",
                &[profile_id.to_string().into(), marker.id.clone().into()])?.into_iter().next().is_some();
            if exists {
                db::update(db, profile_id, &marker.id, marker)?;
            } else {
                db::insert(db, profile_id, marker)?;
            }
        }
        PlaceLabelMutation::DeleteMarkers { id } => match id {
            Some(id) if db::valid_place_ref(id) => {
                db.execute("DELETE FROM place_markers WHERE user_id=?1 AND id=?2", params![profile_id, id]).map_err(db::error)?;
            }
            Some(_) => return Err("The place marker is invalid.".into()),
            None => {
                db.execute("DELETE FROM place_markers WHERE user_id=?1", [profile_id]).map_err(db::error)?;
            }
        },
        PlaceLabelMutation::InsertLabel { label } => db::insert(db, profile_id, label)?,
        PlaceLabelMutation::DeleteLabels { before_local_date } => {
            if let Some(cutoff) = before_local_date {
                db::valid_date(cutoff)?;
            }
            delete_labels_before(db, profile_id, before_local_date.as_deref())?;
        }
        PlaceLabelMutation::UpsertDismissal { dismissal } => {
            let exists = db::read::<WhereSuggestionDismissal>(db, "SELECT * FROM where_suggestion_dismissals WHERE user_id=?1 AND id=?2",
                &[profile_id.to_string().into(), dismissal.id.clone().into()])?.into_iter().next().is_some();
            if exists {
                db::update(db, profile_id, &dismissal.id, dismissal)?;
            } else {
                db::insert(db, profile_id, dismissal)?;
            }
        }
    }
    read(db, profile_id)
}

pub fn delete_label(db: &Connection, profile_id: &str, occurrence_id: &str) -> Result<()> {
    db.execute("DELETE FROM completion_place_labels WHERE user_id=?1 AND id=?2", params![profile_id, occurrence_id]).map_err(db::error)?;
    Ok(())
}

fn delete_labels_before(db: &Connection, profile_id: &str, cutoff: Option<&str>) -> Result<()> {
    match cutoff {
        Some(cutoff) => db.execute("DELETE FROM completion_place_labels WHERE user_id=?1 AND local_date<?2", params![profile_id, cutoff]),
        None => db.execute("DELETE FROM completion_place_labels WHERE user_id=?1", [profile_id]),
    }
    .map_err(db::error)?;
    Ok(())
}
