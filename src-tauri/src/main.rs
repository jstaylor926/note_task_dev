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
mod file_commands;
mod entity_commands;
mod lsp;
mod lsp_commands;
mod remote_auth;
mod remote_server;

use std::sync::{Arc, Mutex};
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
    pub lsp_manager: lsp::LspManager,
    pub shell_hooks_dir: Option<std::path::PathBuf>,
    pub project_root: String,
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
                // In production, the sidecar would be bundled alongside the app as a resource
                app.path()
                    .resolve("sidecar", tauri::path::BaseDirectory::Resource)
                    .expect("failed to resolve production sidecar path")
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
            let shell_hooks_dir_clone = shell_hooks_dir.clone();
            let state = AppState {
                db: Mutex::new(conn),
                sidecar_manager: Mutex::new(sidecar_manager),
                sidecar_url: sidecar_url.clone(),
                indexing: Mutex::new(IndexingState::new()),
                git_branch,
                pty_manager: Mutex::new(pty::PtyManager::new()),
                lsp_manager: lsp::LspManager::new(),
                shell_hooks_dir,
                project_root: project_root.to_string_lossy().to_string(),
            };

            app.manage(state);
            let shell_hooks_dir = shell_hooks_dir_clone;

            let app_handle_for_events = app.handle().clone();
            app.listen(events::TERMINAL_COMMAND_END, move |event| {
                if let Ok(payload) = serde_json::from_str::<events::TerminalCommandEndPayload>(event.payload()) {
                    let state = app_handle_for_events.state::<AppState>();
                    let (profile_id, sidecar_url, git_branch) = {
                        let conn = state.inner().db.lock().unwrap();
                        let pid = db::get_active_profile_id(&conn)
                            .unwrap_or(None)
                            .unwrap_or_else(|| "default".to_string());
                        let url = state.inner().sidecar_url.clone();
                        let branch = state.inner().git_branch.clone();
                        (pid, url, branch)
                    };
                    
                    let command_id = {
                        let conn = state.inner().db.lock().unwrap();
                        db::insert_terminal_command(
                            &conn,
                            &profile_id,
                            &payload.command,
                            payload.cwd.as_deref(),
                            payload.exit_code,
                            payload.duration_ms,
                            payload.output.as_deref(),
                        ).unwrap_or_default()
                    };

                    // Fire off background task for embedding if output is substantial
                    if !command_id.is_empty() {
                        if let Some(ref output) = payload.output {
                            if output.len() > 500 {
                                let output_clone = output.clone();
                                let command_clone = payload.command.clone();
                                tauri::async_runtime::spawn(async move {
                                    if let Err(e) = crate::ingest::process_terminal_output(
                                        &command_id,
                                        &command_clone,
                                        &output_clone,
                                        &sidecar_url,
                                        &git_branch,
                                    ).await {
                                        log::error!("Failed to embed terminal output: {}", e);
                                    }
                                });
                            }
                        }
                    }
                }
            });

            // 8. Start background health monitor
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(sidecar::health_monitor_loop(
                app_handle.clone(),
                sidecar_url.clone(),
            ));
            tauri::async_runtime::spawn(watcher::start_watcher(
                app_handle.clone(),
                project_root.clone(),
            ));

            // 9. Start Remote API server (if enabled)
            // Check app_config for remote_access_enabled; default to false
            let app_state = app.state::<AppState>();
            let remote_enabled = {
                let conn_check = app_state.db.lock().unwrap();
                db::get_app_config(&conn_check, "remote_access_enabled")
                    .unwrap_or(None)
                    .map(|v| v == "true")
                    .unwrap_or(false)
            };

            if remote_enabled {
                let remote_port: u16 = {
                    let conn_check = app_state.db.lock().unwrap();
                    db::get_app_config(&conn_check, "remote_api_port")
                        .unwrap_or(None)
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(9401)
                };

                // Open a second DB connection for the remote server (SQLite WAL supports this)
                let remote_db = db::initialize(&db_path)
                    .expect("failed to open second DB connection for remote server");

                let remote_state = remote_auth::RemoteAppState {
                    db: Arc::new(Mutex::new(remote_db)),
                    app_handle: app_handle.clone(),
                    sidecar_url: sidecar_url.clone(),
                    project_root: project_root.to_string_lossy().to_string(),
                    pairing: remote_auth::PairingState::new(),
                    pty_manager: Arc::new(Mutex::new(pty::PtyManager::new())),
                    shell_hooks_dir: shell_hooks_dir.clone(),
                };

                let certs_dir = app_data_dir.join("remote_certs");
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = remote_server::start_server(remote_state, remote_port, certs_dir).await {
                        log::error!("Remote API server failed: {}", e);
                    }
                });

                log::info!("Remote API server started on port {}", remote_port);
            } else {
                log::info!("Remote API server disabled (set remote_access_enabled=true in app_config to enable)");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::get_app_status,
            commands::semantic_search,
            commands::get_indexing_status,
            commands::universal_search,
            pty_commands::pty_create,
            pty_commands::pty_write,
            pty_commands::pty_resize,
            pty_commands::pty_kill,
            file_commands::file_read,
            file_commands::file_write,
            file_commands::file_list_directory,
            file_commands::file_stat,
            file_commands::get_workspace_root,
            file_commands::file_list_all,
            entity_commands::note_create,
            entity_commands::note_get,
            entity_commands::note_list,
            entity_commands::note_update,
            entity_commands::note_delete,
            entity_commands::task_create,
            entity_commands::task_get,
            entity_commands::task_list,
            entity_commands::task_update,
            entity_commands::task_delete,
            entity_commands::entity_link_create,
            entity_commands::entity_link_list,
            entity_commands::entity_link_delete,
            entity_commands::note_auto_link,
            entity_commands::entity_link_confirm,
            entity_commands::entity_links_with_details,
            entity_commands::get_all_entities,
            entity_commands::get_all_links,
            entity_commands::extract_tasks_from_terminal,
            entity_commands::list_suggested_links,
            entity_commands::count_suggested_links,
            entity_commands::task_lineage_batch,
            entity_commands::entity_search,
            commands::get_remote_access_status,
            commands::set_remote_access_enabled,
            commands::set_remote_access_port,
            commands::list_paired_devices,
            commands::revoke_paired_device,
            commands::device_delete,
            commands::session_capture,
            commands::get_latest_session,
            commands::session_history_list,
            commands::chat_history_list,
            commands::chat_send,
            commands::profile_list,
            commands::profile_create,
            commands::profile_activate,
            commands::profile_update,
            commands::profile_delete,
            commands::terminal_translate,
            commands::terminal_resolve,
            commands::terminal_command_persist,
            lsp_commands::lsp_spawn,
            lsp_commands::lsp_send,
            commands::save_editor_layout,
            commands::get_editor_layout,
        ])
        .build(tauri::generate_context!())
        .expect("error building cortex")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                log::info!("Application exiting, capturing session state...");
                let state = app.state::<AppState>();
                
                // Trigger auto-capture on exit
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    if let Err(e) = crate::commands::session_capture("exit".to_string(), state).await {
                        log::error!("Auto-capture on exit failed: {}", e);
                    }
                });

                log::info!("Stopping sidecar, PTY, and LSP sessions...");
                let mut manager = state.sidecar_manager.lock().unwrap();
                manager.stop();
                let mut pty_mgr = state.pty_manager.lock().unwrap();
                pty_mgr.kill_all();
                state.lsp_manager.kill_all();
            }
        });
}
