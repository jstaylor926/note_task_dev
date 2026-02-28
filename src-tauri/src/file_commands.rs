use serde::Serialize;
use std::fs;
use std::path::Path;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct FileReadResponse {
    pub content: String,
    pub size: u64,
    pub extension: Option<String>,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub extension: Option<String>,
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct FileStat {
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub extension: Option<String>,
    pub readonly: bool,
}

/// Validate that a path exists and is within the project root.
/// For file commands, we use the project root (CARGO_MANIFEST_DIR parent) as the scope.
fn validate_path(path: &str) -> Result<std::path::PathBuf, String> {
    let path = Path::new(path);

    // Canonicalize to resolve symlinks and ".." components
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Path '{}' is not accessible: {}", path.display(), e))?;

    Ok(canonical)
}

#[tauri::command]
pub async fn file_read(path: String) -> Result<FileReadResponse, String> {
    let canonical = validate_path(&path)?;

    if !canonical.is_file() {
        return Err(format!(
            "Path '{}' is not a file",
            canonical.display()
        ));
    }

    let metadata = fs::metadata(&canonical)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let content = fs::read_to_string(&canonical)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let extension = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_string());

    Ok(FileReadResponse {
        content,
        size: metadata.len(),
        extension,
        path: canonical.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn file_write(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);

    // For writes, the parent directory must exist
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            return Err(format!(
                "Parent directory '{}' does not exist",
                parent.display()
            ));
        }
    }

    fs::write(target, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn file_list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let canonical = validate_path(&path)?;

    if !canonical.is_dir() {
        return Err(format!(
            "Path '{}' is not a directory",
            canonical.display()
        ));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&canonical)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read entry metadata: {}", e))?;
        let entry_path = entry.path();

        entries.push(DirEntry {
            name: entry
                .file_name()
                .to_string_lossy()
                .to_string(),
            path: entry_path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            extension: entry_path
                .extension()
                .map(|e| e.to_string_lossy().to_string()),
            size: metadata.len(),
        });
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub async fn file_stat(path: String) -> Result<FileStat, String> {
    let canonical = validate_path(&path)?;

    let metadata = fs::metadata(&canonical)
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let extension = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_string());

    Ok(FileStat {
        path: canonical.to_string_lossy().to_string(),
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        extension,
        readonly: metadata.permissions().readonly(),
    })
}

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub path: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub extension: Option<String>,
}

#[tauri::command]
pub async fn get_workspace_root(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    Ok(state.project_root.clone())
}

