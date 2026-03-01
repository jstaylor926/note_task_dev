# Phase 8: Mobile Companion App

> **Goal:** A native mobile app (Swift iOS / Kotlin Android) that acts as a lightweight remote control for the running Cortex desktop app over the local network. Inspired by the Claude Code remote-control pattern — the desktop remains the "brain," the mobile is a thin authenticated client.

**Prerequisites:** Core desktop features stable (Phases 0-5). Does NOT require Phase 6/7 completion.

---

## Design Philosophy

The mobile app is **not a standalone Cortex port.** It is a **remote viewport and command surface** for a running desktop instance. Think of it like SSH for your workspace — you authenticate, connect, and interact with the same state that's on your desktop.

This means:

- **No local database on mobile.** All data lives on the desktop's SQLite + LanceDB.
- **No sidecar on mobile.** Embedding, indexing, and ML stay on the desktop.
- **No offline mode (v1).** The phone must be on the same network as the desktop.
- **Stateless client.** The mobile app caches nothing durable — it's a live window into the desktop.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Desktop (Cortex)                         │
│                                                           │
│  ┌──────────┐    ┌────────────────┐    ┌──────────────┐  │
│  │  Tauri    │    │  Remote API    │    │   Python     │  │
│  │  Backend  │◄──►│  Server (Rust) │    │   Sidecar    │  │
│  │  (state)  │    │  (axum/warp)   │    │   (FastAPI)  │  │
│  └──────────┘    └───────┬────────┘    └──────────────┘  │
│                          │                                │
│                    TLS + PIN auth                         │
│                          │                                │
└──────────────────────────┼───────────────────────────────┘
                           │ LAN (Wi-Fi)
                           │
┌──────────────────────────┼───────────────────────────────┐
│                   Mobile Client                           │
│                                                           │
│  ┌──────────┐    ┌────────────────┐    ┌──────────────┐  │
│  │  Notes &  │    │  API Client    │    │  Terminal    │  │
│  │  Tasks UI │◄──►│  (HTTP + WS)   │◄──►│  View       │  │
│  └──────────┘    └────────────────┘    └──────────────┘  │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              File Browser UI                          │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

Two transport layers:

1. **HTTP REST** — Request-response for CRUD operations (notes, tasks, files, health)
2. **WebSocket** — Streaming for terminal I/O (bidirectional, base64 binary data)

---

## Part 1: Desktop-Side Changes (Remote API Server)

### 1.1 Embedded HTTP Server in Tauri

Add an `axum` HTTP server inside the Tauri process that exposes the existing Tauri commands over the network. This runs alongside the existing Tauri IPC — the SolidJS frontend continues using `invoke()`, while mobile uses HTTP.

**Why axum inside Tauri (not a separate process):**
- Direct access to `AppState` (SQLite, PTY manager, sidecar handle) — no IPC hop
- Single port to manage, single auth boundary
- axum is already in the tokio ecosystem that Tauri uses
- Lighter than spinning up a third process

**Default bind:** `0.0.0.0:9401` (configurable). Only starts when user explicitly enables "Remote Access" in settings.

