use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize)]
struct IngestRequest {
    file_path: String,
    content: String,
    language: String,
    source_type: String,
    git_branch: String,
}

#[derive(Deserialize)]
struct IngestResponse {
    chunk_count: usize,
}

/// Detect the programming language from a file extension.
fn detect_language(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("rs") => "rust",
        Some("py") => "python",
        Some("ts") | Some("tsx") => "typescript",
        Some("js") | Some("jsx") => "javascript",
        Some("md") => "markdown",
        Some("toml") => "toml",
        Some("json") => "json",
        Some("yaml") | Some("yml") => "yaml",
        Some("html") => "html",
        Some("css") => "css",
        Some("sql") => "sql",
        Some("sh") | Some("bash") | Some("zsh") => "shell",
        Some("txt") => "text",
        _ => "text",
    }
}

/// Detect the source type from the file path and extension.
fn detect_source_type(path: &Path) -> &'static str {
    let path_str = path.to_string_lossy();

    // Test files
    if path_str.contains("/tests/")
        || path_str.contains("/test/")
        || path_str.contains("__tests__")
        || path_str.contains("test_")
        || path_str.contains(".test.")
        || path_str.contains(".spec.")
    {
        return "test";
    }

    match path.extension().and_then(|e| e.to_str()) {
        Some("md") | Some("txt") => "docs",
        Some("toml") | Some("json") | Some("yaml") | Some("yml") => "config",
        Some("rs") | Some("py") | Some("ts") | Some("tsx") | Some("js") | Some("jsx")
        | Some("html") | Some("css") | Some("sql") | Some("sh") | Some("bash")
        | Some("zsh") => "code",
        _ => "unknown",
    }
}

/// Send a file's content to the sidecar /ingest endpoint for chunking + embedding.
pub async fn process_file(path: &Path, sidecar_url: &str) -> anyhow::Result<usize> {
    if !path.is_file() {
        return Ok(0);
    }

    let content = fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(0);
    }

    let language = detect_language(path).to_string();
    let source_type = detect_source_type(path).to_string();

    let req = IngestRequest {
        file_path: path.to_string_lossy().to_string(),
        content,
        language,
        source_type,
        git_branch: "main".to_string(),
    };

    let client = reqwest::Client::new();
    let url = format!("{}/ingest", sidecar_url);

    let res = client.post(url).json(&req).send().await?;

    if !res.status().is_success() {
        let err = res.text().await?;
        anyhow::bail!("Failed to ingest file: {}", err);
    }

    let resp: IngestResponse = res.json().await?;
    Ok(resp.chunk_count)
}

/// Delete all embeddings for a given file from the sidecar.
pub async fn delete_file_embeddings(file_path: &str, sidecar_url: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let url = format!("{}/embeddings", sidecar_url);

    let res = client
        .delete(&url)
        .query(&[("source_file", file_path)])
        .send()
        .await?;

    if !res.status().is_success() {
        let err = res.text().await?;
        anyhow::bail!("Failed to delete embeddings: {}", err);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_language() {
        assert_eq!(detect_language(Path::new("main.rs")), "rust");
        assert_eq!(detect_language(Path::new("app.py")), "python");
        assert_eq!(detect_language(Path::new("index.ts")), "typescript");
        assert_eq!(detect_language(Path::new("component.tsx")), "typescript");
        assert_eq!(detect_language(Path::new("script.js")), "javascript");
        assert_eq!(detect_language(Path::new("README.md")), "markdown");
        assert_eq!(detect_language(Path::new("config.toml")), "toml");
        assert_eq!(detect_language(Path::new("data.json")), "json");
        assert_eq!(detect_language(Path::new("config.yaml")), "yaml");
        assert_eq!(detect_language(Path::new("unknown.xyz")), "text");
    }

    #[test]
    fn test_detect_source_type() {
        assert_eq!(detect_source_type(Path::new("src/main.rs")), "code");
        assert_eq!(detect_source_type(Path::new("README.md")), "docs");
        assert_eq!(detect_source_type(Path::new("Cargo.toml")), "config");
        assert_eq!(detect_source_type(Path::new("tests/test_main.rs")), "test");
        assert_eq!(
            detect_source_type(Path::new("src/components/__tests__/App.test.tsx")),
            "test"
        );
        assert_eq!(
            detect_source_type(Path::new("sidecar/tests/test_api.py")),
            "test"
        );
    }
}
