//! Ticket 292 day notes. The TypeScript core normalizes and validates the note;
//! this module enforces ownership and compare-and-set on the stored note text.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::db::{self, error, Result};
use super::rows::{DayNote, NoteShortcutState};

const MAX_NOTE_CHARACTERS: usize = 2_000;

/// Snapshot reads also run inside migration tests at schema versions before 0021.
pub fn owned_if_present(db: &Connection, profile_id: &str) -> Result<Vec<DayNote>> {
    let present: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='day_notes')",
            [],
            |row| row.get(0),
        )
        .map_err(error)?;
    if present { db::owned::<DayNote>(db, profile_id) } else { Ok(vec![]) }
}

pub fn read(db: &Connection, profile_id: &str, start: &str, end: &str) -> Result<Value> {
    db::valid_date(start)?;
    db::valid_date(end)?;
    Ok(json!(db::read::<DayNote>(
        db,
        "SELECT * FROM day_notes WHERE user_id=?1 AND local_date>=?2 AND local_date<=?3 ORDER BY local_date,id",
        &[profile_id.to_string().into(), start.to_string().into(), end.to_string().into()],
    )?))
}

/// Returns the saved row, or JSON null when the stored note differs from `expected_note`.
/// A shortcut-assisted save also excludes the day note from the day-note shortcut pool,
/// in the same transaction, like hosted `save_day_note_with_shortcut`.
#[allow(clippy::too_many_arguments)]
pub fn save(
    db: &Connection,
    profile_id: &str,
    now: &str,
    new_id: &str,
    local_date: &str,
    expected_note: &Option<String>,
    note: &Option<String>,
    used_shortcut: bool,
) -> Result<Value> {
    if used_shortcut && note.is_none() {
        return Err("The shortcut day note update is invalid.".into());
    }
    let saved = save_note(db, profile_id, now, new_id, local_date, expected_note, note)?;
    if used_shortcut {
        if let Some(id) = saved.get("id").and_then(Value::as_str) {
            exclude_from_pool(db, profile_id, now, id)?;
        }
    }
    Ok(saved)
}

fn exclude_from_pool(db: &Connection, profile_id: &str, now: &str, day_note_id: &str) -> Result<()> {
    let existing = db::read::<NoteShortcutState>(
        db,
        "SELECT * FROM note_shortcut_states WHERE user_id=?1 AND id=?2",
        &[
            profile_id.to_string().into(),
            db::DAY_NOTE_SHORTCUT_POOL_ID.to_string().into(),
        ],
    )?
    .into_iter()
    .next();
    let insert = existing.is_none();
    let mut state = existing.unwrap_or_else(|| NoteShortcutState {
        id: db::DAY_NOTE_SHORTCUT_POOL_ID.into(),
        user_id: profile_id.into(),
        behavior_id: None,
        enabled: false,
        entries: vec![],
        excluded_occurrence_ids: vec![],
        revision: 0,
        updated_at: now.into(),
    });
    if state.excluded_occurrence_ids.iter().any(|id| id == day_note_id) {
        return Ok(());
    }
    if state.excluded_occurrence_ids.len() == 100_000 {
        return Err("The Note shortcut exclusion history is full.".into());
    }
    if state.revision >= 2_147_483_647 {
        return Err("The Note shortcut revision limit has been reached.".into());
    }
    state.excluded_occurrence_ids.push(day_note_id.into());
    state.revision += 1;
    state.updated_at = now.into();
    if insert {
        db::insert(db, profile_id, &state)
    } else {
        db::update(db, profile_id, &state.id, &state)
    }
}

fn save_note(
    db: &Connection,
    profile_id: &str,
    now: &str,
    new_id: &str,
    local_date: &str,
    expected_note: &Option<String>,
    note: &Option<String>,
) -> Result<Value> {
    db::valid_date(local_date)?;
    db::valid_id(new_id)?;
    if let Some(text) = note {
        if text.trim().is_empty() || text.chars().count() > MAX_NOTE_CHARACTERS {
            return Err("The day note is invalid.".into());
        }
    }
    let existing: Option<String> = db
        .query_row(
            "SELECT id FROM day_notes WHERE user_id=?1 AND local_date=?2",
            params![profile_id, local_date],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    let Some(id) = existing else {
        if expected_note.is_some() || note.is_none() {
            return Ok(Value::Null);
        }
        let row = DayNote {
            id: new_id.into(),
            user_id: profile_id.into(),
            local_date: local_date.into(),
            note: note.clone(),
            revision: 1,
            created_at: now.into(),
            updated_at: now.into(),
        };
        db::insert(db, profile_id, &row)?;
        return Ok(json!(row));
    };
    let mut row: DayNote = db::by_id(db, profile_id, &id)?;
    if row.note != *expected_note {
        return Ok(Value::Null);
    }
    if row.note == *note {
        return Ok(json!(row));
    }
    if row.revision >= 2_147_483_647 {
        return Err("The day note revision limit has been reached.".into());
    }
    row.note = note.clone();
    row.revision += 1;
    row.updated_at = now.into();
    db::update(db, profile_id, &id, &row)?;
    Ok(json!(row))
}