```rust
// src-tauri/src/remote_server.rs

use axum::{Router, routing::{get, post, delete}, extract::State, Json};
use tower_http::cors::CorsLayer;

pub fn build_router(app_state: AppState) -> Router {
    Router::new()
        // Health
        .route("/api/v1/health", get(health_handler))

        // Notes
        .route("/api/v1/notes", get(list_notes).post(create_note))
        .route("/api/v1/notes/:id", get(get_note).put(update_note).delete(delete_note))
        .route("/api/v1/notes/:id/auto-link", post(auto_link_note))

        // Tasks
        .route("/api/v1/tasks", get(list_tasks).post(create_task))
        .route("/api/v1/tasks/:id", get(get_task).put(update_task).delete(delete_task))

        // Files
        .route("/api/v1/files/read", post(read_file))
        .route("/api/v1/files/list", post(list_directory))
        .route("/api/v1/files/tree", get(file_tree))
        .route("/api/v1/files/stat", post(file_stat))

        // Terminal
        .route("/api/v1/terminal/sessions", get(list_terminals).post(create_terminal))
        .route("/api/v1/terminal/sessions/:id", delete(kill_terminal))
        .route("/api/v1/terminal/sessions/:id/resize", post(resize_terminal))
        // Terminal I/O is over WebSocket, not REST
        .route("/api/v1/terminal/sessions/:id/ws", get(terminal_websocket))

        // Search (stretch goal for v1, included for completeness)
        .route("/api/v1/search", get(semantic_search))

        // Entity Links
        .route("/api/v1/links", post(create_link).get(list_links))
        .route("/api/v1/links/:id", delete(delete_link))

        // Pairing
        .route("/api/v1/pair", post(pair_device))
        .route("/api/v1/pair/verify", post(verify_pin))

        .layer(auth_middleware())
        .layer(CorsLayer::permissive())
        .with_state(app_state)
}
```

### 1.2 Authentication: PIN Pairing Flow

**Pairing protocol (one-time per device):**

```
1. User enables "Remote Access" in desktop settings
2. Desktop generates a 6-digit PIN, displays it on screen
3. Desktop starts listening on 0.0.0.0:9401
4. Mobile app discovers desktop via mDNS (service type: _cortex._tcp)
   OR user manually enters desktop IP
5. Mobile sends POST /api/v1/pair with { device_name, device_id }
6. Desktop returns { challenge_id } and waits
7. Mobile prompts user for PIN, sends POST /api/v1/pair/verify
   with { challenge_id, pin, device_id }
8. Desktop verifies PIN, generates a long-lived API token (JWT or random 256-bit)
9. Desktop stores { device_id, device_name, token_hash, paired_at } in SQLite
10. Mobile stores token securely (iOS Keychain / Android Keystore)
11. All subsequent requests use Bearer token in Authorization header
```

**Token management:**
- Tokens are per-device, revocable from desktop settings UI
- Token has no expiry (local network, low risk) but can be rotated
- Desktop shows list of paired devices with "Revoke" button
- If PIN is entered wrong 3 times, pairing locks for 5 minutes

**New SQLite table:**

```sql
CREATE TABLE IF NOT EXISTS paired_devices (
    id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    token_hash TEXT NOT NULL,        -- SHA-256 of the bearer token
    platform TEXT,                   -- 'ios' or 'android'
    last_seen_at TEXT,
    paired_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked INTEGER NOT NULL DEFAULT 0
);
```

### 1.3 Terminal WebSocket Protocol

Terminal I/O needs real-time bidirectional streaming. REST won't cut it.

```
Mobile ──── WebSocket ───── Desktop
   │                           │
   │  ← { type: "output",     │   (PTY stdout, base64)
   │       data: "base64..." } │
   │                           │
   │  → { type: "input",      │   (keystrokes, base64)
   │       data: "base64..." } │
   │                           │
   │  → { type: "resize",     │   (terminal resize)
   │       cols: 80, rows: 24}│
   │                           │
   │  ← { type: "exit",       │   (process exited)
   │       code: 0 }          │
   │                           │
   │  ← { type: "command_end",│   (OSC 633 command capture)
   │       command: "...",     │
   │       exit_code: 0,      │
   │       cwd: "/path" }     │
```

This maps directly to the existing PTY events (`pty:output`, `pty:exit`, `terminal:command-end`). The WebSocket handler subscribes to Tauri events for the given session and relays them to the mobile client.

### 1.4 mDNS Service Advertisement

When remote access is enabled, advertise via mDNS so the mobile app can auto-discover the desktop:

```rust
// Using mdns-sd crate
let service = ServiceInfo::new(
    "_cortex._tcp.local.",
    &hostname,
    &format!("{}.local.", hostname),
    local_ip,
    9401,
    &[("version", "1"), ("name", &machine_name)]
)?;
mdns_daemon.register(service)?;
```

