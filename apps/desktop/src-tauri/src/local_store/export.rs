use super::{
    behavior,
    db::{self, Result},
    rows::*,
};
use rusqlite::{types::Value as SqlValue, Connection};
use serde_json::{json, Value};

// The dispatcher holds one read transaction across all collections.
pub fn read(
    db: &Connection,
    profile_id: &str,
    start_local_date: Option<&str>,
    end_local_date: &str,
    include_time_tracking: bool,
    through_started_at: &str,
) -> Result<Value> {
    db::valid_date(end_local_date)?;
    if let Some(start) = start_local_date {
        db::valid_date(start)?;
        if start > end_local_date {
            return Err("The export date range is inverted.".into());
        }
    }
    let through = db::instant_key(through_started_at)?;
    let values: Vec<SqlValue> = vec![
        profile_id.to_string().into(),
        start_local_date.map_or(SqlValue::Null, |value| value.to_string().into()),
        end_local_date.to_string().into(),
    ];
    let occurrences = db::read::<Occurrence>(db,
        "SELECT * FROM occurrences WHERE user_id=?1 AND (?2 IS NULL OR local_date>=?2) AND local_date<=?3 ORDER BY local_date,scheduled_for,id", &values)?;
    let status_events = db::read::<OccurrenceStatusEvent>(db,
        "SELECT r.* FROM occurrence_status_events r JOIN occurrences o ON o.user_id=r.user_id AND o.id=r.occurrence_id WHERE r.user_id=?1 AND (?2 IS NULL OR o.local_date>=?2) AND o.local_date<=?3 ORDER BY r.recorded_at,r.created_at,r.id", &values)?;
    let reminder_deliveries = db::read::<ReminderDelivery>(db,
        "SELECT r.* FROM reminder_deliveries r JOIN occurrences o ON o.user_id=r.user_id AND o.id=r.occurrence_id WHERE r.user_id=?1 AND (?2 IS NULL OR o.local_date>=?2) AND o.local_date<=?3 ORDER BY r.scheduled_send_at,r.id", &values)?;
    let native_reminders = db::read::<NativeReminderState>(db,
        "SELECT r.* FROM native_reminder_state r JOIN occurrences o ON o.user_id=r.user_id AND o.id=r.occurrence_id WHERE r.user_id=?1 AND (?2 IS NULL OR o.local_date>=?2) AND o.local_date<=?3 ORDER BY r.fire_at,r.id", &values)?;
    let time_sessions = if include_time_tracking {
        let mut time_values = values.clone();
        time_values.push(through.into());
        // Normalize stored fractional seconds before comparison; text order alone loses nanoseconds.
        db::read::<OccurrenceTimeSession>(db,
            "SELECT r.* FROM occurrence_time_sessions r JOIN occurrences o ON o.user_id=r.user_id AND o.id=r.occurrence_id WHERE r.user_id=?1 AND (?2 IS NULL OR o.local_date>=?2) AND o.local_date<=?3 AND (substr(r.started_at,1,19)||'.'||substr((CASE WHEN substr(r.started_at,20,1)='.' THEN substr(r.started_at,21,length(r.started_at)-21) ELSE '' END)||'000000000',1,9))<=?4 ORDER BY r.started_at,r.id", &time_values)?
    } else {
        vec![]
    };
    Ok(json!({
        "categories":db::owned::<Category>(db,profile_id)?,
        "graphs":behavior::read_graphs(db,profile_id)?,
        "behaviorDefinitionEvents":db::owned::<BehaviorDefinitionEvent>(db,profile_id)?,
        "behaviorConfigurationEvents":db::owned::<BehaviorConfigurationEvent>(db,profile_id)?,
        "occurrences":occurrences,
        "statusEvents":status_events,
        "reminderDeliveries":reminder_deliveries,
        "timeSessions":time_sessions,
        "nativeReminders":native_reminders,
        "importedNotes":db::owned::<ImportedNote>(db,profile_id)?,
        "importedInterventions":db::owned::<ImportedIntervention>(db,profile_id)?,
        "importRuns":db::owned::<BehaviorLogImportRun>(db,profile_id)?.into_iter().filter(|row| row.status == "applied").collect::<Vec<_>>(),
        "importMappings":db::owned::<BehaviorLogImportRecordMapping>(db,profile_id)?,
        "dayNotes":super::day_note::owned_if_present(db,profile_id)?
    }))
}
