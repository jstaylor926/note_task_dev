use serde::Serialize;

pub const INDEXING_PROGRESS: &str = "indexing:progress";
pub const INDEXING_FILE_COMPLETE: &str = "indexing:file-complete";
pub const INDEXING_FILE_ERROR: &str = "indexing:file-error";
pub const INDEXING_FILE_DELETED: &str = "indexing:file-deleted";

#[derive(Clone, Serialize)]
pub struct IndexingProgressPayload {
    pub completed: usize,
    pub total: usize,
    pub current_file: Option<String>,
    pub is_idle: bool,
}

#[derive(Clone, Serialize)]
pub struct IndexingFileCompletePayload {
    pub file_path: String,
    pub chunk_count: usize,
    pub completed: usize,
    pub total: usize,
}

#[derive(Clone, Serialize)]
pub struct IndexingFileErrorPayload {
    pub file_path: String,
    pub error: String,
    pub completed: usize,
    pub total: usize,
}

#[derive(Clone, Serialize)]
pub struct IndexingFileDeletedPayload {
    pub file_path: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_progress_payload_serialize() {
        let payload = IndexingProgressPayload {
            completed: 5,
            total: 10,
            current_file: Some("/tmp/test.rs".to_string()),
            is_idle: false,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"completed\":5"));
        assert!(json.contains("\"total\":10"));
        assert!(json.contains("\"is_idle\":false"));
        assert!(json.contains("\"current_file\":\"/tmp/test.rs\""));
    }

    #[test]
    fn test_progress_payload_idle_with_null_file() {
        let payload = IndexingProgressPayload {
            completed: 10,
            total: 10,
            current_file: None,
            is_idle: true,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"is_idle\":true"));
        assert!(json.contains("\"current_file\":null"));
    }

    #[test]
    fn test_file_complete_payload_serialize() {
        let payload = IndexingFileCompletePayload {
            file_path: "/tmp/test.rs".to_string(),
            chunk_count: 3,
            completed: 1,
            total: 5,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"chunk_count\":3"));
        assert!(json.contains("\"file_path\":\"/tmp/test.rs\""));
    }

    #[test]
    fn test_file_error_payload_serialize() {
        let payload = IndexingFileErrorPayload {
            file_path: "/tmp/bad.rs".to_string(),
            error: "read failed".to_string(),
            completed: 2,
            total: 5,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"error\":\"read failed\""));
    }
}