Mobile app listens for `_cortex._tcp` services on the local network and presents discovered instances to the user.

### 1.5 Desktop Settings UI Addition

New section in settings (when settings UI is built):

```
Remote Access
├── [Toggle] Enable remote connections
├── [Display] Listening on 192.168.1.42:9401
├── [Button] Generate Pairing PIN
├── [Display] PIN: 847293 (expires in 5 minutes)
├── Paired Devices
│   ├── iPhone 15 Pro — paired 2026-02-28 — [Revoke]
│   └── Pixel 8 — paired 2026-03-01 — [Revoke]
└── [Advanced]
    ├── Port: 9401
    └── [Toggle] Require TLS (self-signed cert)
```

---

## Part 2: Mobile App — iOS (Swift)

### 2.1 Project Structure

```
CortexMobile-iOS/
├── CortexMobile.xcodeproj
├── Sources/
│   ├── App/
│   │   ├── CortexApp.swift              # SwiftUI app entry
│   │   └── AppState.swift               # ObservableObject, connection state
│   ├── Networking/
│   │   ├── CortexAPIClient.swift        # HTTP client (URLSession)
│   │   ├── WebSocketManager.swift       # Terminal WebSocket (URLSessionWebSocketTask)
│   │   ├── ServiceDiscovery.swift       # mDNS/Bonjour browser
│   │   └── AuthManager.swift            # Keychain token storage
│   ├── Models/
│   │   ├── Note.swift                   # Codable models matching Rust types
│   │   ├── Task.swift
│   │   ├── FileEntry.swift
│   │   └── TerminalSession.swift
│   ├── Views/
│   │   ├── Connection/
│   │   │   ├── DiscoveryView.swift      # Find desktop on network
│   │   │   └── PairingView.swift        # PIN entry
│   │   ├── Dashboard/
│   │   │   └── DashboardView.swift      # Home screen: quick actions + status
│   │   ├── Notes/
│   │   │   ├── NoteListView.swift       # Note list with search
│   │   │   └── NoteEditorView.swift     # Markdown editor (lightweight)
│   │   ├── Tasks/
│   │   │   ├── TaskListView.swift       # Task list with filters
│   │   │   ├── TaskBoardView.swift      # Compact Kanban
│   │   │   └── TaskDetailView.swift     # Edit task
│   │   ├── Terminal/
│   │   │   ├── TerminalView.swift       # Terminal display
│   │   │   └── TerminalInputBar.swift   # Command input + quick actions
│   │   └── Files/
│   │       ├── FileBrowserView.swift    # Directory tree
│   │       └── FilePreviewView.swift    # Read-only file viewer (syntax highlighted)
│   └── Utilities/
│       ├── SyntaxHighlighter.swift      # Basic code highlighting
│       └── MarkdownRenderer.swift       # Note rendering
├── Tests/
└── Resources/
```

### 2.2 Key iOS Implementation Details

**Networking Layer:**
- `URLSession` for REST calls (no third-party HTTP lib needed)
- `URLSessionWebSocketTask` for terminal WebSocket (native since iOS 13)
- `NWBrowser` (Network.framework) for Bonjour/mDNS discovery
- Token stored in iOS Keychain via `Security.framework`

**Terminal on Mobile:**
- No xterm.js on mobile. Use a custom `UITextView`/`AttributedString` renderer for terminal output
- Support basic ANSI color codes (the 16-color set) via attributed strings
- Input bar at bottom with a text field + "Enter" button
- Quick action buttons: Ctrl+C, Tab, Up arrow (history), Ctrl+D
- Haptic feedback on command completion (success = light tap, error = heavy tap)

**Notes Editor:**
- Lightweight Markdown editor — `TextEditor` with basic formatting toolbar
- Render preview using `AttributedString` or a `WKWebView` with marked.js
- Offline draft queue: if connection drops mid-edit, buffer changes locally and sync when reconnected

**Minimum iOS version:** iOS 16 (for modern SwiftUI, NavigationStack, etc.)

