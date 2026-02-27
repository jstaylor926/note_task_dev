use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::Emitter;
use tokio::sync::oneshot;

use crate::events::{
    PtyExitPayload, PtyOutputPayload, TerminalCommandEndPayload, TerminalCommandStartPayload,
    PTY_EXIT, PTY_OUTPUT, TERMINAL_COMMAND_END, TERMINAL_COMMAND_START,
};
use crate::osc_parser::{OscEvent, OscParser};

/// Detect the default shell from $SHELL or fall back to platform default.
pub fn detect_default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "/bin/zsh".to_string()
        } else {
            "/bin/bash".to_string()
        }
    })
}

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    _reader_handle: JoinHandle<()>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn create_session(
        &mut self,
        id: String,
        app_handle: tauri::AppHandle,
        cwd: Option<String>,
        shell_command: Option<CommandBuilder>,
        cols: Option<u16>,
        rows: Option<u16>,
    ) -> Result<(), String> {
        if self.sessions.contains_key(&id) {
            return Err(format!("Session '{}' already exists", id));
        }

        let pty_system = native_pty_system();
        let size = PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = shell_command.unwrap_or_else(|| {
            let shell = detect_default_shell();
            CommandBuilder::new(shell)
        });

        if let Some(ref dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let child = Arc::new(Mutex::new(child));
        let child_for_reader = Arc::clone(&child);

        // Drop the slave — we only interact via master
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

        let session_id = id.clone();
        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let engine = base64::engine::general_purpose::STANDARD;
            let mut osc_parser = OscParser::new();
            let mut current_command: Option<String> = None;
            let mut command_start_time: Option<std::time::Instant> = None;
            let mut current_cwd: Option<String> = None;
            let mut command_output: Option<Vec<u8>> = None;

            loop {
                // Check for shutdown signal (non-blocking)
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }

                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — process exited
                        let mut child_guard = child_for_reader.lock().unwrap();
                        let exit_code = child_guard.wait().ok().map(|s| s.exit_code() as i32);

                        let _ = app_handle.emit(
                            PTY_EXIT,
                            PtyExitPayload {
                                session_id: session_id.clone(),
                                exit_code,
                            },
                        );
                        break;
                    }
                    Ok(n) => {
                        let result = osc_parser.parse(&buf[..n]);

                        // Process OSC events
                        for event in &result.events {
                            match event {
                                OscEvent::CommandText { text } => {
                                    current_command = Some(text.clone());
                                }
                                OscEvent::CommandStart => {
                                    command_start_time = Some(std::time::Instant::now());
                                    command_output = Some(Vec::new());
                                    
                                    let cmd_for_monitor = current_command.clone().unwrap_or_default();
                                    let session_id_for_monitor = session_id.clone();
                                    let app_handle_for_monitor = app_handle.clone();
                                    
                                    // Basic heuristic: notify if command takes longer than 30s
                                    tauri::async_runtime::spawn(async move {
                                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                                        // This is a naive implementation. A better one would check if the command
                                        // has already completed. Since we don't have a reliable way to cancel this
                                        // task from the reader thread easily without adding channels per command,
                                        // we'll just let the frontend handle deduplication or ignore if already ended.
                                        let _ = app_handle_for_monitor.emit(
                                            crate::events::TERMINAL_PIPELINE_STATUS,
                                            crate::events::TerminalPipelineStatusPayload {
                                                session_id: session_id_for_monitor,
                                                command: cmd_for_monitor,
                                                status: "running".to_string(),
                                                duration_ms: 30000,
                                            }
                                        );
                                    });

                                    let _ = app_handle.emit(
                                        TERMINAL_COMMAND_START,
                                        TerminalCommandStartPayload {
                                            session_id: session_id.clone(),
                                            command: current_command
                                                .clone()
                                                .unwrap_or_default(),
                                        },
                                    );
                                }
                                OscEvent::CommandEnd { exit_code } => {
                                    let duration_ms = command_start_time
                                        .map(|t| t.elapsed().as_millis() as u64);
                                    let output_str = command_output.take().and_then(|bytes| {
                                        String::from_utf8(bytes).ok()
                                    });
                                    
                                    if let Some(ms) = duration_ms {
                                        if ms >= 30000 {
                                            let status = if *exit_code == Some(0) { "completed" } else { "failed" };
                                            let _ = app_handle.emit(
                                                crate::events::TERMINAL_PIPELINE_STATUS,
                                                crate::events::TerminalPipelineStatusPayload {
                                                    session_id: session_id.clone(),
                                                    command: current_command.clone().unwrap_or_default(),
                                                    status: status.to_string(),
                                                    duration_ms: ms,
                                                }
                                            );
                                        }
                                    }

                                    let _ = app_handle.emit(
                                        TERMINAL_COMMAND_END,
                                        TerminalCommandEndPayload {
                                            session_id: session_id.clone(),
                                            command: current_command
                                                .take()
                                                .unwrap_or_default(),
                                            exit_code: *exit_code,
                                            cwd: current_cwd.clone(),
                                            duration_ms,
                                            output: output_str,
                                        },
                                    );
                                    command_start_time = None;
                                }
                                OscEvent::CwdChange { path } => {
                                    current_cwd = Some(path.clone());
                                }
                            }
                        }

                        // Forward clean output to frontend and capture if recording
                        if !result.output.is_empty() {
                            if let Some(ref mut output_buf) = command_output {
                                // Cap at 1MB to prevent excessive memory usage
                                if output_buf.len() < 1024 * 1024 {
                                    output_buf.extend_from_slice(&result.output);
                                }
                            }
                            let encoded = engine.encode(&result.output);
                            let _ = app_handle.emit(
                                PTY_OUTPUT,
                                PtyOutputPayload {
                                    session_id: session_id.clone(),
                                    data: encoded,
                                },
                            );
                        }
                    }
                    Err(e) => {
                        log::error!("PTY read error for session '{}': {}", session_id, e);
                        let mut child_guard = child_for_reader.lock().unwrap();
                        let exit_code = child_guard.wait().ok().map(|s| s.exit_code() as i32);

                        let _ = app_handle.emit(
                            PTY_EXIT,
                            PtyExitPayload {
                                session_id: session_id.clone(),
                                exit_code,
                            },
                        );
                        break;
                    }
                }
            }
        });

        let session = PtySession {
            master: pair.master,
            writer,
            child,
            _reader_handle: reader_handle,
            shutdown_tx: Some(shutdown_tx),
        };

        self.sessions.insert(id, session);
        Ok(())
    }

    pub fn write(&mut self, id: &str, data: &[u8]) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(id)
            .ok_or_else(|| format!("Session '{}' not found", id))?;

        session
            .writer
            .write_all(data)
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;

        Ok(())
    }

    pub fn resize(&mut self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(id)
            .ok_or_else(|| format!("Session '{}' not found", id))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))?;

        Ok(())
    }

    pub fn kill(&mut self, id: &str) -> Result<(), String> {
        let mut session = self
            .sessions
            .remove(id)
            .ok_or_else(|| format!("Session '{}' not found", id))?;

        // Signal the reader thread to stop
        if let Some(tx) = session.shutdown_tx.take() {
            let _ = tx.send(());
        }

        // Kill the child process
        let mut child_guard = session.child.lock().unwrap();
        child_guard
            .kill()
            .map_err(|e| format!("Failed to kill process: {}", e))?;

        Ok(())
    }

    pub fn kill_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            if let Err(e) = self.kill(&id) {
                log::error!("Failed to kill PTY session '{}': {}", id, e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pty_manager_new_empty() {
        let manager = PtyManager::new();
        assert!(manager.sessions.is_empty());
    }

    #[test]
    fn test_detect_default_shell() {
        let shell = detect_default_shell();
        assert!(!shell.is_empty());
        // Should be an absolute path
        assert!(shell.starts_with('/'));
    }

    #[test]
    fn test_kill_nonexistent_session() {
        let mut manager = PtyManager::new();
        let result = manager.kill("nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_write_nonexistent_session() {
        let mut manager = PtyManager::new();
        let result = manager.write("nonexistent", b"hello");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_resize_nonexistent_session() {
        let mut manager = PtyManager::new();
        let result = manager.resize("nonexistent", 80, 24);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_take_writer_twice_fails() {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).unwrap();
        let _writer1 = pair.master.take_writer().unwrap();
        let writer2 = pair.master.take_writer();
        assert!(writer2.is_err());
    }
}
