use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::mpsc::Receiver;

pub fn create_watcher() -> notify::Result<(RecommendedWatcher, Receiver<notify::Result<notify::Event>>)> {
    let (tx, rx) = std::sync::mpsc::channel();

    let watcher = RecommendedWatcher::new(tx, Config::default())?;

    Ok((watcher, rx))
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
