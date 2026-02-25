# Module: Pluggable ML/AI/Agent Layer

> The agent layer is the intelligence backbone. It manages LLM routing, background autonomous agents, and external integrations. Every AI-powered feature in the application — from chat to inline suggestions to error resolution — routes through this module. Future iterations should focus on adding new agent types, improving routing intelligence, and expanding the webhook/API surface for external tool integration.

---

## Overview

The agent layer has three sub-systems:

1. **Model Router** — manages LLM selection based on configurable rules, handles fallbacks, tracks costs, and manages context windows
2. **Background Agents** — autonomous processes that run without direct user interaction (research daemon, pipeline monitor, digest agent)
3. **Webhook & API Extensibility** — REST endpoints for external tools to push context into the system or trigger workflows

---

## Sub-System 5A: Model Router

### Architecture

```
Any Feature Requesting LLM Inference
    │
    ▼
Model Router (litellm wrapper)
    │
    ├── Evaluate routing rules (workspace profile, task type, content sensitivity)
    │
    ▼
Selected Model
    ├── Local: Ollama (llama3, codellama, mistral, etc.)
    ├── Cloud: Claude API (claude-sonnet-4-5-20250929, etc.)
    ├── Cloud: OpenAI API (gpt-4o, etc.)
    ├── Cloud: Gemini API (gemini-2.0-flash, etc.)
    └── Local: Custom GGUF models via llama.cpp
    │
    ▼
litellm.completion() or litellm.acompletion()
    │
    ├── Streaming response → Tauri event channel → Frontend
    ├── Cost tracking → SQLite (chat_messages.cost_usd)
    └── Fallback on failure → next model in chain
```

### Routing Rules

Routing rules are evaluated in order; first match wins:

```yaml
routing_rules:
  # Rule 1: Work profile — never use cloud APIs
  - name: "proprietary_code"
    conditions:
      - workspace_profile: "work"
    model: "ollama/codellama:13b"
    reason: "ITAR compliance — never send work code to cloud APIs"

  # Rule 2: Any request containing file content from a blocked profile
  - name: "sensitive_content"
    conditions:
      - contains_file_content: true
      - workspace_security_block_cloud: true
    model: "ollama/codellama:13b"
    reason: "File content from security-blocked profiles stays local"

  # Rule 3: Complex reasoning tasks (architecture, debugging, refactoring)
  - name: "complex_reasoning"
    conditions:
      - task_type:
          - "architecture"
          - "debugging"
          - "refactoring"
          - "code_review"
    model: "claude-sonnet-4-5-20250929"
    fallback: "ollama/llama3:70b"
    reason: "Best model for hard problems"

  # Rule 4: Session state summarization
  - name: "summarization"
    conditions:
      - task_type: "summarization"
    model: "ollama/llama3:8b"
    fallback: "ollama/mistral:7b"
    reason: "Lightweight model sufficient for summarization"

  # Rule 5: Inline code completion
  - name: "code_completion"
    conditions:
      - task_type: "completion"
    model: "ollama/codellama:13b"
    reason: "Fast local model for real-time completions"

  # Rule 6: Quick questions and formatting
  - name: "quick_tasks"
    conditions:
      - task_type:
          - "formatting"
          - "simple_question"
          - "translation"
    model: "ollama/llama3:8b"
    reason: "Fast local model for lightweight work"

  # Rule 7: Embedding (always local)
  - name: "embeddings"
    conditions:
      - task_type: "embed"
    model: "local/all-MiniLM-L6-v2"
    reason: "Embeddings always run locally"

  # Rule 8: Default fallback
  - name: "default"
    conditions: []
    model: "ollama/llama3:8b"
    fallback: "claude-sonnet-4-5-20250929"
    reason: "Default model for unclassified tasks"
```

### Task Type Classification

When a feature makes an LLM request, it tags the request with a `task_type`:

| Task Type | Source Features |
|-----------|----------------|
| `chat` | Chat panel conversation |
| `completion` | Inline code suggestions |
| `debugging` | Error resolution agent |
| `refactoring` | Refactoring agent panel |
| `summarization` | Session state capture, digest agent |
| `architecture` | Design discussions in chat |
| `code_review` | Code review requests |
| `nl_translation` | Natural language terminal mode |
| `entity_extraction` | Auto-linking pipeline |
| `embed` | Embedding generation |
| `simple_question` | Quick factual questions |
| `formatting` | Code formatting suggestions |

### Context Window Management

When the combined context (system prompt + session state + relevant chunks + user query) exceeds the model's context window:

```
Total Context Exceeds Window
    │
    ▼
Strategy 1: Smart Truncation
    ├── Keep: system prompt (always)
    ├── Keep: user query (always)
    ├── Keep: session state payload (always — it's the killer feature)
    ├── Trim: relevant code chunks (keep most relevant, drop least relevant)
    ├── Trim: chat history (keep most recent, summarize older)
    └── Trim: knowledge graph context (keep directly linked entities, drop 2+ hop)
    │
    ▼
If still exceeds after truncation:
    │
    ▼
Strategy 2: Model Upgrade
    Switch to a model with a larger context window
    (e.g., from 8K model to 128K model)
    │
    ▼
If no larger model available:
    │
    ▼
Strategy 3: Summarize and Retry
    Summarize the oldest context into a compressed form
    and retry with the summarized version
```

