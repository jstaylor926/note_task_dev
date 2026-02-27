use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use crate::db;
use crate::events;
use crate::ingest;
use crate::AppState;
use tauri::Emitter;
use tauri::Manager;

const INDEXABLE_EXTENSIONS: &[&str] = &[
    "rs", "py", "ts", "tsx", "js", "jsx", "md", "txt", "toml", "json",
    "yaml", "yml", "html", "css", "sql", "sh", "bash", "zsh",
];

/// Debounce window for grouping rapid file events.
const DEBOUNCE_MS: u64 = 300;

fn has_indexable_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| INDEXABLE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

/// Check if a path should be indexed using .gitignore rules.
/// For runtime event filtering (single file check).
fn should_index_with_gitignore(path: &Path, gitignore: &Option<ignore::gitignore::Gitignore>) -> bool {
    if !has_indexable_extension(path) {
        return false;
    }

    if let Some(gi) = gitignore {
        let is_dir = path.is_dir();
        if gi.matched(path, is_dir).is_ignore() {
            return false;
        }
    }

    true
}

pub fn create_watcher() -> notify::Result<(RecommendedWatcher, Receiver<notify::Result<notify::Event>>)> {
    let (tx, rx) = std::sync::mpsc::channel();

    let watcher = RecommendedWatcher::new(tx, Config::default())?;

    Ok((watcher, rx))
}

/// Collect indexable files using ignore::WalkBuilder which respects .gitignore and .contextignore.
fn collect_files_with_ignore(dir: &Path) -> Vec<PathBuf> {
    let mut builder = ignore::WalkBuilder::new(dir);
    builder
        .hidden(true)           // Skip hidden files/dirs
        .git_ignore(true)       // Respect .gitignore
        .git_global(true)       // Respect global .gitignore
        .git_exclude(true);     // Respect .git/info/exclude

    // Add .contextignore if it exists
    let contextignore = dir.join(".contextignore");
    if contextignore.exists() {
        builder.add_ignore(&contextignore);
    }

    let mut files = Vec::new();
    for entry in builder.build().flatten() {
        let path = entry.path().to_path_buf();
        if path.is_file() && has_indexable_extension(&path) {
            files.push(path);
        }
    }
    files
}

/// Build a gitignore matcher for runtime event filtering.
fn build_gitignore(dir: &Path) -> Option<ignore::gitignore::Gitignore> {
    let mut builder = ignore::gitignore::GitignoreBuilder::new(dir);

    let gitignore_path = dir.join(".gitignore");
    if gitignore_path.exists() {
        let _ = builder.add(&gitignore_path);
    }

    let contextignore_path = dir.join(".contextignore");
    if contextignore_path.exists() {
        let _ = builder.add(&contextignore_path);
    }

    builder.build().ok()
}