### 2.3 iOS App Screens

```
┌─────────────────────────┐
│    Discovery Screen      │
│                          │
│  Searching for Cortex... │
│                          │
│  ┌────────────────────┐  │
│  │ JT's MacBook Pro   │  │
│  │ 192.168.1.42:9401  │  │
│  │         [Connect]  │  │
│  └────────────────────┘  │
│                          │
│  [Enter IP manually]     │
└─────────────────────────┘

┌─────────────────────────┐
│     Pairing Screen       │
│                          │
│  Enter the PIN shown     │
│  on your desktop:        │
│                          │
│    ┌─┐ ┌─┐ ┌─┐          │
│    │8│ │4│ │7│           │
│    └─┘ └─┘ └─┘          │
│    ┌─┐ ┌─┐ ┌─┐          │
│    │2│ │9│ │3│           │
│    └─┘ └─┘ └─┘          │
│                          │
│       [Pair Device]      │
└─────────────────────────┘

┌─────────────────────────┐
│     Dashboard            │
│  ─────────────────────── │
│  Connected to MacBook    │
│  ● Sidecar healthy       │
│                          │
│  ┌─────────┐ ┌────────┐ │
│  │  Notes   │ │ Tasks  │ │
│  │   12     │ │  8     │ │
│  └─────────┘ └────────┘ │
│  ┌─────────┐ ┌────────┐ │
│  │Terminal  │ │ Files  │ │
│  │  2 sess  │ │ Browse │ │
│  └─────────┘ └────────┘ │
│                          │
│  Recent Notes            │
│  ├─ Gradient Accum Plan  │
│  ├─ Ch.3 Draft           │
│  └─ Meeting Notes Feb    │
│                          │
│  Active Tasks            │
│  ├─ ○ Implement grad acc │
│  └─ ○ Fix transform bug  │
└─────────────────────────┘

┌─────────────────────────┐
│  ◄ Terminal: zsh         │
│  ─────────────────────── │
│                          │
│  $ python train.py       │
│  Epoch 12/100            │
│  Loss: 0.234             │
│  Accuracy: 0.891         │
│  █████████░░░ 12%        │
│                          │
│                          │
│                          │
│  ─────────────────────── │
│  [Ctrl+C] [Tab] [↑]     │
│  ┌────────────────────┐  │
│  │ $ _                 │  │
│  └────────────────────┘  │
│              [Send ➤]    │
└─────────────────────────┘
```

---

## Part 3: Mobile App — Android (Kotlin)

### 3.1 Project Structure

```
cortex-mobile-android/
├── app/
│   ├── src/main/
│   │   ├── java/com/cortex/mobile/
│   │   │   ├── CortexApplication.kt
│   │   │   ├── ui/
│   │   │   │   ├── discovery/DiscoveryScreen.kt
│   │   │   │   ├── pairing/PairingScreen.kt
│   │   │   │   ├── dashboard/DashboardScreen.kt
│   │   │   │   ├── notes/NoteListScreen.kt
│   │   │   │   ├── notes/NoteEditorScreen.kt
│   │   │   │   ├── tasks/TaskListScreen.kt
│   │   │   │   ├── tasks/TaskBoardScreen.kt
│   │   │   │   ├── terminal/TerminalScreen.kt
│   │   │   │   └── files/FileBrowserScreen.kt
│   │   │   ├── data/
│   │   │   │   ├── api/CortexApiService.kt      # Retrofit interface
│   │   │   │   ├── ws/TerminalWebSocket.kt       # OkHttp WebSocket
│   │   │   │   ├── discovery/NsdDiscovery.kt     # Android NSD (mDNS)
│   │   │   │   └── auth/TokenManager.kt          # EncryptedSharedPreferences
│   │   │   ├── model/
│   │   │   │   ├── Note.kt
│   │   │   │   ├── Task.kt
│   │   │   │   └── FileEntry.kt
│   │   │   └── viewmodel/
│   │   │       ├── ConnectionViewModel.kt
│   │   │       ├── NotesViewModel.kt
│   │   │       ├── TasksViewModel.kt
│   │   │       ├── TerminalViewModel.kt
│   │   │       └── FilesViewModel.kt
│   │   └── res/
│   └── build.gradle.kts
├── gradle/
└── settings.gradle.kts
```

