use super::{db, rows::TravelSettings, Result, TravelHabitsMutation, TravelSettingsMutation};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

/// Ticket 217 bounds, matching `TRAVEL_HABIT_RULES` (travel-habit-defaults@1) and the hosted checks.
const MAX_PREPARATION_MINUTES: i64 = 60;
const MAX_ARRIVAL_BUFFER_MINUTES: i64 = 30;
const MAX_REMEMBERED_PLACES: usize = 100;
const MAX_RETAINED_ANSWERS: usize = 30;

pub fn read(db: &Connection, profile_id: &str) -> Result<TravelSettings> {
    db::owned::<TravelSettings>(db, profile_id)?
        .into_iter()
        .next()
        .ok_or_else(|| "Travel settings are unavailable.".into())
}

pub fn read_value(db: &Connection, profile_id: &str) -> Result<Value> {
    let row = read(db, profile_id)?;
    Ok(json!({
        "enabled": row.enabled,
        "baseLocationText": row.base_location_text,
        "mode": row.mode,
        "navigationPreference": row.navigation_preference,
        "routingConsentAt": row.routing_consent_at,
        "onboardingCompletedAt": row.onboarding_completed_at,
        "updatedAt": row.updated_at,
        "habits": habits_value(&row)?,
    }))
}

/// Stored snake_case entries become the shared camelCase `TravelHabits` shape.
fn habits_value(row: &TravelSettings) -> Result<Value> {
    validate_place_modes(&row.place_modes)?;
    validate_leave_feedback(&row.leave_feedback)?;
    let place_modes: Vec<Value> = row.place_modes.as_array().into_iter().flatten().map(|entry| json!({
        "placeKey": entry["place_key"],
        "mode": entry["mode"],
        "chosenAt": entry["chosen_at"],
    })).collect();
    let leave_feedback: Vec<Value> = row.leave_feedback.as_array().into_iter().flatten().map(|entry| json!({
        "eventRef": entry["event_ref"],
        "localDate": entry["local_date"],
        "answer": entry["answer"],
        "answeredAt": entry["answered_at"],
        "rulesVersion": entry["rules_version"],
    })).collect();
    Ok(json!({
        "preparationMinutes": row.preparation_minutes,
        "arrivalBufferMinutes": row.arrival_buffer_minutes,
        "placeModes": place_modes,
        "leaveFeedback": leave_feedback,
        "updatedAt": row.habits_updated_at,
    }))
}

pub fn write(
    db: &Connection,
    profile_id: &str,
    now: &str,
    expected_updated_at: &str,
    next: &TravelSettingsMutation,
) -> Result<Value> {
    db::instant_key(expected_updated_at)?;
    db::instant_key(&next.updated_at)?;
    for value in [&next.routing_consent_at, &next.onboarding_completed_at].into_iter().flatten() {
        db::instant_key(value)?;
    }
    let current = read(db, profile_id)?;
    if current.updated_at != expected_updated_at {
        return Err("Travel settings changed after they were loaded.".into());
    }
    if next.updated_at != now {
        return Err("Travel settings history is invalid.".into());
    }
    if next.enabled && (next.mode.is_none() || next.routing_consent_at.is_none()) {
        return Err("Enabled travel requires a mode and routing consent.".into());
    }
    if next.mode.as_deref().is_some_and(|mode| !matches!(mode, "walking" | "cycling" | "transit" | "driving"))
        || next.navigation_preference.as_deref().is_some_and(|app| !matches!(app, "google_maps" | "apple_maps"))
        || next.base_location_text.as_deref().is_some_and(|text| text.trim() != text || text.is_empty() || text.len() > 500 || text.chars().any(char::is_control))
    {
        return Err("Travel settings contain an unsupported value.".into());
    }
    let changed = db.execute(
        "UPDATE travel_settings SET enabled=?3,base_location_text=?4,mode=?5,navigation_preference=?6,routing_consent_at=?7,onboarding_completed_at=?8,updated_at=?9 WHERE user_id=?1 AND updated_at=?2",
        params![profile_id, expected_updated_at, next.enabled, next.base_location_text, next.mode,
            next.navigation_preference, next.routing_consent_at, next.onboarding_completed_at, next.updated_at],
    ).map_err(db::error)?;
    if changed != 1 {
        return Err("Travel settings changed after they were loaded.".into());
    }
    read_value(db, profile_id)
}

