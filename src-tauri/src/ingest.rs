use serde::Serialize;
use std::path::Path;
use std::fs;
use std::collections::HashMap;

#[derive(Serialize)]
pub struct Chunk {
    pub text: String,
    pub index: usize,
}

#[derive(Serialize)]
struct EmbedRequest {
    text: String,
    metadata: HashMap<String, serde_json::Value>,
}

pub fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let words: Vec<&str> = text.split_whitespace().collect();
    
    if words.is_empty() {
        return chunks;
    }

    let mut start = 0;
    let mut chunk_index = 0;

    while start < words.len() {
        let end = std::cmp::min(start + chunk_size, words.len());
        let chunk_words = &words[start..end];
        let chunk_text = chunk_words.join(" ");
        
        chunks.push(Chunk {
            text: chunk_text,
            index: chunk_index,
        });

        if end == words.len() {
            break;
        }

        start += chunk_size.saturating_sub(overlap).max(1);
        chunk_index += 1;
    }

    chunks
}

pub async fn process_file(path: &Path, sidecar_url: &str) -> anyhow::Result<()> {
    if !path.is_file() {
        return Ok(());
    }

    let content = fs::read_to_string(path)?;
    let chunks = chunk_text(&content, 500, 50); // Default chunk sizes

    for chunk in chunks {
        ingest_chunk(&chunk, path, sidecar_url).await?;
    }

    Ok(())
}

async fn ingest_chunk(chunk: &Chunk, path: &Path, sidecar_url: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let url = format!("{}/embed", sidecar_url);
    
    let mut metadata = HashMap::new();
    metadata.insert("source_file".to_string(), serde_json::Value::String(path.to_string_lossy().to_string()));
    metadata.insert("chunk_index".to_string(), serde_json::Value::Number(serde_json::Number::from(chunk.index)));

    let req = EmbedRequest {
        text: chunk.text.clone(),
        metadata,
    };

    let res = client.post(url)
        .json(&req)
        .send()
        .await?;

    if !res.status().is_success() {
        let err = res.text().await?;
        anyhow::bail!("Failed to ingest chunk: {}", err);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_text_basic() {
        let text = "Cortex is an AI-augmented workspace for developers. It uses local models for privacy.";
        // chunk_size=5 words, overlap=2 words
        let chunks = chunk_text(text, 5, 2);
        
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].index, 0);
        assert!(chunks[0].text.split_whitespace().count() <= 5);
    }
}
