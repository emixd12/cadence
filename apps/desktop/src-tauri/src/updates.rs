use serde::Serialize;
use std::sync::MutexGuard;

use crate::local_store::LocalStore;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConfiguration {
    configured: bool,
    version: String,
}

fn valid_configuration(identifier: &str, config: Option<&serde_json::Value>) -> bool {
    if identifier != "app.cadence.desktop" {
        return false;
    }
    let Some(config) = config else {
        return false;
    };
    if !config
        .get("pubkey")
        .and_then(|v| v.as_str())
        .is_some_and(|v| !v.trim().is_empty())
    {
        return false;
    }
    for flag in [
        "dangerousInsecureTransportProtocol",
        "dangerousAcceptInvalidCerts",
        "dangerousAcceptInvalidHostnames",
    ] {
        if config.get(flag).is_some_and(|v| v != false) {
            return false;
        }
    }
    config
        .get("endpoints")
        .and_then(|v| v.as_array())
        .is_some_and(|endpoints| {
            !endpoints.is_empty()
                && endpoints.iter().all(|value| {
                    value
                        .as_str()
                        .and_then(|v| tauri::Url::parse(v).ok())
                        .is_some_and(|url| {
                            url.scheme() == "https"
                                && url.host_str().is_some()
                                && url.username().is_empty()
                                && url.password().is_none()
                        })
                })
        })
}

pub fn is_configured(app: &tauri::AppHandle) -> bool {
    valid_configuration(
        &app.config().identifier,
        app.config().plugins.0.get("updater"),
    )
}

#[tauri::command]
pub fn read_update_configuration(app: tauri::AppHandle) -> UpdateConfiguration {
    UpdateConfiguration {
        configured: is_configured(&app),
        version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
pub fn restart_after_update(
    app: tauri::AppHandle,
    local: tauri::State<'_, LocalStore>,
) -> Result<(), String> {
    if !is_configured(&app) {
        return Err("Signed updates are not configured for this build.".into());
    }
    let _restart_guard = lock_for_restart(&local)?;
    // A failed withdrawal must not block the update; the next build still reports truthful coverage.
    let _ = crate::notifications::withdraw_pending_before_update();
    app.restart()
}

fn lock_for_restart(store: &LocalStore) -> Result<MutexGuard<'_, rusqlite::Connection>, String> {
    store
        .0
        .try_lock()
        .map_err(|_| "Cadence is still saving changes. Try again when saving finishes.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn updater_requires_final_identity_key_https_and_certificate_validation() {
        let config = json!({"pubkey":"test-key", "endpoints":["https://releases.cadence.invalid/latest.json"]});
        assert!(valid_configuration("app.cadence.desktop", Some(&config)));
        assert!(!valid_configuration(
            "app.cadence.desktop-spike",
            Some(&config)
        ));
        assert!(!valid_configuration("app.cadence.desktop", None));
        for bad in [
            json!({"pubkey":"", "endpoints":["https://releases.cadence.invalid/latest.json"]}),
            json!({"pubkey":"test-key", "endpoints":[]}),
            json!({"pubkey":"test-key", "endpoints":["http://releases.cadence.invalid/latest.json"]}),
            json!({"pubkey":"test-key", "endpoints":["https://user:secret@releases.cadence.invalid/latest.json"]}),
            json!({"pubkey":"test-key", "endpoints":["https://releases.cadence.invalid/latest.json"], "dangerousAcceptInvalidCerts":true}),
        ] {
            assert!(!valid_configuration("app.cadence.desktop", Some(&bad)));
        }
    }

    #[test]
    fn restart_lock_rejects_an_active_local_write() {
        let store = LocalStore(std::sync::Mutex::new(
            rusqlite::Connection::open_in_memory().unwrap(),
        ));
        let write = store.0.lock().unwrap();

        assert_eq!(
            lock_for_restart(&store).err().as_deref(),
            Some("Cadence is still saving changes. Try again when saving finishes.")
        );
        drop(write);
        assert!(lock_for_restart(&store).is_ok());
    }
}