/// Ticket 217: one habit change planned in TypeScript, checked against its own revision.
pub fn write_habits(
    db: &Connection,
    profile_id: &str,
    now: &str,
    expected_updated_at: Option<&str>,
    next: &TravelHabitsMutation,
) -> Result<Value> {
    if next.updated_at != now || !canonical_instant(&next.updated_at) {
        return Err("Travel habits history is invalid.".into());
    }
    let current = read(db, profile_id)?;
    if current.habits_updated_at.as_deref() != expected_updated_at {
        return Err("Travel habits changed after they were loaded.".into());
    }
    if next.preparation_minutes.is_some_and(|value| !(0..=MAX_PREPARATION_MINUTES).contains(&value))
        || next.arrival_buffer_minutes.is_some_and(|value| !(0..=MAX_ARRIVAL_BUFFER_MINUTES).contains(&value))
    {
        return Err("Travel habits contain an unsupported value.".into());
    }
    let place_modes = Value::Array(next.place_modes.iter().map(|entry| json!({
        "place_key": entry.place_key,
        "mode": entry.mode,
        "chosen_at": entry.chosen_at,
    })).collect());
    let leave_feedback = Value::Array(next.leave_feedback.iter().map(|entry| json!({
        "event_ref": entry.event_ref,
        "local_date": entry.local_date,
        "answer": entry.answer,
        "answered_at": entry.answered_at,
        "rules_version": entry.rules_version,
    })).collect());
    validate_place_modes(&place_modes)?;
    validate_leave_feedback(&leave_feedback)?;
    let changed = db.execute(
        "UPDATE travel_settings SET preparation_minutes=?3,arrival_buffer_minutes=?4,place_modes=?5,leave_feedback=?6,habits_updated_at=?7 WHERE user_id=?1 AND habits_updated_at IS ?2",
        params![profile_id, expected_updated_at, next.preparation_minutes, next.arrival_buffer_minutes,
            place_modes.to_string(), leave_feedback.to_string(), next.updated_at],
    ).map_err(db::error)?;
    if changed != 1 {
        return Err("Travel habits changed after they were loaded.".into());
    }
    read_value(db, profile_id)
}

/// Same rules as the hosted `travel_place_modes_valid`: digests in ascending order, one mode each.
pub fn validate_place_modes(value: &Value) -> Result<()> {
    let entries = value.as_array().ok_or("Travel habits are invalid.")?;
    if entries.len() > MAX_REMEMBERED_PLACES {
        return Err("Travel habits are invalid.".into());
    }
    let mut previous: Option<&str> = None;
    for entry in entries {
        let row = entry.as_object().ok_or("Travel habits are invalid.")?;
        let key = row.get("place_key").and_then(Value::as_str).unwrap_or("");
        if row.len() != 3
            || !place_key(key)
            || !row.get("mode").and_then(Value::as_str).is_some_and(|mode| matches!(mode, "walking" | "cycling" | "transit" | "driving"))
            || !row.get("chosen_at").and_then(Value::as_str).is_some_and(canonical_instant)
            || previous.is_some_and(|last| key <= last)
        {
            return Err("Travel habits are invalid.".into());
        }
        previous = Some(key);
    }
    Ok(())
}

/// Same rules as the hosted `travel_leave_feedback_valid`: one answer per local date, ascending.
pub fn validate_leave_feedback(value: &Value) -> Result<()> {
    let entries = value.as_array().ok_or("Travel habits are invalid.")?;
    if entries.len() > MAX_RETAINED_ANSWERS {
        return Err("Travel habits are invalid.".into());
    }
    let mut previous: Option<&str> = None;
    for entry in entries {
        let row = entry.as_object().ok_or("Travel habits are invalid.")?;
        let local_date = row.get("local_date").and_then(Value::as_str).unwrap_or("");
        let version = row.get("rules_version").and_then(Value::as_str).unwrap_or("");
        if row.len() != 5
            || !digest(row.get("event_ref").and_then(Value::as_str).unwrap_or(""))
            || local_date.len() != 10
            || db::valid_date(local_date).is_err()
            || !row.get("answer").and_then(Value::as_str).is_some_and(|answer| matches!(answer, "too_early" | "about_right" | "too_late"))
            || !row.get("answered_at").and_then(Value::as_str).is_some_and(canonical_instant)
            || !rules_version(version)
            || previous.is_some_and(|last| local_date <= last)
        {
            return Err("Travel habits are invalid.".into());
        }
        previous = Some(local_date);
    }
    Ok(())
}

/// The Ticket 216 place key: unpadded base64url SHA-256, 43 characters.
fn place_key(value: &str) -> bool {
    value.len() == 43 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn rules_version(value: &str) -> bool {
    value.strip_prefix("travel-habit-defaults@").is_some_and(|number| {
        !number.is_empty() && !number.starts_with('0') && number.bytes().all(|byte| byte.is_ascii_digit())
    })
}

/// YYYY-MM-DDTHH:MM:SS.ffffffZ, the canonical instant every platform writes.
pub fn canonical_instant(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.is_ascii()
        && bytes.len() == 27
        && bytes[10] == b'T'
        && bytes[19] == b'.'
        && bytes[26] == b'Z'
        && bytes[20..26].iter().all(u8::is_ascii_digit)
        && db::valid_date(&value[..10]).is_ok()
        && db::valid_time(&value[11..19]).is_ok()
}
