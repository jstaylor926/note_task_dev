// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod events;
mod sidecar;
mod watcher;
mod ingest;
mod pty;
mod pty_commands;
mod osc_parser;
mod shell_hooks;

use std::sync::Mutex;
use tauri::{Manager, Listener};

pub struct IndexingState {
    pub total_queued: usize,
    pub completed: usize,
    pub current_file: Option<String>,
}

impl IndexingState {
    pub fn new() -> Self {
        Self {
            total_queued: 0,
            completed: 0,
            current_file: None,
        }
    }

    pub fn is_idle(&self) -> bool {
        self.completed >= self.total_queued
    }
}

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub sidecar_manager: Mutex<sidecar::SidecarManager>,
    pub sidecar_url: String,
    pub indexing: Mutex<IndexingState>,
    pub git_branch: String,
    pub pty_manager: Mutex<pty::PtyManager>,
    pub shell_hooks_dir: Option<std::path::PathBuf>,
}

/// Detect the current git branch by running `git rev-parse --abbrev-ref HEAD`.
fn detect_git_branch(project_root: &std::path::Path) -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(project_root)
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "main".to_string())
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

            // 5. Detect git branch and project root
            let project_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("failed to resolve project root")
                .to_path_buf();
            let git_branch = detect_git_branch(&project_root);
            log::info!("Detected git branch: {}", git_branch);

            // 6. Set up shell hooks for terminal integration
            let shell_hooks_dir = match shell_hooks::setup_hook_dir(&app_data_dir) {
                Ok(dir) => {
                    log::info!("Shell hooks installed at {:?}", dir);
                    Some(dir)
                }
                Err(e) => {
                    log::error!("Failed to set up shell hooks: {}", e);
                    None
                }
            };

            // 7. Store shared state
            let state = AppState {
                db: Mutex::new(conn),
                sidecar_manager: Mutex::new(sidecar_manager),
                sidecar_url: sidecar_url.clone(),
                indexing: Mutex::new(IndexingState::new()),
                git_branch,
                pty_manager: Mutex::new(pty::PtyManager::new()),
                shell_hooks_dir,
            };
            app.manage(state);

            let app_handle_for_events = app.handle().clone();
            app.listen(events::TERMINAL_COMMAND_END, move |event| {
                if let Ok(payload) = serde_json::from_str::<events::TerminalCommandEndPayload>(event.payload()) {
                    let state = app_handle_for_events.state::<AppState>();
                    if let Ok(conn) = state.inner().db.lock() {
                        let profile_id = db::get_active_profile_id(&conn)
                            .unwrap_or(None)
                            .unwrap_or_else(|| "default".to_string());
                        
                        if let Err(e) = db::insert_terminal_command(
                            &conn,
                            &profile_id,
                            &payload.command,
                            payload.cwd.as_deref(),
                            payload.exit_code,
                            payload.duration_ms,
                        ) {
                            log::error!("Failed to persist terminal command: {}", e);
                        }
                    }
                }
            });

            // 7. Start background health monitor
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(sidecar::health_monitor_loop(
                app_handle.clone(),
                sidecar_url,
            ));
            tauri::async_runtime::spawn(watcher::start_watcher(
                app_handle,
                project_root,
            ));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::get_app_status,
            commands::semantic_search,
            commands::get_indexing_status,
            pty_commands::pty_create,
            pty_commands::pty_write,
            pty_commands::pty_resize,
            pty_commands::pty_kill,
        ])
        .build(tauri::generate_context!())
        .expect("error building cortex")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                log::info!("Application exiting, stopping sidecar and PTY sessions...");
                let state = app.state::<AppState>();
                let mut manager = state.sidecar_manager.lock().unwrap();
                manager.stop();
                let mut pty_mgr = state.pty_manager.lock().unwrap();
                pty_mgr.kill_all();
            }
        });
}