### 3.2 Key Android Implementation Details

**Tech stack:**
- Jetpack Compose for UI
- Retrofit + OkHttp for REST
- OkHttp WebSocket for terminal streaming
- Android NSD (Network Service Discovery) for mDNS
- EncryptedSharedPreferences for token storage
- Kotlin Coroutines + Flow for reactive data
- Hilt for dependency injection

**Terminal rendering:**
- Custom Compose `Canvas` or `BasicText` with `AnnotatedString` for ANSI colors
- Virtual keyboard with terminal-specific keys row (Ctrl, Tab, Esc, arrows)
- Same quick-action buttons as iOS

**Minimum Android version:** API 26 (Android 8.0) — covers 95%+ of active devices

---

## Part 4: API Contract (Shared Between Platforms)

### 4.1 REST Endpoints

All endpoints prefixed with `/api/v1/`. All require `Authorization: Bearer <token>` header (except pairing endpoints).

#### Health
```
GET /health
Response: {
  "status": "ok",
  "tauri": true,
  "sidecar": true,
  "sqlite": true,
  "lancedb": true,
  "version": "0.1.0",
  "uptime_seconds": 3600
}
```

#### Notes
```
GET    /notes                    → NoteRow[]
POST   /notes                    → NoteRow         body: { title, content }
GET    /notes/:id                → NoteRow
PUT    /notes/:id                → bool             body: { title?, content? }
DELETE /notes/:id                → bool
POST   /notes/:id/auto-link      → EntityLinkRow[]
```

#### Tasks
```
GET    /tasks?status=todo|doing|done  → TaskRow[]
POST   /tasks                         → TaskRow     body: { title, content?, priority, source_type? }
GET    /tasks/:id                     → TaskRow
PUT    /tasks/:id                     → bool         body: { title?, content?, status?, priority?, due_date? }
DELETE /tasks/:id                     → bool
```

#### Files
```
POST   /files/list     → DirEntry[]       body: { path }
POST   /files/read     → FileReadResponse  body: { path }
POST   /files/stat     → FileStat          body: { path }
GET    /files/tree     → FileEntry[]       query: ?root=/path
```

#### Terminal
```
GET    /terminal/sessions                → TerminalSession[]
POST   /terminal/sessions                → { session_id }    body: { cwd?, cols?, rows? }
DELETE /terminal/sessions/:id            → bool
POST   /terminal/sessions/:id/resize     → bool              body: { cols, rows }
GET    /terminal/sessions/:id/ws         → WebSocket upgrade
```

#### Pairing
```
POST   /pair          → { challenge_id }    body: { device_name, device_id, platform }
POST   /pair/verify   → { token }           body: { challenge_id, pin, device_id }
```

### 4.2 WebSocket Message Types

```typescript
// Client → Server
type ClientMessage =
  | { type: "input"; data: string }      // base64 encoded keystrokes
  | { type: "resize"; cols: number; rows: number }

// Server → Client
type ServerMessage =
  | { type: "output"; data: string }     // base64 encoded PTY output
  | { type: "exit"; code: number | null }
  | { type: "command_end"; command: string; exit_code: number; cwd: string; duration_ms: number }
```