fn process_file_with_events(app_handle: AppHandle, path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let state = app_handle.state::<AppState>();
        let sidecar_url = state.sidecar_url.clone();
        let file_path_str = path.to_string_lossy().to_string();

        // 1. Read content and compute hash
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to read file {:?}: {}", path, e);
                return;
            }
        };

        if content.trim().is_empty() {
            return;
        }

        let new_hash = ingest::compute_sha256(&content);
        let file_size = content.len() as u64;
        let language = ingest::detect_language(&path);

        // 2. Check file_index — skip if hash matches (lock scope limited)
        {
            let conn = state.db.lock().unwrap();
            if let Ok(Some(profile_id)) = db::get_active_profile_id(&conn) {
                if let Ok(Some(existing_hash)) = db::get_file_hash(&conn, &file_path_str, &profile_id) {
                    if existing_hash == new_hash {
                        log::debug!("Skipping unchanged file {:?}", path);
                        return;
                    }
                }
            }
        }

        // 3. File is new or changed — emit queued event
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

        // 4. Delete old embeddings + entities for this file, then ingest new content
        let _ = ingest::delete_file_embeddings(&file_path_str, &sidecar_url).await;
        {
            let conn = state.db.lock().unwrap();
            let _ = db::delete_entities_by_source_file(&conn, &file_path_str);
        }

        let git_branch = state.git_branch.clone();
        match ingest::process_file(&path, &sidecar_url, &git_branch).await {
            Ok(resp) => {
                log::info!("Processed file {:?} ({} chunks, {} entities)", path, resp.chunk_count, resp.entities.len());

                // 5. Update file_index and write entities to SQLite
                {
                    let conn = state.db.lock().unwrap();
                    if let Ok(Some(profile_id)) = db::get_active_profile_id(&conn) {
                        if let Err(e) = db::upsert_file_index(
                            &conn,
                            &file_path_str,
                            &profile_id,
                            &new_hash,
                            language,
                            resp.chunk_count,
                            file_size,
                        ) {
                            log::error!("Failed to update file_index for {:?}: {}", path, e);
                        }

                        for entity in &resp.entities {
                            let metadata = serde_json::json!({
                                "start_line": entity.start_line,
                                "end_line": entity.end_line,
                            });
                            if let Err(e) = db::upsert_entity(
                                &conn,
                                &entity.entity_type,
                                &entity.name,
                                &file_path_str,
                                &profile_id,
                                &metadata.to_string(),
                            ) {
                                log::error!("Failed to upsert entity '{}': {}", entity.name, e);
                            }
                        }
                    }
                }

                let chunk_count = resp.chunk_count;
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

/// Handle file deletion: remove embeddings, file_index, and entities.
fn handle_file_deleted(app_handle: AppHandle, path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let state = app_handle.state::<AppState>();
        let sidecar_url = state.sidecar_url.clone();
        let file_path_str = path.to_string_lossy().to_string();

        log::info!("File deleted: {:?}", path);

        // Delete embeddings from sidecar
        let _ = ingest::delete_file_embeddings(&file_path_str, &sidecar_url).await;

        // Delete from SQLite (file_index + entities)
        {
            let conn = state.db.lock().unwrap();
            if let Ok(Some(profile_id)) = db::get_active_profile_id(&conn) {
                let _ = db::delete_file_index(&conn, &file_path_str, &profile_id);
            }
            let _ = db::delete_entities_by_source_file(&conn, &file_path_str);
        }

        let _ = app_handle.emit(events::INDEXING_FILE_DELETED, events::IndexingFileDeletedPayload {
            file_path: file_path_str,
        });
    });
}

