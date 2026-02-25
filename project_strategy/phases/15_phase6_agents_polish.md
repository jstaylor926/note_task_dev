# Phase 6: Background Agents & Polish

> **Goal:** The autonomous intelligence layer comes alive — research daemon monitors ArXiv, pipeline monitor tracks training jobs, digest agent compiles morning briefings. Plus UI polish: themes, keyboard customization, settings, notifications.

**Prerequisite:** Phase 5 (knowledge graph & tasks) complete.

---

## Definition of Done

- [ ] Research daemon fetches and indexes ArXiv papers matching configured keywords
- [ ] Pipeline monitor detects and tracks long-running processes with metrics
- [ ] Digest agent produces a "morning briefing" on session start
- [ ] Webhook/API endpoints functional for external tool integration
- [ ] Model routing rules UI: configure which model handles which task type
- [ ] Settings/preferences panel: configure all system settings from the UI
- [ ] Full keyboard shortcut customization
- [ ] Theme support: dark mode, light mode, custom themes
- [ ] Desktop notification system for agent alerts
- [ ] Additional LSP language servers: JavaScript/TypeScript, Rust
- [ ] Minimap in editor
- [ ] Status bar showing: active profile, indexing status, sidecar status, model in use

---

## Key Tasks

### 1. Research Daemon

- ArXiv API/RSS feed integration
- Configurable keywords and categories per workspace profile
- Background task on cron schedule (default: daily)
- Create Reference entities for matching papers
- Embed abstracts in LanceDB
- Optional: generate LLM summary notes
- Notification: "N new papers matched your interests"

### 2. Pipeline Monitor

- Process detection by PID, name pattern, or log file path
- Metric parsing from stdout (loss, accuracy, epoch, step)
- Create/update Experiment entities with parsed metrics
- Completion/failure notifications
- History view: past monitored pipelines with outcomes

### 3. Digest Agent

- Compile on session start: overdue tasks, upcoming deadlines, overnight experiments, new papers, stale branches, unresolved errors
- Present as first chat message in greeting
- Configurable: which sections to include, summary depth

### 4. Webhook/API Endpoints

- Full REST API as documented in `08_module_agent_layer.md`
- All endpoints: ingest, trigger, search, session, tasks, entities, graph neighbors, health, stats
- API documentation (auto-generated from FastAPI)

### 5. Model Routing UI

- Visual editor for routing rules
- Test a rule: "if I send this type of request, which model handles it?"
- Cost dashboard: daily/weekly/monthly usage and cost by model

### 6. Settings Panel

- All configuration from YAML files exposed as UI forms
- Categories: general, editor, terminal, context engine, agents, LLM routing, profiles
- Changes saved to config files and applied without restart where possible

### 7. Theme & UI Polish

- Dark and light theme (CSS custom properties for easy theming)
- Custom theme support (user-defined color schemes)
- Consistent typography, spacing, and visual hierarchy
- Loading states, error states, empty states
- Smooth transitions and animations (subtle, not distracting)

### 8. Keyboard Shortcuts

- Full shortcut customization via config file
- Command palette (Cmd+Shift+P) for discovering all available commands
- Shortcut display in menus and tooltips

### 9. Notification System

- Desktop notifications via Tauri's notification plugin
- In-app notification center (badge count, notification list)
- Configurable: which events trigger notifications
- Do-not-disturb mode

### 10. Additional LSP Servers

- JavaScript/TypeScript: typescript-language-server
- Rust: rust-analyzer
- Same proxy architecture as Python LSP from Phase 4

---

## Testing Strategy

- **Integration test:** Research daemon finds and indexes a known ArXiv paper
- **Integration test:** Pipeline monitor detects a training script and parses metrics
- **Integration test:** Digest agent produces coherent briefing from test data
- **Integration test:** POST /api/v1/ingest creates entity and embedding
- **UI test:** Theme switching doesn't break layout
- **UI test:** All settings save and apply correctly

---

## Open Questions

- Should the research daemon support sources beyond ArXiv? (Semantic Scholar, Google Scholar, HuggingFace papers)
- Should the notification system support webhook-based notifications to external services (Slack, email)?
- Can we add a "focus mode" that hides all non-essential panels for distraction-free coding?
