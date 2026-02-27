use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use tauri::AppHandle;
use crate::events;
use crate::ingest;
use crate::AppState;
use tauri::Emitter;
use tauri::Manager;

const INDEXABLE_EXTENSIONS: &[&str] = &[
    "rs", "py", "ts", "tsx", "js", "jsx", "md", "txt", "toml", "json",
    "yaml", "yml", "html", "css", "sql", "sh", "bash", "zsh",
];

const IGNORED_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "dist", "__pycache__", ".venv",
    "venv", ".claude", ".DS_Store",
];

fn should_index(path: &Path) -> bool {
    // Skip directories in the ignore list
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            if let Some(name_str) = name.to_str() {
                if IGNORED_DIRS.contains(&name_str) {
                    return false;
                }
            }
        }
    }

    // Only index files with known text extensions
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| INDEXABLE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

pub fn create_watcher() -> notify::Result<(RecommendedWatcher, Receiver<notify::Result<notify::Event>>)> {
    let (tx, rx) = std::sync::mpsc::channel();

    let watcher = RecommendedWatcher::new(tx, Config::default())?;

    Ok((watcher, rx))
}

fn collect_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return files,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name();
            if let Some(name_str) = name.to_str() {
                if !IGNORED_DIRS.contains(&name_str) {
                    files.extend(collect_files(&path));
                }
            }
        } else if should_index(&path) {
            files.push(path);
        }
    }
    files
}

fn process_file_with_events(app_handle: AppHandle, path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let state = app_handle.state::<AppState>();
        let sidecar_url = state.sidecar_url.clone();
        let file_path_str = path.to_string_lossy().to_string();

        // Update state: new file queued
        {
            let mut indexing = state.indexing.lock().unwrap();
            indexing.total_queued += 1;
            indexing.current_file = Some(file_path_str.clone());
            let _ = app_handle.emit(events::INDEXING_PROGRESS, events::IndexingProgressPayload {
                completed: indexing.completed,
                total: indexing.total_queued,
                current_file: indexing.current_file.clone(),
                is_idle: false,
            });
        }

        match ingest::process_file(&path, &sidecar_url).await {
            Ok(chunk_count) => {
                log::info!("Processed file {:?} ({} chunks)", path, chunk_count);
                let mut indexing = state.indexing.lock().unwrap();
                indexing.completed += 1;
                let is_idle = indexing.is_idle();
                if is_idle {
                    indexing.current_file = None;
                }
                let _ = app_handle.emit(events::INDEXING_FILE_COMPLETE, events::IndexingFileCompletePayload {
                    file_path: file_path_str.clone(),
                    chunk_count,
                    completed: indexing.completed,
                    total: indexing.total_queued,
                });
                let _ = app_handle.emit(events::INDEXING_PROGRESS, events::IndexingProgressPayload {
                    completed: indexing.completed,
                    total: indexing.total_queued,
                    current_file: indexing.current_file.clone(),
                    is_idle,
                });
            }
            Err(e) => {
                log::error!("Failed to process file {:?}: {}", path, e);
                let mut indexing = state.indexing.lock().unwrap();
                indexing.completed += 1;
                let is_idle = indexing.is_idle();
                if is_idle {
                    indexing.current_file = None;
                }
                let _ = app_handle.emit(events::INDEXING_FILE_ERROR, events::IndexingFileErrorPayload {
                    file_path: file_path_str.clone(),
                    error: e.to_string(),
                    completed: indexing.completed,
                    total: indexing.total_queued,
                });
                let _ = app_handle.emit(events::INDEXING_PROGRESS, events::IndexingProgressPayload {
                    completed: indexing.completed,
                    total: indexing.total_queued,
                    current_file: indexing.current_file.clone(),
                    is_idle,
                });
            }
        }
    });
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

    // Initial scan: index all existing files
    let existing_files = collect_files(&watch_path);
    log::info!("Initial scan: found {} indexable files", existing_files.len());
    for path in existing_files {
        process_file_with_events(app_handle.clone(), path);
    }

    // Keep watcher alive by moving it into the task
    let _watcher = watcher;

    while let Ok(event) = rx.recv() {
        match event {
            Ok(event) => {
                if event.kind.is_modify() || event.kind.is_create() {
                    for path in event.paths {
                        if !should_index(&path) {
                            continue;
                        }
                        process_file_with_events(app_handle.clone(), path);
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
    fn test_should_index_accepts_known_extensions() {
        assert!(should_index(Path::new("/project/src/main.rs")));
        assert!(should_index(Path::new("/project/src/lib.ts")));
        assert!(should_index(Path::new("/project/README.md")));
        assert!(should_index(Path::new("/project/config.toml")));
    }

    #[test]
    fn test_should_index_rejects_unknown_extensions() {
        assert!(!should_index(Path::new("/project/image.png")));
        assert!(!should_index(Path::new("/project/binary.exe")));
        assert!(!should_index(Path::new("/project/data.bin")));
    }

    #[test]
    fn test_should_index_rejects_ignored_dirs() {
        assert!(!should_index(Path::new("/project/node_modules/pkg/index.js")));
        assert!(!should_index(Path::new("/project/target/debug/main.rs")));
        assert!(!should_index(Path::new("/project/.git/config")));
    }

    #[test]
    fn test_collect_files_respects_filters() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path().canonicalize().unwrap();

        // Create indexable file
        let rs_file = dir_path.join("main.rs");
        std::fs::write(&rs_file, "fn main() {}").unwrap();

        // Create non-indexable file
        let png_file = dir_path.join("image.png");
        std::fs::write(&png_file, "fake png").unwrap();

        // Create ignored dir with indexable file inside
        let nm_dir = dir_path.join("node_modules");
        std::fs::create_dir(&nm_dir).unwrap();
        std::fs::write(nm_dir.join("lib.js"), "module.exports = {}").unwrap();

        let files = collect_files(&dir_path);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0], rs_file);
    }

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
