//! Ticket 374 (D35): Periods in the local store. The TypeScript core normalizes and
//! validates the label, dates and note; this module enforces ownership, the cap of
//! 500 Periods per profile and compare-and-set on `revision`, like the hosted
//! `create_period`, `create_period_if_absent`, `update_period` and `delete_period`.
//! Labels and notes never reach an error message or a log.
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::db::{self, error, Result};
use super::rows::Period;
use super::tombstone;

/// Mirrors `PERIOD_LIMITS.perAccount` and the hosted `periods_enforce_account_cap` trigger.
pub const MAX_PER_PROFILE: i64 = 500;
/// The words of `PERIOD_LIMIT_MESSAGE` in `packages/core/src/services/period.service.ts`.
pub const LIMIT_MESSAGE: &str =
    "You have reached the limit of 500 periods. Remove one before adding another.";
const MAX_LABEL_CHARACTERS: usize = 60;
const MAX_NOTE_CHARACTERS: usize = 2_000;
const MAX_REVISION: i64 = 2_147_483_647;

/// Snapshot reads also run inside migration tests at schema versions before 0031.
pub fn owned_if_present(db: &Connection, profile_id: &str) -> Result<Vec<Period>> {
    let present: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='periods')",
            [],
            |row| row.get(0),
        )
        .map_err(error)?;
    if present { db::owned::<Period>(db, profile_id) } else { Ok(vec![]) }
}

/// The table checks of hosted `public.periods` and local `periods`, so a row that
/// either database accepts passes here and account sync never meets a row it refuses.
pub fn validate(row: &Period) -> Result<()> {
    let label_characters = row.label.chars().count();
    if row.label != row.label.trim_matches(' ')
        || !(1..=MAX_LABEL_CHARACTERS).contains(&label_characters)
        || row.label.contains(['\n', '\r'])
    {
        return Err("The period label is invalid.".into());
    }
    db::valid_date(&row.start_on)?;
    if let Some(end_on) = &row.end_on {
        db::valid_date(end_on)?;
        if end_on.as_str() < row.start_on.as_str() {
            return Err("The period dates are invalid.".into());
        }
    }
    if let Some(note) = &row.note {
        if note.trim_matches(' ').is_empty() || note.chars().count() > MAX_NOTE_CHARACTERS {
            return Err("The period note is invalid.".into());
        }
    }
    if !(1..=MAX_REVISION).contains(&row.revision) {
        return Err("The period revision is invalid.".into());
    }
    Ok(())
}

/// Every Period of the profile, or with a range those with a day inside it: first day
/// on or before `end`, and ongoing or last day on or after `start`.
pub fn read(
    db: &Connection,
    profile_id: &str,
    start: &Option<String>,
    end: &Option<String>,
) -> Result<Value> {
    match (start, end) {
        (None, None) => Ok(json!(db::read::<Period>(
            db,
            "SELECT * FROM periods WHERE user_id=?1 ORDER BY start_on,id",
            &[profile_id.to_string().into()],
        )?)),
        (Some(start), Some(end)) => {
            db::valid_date(start)?;
            db::valid_date(end)?;
            Ok(json!(db::read::<Period>(
                db,
                "SELECT * FROM periods WHERE user_id=?1 AND start_on<=?3 AND (end_on IS NULL OR end_on>=?2) ORDER BY start_on,id",
                &[profile_id.to_string().into(), start.clone().into(), end.clone().into()],
            )?))
        }
        _ => Err("A period range needs both dates.".into()),
    }
}

fn find(db: &Connection, profile_id: &str, id: &str) -> Result<Option<Period>> {
    db::valid_id(id)?;
    Ok(db::read::<Period>(
        db,
        "SELECT * FROM periods WHERE user_id=?1 AND id=?2",
        &[profile_id.to_string().into(), id.to_string().into()],
    )?
    .into_iter()
    .next())
}

/// Returns the row, or JSON null when the profile has no such Period.
pub fn get(db: &Connection, profile_id: &str, id: &str) -> Result<Value> {
    Ok(find(db, profile_id, id)?.map_or(Value::Null, |row| json!(row)))
}