### Cost Tracking

litellm provides cost tracking natively. Every LLM call logs:
- Model used
- Input tokens
- Output tokens
- Estimated cost (USD)
- Latency (ms)

This data is stored in `chat_messages` (for chat) and a separate `llm_usage_log` table (for all requests):

```sql
CREATE TABLE llm_usage_log (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT,
    task_type TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    latency_ms INTEGER,
    success BOOLEAN,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

A dashboard view shows:
- Daily/weekly/monthly cost by model and task type
- Token usage patterns
- Model performance comparison (latency vs. quality for similar tasks)

---

## Sub-System 5B: Background Agents

### Agent Architecture

Background agents are Python asyncio tasks managed by the sidecar:

```python
class BackgroundAgent:
    name: str
    schedule: str              # cron expression or "on_event"
    enabled: bool
    workspace_profiles: list   # which profiles this agent runs for

    async def run(self, context: AgentContext) -> AgentResult:
        """Execute the agent's task."""
        ...

    async def on_result(self, result: AgentResult):
        """Handle the result — store entities, send notifications, etc."""
        ...
```

### Research Daemon

**Purpose:** Monitor ArXiv and other pre-print servers for papers matching your research interests.

```yaml
research_daemon:
  enabled: true
  schedule: "0 6 * * *"        # Daily at 6 AM
  sources:
    - type: "arxiv"
      categories: ["cs.LG", "cs.AI", "cs.CL"]
      keywords:
        - "transformer attention"
        - "federated learning"
        - "MLOps"
        - "data pipeline"
        - "neural architecture search"
      max_results_per_run: 20
  actions:
    - store_abstract: true      # Embed abstract in LanceDB
    - create_reference: true    # Create Reference entity in knowledge graph
    - generate_summary: true    # Use LLM to generate a 3-paragraph summary note
    - summary_model: "ollama/llama3:8b"
  workspace_profiles: ["thesis-research", "masters-coursework"]
```

**Flow:**

```
Schedule Trigger (or manual trigger)
    │
    ▼
Fetch ArXiv RSS/API for configured categories
    │
    ▼
Filter by keywords (title + abstract matching)
    │
    ▼
For each matching paper:
    ├── Check if already exists in knowledge graph (by ArXiv ID)
    │   └── Skip if exists
    ├── Create Reference entity (title, authors, abstract, URL, ArXiv ID)
    ├── Embed abstract in LanceDB
    ├── Generate summary note via LLM (if enabled)
    │   └── Create Note entity linked to Reference
    └── Auto-link to existing entities (semantic matching against codebase/notes)
    │
    ▼
Notification: "5 new papers matched your interests"
```

### Pipeline Monitor

**Purpose:** Watch for long-running processes and track their status.

```yaml
pipeline_monitor:
  enabled: true
  schedule: "*/30 * * * * *"   # Every 30 seconds (polling interval)
  watch:
    - type: "process"
      patterns:
        - "python train"
        - "python -m torch"
        - "mlflow"
      actions:
        - parse_metrics: true
        - create_experiment: true
        - notify_on_complete: true
        - notify_on_failure: true
    - type: "log_file"
      paths:
        - "~/experiments/*/training.log"
      actions:
        - parse_metrics: true
        - tail_follow: true
```

**Integration with terminal:** The pipeline monitor supplements the terminal's built-in pipeline detection. Terminal-detected long-running processes are registered with the pipeline monitor for ongoing tracking even if the terminal tab is closed.

### Digest Agent

**Purpose:** Compile a "morning briefing" of relevant information at session start.

```yaml
digest_agent:
  enabled: true
  trigger: "session_start"     # Run when a session starts
  include:
    - overdue_tasks: true
    - upcoming_deadlines: true  # Tasks due within 3 days
    - stale_branches: true      # Git branches with uncommitted changes > 24h old
    - overnight_experiments: true # Experiments that completed since last session
    - new_research_papers: true  # Papers found by research daemon since last session
    - unresolved_errors: true    # Terminal errors from last session without resolution
  format: "chat_message"        # Presented as the first message in the chat panel
  model: "ollama/llama3:8b"     # Model for generating the digest summary
```

**Example Output:**

```
Good morning! Here's your briefing for the "Thesis Research" workspace:

📋 Tasks:
  • "Implement gradient accumulation" is overdue (due yesterday)
  • "Write Chapter 3 introduction" is due Thursday

🔬 Experiments:
  • run-043 completed overnight: loss=0.089, accuracy=0.934 (best so far!)

