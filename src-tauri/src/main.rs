// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod sidecar;
mod watcher;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub sidecar_manager: Mutex<sidecar::SidecarManager>,
    pub sidecar_url: String,
}

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .setup(|app| {
            // 1. Resolve app data directory
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app data dir");

            log::info!("App data directory: {:?}", app_data_dir);

            // 2. Initialize SQLite database
            let db_path = app_data_dir.join("cortex.db");
            let conn =
                db::initialize(&db_path).expect("failed to initialize database");

            // 3. Resolve sidecar directory
            // In dev mode, the sidecar is relative to the project root
            // TAURI_DEV is set during `tauri dev`; in production, use bundled path
            let sidecar_dir = if cfg!(debug_assertions) {
                // During development, find the sidecar directory relative to the Tauri source
                let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                manifest_dir.parent().unwrap().join("sidecar")
            } else {
                // In production, the sidecar would be bundled alongside the app
                // For now, fall back to the same dev path
                let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                manifest_dir.parent().unwrap().join("sidecar")
            };

            log::info!("Sidecar directory: {:?}", sidecar_dir);

            // 4. Spawn Python sidecar
            let sidecar_port = 9400u16;
            let sidecar_url = format!("http://127.0.0.1:{}", sidecar_port);
            let mut sidecar_manager =
                sidecar::SidecarManager::new(sidecar_port, sidecar_dir);

            if let Err(e) = sidecar_manager.start() {
                log::error!("Failed to start sidecar: {}", e);
                // Don't panic — the app can run in degraded mode
            }

            // 5. Store shared state
            let state = AppState {
                db: Mutex::new(conn),
                sidecar_manager: Mutex::new(sidecar_manager),
                sidecar_url: sidecar_url.clone(),
            };
            app.manage(state);

            // 6. Start background health monitor
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(sidecar::health_monitor_loop(
                app_handle,
                sidecar_url,
            ));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::get_app_status,
        ])
        .build(tauri::generate_context!())
        .expect("error building cortex")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                log::info!("Application exiting, stopping sidecar...");
                let state = app.state::<AppState>();
                let mut manager = state.sidecar_manager.lock().unwrap();
                manager.stop();
            }
        });
}
