//! Authentication for the Remote API server.
//!
//! Implements PIN-based device pairing and Bearer token validation.
//! Flow:
//!   1. Desktop generates a 6-digit PIN (valid for 5 minutes)
//!   2. Mobile sends POST /api/v1/pair with device info
//!   3. Mobile sends POST /api/v1/pair/verify with PIN
//!   4. On success, desktop returns a Bearer token
//!   5. All subsequent requests use Authorization: Bearer <token>

use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::db;

/// Shared state for pairing challenges
#[derive(Debug, Clone)]
pub struct PairingState {
    pub active_challenge: Arc<Mutex<Option<PairingChallenge>>>,
    pub failed_attempts: Arc<Mutex<u32>>,
    pub lockout_until: Arc<Mutex<Option<Instant>>>,
}

#[derive(Debug, Clone)]
pub struct PairingChallenge {
    pub challenge_id: String,
    pub pin: String,
    pub device_id: String,
    pub device_name: String,
    pub platform: Option<String>,
    pub created_at: Instant,
}

impl PairingState {
    pub fn new() -> Self {
        Self {
            active_challenge: Arc::new(Mutex::new(None)),
            failed_attempts: Arc::new(Mutex::new(0)),
            lockout_until: Arc::new(Mutex::new(None)),
        }
    }

    /// Generate a new 6-digit PIN for pairing. Returns the PIN string.
    pub fn generate_pin(&self) -> String {
        let mut rng = rand::thread_rng();
        let pin: u32 = rng.gen_range(100_000..1_000_000);
        pin.to_string()
    }

    /// Check if pairing is currently locked out due to failed attempts.
    pub fn is_locked_out(&self) -> bool {
        let lockout = self.lockout_until.lock().unwrap();
        if let Some(until) = *lockout {
            if Instant::now() < until {
                return true;
            }
        }
        false
    }

    /// Record a failed pairing attempt. Returns true if now locked out.
    pub fn record_failure(&self) -> bool {
        let mut attempts = self.failed_attempts.lock().unwrap();
        *attempts += 1;
        if *attempts >= 3 {
            let lockout_duration = match *attempts {
                3..=5 => Duration::from_secs(300),   // 5 minutes
                6..=8 => Duration::from_secs(900),   // 15 minutes
                _ => Duration::from_secs(3600),      // 1 hour
            };
            let mut lockout = self.lockout_until.lock().unwrap();
            *lockout = Some(Instant::now() + lockout_duration);
            true
        } else {
            false
        }
    }

    /// Reset failed attempts after successful pairing.
    pub fn reset_failures(&self) {
        let mut attempts = self.failed_attempts.lock().unwrap();
        *attempts = 0;
        let mut lockout = self.lockout_until.lock().unwrap();
        *lockout = None;
    }
}

/// Generate a cryptographically random API token (256-bit, hex-encoded).
pub fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let mut bytes = [0u8; 32];
    rng.fill(&mut bytes);
    hex::encode(bytes)
}

/// Hash a token with SHA-256 for storage.
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

// ─── Request/Response types ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PairRequest {
    pub device_name: String,
    pub device_id: String,
    pub platform: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PairResponse {
    pub challenge_id: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyPinRequest {
    pub challenge_id: String,
    pub pin: String,
    pub device_id: String,
}

#[derive(Debug, Serialize)]
pub struct VerifyPinResponse {
    pub token: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

impl ErrorResponse {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            error: ErrorDetail {
                code: code.to_string(),
                message: message.to_string(),
            },
        }
    }
}

// ─── Shared state type ───────────────────────────────────────────────

/// The shared state available to all axum handlers.
/// Wraps the Tauri AppState DB connection + pairing state.
#[derive(Clone)]
pub struct RemoteAppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub app_handle: tauri::AppHandle,
    pub sidecar_url: String,
    pub project_root: String,
    pub pairing: PairingState,
    pub pty_manager: Arc<Mutex<crate::pty::PtyManager>>,
    pub shell_hooks_dir: Option<std::path::PathBuf>,
}

// ─── Auth middleware ─────────────────────────────────────────────────

/// Axum middleware that validates Bearer tokens.
/// Skips auth for pairing endpoints.
pub async fn auth_middleware(
    State(state): State<RemoteAppState>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = request.uri().path();

    // Skip auth for pairing endpoints and health check
    if path.starts_with("/api/v1/pair") || path == "/api/v1/health" {
        return Ok(next.run(request).await);
    }

    // Extract Bearer token
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..],
        _ => return Err(StatusCode::UNAUTHORIZED),
    };

    // Validate token against database
    let token_hash = hash_token(token);
    let valid = {
        let conn = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db::validate_device_token(&conn, &token_hash)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };

    match valid {
        Some(_device_id) => Ok(next.run(request).await),
        None => Err(StatusCode::UNAUTHORIZED),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_pin_is_6_digits() {
        let state = PairingState::new();
        let pin = state.generate_pin();
        assert_eq!(pin.len(), 6);
        assert!(pin.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn test_generate_token_is_64_hex_chars() {
        let token = generate_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_hash_token_deterministic() {
        let token = "test_token_123";
        let hash1 = hash_token(token);
        let hash2 = hash_token(token);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_hash_token_different_inputs() {
        let hash1 = hash_token("token_a");
        let hash2 = hash_token("token_b");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_lockout_after_3_failures() {
        let state = PairingState::new();
        assert!(!state.is_locked_out());
        assert!(!state.record_failure()); // 1
        assert!(!state.record_failure()); // 2
        assert!(state.record_failure());  // 3 → locked
        assert!(state.is_locked_out());
    }

    #[test]
    fn test_reset_failures() {
        let state = PairingState::new();
        state.record_failure();
        state.record_failure();
        state.record_failure();
        assert!(state.is_locked_out());

        state.reset_failures();
        assert!(!state.is_locked_out());
    }
}
