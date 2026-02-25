# Phase 2: Session State & Handoff

> **Goal:** The session handoff mechanism works end-to-end. You can close the app, reopen it, and the LLM greets you with full awareness of what you were doing, what was blocking you, and what you planned to do next. This is the killer feature.

**Prerequisite:** Phase 1 (context engine core) complete.

---

## Definition of Done

- [ ] Session state captured automatically on app exit
- [ ] Session state captured on periodic snapshots (every 5 minutes)
- [ ] Session state captured on workspace profile switch
- [ ] State summarization via LLM produces meaningful `blockers` and `next_steps`
- [ ] Rule-based fallback works when LLM is unavailable
- [ ] Session state stored in SQLite with full payload schema
- [ ] Session hydration on app start: loads latest state for active profile
- [ ] Relevant code chunks fetched from LanceDB based on session state `active_files`
- [ ] Chat panel functional with LLM integration (litellm routing)
- [ ] Context-aware LLM greeting on session resume
- [ ] Workspace profile CRUD (create, switch, edit, delete)
- [ ] Profile switching triggers capture → deactivate → activate → hydrate flow
- [ ] Historical session states queryable ("what was I working on last Thursday?")
- [ ] Performance: session capture completes in < 3 seconds
- [ ] Performance: session hydration completes in < 2 seconds

---

## Key Tasks

### 1. LLM Integration (litellm)

- Install and configure litellm in the Python sidecar
- Set up Ollama connection for local models
- Implement model routing logic (basic version — full routing rules come in Phase 6)
- Streaming response support via Server-Sent Events
- Chat endpoint: `POST /api/v1/chat`

### 2. Session State Capture

- Implement capture triggers: app exit, periodic (5 min), manual, profile switch
- Gather raw signals from each source:
  - Editor: placeholder in this phase (active file tracking via file watcher's last-modified)
  - Terminal: not yet available (placeholder — capture CWD from file watcher root)
  - Git: run `git status`, `git branch`, `git diff --stat` in watched directories
  - Notes: query recently modified Note entities from SQLite
  - Chat: query recent chat_messages from SQLite
- LLM summarization: send raw signals to LLM to synthesize `blockers`, `next_steps`, `active_chat_summary`
- Rule-based fallback: if LLM unavailable, extract blockers from error-related git commits, next_steps from TODO entities

### 3. Session State Storage

- Write payload to `session_states` table
- Crash-safe: use SQLite transaction, WAL mode ensures atomicity
- Periodic snapshots: background timer triggers capture every 5 minutes during active use

### 4. Session Hydration

- On app start: load latest session_state for active workspace profile
- Fetch relevant LanceDB chunks based on `focus.open_files` and `context.recent_file_edits`
- Compose LLM system prompt: base prompt + session state payload + relevant chunks
- Generate greeting message via LLM

### 5. Chat Panel (Frontend)

- SolidJS chat component with message list and input field
- Streaming message display (tokens appear as they arrive)
- Message history stored in SQLite `chat_messages`
- System prompt injection (session state + relevant context)
- Model indicator (show which model is handling the conversation)

### 6. Workspace Profile Management

- Profile list in sidebar/header
- Create new profile: name, watched directories, optional LLM settings
- Switch profile: triggers full capture → deactivate → activate → hydrate flow
- Edit profile: change name, directories, settings
- Delete profile: confirmation dialog, removes profile and all associated data

### 7. Historical Session Queries

- Endpoint: `GET /api/v1/session/history?profile={id}&limit=10`
- UI: browsable session history showing timestamps, duration, focus summary
- Click a historical session to view its full payload
- Future: "what was I working on last Thursday?" via natural language query against session history

---

## API Endpoints Added

```
POST /api/v1/chat           — send message, receive streaming LLM response
POST /api/v1/session/capture — manually trigger session state capture
GET  /api/v1/session/latest  — get latest session state for active profile
GET  /api/v1/session/history — get historical session states
POST /api/v1/profiles        — create workspace profile
GET  /api/v1/profiles        — list all profiles
PUT  /api/v1/profiles/{id}   — update profile
DELETE /api/v1/profiles/{id} — delete profile
POST /api/v1/profiles/{id}/activate — switch active profile
```

---

## Testing Strategy

- **Unit test:** Session state payload schema validation
- **Unit test:** Rule-based fallback produces reasonable blockers/next_steps from raw signals
- **Integration test:** App exit → capture → restart → hydrate → LLM greeting contains relevant context
- **Integration test:** Profile switch preserves outgoing state and loads incoming state
- **Integration test:** Chat with LLM works end-to-end (message → response → stored in DB)
- **Stress test:** Rapid profile switching doesn't corrupt state
- **Crash test:** Kill app process → restart → most recent periodic snapshot is available

---

## Open Questions

- What should the LLM greeting look like for a brand-new profile with no history? ("Welcome to your new workspace. I'll start learning your context as you work.")
- Should the periodic snapshot interval be adaptive? (More frequent during active coding, less during idle)
- How much chat history should be included in the system prompt? (Last 5 messages? Last 10? Configurable?)
- Should session state include browser tabs or other external context? (Requires external integration — defer to Phase 7?)