📄 Research:
  • 3 new papers matched your interests since last session
    - "Efficient Multi-Head Attention with Sparse Projections" (ArXiv 2402.xxxxx)
    - [2 more]

🌿 Git:
  • Branch "feature/multi-head-attention" has uncommitted changes (2 days old)

❌ Unresolved:
  • CUDA OOM error in train.py (from 2 sessions ago) — still no fix applied

Want me to help with any of these?
```

### Custom Agents (Future)

The agent architecture supports user-defined agents:

```python
# user_agents/slack_monitor.py
class SlackMonitorAgent(BackgroundAgent):
    name = "slack_monitor"
    schedule = "*/5 * * * *"  # Every 5 minutes

    async def run(self, context):
        # Check Slack API for mentions/DMs
        # Create entities for relevant messages
        # Auto-link to current workspace context
        ...
```

---

## Sub-System 5C: Webhook & API Extensibility

### Local REST API

The Python sidecar exposes REST endpoints on `127.0.0.1:9400`:

```
API Endpoints
│
├── POST /api/v1/ingest
│   Body: { "content": "text", "source_type": "external", "metadata": {...} }
│   → Embeds content in LanceDB, creates entity in knowledge graph
│
├── POST /api/v1/trigger
│   Body: { "agent": "research_daemon", "params": {...} }
│   → Triggers a background agent run on demand
│
├── GET /api/v1/search?q=query&limit=10&source_type=code
│   → Semantic search across the knowledge graph
│   Returns: ranked results with metadata
│
├── GET /api/v1/session?profile=thesis-research
│   → Retrieve current or latest session state payload
│
├── GET /api/v1/session/history?profile=thesis-research&limit=10
│   → Retrieve historical session states
│
├── POST /api/v1/task
│   Body: { "title": "...", "priority": "high", "profile": "...", "due_date": "..." }
│   → Create a task programmatically
│
├── GET /api/v1/tasks?profile=thesis-research&status=todo
│   → List tasks with filters
│
├── GET /api/v1/entities?type=CodeUnit&file=transformer.py
│   → Query entities by type, file, or other filters
│
├── GET /api/v1/graph/neighbors?entity_id=uuid&hops=2
│   → Get knowledge graph neighbors within N hops
│
├── GET /api/v1/health
│   → Health check (sidecar status, model availability, storage status)
│
└── GET /api/v1/stats
    → Usage statistics (entity counts, embedding counts, LLM costs)
```

### Use Cases for External Integration

| External Tool | Integration | Endpoint |
|--------------|-------------|----------|
| CI/CD pipeline (GitHub Actions, Jenkins) | Push build failure logs | POST /api/v1/ingest |
| Foundry pipeline | Push pipeline status updates | POST /api/v1/ingest |
| Calendar app (via script) | Push upcoming meetings | POST /api/v1/ingest |
| Issue tracker (Jira, GitHub Issues) | Push assigned issues as tasks | POST /api/v1/task |
| Custom script | Trigger research daemon for specific query | POST /api/v1/trigger |
| Browser extension (future) | Push bookmarks/tabs as references | POST /api/v1/ingest |
| Mobile companion (future) | Quick note capture → push as note entity | POST /api/v1/ingest |

### Authentication

The API binds to `127.0.0.1` only (no external network access by default). For local use, no authentication is required. If the API is ever exposed to the local network:
- API key authentication via `X-API-Key` header
- Keys stored in the app's config, generated on first use
- Rate limiting to prevent abuse

---

## Configuration

```yaml
# agent_layer.yaml
model_router:
  default_model: "ollama/llama3:8b"
  embedding_model: "local/all-MiniLM-L6-v2"
  code_embedding_model: "local/codebert-base"
  routing_rules_file: "routing_rules.yaml"
  cost_tracking: true
  max_retries: 3
  retry_backoff_seconds: [1, 5, 15]

background_agents:
  research_daemon:
    enabled: true
    config_file: "research_daemon.yaml"
  pipeline_monitor:
    enabled: true
    config_file: "pipeline_monitor.yaml"
  digest_agent:
    enabled: true
    config_file: "digest_agent.yaml"

api:
  enabled: true
  host: "127.0.0.1"
  port: 9400
  cors_origins: ["http://localhost:*"]
  require_api_key: false
```

---

## Open Questions for Future Iterations

- Should the model router support A/B testing? (Route 50% of requests to model A, 50% to model B, compare quality)
- Can we implement "model memory" — where the router learns which model performs best for which task types based on user feedback?
- Should background agents support chaining? (Research daemon finds paper → digest agent summarizes → task agent creates reading task)
- How should we handle model updates? (When Ollama pulls a new version of llama3, does the system need to re-evaluate routing rules?)
- Should the API support WebSocket connections for real-time streaming of agent outputs?
- Can we integrate with MCP (Model Context Protocol) for standardized tool use across LLM providers?
- Should there be an agent marketplace or template system for sharing agent configurations?
- How do we handle rate limits gracefully? (Queue requests? Switch models? Notify user?)
