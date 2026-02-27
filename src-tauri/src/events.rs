use serde::{Deserialize, Serialize};

pub const INDEXING_PROGRESS: &str = "indexing:progress";
pub const INDEXING_FILE_COMPLETE: &str = "indexing:file-complete";
pub const INDEXING_FILE_ERROR: &str = "indexing:file-error";
pub const INDEXING_FILE_DELETED: &str = "indexing:file-deleted";

pub const PTY_OUTPUT: &str = "pty:output";
pub const PTY_EXIT: &str = "pty:exit";
pub const TERMINAL_COMMAND_START: &str = "terminal:command-start";
pub const TERMINAL_COMMAND_END: &str = "terminal:command-end";
pub const TERMINAL_PIPELINE_STATUS: &str = "terminal:pipeline-status";

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

#[derive(Clone, Serialize)]
pub struct PtyOutputPayload {
    pub session_id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct PtyExitPayload {
    pub session_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Serialize)]
pub struct TerminalCommandStartPayload {
    pub session_id: String,
    pub command: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct TerminalCommandEndPayload {
    pub session_id: String,
    pub command: String,
    pub exit_code: Option<i32>,
    pub cwd: Option<String>,
    pub duration_ms: Option<u64>,
    pub output: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct TerminalPipelineStatusPayload {
    pub session_id: String,
    pub command: String,
    pub status: String, // "running", "completed", "failed"
    pub duration_ms: u64,
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
