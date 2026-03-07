use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const SIDECAR_TIMEOUT_SECS: u64 = 10;
const SIDECAR_MAX_RETRIES: usize = 3;
const SIDECAR_RETRY_BASE_MS: u64 = 200;
const SIDECAR_CIRCUIT_FAILURE_THRESHOLD: usize = 5;
const SIDECAR_CIRCUIT_OPEN_SECS: u64 = 30;

#[derive(Default)]
struct CircuitState {
    consecutive_failures: usize,
    opened_at: Option<Instant>,
}

static SIDECAR_CIRCUIT: OnceLock<Mutex<CircuitState>> = OnceLock::new();

fn circuit_state() -> &'static Mutex<CircuitState> {
    SIDECAR_CIRCUIT.get_or_init(|| Mutex::new(CircuitState::default()))
}

fn circuit_precheck() -> Result<(), String> {
    let mut state = circuit_state().lock().map_err(|e| e.to_string())?;
    if let Some(opened_at) = state.opened_at {
        let open_for = Duration::from_secs(SIDECAR_CIRCUIT_OPEN_SECS);
        let elapsed = opened_at.elapsed();
        if elapsed < open_for {
            let remaining = open_for.saturating_sub(elapsed).as_secs();
            return Err(format!(
                "sidecar circuit open; retry after {}s",
                remaining.max(1)
            ));
        }
        // Cooldown elapsed; allow a probe request.
        state.opened_at = None;
    }
    Ok(())
}

fn circuit_mark_success() -> Result<(), String> {
    let mut state = circuit_state().lock().map_err(|e| e.to_string())?;
    state.consecutive_failures = 0;
    state.opened_at = None;
    Ok(())
}

fn circuit_mark_failure() -> Result<(), String> {
    let mut state = circuit_state().lock().map_err(|e| e.to_string())?;
    state.consecutive_failures = state.consecutive_failures.saturating_add(1);
    if state.consecutive_failures >= SIDECAR_CIRCUIT_FAILURE_THRESHOLD {
        state.opened_at = Some(Instant::now());
    }
    Ok(())
}

pub async fn send_with_policy<F>(
    mut build_request: F,
) -> Result<reqwest::Response, String>
where
    F: FnMut() -> reqwest::RequestBuilder,
{
    circuit_precheck()?;

    let mut last_error: Option<String> = None;
    for attempt in 0..SIDECAR_MAX_RETRIES {
        match build_request()
            .timeout(Duration::from_secs(SIDECAR_TIMEOUT_SECS))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_server_error() => {
                last_error = Some(format!("server error {}", resp.status().as_u16()));
            }
            Ok(resp) => {
                let _ = circuit_mark_success();
                return Ok(resp);
            }
            Err(e) => {
                last_error = Some(e.to_string());
            }
        }

        if attempt + 1 < SIDECAR_MAX_RETRIES {
            let backoff = SIDECAR_RETRY_BASE_MS * (1 << attempt);
            tokio::time::sleep(Duration::from_millis(backoff)).await;
        }
    }

    let _ = circuit_mark_failure();
    Err(format!(
        "sidecar request failed after {} attempts: {}",
        SIDECAR_MAX_RETRIES,
        last_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}
