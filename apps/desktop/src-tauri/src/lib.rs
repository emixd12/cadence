mod auth;
mod calendar_cache;
mod files;
mod local_store;
mod location;
mod notifications;
mod storage;
mod updates;

#[cfg(feature = "contract-harness")]
pub fn run_local_store_contract(path: &std::path::Path) -> Result<(), String> {
    local_store::run_contract(path)
}

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, State};

#[tauri::command]
fn spike_read(database: State<'_, Mutex<Connection>>) -> Result<storage::Snapshot, String> {
    let connection = database.lock().map_err(|_| "SQLite lock is unavailable.")?;
    storage::read(&connection)
}

#[tauri::command]
fn spike_write(
    database: State<'_, Mutex<Connection>>,
    value: String,
    force_rollback: bool,
) -> Result<storage::Snapshot, String> {
    let mut connection = database.lock().map_err(|_| "SQLite lock is unavailable.")?;
    storage::write(&mut connection, &value, force_rollback)
}

pub fn run() {
    // Install the delegate before AppKit finishes launch, including notification launches.
    notifications::initialize();
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            local_store::adopt_previous_identity(&directory).map_err(std::io::Error::other)?;
            let database = storage::open(&directory.join("native-boundary-spike.sqlite3"))
                .map_err(std::io::Error::other)?;
            app.manage(Mutex::new(database));
            let local = local_store::open(&directory.join("cadence.sqlite3"))
                .map_err(std::io::Error::other)?;
            app.manage(local);
            let calendar = calendar_cache::open(&directory.join("calendar-cache.sqlite3"))
                .map_err(std::io::Error::other)?;
            app.manage(calendar);
            if updates::is_configured(app.handle()) {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            notifications::attach(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            spike_read,
            spike_write,
            auth::auth_open_url,
            auth::auth_secret_get,
            auth::auth_secret_set,
            auth::auth_secret_remove,
            auth::auth_account_metadata,
            auth::auth_record_account_metadata,
            auth::auth_clear_account_metadata,
            auth::auth_first_link_baseline,
            auth::auth_account_sync_context,
            auth::auth_complete_account_sync,
            auth::auth_begin_first_link,
            calendar_cache::calendar_cache_begin,
            calendar_cache::calendar_cache_read,
            calendar_cache::calendar_cache_read_current,
            calendar_cache::calendar_cache_replace,
            calendar_cache::calendar_cache_clear,
            calendar_cache::connector_cache_begin,
            calendar_cache::connector_cache_read,
            calendar_cache::connector_cache_read_current,
            calendar_cache::connector_cache_replace,
            calendar_cache::connector_cache_clear,
            notifications::native_notifications,
            notifications::native_events,
            location::foreground_location,
            location::open_location_settings,
            local_store::local_store,
            files::save_export,
            files::local_database_info,
            files::delete_storage_recovery_backup,
            files::reveal_local_database,
            files::backup_local_database,
            files::create_protected_local_backup,
            files::disconnect_keep_local_copy,
            files::disconnect_remove_account_data,
            files::restore_local_database,
            updates::read_update_configuration,
            updates::restart_after_update
        ])
        .run(tauri::generate_context!())
        .expect("Cadence could not open its local data");
}
