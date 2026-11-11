use super::{
    db::{self, error, Result},
    rows::{Behavior, NoteShortcutState, StoredRow},
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CONTEXT_LIMIT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NoteSource {
    pub id: String,
    pub user_id: String,
    pub behavior_id: String,
    pub note: Option<String>,
    pub local_date: String,
    pub scheduled_for: String,
}
impl StoredRow for NoteSource {
    const TABLE: &'static str = "occurrences";
    const JSON_COLUMNS: &'static [&'static str] = &[];
    const BOOL_COLUMNS: &'static [&'static str] = &[];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NoteShortcutBehavior {
    pub id: String,
    pub user_id: String,
    pub active: bool,
    pub timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteShortcutContext {
    pub state: Option<NoteShortcutState>,
    pub global_state: Option<NoteShortcutState>,
    pub behavior: Option<NoteShortcutBehavior>,
    pub notes: Vec<NoteSource>,
    pub imported_occurrence_ids: Vec<String>,
}

pub fn read_states(db: &Connection, profile_id: &str) -> Result<Vec<NoteShortcutState>> {
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='note_shortcut_states')",
            [],
            |row| row.get(0),
        )
        .map_err(error)?;
    if !exists {
        return Ok(vec![]);
    }
    db::read(
        db,
        "SELECT * FROM note_shortcut_states WHERE user_id=?1 ORDER BY id",
        &[profile_id.to_string().into()],
    )
}

pub fn read_context(
    db: &Connection,
    profile_id: &str,
    behavior_id: Option<&str>,
) -> Result<NoteShortcutContext> {
    let state_id = behavior_id.unwrap_or("global");
    if let Some(id) = behavior_id {
        db::valid_id(id)?;
    }
    let state = read_state(db, profile_id, state_id)?;
    let global_state = read_state(db, profile_id, "global")?;
    let Some(behavior_id) = behavior_id else {
        return checked_context(NoteShortcutContext {
            state,
            global_state,
            behavior: None,
            notes: vec![],
            imported_occurrence_ids: vec![],
        });
    };
    let behavior = db::read::<Behavior>(
        db,
        "SELECT * FROM behaviors WHERE user_id=?1 AND id=?2",
        &[
            profile_id.to_string().into(),
            behavior_id.to_string().into(),
        ],
    )?
    .into_iter()
    .next()
    .map(|row| NoteShortcutBehavior {
        id: row.id,
        user_id: row.user_id,
        active: row.active,
        timezone: row.timezone,
    });
    let notes = if behavior.is_some() {
        db::read::<NoteSource>(
            db,
            "SELECT id,user_id,behavior_id,note,local_date,scheduled_for FROM occurrences WHERE user_id=?1 AND behavior_id=?2 AND note IS NOT NULL AND length(trim(note)) > 0 AND length(note) <= 2000 ORDER BY id",
            &[profile_id.to_string().into(), behavior_id.to_string().into()],
        )?
    } else {
        vec![]
    };
    let imported_occurrence_ids = if behavior.is_some() {
        let mut statement = db.prepare(
            "SELECT DISTINCT mapping.local_id FROM behaviorlog_import_record_mappings mapping JOIN occurrences occurrence ON occurrence.user_id=mapping.user_id AND occurrence.id=mapping.local_id WHERE mapping.user_id=?1 AND mapping.record_type='occurrence' AND occurrence.behavior_id=?2 ORDER BY mapping.local_id",
        ).map_err(error)?;
        let mut rows = statement.query([profile_id, behavior_id]).map_err(error)?;
        let mut ids = Vec::new();
        while let Some(row) = rows.next().map_err(error)? {
            if ids.len() == db::READ_LIMIT {
                return Err("The imported Occurrence read exceeds 100,000 rows; no partial result was returned.".into());
            }
            ids.push(row.get(0).map_err(error)?);
        }
        ids
    } else {
        vec![]
    };
    checked_context(NoteShortcutContext {
        state,
        global_state,
        behavior,
        notes,
        imported_occurrence_ids,
    })
}

fn checked_context(context: NoteShortcutContext) -> Result<NoteShortcutContext> {
    let bytes = serde_json::to_vec(&context)
        .map_err(|_| "The Note shortcut context could not be encoded.".to_string())?;
    if bytes.len() > CONTEXT_LIMIT_BYTES {
        return Err(
            "The Note shortcut context exceeds 64 MiB; no partial result was returned.".into(),
        );
    }
    Ok(context)
}

pub fn commit(
    db: &Connection,
    profile_id: &str,
    now: &str,
    expected: &NoteShortcutContext,
    next: &NoteShortcutState,
    require_enabled: bool,
) -> Result<Value> {
    let behavior_id = next.behavior_id.as_deref();
    let current = read_context(db, profile_id, behavior_id)?;
    if &current != expected {
        return Err("Note shortcut sources or settings changed. Refresh and try again.".into());
    }
    db::validate_row(profile_id, next)?;
    if next.updated_at != now {
        return Err("The Note shortcut update time is invalid.".into());
    }
    let expected_revision = current.state.as_ref().map_or(0, |state| state.revision);
    if next.revision != expected_revision + 1 || next.id != behavior_id.unwrap_or("global") {
        return Err("The Note shortcut revision is stale.".into());
    }
    if let Some(behavior_id) = behavior_id {
        let behavior = current.behavior.as_ref().ok_or("Behavior not found.")?;
        if behavior.id != behavior_id || behavior.user_id != profile_id {
            return Err("Behavior not found.".into());
        }
        // Ticket 305: on unless the retained global switch is stored off. The
        // per-Behavior flag is kept for sync but no longer gates.
        if require_enabled && !behavior.active {
            return Err("Note shortcuts are available for active Behaviors only.".into());
        }
        if require_enabled
            && current
                .global_state
                .as_ref()
                .is_some_and(|state| !state.enabled)
        {
            return Err("Note shortcuts are turned off for this account.".into());
        }
    } else if require_enabled {
        return Err("Choose a Behavior for shortcut management.".into());
    }
    if current.state.is_some() {
        db::update(db, profile_id, &next.id, next)?;
    } else {
        db::insert(db, profile_id, next)?;
    }
    Ok(json!(next))
}

fn read_state(db: &Connection, profile_id: &str, id: &str) -> Result<Option<NoteShortcutState>> {
    Ok(db::read(
        db,
        "SELECT * FROM note_shortcut_states WHERE user_id=?1 AND id=?2",
        &[profile_id.to_string().into(), id.to_string().into()],
    )?
    .into_iter()
    .next())
}
