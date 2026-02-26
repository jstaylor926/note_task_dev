use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub enum SidecarStatus {
    Starting,
    Healthy,
    Unhealthy,
    Stopped,
}

pub struct SidecarManager {
    process: Option<Child>,
    port: u16,
    sidecar_dir: PathBuf,
    restart_count: u32,
    max_restarts: u32,
    pub status: SidecarStatus,
}

impl SidecarManager {
    pub fn new(port: u16, sidecar_dir: PathBuf) -> Self {
        Self {
            process: None,
            port,
            sidecar_dir,
            restart_count: 0,
            max_restarts: 3,
            status: SidecarStatus::Stopped,
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        log::info!(
            "Starting Python sidecar on port {} from {:?}",
            self.port,
            self.sidecar_dir
        );

        self.status = SidecarStatus::Starting;

        let child = Command::new("uv")
            .arg("run")
            .arg("--directory")
            .arg(&self.sidecar_dir)
            .arg("python")
            .arg("-m")
            .arg("cortex_sidecar.main")
            .arg("--port")
            .arg(self.port.to_string())
            .arg("--host")
            .arg("127.0.0.1")
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        log::info!("Sidecar process started with PID: {}", child.id());
        self.process = Some(child);
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.process.take() {
            log::info!("Stopping sidecar (PID: {})", child.id());
            let _ = child.kill();
            let _ = child.wait();
            log::info!("Sidecar stopped");
        }
        self.status = SidecarStatus::Stopped;
    }

    pub fn is_process_alive(&mut self) -> bool {
        if let Some(ref mut child) = self.process {
            match child.try_wait() {
                Ok(Some(_)) => {
                    // Process has exited
                    false
                }
                Ok(None) => {
                    // Process still running
                    true
                }
                Err(_) => false,
            }
        } else {
            false
        }
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn can_restart(&self) -> bool {
        self.restart_count < self.max_restarts
    }

    pub fn restart(&mut self) -> Result<(), String> {
        if !self.can_restart() {
            return Err(format!(
                "Max restarts ({}) exceeded",
                self.max_restarts
            ));
        }

        self.restart_count += 1;
        log::warn!(
            "Restarting sidecar (attempt {}/{})",
            self.restart_count,
            self.max_restarts
        );

        self.stop();
        self.start()
    }

    pub fn mark_healthy(&mut self) {
        self.status = SidecarStatus::Healthy;
        self.restart_count = 0; // Reset on successful health check
    }

    pub fn mark_unhealthy(&mut self) {
        self.status = SidecarStatus::Unhealthy;
    }

    pub fn backoff_duration(&self) -> Duration {
        // Exponential backoff: 1s, 2s, 4s
        Duration::from_secs(1 << self.restart_count.min(3))
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Perform an HTTP health check against the sidecar.
pub async fn check_sidecar_health(base_url: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/health", base_url))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map_err(|e| format!("Health check request failed: {}", e))?;

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Health check parse failed: {}", e))
}

/// Background health monitoring task. Spawned from main.rs setup.
pub async fn health_monitor_loop(
    app_handle: tauri::AppHandle,
    base_url: String,
) {
    use tauri::Manager;

    // Wait a few seconds for initial sidecar startup
    tokio::time::sleep(Duration::from_secs(3)).await;

    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;

        let state = app_handle.state::<crate::AppState>();
        let is_alive = {
            let mut manager = state.sidecar_manager.lock().unwrap();
            manager.is_process_alive()
        };

        if !is_alive {
            log::warn!("Sidecar process is not alive");
            let (can_restart, backoff) = {
                let mut manager = state.sidecar_manager.lock().unwrap();
                manager.mark_unhealthy();
                let can = manager.can_restart();
                let delay = manager.backoff_duration();
                (can, delay)
            }; // MutexGuard dropped here before any await

            if can_restart {
                log::info!("Waiting {:?} before restart", backoff);
                tokio::time::sleep(backoff).await;

                let mut manager = state.sidecar_manager.lock().unwrap();
                if let Err(e) = manager.restart() {
                    log::error!("Failed to restart sidecar: {}", e);
                }
            } else {
                log::error!("Sidecar exceeded max restart attempts");
            }
            continue;
        }

        // Process is alive — check HTTP health
        match check_sidecar_health(&base_url).await {
            Ok(body) => {
                let status = body
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");

                if status == "ok" {
                    let mut manager = state.sidecar_manager.lock().unwrap();
                    manager.mark_healthy();
                } else {
                    log::warn!("Sidecar health check returned non-ok: {}", status);
                    let mut manager = state.sidecar_manager.lock().unwrap();
                    manager.mark_unhealthy();
                }
            }
            Err(e) => {
                log::warn!("Sidecar health check failed: {}", e);
                let mut manager = state.sidecar_manager.lock().unwrap();
                manager.mark_unhealthy();
            }
        }
    }
}