### 4.3 Error Response Format

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Note with id 'abc123' not found"
  }
}
```

Standard HTTP status codes: 200, 201, 400, 401, 403, 404, 500.

---

## Part 5: Implementation Plan

### Phase 8a: Desktop Remote API (2-3 weeks)

| # | Task | Depends On | Test |
|---|------|-----------|------|
| 1 | Add `axum` + `tower` + `tokio-tungstenite` to `src-tauri/Cargo.toml` | — | Compiles |
| 2 | Create `remote_server.rs` with axum Router skeleton | 1 | Integration test: server starts and responds to /health |
| 3 | Implement auth middleware (Bearer token validation) | 2 | Unit test: rejects invalid tokens, accepts valid |
| 4 | Implement PIN pairing endpoints (`/pair`, `/pair/verify`) | 2, 3 | Integration test: full pairing flow |
| 5 | Add `paired_devices` table to SQLite schema | — | Migration test |
| 6 | Wire note endpoints to existing `db.rs` note functions | 2, 3 | Integration test: CRUD via HTTP matches CRUD via invoke |
| 7 | Wire task endpoints to existing `db.rs` task functions | 2, 3 | Same as above |
| 8 | Wire file endpoints to existing file commands | 2, 3 | Integration test: list/read/stat via HTTP |
| 9 | Implement terminal WebSocket handler | 2, 3 | Integration test: create session, send input, receive output |
| 10 | Add mDNS advertisement (`mdns-sd` crate) | 2 | Test: service discoverable on LAN |
| 11 | Add "Remote Access" toggle to app config | 5 | Config persists, server starts/stops |
| 12 | TLS support (self-signed cert generation via `rcgen`) | 2 | Test: HTTPS connection works |
| 13 | Rate limiting middleware (`tower::limit`) | 2 | Test: rate limit kicks in |

### Phase 8b: iOS App (3-4 weeks)

| # | Task | Depends On | Test |
|---|------|-----------|------|
| 1 | Xcode project setup, SwiftUI app scaffold | 8a complete | Builds and runs |
| 2 | Bonjour service discovery (`NWBrowser`) | 1 | Discovers desktop on LAN |
| 3 | PIN pairing flow UI + API client | 2 | Pairs with desktop, stores token |
| 4 | Dashboard screen (health status, quick links) | 3 | Shows connection status |
| 5 | Notes list + editor views | 4 | Create, read, update, delete notes |
| 6 | Tasks list + Kanban board views | 4 | Create, read, update, delete tasks |
| 7 | File browser + file preview | 4 | Navigate dirs, read files with syntax highlighting |
| 8 | Terminal view + WebSocket integration | 4 | Connect to PTY, send commands, see output |
| 9 | ANSI color rendering in terminal view | 8 | Colors render correctly |
| 10 | Polish: haptics, pull-to-refresh, dark mode | 5-9 | Manual QA |
| 11 | Reconnection logic (auto-reconnect on network change) | 3 | Recovers from Wi-Fi drop |

### Phase 8c: Android App (3-4 weeks, can parallel with 8b)

| # | Task | Depends On | Test |
|---|------|-----------|------|
| 1 | Android project setup, Compose scaffold, Hilt DI | 8a complete | Builds and runs |
| 2 | NSD service discovery | 1 | Discovers desktop on LAN |
| 3 | PIN pairing flow UI + Retrofit client | 2 | Pairs with desktop, stores token |
| 4 | Dashboard screen | 3 | Shows connection status |
| 5 | Notes list + editor screens | 4 | CRUD notes |
| 6 | Tasks list + board screens | 4 | CRUD tasks |
| 7 | File browser + preview | 4 | Navigate dirs, read files |
| 8 | Terminal screen + OkHttp WebSocket | 4 | Terminal I/O works |
| 9 | ANSI rendering with AnnotatedString | 8 | Colors work |
| 10 | Polish: Material You theming, haptics | 5-9 | Manual QA |
| 11 | Reconnection logic | 3 | Recovers gracefully |

---

## Part 6: Security Considerations

### Network Security
- **TLS required by default** for all API traffic (self-signed cert, pinned by mobile on first pairing)
- **PIN brute-force protection:** 3 attempts, then 5-minute lockout, then 15-minute, then 1-hour
- **Token is 256-bit random**, stored hashed (SHA-256) on desktop, raw in Keychain/Keystore on mobile
- **No port forwarding guidance** — the app should not encourage exposing the API to the internet in v1

### File Access
- Remote API respects the same file access boundaries as the desktop app
- Files outside watched directories are accessible but could be scoped down in future
- No file write endpoint in v1 (read-only for files — notes/tasks have their own write paths)
- Path traversal protection: validate all file paths are within workspace root

### Terminal Security
- Terminal sessions created via mobile have the same permissions as the desktop user
- Consider: optional "read-only terminal" mode that only shows output, no input
- Session idle timeout: kill terminal sessions inactive for 30 minutes (configurable)

---

## Part 7: Future Extensions (Post-v1)

These are explicitly out of scope for v1 but worth designing toward:

1. **Semantic search on mobile** — already have the endpoint, just need a search UI
2. **Push notifications** — desktop pushes events (task due, indexing complete, terminal exit) via APNs/FCM
3. **Offline draft queue** — buffer note/task edits locally, sync when reconnected
4. **Quick capture widget** — iOS widget / Android widget for instant note or task creation
5. **Voice-to-note** — capture audio on mobile, send to desktop for whisper.cpp transcription
6. **Tunnel/relay support** — Tailscale or WireGuard integration for remote access outside LAN
7. **Multi-device pairing** — already supported by schema, just needs UI
8. **Share sheet integration** — share links/text from other apps into Cortex as notes
9. **Biometric lock** — Face ID / fingerprint to open the mobile app

---

## Part 8: Dependency Changes

### Desktop (src-tauri/Cargo.toml additions)

```toml
[dependencies]
axum = "0.7"
tower = "0.4"
tower-http = { version = "0.5", features = ["cors", "trace", "limit"] }
tokio-tungstenite = "0.23"      # WebSocket for terminal
mdns-sd = "0.11"                # mDNS service advertisement
rcgen = "0.13"                  # Self-signed TLS cert generation
jsonwebtoken = "9"              # JWT for API tokens (alternative: random tokens)
```

### iOS

```
// Swift Package Manager
- Alamofire (optional, can use URLSession)
- swift-markdown-ui (note rendering)
- KeychainAccess (token storage, wraps Security.framework)
```

### Android

```kotlin
// build.gradle.kts
implementation("com.squareup.retrofit2:retrofit:2.11.0")
implementation("com.squareup.retrofit2:converter-gson:2.11.0")
implementation("com.squareup.okhttp3:okhttp:4.12.0")
implementation("androidx.security:security-crypto:1.1.0-alpha06")
implementation("io.noties.markwon:core:4.6.2")  // Markdown rendering
```

---

## Definition of Done

- [ ] Desktop remote API server starts/stops via settings toggle
- [ ] PIN pairing flow works end-to-end (generate, verify, store token)
- [ ] All REST endpoints return correct data matching Tauri command outputs
- [ ] Terminal WebSocket streams bidirectional data correctly
- [ ] mDNS discovery works on local network
- [ ] TLS enabled by default with self-signed cert
- [ ] iOS app: discovery → pair → dashboard → notes/tasks/terminal/files all functional
- [ ] Android app: same feature parity as iOS
- [ ] Auth middleware rejects invalid/revoked tokens
- [ ] Rate limiting prevents abuse
- [ ] File path traversal protection validated
- [ ] >80% test coverage on remote_server.rs
- [ ] Integration tests cover full pairing + CRUD + terminal flow

---

## Open Questions

1. Should the remote API be a Tauri plugin (publishable, reusable) or inline code?
2. Should file writes be allowed from mobile in v1, or keep it read-only?
3. Is self-signed TLS + cert pinning sufficient, or should we support Let's Encrypt for power users?
4. Should the mobile app support multiple paired desktops (e.g., work machine + home machine)?
5. How should terminal scrollback be handled on mobile? Stream everything or paginate history?
6. Should the mobile Kanban board support drag-and-drop task reordering?
7. Is it worth adding a "command palette" on mobile (like Cmd+K) for quick actions?
8. Should the mobile app have its own onboarding flow explaining what Cortex is, or assume the user already knows?
