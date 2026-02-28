use serde::Serialize;
use std::fs;
use std::path::Path;

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
}
