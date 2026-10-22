#[tauri::command]
pub async fn foreground_location(request_permission: bool) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        static ACTIVE: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = ACTIVE.try_lock().map_err(|_| "A location request is already active.".to_string())?;
        request(request_permission)
    })
        .await
        .map_err(|_| "Location is unavailable.".to_string())?
}

#[cfg(target_os = "macos")]
fn request(request_permission: bool) -> Result<serde_json::Value, String> {
    use std::ffi::{c_char, c_void, CStr};
    extern "C" {
        fn cadence_location_request(request_permission: bool) -> *mut c_char;
        fn free(value: *mut c_void);
    }
    let pointer = unsafe { cadence_location_request(request_permission) };
    if pointer.is_null() { return Ok(serde_json::json!({ "state": "unavailable", "reason": "bridge" })); }
    let result = unsafe { serde_json::from_slice(CStr::from_ptr(pointer).to_bytes()) };
    unsafe { free(pointer.cast()) };
    result.map_err(|_| "Location is unavailable.".into())
}

#[cfg(not(target_os = "macos"))]
fn request(_: bool) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "state": "unavailable", "reason": "bridge" }))
}

/// System Settings › Privacy & Security › Location Services. The webview passes no URL.
const LOCATION_SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices";

#[tauri::command]
pub fn open_location_settings() -> Result<(), String> {
    open_settings(LOCATION_SETTINGS_URL)
}

#[cfg(target_os = "macos")]
fn open_settings(url: &str) -> Result<(), String> {
    extern "C" {
        fn cadence_auth_open_url(value: *const std::ffi::c_char) -> bool;
    }
    let value = std::ffi::CString::new(url).map_err(|_| "System Settings could not open.".to_string())?;
    if unsafe { cadence_auth_open_url(value.as_ptr()) } { Ok(()) } else { Err("System Settings could not open.".into()) }
}

#[cfg(not(target_os = "macos"))]
fn open_settings(_: &str) -> Result<(), String> {
    Err("System Settings could not open.".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn settings_link_targets_only_the_location_services_pane() {
        let url = super::LOCATION_SETTINGS_URL;
        assert!(url.starts_with("x-apple.systempreferences:com.apple.preference.security?"));
        assert!(url.ends_with("?Privacy_LocationServices"));
        assert!(!url.contains(char::is_whitespace));
    }
}