/// Tracks pending debounced events per file path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DebouncedAction {
    Upsert,
    Delete,
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

    // Build gitignore for runtime filtering
    let gitignore = build_gitignore(&watch_path);

    // Initial scan using ignore::WalkBuilder (respects .gitignore)
    let existing_files = collect_files_with_ignore(&watch_path);
    log::info!("Initial scan: found {} indexable files", existing_files.len());
    for path in existing_files {
        process_file_with_events(app_handle.clone(), path);
    }

    // Keep watcher alive by moving it into the task
    let _watcher = watcher;

    // Debounce map: path -> (action, last_event_time)
    let mut pending: HashMap<PathBuf, (DebouncedAction, Instant)> = HashMap::new();
    let debounce_duration = Duration::from_millis(DEBOUNCE_MS);

    loop {
        // Use a short timeout to periodically flush debounced events
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(event)) => {
                let now = Instant::now();
                for path in event.paths {
                    if event.kind.is_remove() {
                        if has_indexable_extension(&path) {
                            pending.insert(path, (DebouncedAction::Delete, now));
                        }
                    } else if event.kind.is_modify() || event.kind.is_create() {
                        if should_index_with_gitignore(&path, &gitignore) {
                            pending.insert(path, (DebouncedAction::Upsert, now));
                        }
                    }
                }
            }
            Ok(Err(e)) => log::error!("Watcher error: {}", e),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }

        // Flush events that have settled (no new event within debounce window)
        let now = Instant::now();
        let ready: Vec<(PathBuf, DebouncedAction)> = pending
            .iter()
            .filter(|(_, (_, ts))| now.duration_since(*ts) >= debounce_duration)
            .map(|(path, (action, _))| (path.clone(), *action))
            .collect();

        for (path, action) in ready {
            pending.remove(&path);
            match action {
                DebouncedAction::Upsert => {
                    process_file_with_events(app_handle.clone(), path);
                }
                DebouncedAction::Delete => {
                    handle_file_deleted(app_handle.clone(), path);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_has_indexable_extension() {
        assert!(has_indexable_extension(Path::new("/project/src/main.rs")));
        assert!(has_indexable_extension(Path::new("/project/src/lib.ts")));
        assert!(has_indexable_extension(Path::new("/project/README.md")));
        assert!(has_indexable_extension(Path::new("/project/config.toml")));
        assert!(!has_indexable_extension(Path::new("/project/image.png")));
        assert!(!has_indexable_extension(Path::new("/project/binary.exe")));
    }

    #[test]
    fn test_should_index_with_gitignore_no_ignore() {
        // With no gitignore, only extension matters
        assert!(should_index_with_gitignore(Path::new("/project/main.rs"), &None));
        assert!(!should_index_with_gitignore(Path::new("/project/image.png"), &None));
    }

    #[test]
    fn test_should_index_with_gitignore_pattern() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path().canonicalize().unwrap();

        // Create a .gitignore that ignores *.log files
        let gitignore_path = dir_path.join(".gitignore");
        std::fs::write(&gitignore_path, "*.log\nbuild/\n").unwrap();

        let gi = build_gitignore(&dir_path);
        assert!(gi.is_some());

        // .rs should still be indexable
        assert!(should_index_with_gitignore(&dir_path.join("main.rs"), &gi));
        // .log should be ignored even though it's not in INDEXABLE_EXTENSIONS anyway
        assert!(!should_index_with_gitignore(&dir_path.join("debug.log"), &gi));
    }

    #[test]
    fn test_collect_files_with_ignore_respects_gitignore() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path().canonicalize().unwrap();

        // Initialize a git repo so .gitignore is recognized
        std::fs::create_dir(dir_path.join(".git")).unwrap();

        // Create a .gitignore
        std::fs::write(dir_path.join(".gitignore"), "ignored_dir/\n").unwrap();

        // Create indexable file
        let rs_file = dir_path.join("main.rs");
        std::fs::write(&rs_file, "fn main() {}").unwrap();

        // Create non-indexable file
        std::fs::write(dir_path.join("image.png"), "fake png").unwrap();

        // Create ignored dir with indexable file inside
        let ignored_dir = dir_path.join("ignored_dir");
        std::fs::create_dir(&ignored_dir).unwrap();
        std::fs::write(ignored_dir.join("lib.rs"), "fn lib() {}").unwrap();

        let files = collect_files_with_ignore(&dir_path);
        assert_eq!(files.len(), 1);
        assert!(files.iter().any(|f| f.ends_with("main.rs")));
    }

    #[test]
    fn test_contextignore_support() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path().canonicalize().unwrap();

        // Create a .contextignore that ignores generated files
        std::fs::write(dir_path.join(".contextignore"), "generated.rs\n").unwrap();

        std::fs::write(dir_path.join("main.rs"), "fn main() {}").unwrap();
        std::fs::write(dir_path.join("generated.rs"), "fn gen() {}").unwrap();

        let files = collect_files_with_ignore(&dir_path);
        assert_eq!(files.len(), 1);
        assert!(files.iter().any(|f| f.ends_with("main.rs")));
    }

    #[test]
    fn test_debounce_action_enum() {
        // Simple test that DebouncedAction variants work correctly
        assert_eq!(DebouncedAction::Upsert, DebouncedAction::Upsert);
        assert_eq!(DebouncedAction::Delete, DebouncedAction::Delete);
        assert_ne!(DebouncedAction::Upsert, DebouncedAction::Delete);
    }

    #[test]
    fn test_file_watcher_detects_creation() {
        let dir = tempdir().unwrap();
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
