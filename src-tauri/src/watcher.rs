use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use tauri::AppHandle;
use crate::ingest;
use crate::AppState;
use tauri::Manager;

pub fn create_watcher() -> notify::Result<(RecommendedWatcher, Receiver<notify::Result<notify::Event>>)> {
    let (tx, rx) = std::sync::mpsc::channel();

    let watcher = RecommendedWatcher::new(tx, Config::default())?;

    Ok((watcher, rx))
}

pub async fn start_watcher(app_handle: AppHandle, watch_path: PathBuf) {
    let (mut watcher, rx) = match create_watcher() {
        Ok(w) => w,
        Err(e) => {
            log::error!("Failed to create watcher: {}", e);
            return;
        }
    };

    if let Err(e) = watcher.watch(&watch_path, RecursiveMode::Recursive) {
        log::error!("Failed to watch path {:?}: {}", watch_path, e);
        return;
    }

    log::info!("Started watching {:?}", watch_path);

    // Keep watcher alive by moving it into the task
    let _watcher = watcher;

    while let Ok(event) = rx.recv() {
        match event {
            Ok(event) => {
                if event.kind.is_modify() || event.kind.is_create() {
                    for path in event.paths {
                        let app_handle = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app_handle.state::<AppState>();
                            let sidecar_url = state.sidecar_url.clone();
                            
                            if let Err(e) = ingest::process_file(&path, &sidecar_url).await {
                                log::error!("Failed to process file {:?}: {}", path, e);
                            } else {
                                log::info!("Processed file {:?}", path);
                            }
                        });
                    }
                }
            }
            Err(e) => log::error!("Watcher error: {}", e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;
    use std::time::Duration;

    #[test]
    fn test_file_watcher_detects_creation() {
        let dir = tempdir().unwrap();
        // Canonicalize the directory path to avoid macOS /var vs /private/var issues
        let dir_path = dir.path().canonicalize().unwrap();
        
        let (mut watcher, rx) = create_watcher().unwrap();

        watcher.watch(&dir_path, RecursiveMode::Recursive).unwrap();

        // Create a file
        let file_path = dir_path.join("test.txt");
        let mut file = File::create(&file_path).unwrap();
        writeln!(file, "Hello, watcher!").unwrap();
        file.sync_all().unwrap();

        // Wait for event
        let timeout = Duration::from_secs(2);
        
        // On some platforms, multiple events might be fired (Create, Modify, etc.)
        // We look for one that contains our path
        let mut found = false;
        let start = std::time::Instant::now();
        
        while start.elapsed() < timeout {
            if let Ok(Ok(event)) = rx.recv_timeout(Duration::from_millis(500)) {
                if event.paths.iter().any(|p| p.canonicalize().unwrap_or_default() == file_path) {
                    found = true;
                    break;
                }
            }
        }

        assert!(found, "Did not find event for path {:?}", file_path);
    }
}
