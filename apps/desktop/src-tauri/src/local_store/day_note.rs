//! Ticket 292 day notes. The TypeScript core normalizes and validates the note;
//! this module enforces ownership and compare-and-set on the stored note text.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::db::{self, error, Result};
use super::rows::DayNote;

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
#[allow(clippy::too_many_arguments)]
pub fn save(
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