pub struct Fields<'a> {
    pub label: &'a str,
    pub start_on: &'a str,
    pub end_on: &'a Option<String>,
    pub note: &'a Option<String>,
}

fn insert(db: &Connection, profile_id: &str, now: &str, new_id: &str, fields: &Fields) -> Result<Period> {
    db::valid_id(new_id)?;
    let row = Period {
        id: new_id.into(),
        user_id: profile_id.into(),
        label: fields.label.into(),
        start_on: fields.start_on.into(),
        end_on: fields.end_on.clone(),
        note: fields.note.clone(),
        revision: 1,
        created_at: now.into(),
        updated_at: now.into(),
    };
    validate(&row)?;
    let owned: i64 = db
        .query_row("SELECT count(*) FROM periods WHERE user_id=?1", params![profile_id], |row| row.get(0))
        .map_err(error)?;
    if owned >= MAX_PER_PROFILE {
        return Err(LIMIT_MESSAGE.into());
    }
    db::insert(db, profile_id, &row)?;
    Ok(row)
}

/// Adds a Period. Fails with the limit message when the profile holds 500.
pub fn create(db: &Connection, profile_id: &str, now: &str, new_id: &str, fields: &Fields) -> Result<Value> {
    Ok(json!(insert(db, profile_id, now, new_id, fields)?))
}

/// Adds the Period unless one with the same label, first day and last day exists
/// (ongoing matches ongoing). The command runs in one transaction, so two overlapping
/// imports store one Period. An existing Period is returned unchanged.
pub fn create_if_absent(
    db: &Connection,
    profile_id: &str,
    now: &str,
    new_id: &str,
    fields: &Fields,
) -> Result<Value> {
    let existing = db::read::<Period>(
        db,
        "SELECT * FROM periods WHERE user_id=?1 AND label=?2 AND start_on=?3 AND end_on IS ?4 ORDER BY created_at,id LIMIT 1",
        &[
            profile_id.to_string().into(),
            fields.label.to_string().into(),
            fields.start_on.to_string().into(),
            fields.end_on.clone().into(),
        ],
    )?
    .into_iter()
    .next();
    if let Some(period) = existing {
        return Ok(json!({ "period": period, "created": false }));
    }
    let period = insert(db, profile_id, now, new_id, fields)?;
    Ok(json!({ "period": period, "created": true }))
}

/// Compare-and-set on `revision`. Returns JSON null when the Period is gone or its
/// revision differs. An unchanged write returns the row without raising the revision.
pub fn update(
    db: &Connection,
    profile_id: &str,
    now: &str,
    id: &str,
    expected_revision: i64,
    fields: &Fields,
) -> Result<Value> {
    let Some(mut row) = find(db, profile_id, id)? else {
        return Ok(Value::Null);
    };
    if row.revision != expected_revision {
        return Ok(Value::Null);
    }
    if row.label == fields.label
        && row.start_on == fields.start_on
        && row.end_on == *fields.end_on
        && row.note == *fields.note
    {
        return Ok(json!(row));
    }
    if row.revision >= MAX_REVISION {
        return Err("The period revision limit has been reached.".into());
    }
    row.label = fields.label.into();
    row.start_on = fields.start_on.into();
    row.end_on = fields.end_on.clone();
    row.note = fields.note.clone();
    row.revision += 1;
    row.updated_at = now.into();
    validate(&row)?;
    db::update(db, profile_id, id, &row)?;
    Ok(json!(row))
}

/// Removes the Period for good and records a tombstone. Returns the deleted id, or
/// JSON null when the Period is gone or its revision differs.
pub fn delete(
    db: &Connection,
    profile_id: &str,
    mutation_id: &str,
    now: &str,
    id: &str,
    expected_revision: i64,
) -> Result<Value> {
    let Some(row) = find(db, profile_id, id)? else {
        return Ok(Value::Null);
    };
    if row.revision != expected_revision {
        return Ok(Value::Null);
    }
    tombstone(db, profile_id, mutation_id, now, "periods", id)?;
    db.execute("DELETE FROM periods WHERE user_id=?1 AND id=?2", params![profile_id, id])
        .map_err(error)?;
    Ok(json!(id))
}
