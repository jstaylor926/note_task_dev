use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
pub struct EntityInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub entity_type: String,
    pub start_line: Option<usize>,
    pub end_line: Option<usize>,
}

#[derive(Deserialize)]
pub struct IngestResponse {
    pub chunk_count: usize,
    pub entities: Vec<EntityInfo>,
}

/// Compute the SHA-256 hash of a string, returning the hex digest.
pub fn compute_sha256(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Detect the programming language from a file extension.
pub fn detect_language(path: &Path) -> &'static str {
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

/// Send terminal output to the sidecar /ingest endpoint for chunking + embedding.
pub async fn process_terminal_output(
    command_id: &str,
    command: &str,
    output: &str,
    sidecar_url: &str,
    git_branch: &str,
) -> anyhow::Result<IngestResponse> {
    let req = IngestRequest {
        file_path: format!("terminal_{}", command_id),
        content: format!("Command: {}\n\nOutput:\n{}", command, output),
        language: "text".to_string(),
        source_type: "terminal".to_string(),
        git_branch: git_branch.to_string(),
    };

    let client = reqwest::Client::new();
    let url = format!("{}/ingest", sidecar_url);

    let res = client.post(url).json(&req).send().await?;

    if !res.status().is_success() {
        let err = res.text().await?;
        anyhow::bail!("Sidecar error: {}", err);
    }

    let result = res.json::<IngestResponse>().await?;
    Ok(result)
}

/// Send a file's content to the sidecar /ingest endpoint for chunking + embedding.
/// Returns the full ingest response including chunk count and extracted entities.
pub async fn process_file(path: &Path, sidecar_url: &str, git_branch: &str) -> anyhow::Result<IngestResponse> {
    if !path.is_file() {
        return Ok(IngestResponse { chunk_count: 0, entities: vec![] });
    }

    let content = fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(IngestResponse { chunk_count: 0, entities: vec![] });
    }

    let language = detect_language(path).to_string();
    let source_type = detect_source_type(path).to_string();

    let req = IngestRequest {
        file_path: path.to_string_lossy().to_string(),
        content,
        language,
        source_type,
        git_branch: git_branch.to_string(),
    };

    let client = reqwest::Client::new();
    let url = format!("{}/ingest", sidecar_url);

    let res = client.post(url).json(&req).send().await?;

    if !res.status().is_success() {
        let err = res.text().await?;
        anyhow::bail!("Failed to ingest file: {}", err);
    }

    let resp: IngestResponse = res.json().await?;
    Ok(resp)
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

// ─── Reference Extraction (for auto-linking) ────────────────────────

#[derive(Serialize)]
struct ExtractReferencesRequest {
    text: String,
    known_symbols: Vec<String>,
}

#[derive(Deserialize, Debug)]
pub struct ExtractedReference {
    pub text: String,
    pub ref_type: String,
    pub start: usize,
    pub end: usize,
    pub confidence: f64,
}

#[derive(Deserialize, Debug)]
pub struct ExtractReferencesResponse {
    pub references: Vec<ExtractedReference>,
}

/// Call sidecar /extract-references endpoint.
pub async fn extract_references(
    text: &str,
    known_symbols: &[String],
    sidecar_url: &str,
) -> anyhow::Result<ExtractReferencesResponse> {
    let req = ExtractReferencesRequest {
        text: text.to_string(),
        known_symbols: known_symbols.to_vec(),
    };

    let client = reqwest::Client::new();
    let url = format!("{}/extract-references", sidecar_url);

    let res = client.post(url).json(&req).send().await?;

    if !res.status().is_success() {
        let err = res.text().await?;
        anyhow::bail!("Sidecar extract-references error: {}", err);
    }

    let result = res.json::<ExtractReferencesResponse>().await?;
    Ok(result)
}

/// Embed a note's content into LanceDB via sidecar /embed endpoint.
pub async fn embed_note(
    note_id: &str,
    title: &str,
    content: &str,
    sidecar_url: &str,
) -> anyhow::Result<()> {
    let text = format!("Note: {}\n\n{}", title, content);

    #[derive(Serialize)]
    struct EmbedReq<'a> {
        text: String,
        metadata: std::collections::HashMap<&'a str, &'a str>,
    }

    let source_file_key = format!("note_{}", note_id);
    let mut metadata = std::collections::HashMap::new();
    metadata.insert("source_type", "note");
    metadata.insert("source_file", source_file_key.as_str());
    metadata.insert("entity_id", note_id);
    metadata.insert("chunk_type", "note");

    let req = EmbedReq { text, metadata };

    let client = reqwest::Client::new();
    let url = format!("{}/embed", sidecar_url);

    let res = client.post(url).json(&req).send().await?;

    if !res.status().is_success() {
        let err = res.text().await?;
        anyhow::bail!("Sidecar embed note error: {}", err);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_sha256() {
        let hash = compute_sha256("hello world");
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
        // Same input produces same hash
        assert_eq!(hash, compute_sha256("hello world"));
        // Different input produces different hash
        assert_ne!(hash, compute_sha256("hello world!"));
    }

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
