use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reminder {
    id: String,
    title: String,
    body: String,
    fire_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum NotificationRequest {
    Status {},
    RequestPermission {},
    Pending {},
    Delivered {},
    Schedule { reminders: Vec<Reminder> },
    Cancel { ids: Vec<String> },
    CancelPending { ids: Vec<String> },
}

fn validate(request: &NotificationRequest) -> Result<(), String> {
    let ids: Vec<&String> = match request {
        NotificationRequest::Schedule { reminders } => {
            if reminders.iter().any(|r| {
                r.title.is_empty()
                    || r.title.encode_utf16().count() > 200
                    || r.body.encode_utf16().count() > 2000
                    || r.fire_at.len() > 40
            }) {
                return Err(
                    "Reminder title, body, or timestamp exceeds native request limits.".into(),
                );
            }
            reminders.iter().map(|reminder| &reminder.id).collect()
        }
        NotificationRequest::Cancel { ids } | NotificationRequest::CancelPending { ids } => {
            ids.iter().collect()
        }
        _ => return Ok(()),
    };
    if ids.len() > 4096
        || (ids.is_empty() && matches!(request, NotificationRequest::Schedule { .. }))
    {
        return Err("A schedule operation requires between 1 and 4096 reminders; this is not an OS scheduling limit.".into());
    }
    let mut seen = HashSet::new();
    for id in ids {
        let product_id = id.strip_prefix("cadence.local.").is_some_and(|uuid| {
            uuid.len() == 36
                && uuid.bytes().enumerate().all(|(index, byte)| {
                    if [8, 13, 18, 23].contains(&index) {
                        byte == b'-'
                    } else {
                        byte.is_ascii_hexdigit()
                    }
                })
        });
        if !(id.starts_with("cadence-spike.") || product_id)
            || id.len() > 160
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b".-_".contains(&c))
            || !seen.insert(id)
        {
            return Err("Reminder IDs must be unique cadence-spike. identifiers or cadence.local.<occurrence UUID>.".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn native_notifications(request: NotificationRequest) -> Result<Value, String> {
    validate(&request)?;
    tauri::async_runtime::spawn_blocking(move || platform::request(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn native_events() -> Result<Value, String> {
    platform::events()
}

pub use platform::{attach, initialize};

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::ffi::{c_char, CStr, CString};
    use std::sync::OnceLock;
    use tauri::Emitter;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    extern "C" {
        fn cadence_native_initialize(callback: extern "C" fn());
        fn cadence_native_request(input: *const c_char) -> *mut c_char;
        fn cadence_native_events() -> *mut c_char;
        fn cadence_native_free(value: *mut c_char);
    }

    extern "C" fn changed() {
        if let Some(app) = APP.get() {
            let _ = app.emit("desktop-native-event", ());
        }
    }

    pub fn initialize() {
        unsafe { cadence_native_initialize(changed) };
    }
    pub fn attach(app: tauri::AppHandle) {
        let _ = APP.set(app);
    }

    fn decode(pointer: *mut c_char) -> Result<Value, String> {
        if pointer.is_null() {
            return Err("Native adapter returned no response.".into());
        }
        let result = unsafe { serde_json::from_slice::<Value>(CStr::from_ptr(pointer).to_bytes()) };
        unsafe { cadence_native_free(pointer) };
        let value = result.map_err(|error| error.to_string())?;
        if let Some(error) = value.get("error").and_then(Value::as_str) {
            return Err(error.into());
        }
        Ok(value)
    }

    pub fn request(request: &NotificationRequest) -> Result<Value, String> {
        let input =
            CString::new(serde_json::to_string(request).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        decode(unsafe { cadence_native_request(input.as_ptr()) })
    }

    pub fn events() -> Result<Value, String> {
        decode(unsafe { cadence_native_events() })
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;
    pub fn initialize() {}
    pub fn attach(_: tauri::AppHandle) {}
    pub fn request(_: &NotificationRequest) -> Result<Value, String> {
        Err("This native spike requires macOS 14 or newer.".into())
    }
    pub fn events() -> Result<Value, String> {
        Ok(serde_json::json!([]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivered_readback_does_not_accept_mutation_arguments() {
        let request =
            serde_json::from_str::<NotificationRequest>(r#"{"operation":"delivered"}"#).unwrap();
        assert!(matches!(request, NotificationRequest::Delivered {}));
        assert!(validate(&request).is_ok());
        for input in [
            r#"{"operation":"delivered","ids":[]}"#,
            r#"{"operation":"delivered","reminders":[]}"#,
        ] {
            assert!(serde_json::from_str::<NotificationRequest>(input).is_err());
        }
    }

    #[test]
    fn pending_cancellation_preserves_the_owned_identifier_boundary() {
        let request = serde_json::from_str::<NotificationRequest>(
            r#"{"operation":"cancelPending","ids":["cadence.local.00000000-0000-4000-a000-000000000010"]}"#,
        ).unwrap();
        assert!(matches!(request, NotificationRequest::CancelPending { .. }));
        assert!(validate(&request).is_ok());
        for ids in [
            vec!["other-app.id".into()],
            vec!["cadence-spike.same".into(); 2],
            vec!["cadence-spike.too-many".into(); 4097],
        ] {
            assert!(validate(&NotificationRequest::CancelPending { ids }).is_err());
        }
        assert!(serde_json::from_str::<NotificationRequest>(
            r#"{"operation":"cancelPending","ids":[],"reminders":[]}"#,
        )
        .is_err());
    }

    #[test]
    fn native_text_limits_match_javascript_utf16_units() {
        let mut reminder = Reminder {
            id: "cadence-spike.unicode".into(),
            title: "🟢".repeat(80),
            body: "明".repeat(2000),
            fire_at: "2026-09-01T12:00:00Z".into(),
        };
        assert!(validate(&NotificationRequest::Schedule {
            reminders: vec![reminder.clone()]
        })
        .is_ok());
        reminder.title = "🟢".repeat(101);
        assert!(validate(&NotificationRequest::Schedule {
            reminders: vec![reminder]
        })
        .is_err());
    }

    #[test]
    fn notification_commands_reject_unscoped_duplicate_and_oversized_requests() {
        for ids in [
            vec!["other-app.id".into()],
            vec!["cadence-spike.same".into(); 2],
            vec!["cadence-spike.too-many".into(); 4097],
        ] {
            assert!(validate(&NotificationRequest::Cancel { ids }).is_err());
        }
        assert!(validate(&NotificationRequest::Cancel {
            ids: vec!["cadence-spike.allowed".into()]
        })
        .is_ok());
        assert!(validate(&NotificationRequest::Cancel { ids: vec![] }).is_ok());
        assert!(validate(&NotificationRequest::Cancel {
            ids: vec!["cadence.local.00000000-0000-4000-a000-000000000010".into()]
        })
        .is_ok());
        assert!(validate(&NotificationRequest::Cancel {
            ids: vec!["cadence.local.not-a-uuid".into()]
        })
        .is_err());
        assert!(validate(&NotificationRequest::Schedule { reminders: vec![] }).is_err());
        assert!(serde_json::from_str::<NotificationRequest>(
            r#"{"operation":"cancel","ids":[],"sql":"DROP TABLE"}"#
        )
        .is_err());
    }
}