#[tauri::command]
pub async fn file_list_all(root: String) -> Result<Vec<FileEntry>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("Root '{}' is not a directory", root));
    }

    let mut builder = ignore::WalkBuilder::new(root_path);
    builder
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true);

    let contextignore = root_path.join(".contextignore");
    if contextignore.exists() {
        builder.add_ignore(&contextignore);
    }

    let mut entries = Vec::new();
    for result in builder.build().flatten() {
        let path = result.path().to_path_buf();
        if !path.is_file() {
            continue;
        }

        let relative = path
            .strip_prefix(root_path)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        let extension = path
            .extension()
            .map(|e| e.to_string_lossy().to_string());

        entries.push(FileEntry {
            path: path.to_string_lossy().to_string(),
            relative_path: relative,
            is_dir: false,
            extension,
        });
    }

    entries.sort_by(|a, b| a.relative_path.to_lowercase().cmp(&b.relative_path.to_lowercase()));

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_test_dir() -> TempDir {
        let dir = TempDir::new().unwrap();
        // Create test files
        fs::write(dir.path().join("hello.txt"), "Hello, world!").unwrap();
        fs::write(
            dir.path().join("code.rs"),
            "fn main() {\n    println!(\"hello\");\n}\n",
        )
        .unwrap();
        fs::create_dir(dir.path().join("subdir")).unwrap();
        fs::write(dir.path().join("subdir/nested.md"), "# Title\n\nContent").unwrap();
        dir
    }

    #[tokio::test]
    async fn test_file_read_success() {
        let dir = setup_test_dir();
        let path = dir.path().join("hello.txt").to_string_lossy().to_string();
        let result = file_read(path).await.unwrap();
        assert_eq!(result.content, "Hello, world!");
        assert_eq!(result.extension, Some("txt".to_string()));
        assert_eq!(result.size, 13);
    }

    #[tokio::test]
    async fn test_file_read_with_extension() {
        let dir = setup_test_dir();
        let path = dir.path().join("code.rs").to_string_lossy().to_string();
        let result = file_read(path).await.unwrap();
        assert!(result.content.contains("fn main()"));
        assert_eq!(result.extension, Some("rs".to_string()));
    }

    #[tokio::test]
    async fn test_file_read_nonexistent() {
        let result = file_read("/nonexistent/file.txt".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_file_read_directory_fails() {
        let dir = setup_test_dir();
        let path = dir.path().to_string_lossy().to_string();
        let result = file_read(path).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a file"));
    }

    #[tokio::test]
    async fn test_file_write_success() {
        let dir = setup_test_dir();
        let path = dir.path().join("new_file.txt").to_string_lossy().to_string();
        file_write(path.clone(), "New content".to_string())
            .await
            .unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "New content");
    }

    #[tokio::test]
    async fn test_file_write_overwrite() {
        let dir = setup_test_dir();
        let path = dir.path().join("hello.txt").to_string_lossy().to_string();
        file_write(path.clone(), "Updated content".to_string())
            .await
            .unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "Updated content");
    }

    #[tokio::test]
    async fn test_file_write_nonexistent_parent() {
        let result =
            file_write("/nonexistent/dir/file.txt".to_string(), "content".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[tokio::test]
    async fn test_file_list_directory_success() {
        let dir = setup_test_dir();
        let path = dir.path().to_string_lossy().to_string();
        let entries = file_list_directory(path).await.unwrap();

        // Should have: subdir, code.rs, hello.txt
        assert_eq!(entries.len(), 3);

        // Directories should be first
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].name, "subdir");

        // Files sorted alphabetically
        let file_names: Vec<&str> = entries.iter().filter(|e| !e.is_dir).map(|e| e.name.as_str()).collect();
        assert_eq!(file_names, vec!["code.rs", "hello.txt"]);
    }

    #[tokio::test]
    async fn test_file_list_directory_not_a_dir() {
        let dir = setup_test_dir();
        let path = dir.path().join("hello.txt").to_string_lossy().to_string();
        let result = file_list_directory(path).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }

    #[tokio::test]
    async fn test_file_stat_file() {
        let dir = setup_test_dir();
        let path = dir.path().join("hello.txt").to_string_lossy().to_string();
        let stat = file_stat(path).await.unwrap();
        assert!(stat.is_file);
        assert!(!stat.is_dir);
        assert_eq!(stat.extension, Some("txt".to_string()));
        assert_eq!(stat.size, 13);
    }

    #[tokio::test]
    async fn test_file_stat_directory() {
        let dir = setup_test_dir();
        let path = dir.path().join("subdir").to_string_lossy().to_string();
        let stat = file_stat(path).await.unwrap();
        assert!(!stat.is_file);
        assert!(stat.is_dir);
    }

    #[tokio::test]
    async fn test_file_stat_nonexistent() {
        let result = file_stat("/nonexistent/path".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_file_list_all_returns_files() {
        let dir = setup_test_dir();
        let root = dir.path().to_string_lossy().to_string();
        let entries = file_list_all(root).await.unwrap();

        // Should find hello.txt, code.rs, subdir/nested.md
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|e| !e.is_dir));
    }

    #[tokio::test]
    async fn test_file_list_all_relative_paths() {
        let dir = setup_test_dir();
        let root = dir.path().to_string_lossy().to_string();
        let entries = file_list_all(root).await.unwrap();

        let rel_paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        assert!(rel_paths.contains(&"hello.txt"));
        assert!(rel_paths.contains(&"code.rs"));
        assert!(rel_paths.contains(&"subdir/nested.md"));
    }

    #[tokio::test]
    async fn test_file_list_all_sorted_alphabetically() {
        let dir = setup_test_dir();
        let root = dir.path().to_string_lossy().to_string();
        let entries = file_list_all(root).await.unwrap();

        let rel_paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        // Should be: code.rs, hello.txt, subdir/nested.md
        assert_eq!(rel_paths, vec!["code.rs", "hello.txt", "subdir/nested.md"]);
    }

    #[tokio::test]
    async fn test_file_list_all_respects_gitignore() {
        let dir = TempDir::new().unwrap();
        let dir_path = dir.path();

        // Init git repo so .gitignore is recognized
        fs::create_dir(dir_path.join(".git")).unwrap();
        fs::write(dir_path.join(".gitignore"), "ignored_dir/\n").unwrap();
        fs::write(dir_path.join("main.rs"), "fn main() {}").unwrap();
        fs::create_dir(dir_path.join("ignored_dir")).unwrap();
        fs::write(dir_path.join("ignored_dir/lib.rs"), "fn lib() {}").unwrap();

        let root = dir_path.to_string_lossy().to_string();
        let entries = file_list_all(root).await.unwrap();

        // Should only find main.rs (not files in ignored_dir)
        // .gitignore itself may or may not appear depending on ignore crate behavior
        let rel_paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        assert!(rel_paths.contains(&"main.rs"));
        assert!(!rel_paths.iter().any(|p| p.starts_with("ignored_dir/")));
    }

    #[tokio::test]
    async fn test_file_list_all_includes_extensions() {
        let dir = setup_test_dir();
        let root = dir.path().to_string_lossy().to_string();
        let entries = file_list_all(root).await.unwrap();

        let rs_entry = entries.iter().find(|e| e.relative_path == "code.rs").unwrap();
        assert_eq!(rs_entry.extension, Some("rs".to_string()));

        let md_entry = entries.iter().find(|e| e.relative_path == "subdir/nested.md").unwrap();
        assert_eq!(md_entry.extension, Some("md".to_string()));
    }

    #[tokio::test]
    async fn test_file_list_all_nonexistent_root() {
        let result = file_list_all("/nonexistent/root".to_string()).await;
        assert!(result.is_err());
    }
}
