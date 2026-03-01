use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter};
use std::sync::Arc;

pub struct LspSession {
    pub language: String,
    pub child: Arc<Mutex<Child>>,
    pub stdin_tx: mpsc::Sender<String>,
}

pub struct LspManager {
    pub sessions: Arc<std::sync::Mutex<HashMap<String, LspSession>>>,
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    pub fn spawn_server(
        &self,
        app_handle: AppHandle,
        language: String,
        project_root: String,
    ) -> Result<String, String> {
        let session_id = uuid::Uuid::new_v4().to_string();
        
        let (cmd_bin, args) = match language.as_str() {
            "python" => ("pyright-langserver", vec!["--stdio"]),
            "rust" => ("rust-analyzer", vec![]),
            _ => return Err(format!("Unsupported language for LSP: {}", language)),
        };

        let mut child = Command::new(cmd_bin)
            .args(args)
            .current_dir(&project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to spawn LSP server {}: {}", cmd_bin, e))?;

        let mut stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(100);
        let _sid_clone = session_id.clone();

        // Stdin loop
        tokio::spawn(async move {
            while let Some(msg) = stdin_rx.recv().await {
                let payload = format!("Content-Length: {}

{}", msg.len(), msg);
                if stdin.write_all(payload.as_bytes()).await.is_err() {
                    break;
                }
                let _ = stdin.flush().await;
            }
        });

        // Stdout loop
        let app_clone = app_handle.clone();
        let sid_clone2 = session_id.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            
            loop {
                line.clear();
                if reader.read_line(&mut line).await.is_err() || line.is_empty() {
                    break;
                }

                if line.starts_with("Content-Length: ") {
                    let len: usize = line["Content-Length: ".len()..]
                        .trim()
                        .parse()
                        .unwrap_or(0);
                    
                    // Skip 

                    let mut dummy = String::new();
                    let _ = reader.read_line(&mut dummy).await;

                    let mut buffer = vec![0u8; len];
                    if reader.read_exact(&mut buffer).await.is_ok() {
                        if let Ok(msg) = String::from_utf8(buffer) {
                            let _ = app_clone.emit("lsp:message", serde_json::json!({
                                "session_id": sid_clone2,
                                "message": msg
                            }));
                        }
                    }
                }
            }
        });

        self.sessions.lock().unwrap().insert(session_id.clone(), LspSession {
            language,
            child: Arc::new(Mutex::new(child)),
            stdin_tx,
        });

        Ok(session_id)
    }

    pub fn send_message(&self, session_id: &str, message: String) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get(session_id) {
            let tx = session.stdin_tx.clone();
            tokio::spawn(async move {
                let _ = tx.send(message).await;
            });
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (_, session) in sessions.drain() {
            let child_arc = session.child.clone();
            tokio::spawn(async move {
                let mut child = child_arc.lock().await;
                let _ = child.kill().await;
            });
        }
    }
}
