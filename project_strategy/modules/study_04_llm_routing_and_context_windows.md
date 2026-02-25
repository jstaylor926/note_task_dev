# Study Guide: LLM Routing, Context Windows, and Cost Management

> This guide explains how the agent layer decides which AI model to use for each task, how context windows work and why they matter, and how cost tracking keeps cloud API spending under control. These concepts underpin `08_module_agent_layer.md`.

---

## 1. The Multi-Model Landscape

### Why Not Just Use One Model?

Different AI tasks have very different requirements:

| Task | Needs | Ideal Model |
|------|-------|-------------|
| Inline code completion | Low latency (<200ms), decent quality | Small local model (codellama:13b) |
| Complex debugging | Deep reasoning, large context | Best available (Claude Sonnet) |
| Summarizing session state | Good enough quality, low cost | Small local model (llama3:8b) |
| Embedding text chunks | Deterministic, fast, local | Dedicated embedding model (MiniLM) |
| Sensitive code analysis | Must stay offline (ITAR) | Local only, any size |

Using Claude Sonnet for every task would be expensive, high-latency, and violate security constraints for sensitive code. Using a small local model for everything would produce poor results for complex reasoning tasks.

The **model router** solves this by matching each request to the right model based on rules.

---

## 2. What Is litellm?

### The Problem It Solves

Every LLM provider has a different API:

```python
# OpenAI
from openai import OpenAI
client = OpenAI()
response = client.chat.completions.create(model="gpt-4o", messages=[...])

# Anthropic
from anthropic import Anthropic
client = Anthropic()
response = client.messages.create(model="claude-sonnet-4-5-20250929", messages=[...])

# Ollama (local)
import requests
response = requests.post("http://localhost:11434/api/chat", json={"model": "llama3", ...})
```

Three different APIs for three providers. If you want to add a fourth provider, you write another integration.

### litellm's Unified Interface

**litellm** wraps all providers behind a single API:

```python
import litellm

# Same function call for ANY provider
response = litellm.completion(
    model="ollama/llama3:8b",    # or "claude-sonnet-4-5-20250929" or "gpt-4o"
    messages=[{"role": "user", "content": "Hello"}],
    stream=True
)
```

The model string tells litellm which provider to use:
- `ollama/llama3:8b` → Ollama (local)
- `claude-sonnet-4-5-20250929` → Anthropic API
- `gpt-4o` → OpenAI API
- `gemini/gemini-2.0-flash` → Google Gemini API

litellm handles the translation: different authentication methods, different request formats, different response formats — all normalized.

### Streaming

For chat and code suggestions, responses stream token by token:

```python
response = litellm.completion(
    model="ollama/llama3:8b",
    messages=messages,
    stream=True
)

for chunk in response:
    token = chunk.choices[0].delta.content
    if token:
        yield token  # Send to frontend via SSE/Tauri event
```

Each `chunk` contains one or a few tokens. The frontend displays them as they arrive, creating the "typing" effect. Without streaming, the user would stare at a blank screen until the entire response is generated (which can take 5-30 seconds for complex queries).

---

## 3. Context Windows: The Token Budget

### What Is a Context Window?

An LLM's **context window** is the maximum number of tokens it can process in a single request. Everything — the system prompt, conversation history, code context, and the model's response — must fit within this window.

| Model | Context Window |
|-------|---------------|
| llama3:8b (local) | 8,192 tokens |
| codellama:13b (local) | 16,384 tokens |
| llama3:70b (local) | 8,192 tokens |
| Claude Sonnet | 200,000 tokens |
| GPT-4o | 128,000 tokens |
| Gemini 2.0 Flash | 1,048,576 tokens |

### What Is a Token?

A **token** is the basic unit of text that an LLM processes. Tokens are not words — they're subword pieces determined by the model's **tokenizer** (a vocabulary of common text fragments).

Rough rules of thumb:
- 1 token ≈ 4 characters of English text
- 1 token ≈ 0.75 words
- 100 tokens ≈ 75 words
- A typical function (20 lines of code) ≈ 100-200 tokens
- A full Python file (500 lines) ≈ 2,000-4,000 tokens

### Why Context Windows Matter

For a session state hydration prompt, the context might include:

```
System prompt:                    ~500 tokens
Session state payload:            ~800 tokens
Relevant code chunks (5 chunks):  ~1,500 tokens
Recent chat history (10 msgs):    ~1,200 tokens
Knowledge graph context:          ~600 tokens
User's current query:             ~100 tokens
─────────────────────────────────────────────
Total input:                      ~4,700 tokens
Reserved for response:            ~2,000 tokens
─────────────────────────────────────────────
Total needed:                     ~6,700 tokens
```

This fits comfortably in an 8K context window. But in a long debugging session with lots of code context:

```
System prompt:                    ~500 tokens
Session state payload:            ~800 tokens
Relevant code chunks (20 chunks): ~6,000 tokens
Full file being debugged:         ~3,000 tokens
Error stacktrace:                 ~500 tokens
Recent chat (30 messages):        ~4,200 tokens
Knowledge graph context:          ~1,200 tokens
User's query with code:           ~800 tokens
─────────────────────────────────────────────
Total input:                      ~17,000 tokens
Reserved for response:            ~4,000 tokens
─────────────────────────────────────────────
Total needed:                     ~21,000 tokens  ← Exceeds 8K!
```

This won't fit in the local 8K model. The system needs a strategy.

---

## 4. Context Window Management Strategies

### Strategy 1: Smart Truncation

Prioritize what to keep and what to trim:

```
Priority 1 (NEVER trim):
  ├── System prompt
  ├── User's current query
  └── Session state payload (the killer feature)

Priority 2 (Trim last):
  ├── Most relevant code chunks (top 3 by similarity)
  ├── Most recent chat messages (last 5)
  └── Directly linked knowledge graph entities

Priority 3 (Trim first):
  ├── Less relevant code chunks (similarity < 0.80)
  ├── Older chat messages (summarize instead)
  └── 2+ hop knowledge graph entities
```

The implementation counts tokens for each block and fills the context window in priority order:

```python
def build_context(query, session_state, chunks, chat_history, kg_context, max_tokens):
    context = []
    remaining = max_tokens

    # Priority 1: always include
    context.append(system_prompt)
    remaining -= count_tokens(system_prompt)

    context.append(query)
    remaining -= count_tokens(query)

    context.append(session_state)
    remaining -= count_tokens(session_state)

    # Priority 2: include if space
    for chunk in sorted(chunks, key=lambda c: c.similarity, reverse=True):
        chunk_tokens = count_tokens(chunk.text)
        if chunk_tokens <= remaining:
            context.append(chunk)
            remaining -= chunk_tokens
        else:
            break  # No more room

    # Priority 3: include remaining space
    for msg in reversed(chat_history):  # most recent first
        msg_tokens = count_tokens(msg)
        if msg_tokens <= remaining:
            context.append(msg)
            remaining -= msg_tokens
        else:
            break

    return context
```

### Strategy 2: Model Upgrade

If truncation loses too much context, switch to a model with a larger window:

```python
def select_model_for_context(total_tokens, preferred_model, routing_rules):
    model = preferred_model

    if total_tokens > model.context_window:
        # Try to upgrade
        upgrade_options = [
            "ollama/llama3:8b-32k",     # 32K context
            "claude-sonnet-4-5-20250929",  # 200K context
        ]
        for upgrade in upgrade_options:
            if total_tokens < get_context_window(upgrade):
                if is_allowed(upgrade, routing_rules):  # Check security rules
                    return upgrade

    return model  # Stick with original if no upgrade available/allowed
```

The security check is critical: a sensitive workspace profile with `block_cloud_apis: true` cannot upgrade to Claude even if it has a larger context window. Local-only profiles must use local models regardless of context size.

### Strategy 3: Summarize and Retry

As a last resort, use a fast model to summarize older context:

```
Original: 30 chat messages (4,200 tokens)
    │
    ▼
Summarize messages 1-25 using llama3:8b:
"User was debugging an OOM error in training loop. Tried reducing batch
size (didn't help), then identified gradient accumulation as the fix.
Last blocker was config file format."
    │
    ▼
Summary: ~100 tokens (replacing 3,500 tokens)
Keep messages 26-30 verbatim: ~700 tokens
Total: 800 tokens (saved 3,400 tokens)
```

This loses detail but preserves the narrative arc. The most recent messages (which contain the immediate context) are kept verbatim.

---

## 5. Routing Rules: How the Router Decides

### Rule Evaluation

Rules are evaluated in order, like a firewall ruleset. First match wins:

```
Request arrives: {task_type: "debugging", workspace: "work", contains_code: true}
    │
    ▼
Rule 1: workspace == "work" → model: ollama/codellama:13b ← MATCH! Stop here.

Request arrives: {task_type: "debugging", workspace: "thesis", contains_code: true}
    │
    ▼
Rule 1: workspace == "work" → no match (workspace is "thesis")
Rule 2: contains_code && security_block_cloud → no match (thesis profile allows cloud)
Rule 3: task_type in ["debugging", "refactoring"] → model: claude-sonnet ← MATCH!
```

### Fallback Chains

Each rule can specify a fallback model:

```yaml
- name: "complex_reasoning"
  model: "claude-sonnet-4-5-20250929"
  fallback: "ollama/llama3:70b"
```

If the primary model fails (API error, rate limit, timeout), the router automatically retries with the fallback. Multiple fallbacks can be chained:

```
Primary: claude-sonnet (API call fails — network error)
    │
    ▼
Fallback 1: ollama/llama3:70b (model not downloaded)
    │
    ▼
Fallback 2: ollama/llama3:8b (success!)
```

### Retry with Exponential Backoff

For transient failures (rate limits, timeouts), the router retries with increasing delays:

```
Attempt 1: fail (rate limited)
    wait 1 second
Attempt 2: fail (still rate limited)
    wait 5 seconds
Attempt 3: fail
    wait 15 seconds
Attempt 4: switch to fallback model
```

The backoff intervals (`[1, 5, 15]`) are configurable. This prevents hammering a rate-limited API while still recovering quickly from momentary glitches.

---

## 6. Cost Tracking

### Why Track Costs?

Cloud API pricing is per-token:

| Model | Input Cost | Output Cost |
|-------|-----------|-------------|
| Claude Sonnet | $3.00 / 1M tokens | $15.00 / 1M tokens |
| GPT-4o | $2.50 / 1M tokens | $10.00 / 1M tokens |
| Ollama (local) | $0 (electricity only) | $0 |

A heavy day of AI-assisted coding might use 500K input tokens and 100K output tokens across all features (chat, completions, error resolution, session capture). With Claude Sonnet, that's:

```
Input:  500,000 × ($3.00 / 1,000,000) = $1.50
Output: 100,000 × ($15.00 / 1,000,000) = $1.50
Total: $3.00 per day
```

Manageable, but it can spike if the router unnecessarily sends tasks to expensive models.

### How litellm Tracks Cost

litellm includes a `completion_cost()` function that calculates cost based on the model and token counts:

```python
from litellm import completion_cost

response = litellm.completion(model="claude-sonnet-4-5-20250929", messages=messages)
cost = completion_cost(completion_response=response)
# cost = 0.0042 (USD)
```

### The Usage Log

Every LLM call is logged to `llm_usage_log`:

```sql
INSERT INTO llm_usage_log
    (id, workspace_profile_id, task_type, model, input_tokens, output_tokens,
     cost_usd, latency_ms, success, error_message)
VALUES
    ('uuid', 'thesis-research', 'debugging', 'claude-sonnet-4-5-20250929',
     3200, 850, 0.0224, 2340, true, null);
```

This enables:
- **Daily/weekly/monthly cost reports** by model and task type
- **Identifying expensive patterns** ("debugging tasks consume 60% of cost budget")
- **Model comparison** ("Claude Sonnet takes 3x longer but produces better debugging results")
- **Budget alerts** ("You've spent $15 this week on cloud APIs")

---

## 7. Local vs. Cloud: The Privacy Dimension

### What Stays Local

When `block_cloud_apis: true` is set for a workspace profile:

```
ALL of these stay on your machine:
├── Embedding generation (always local regardless)
├── Code completions → ollama/codellama:13b
├── Chat conversations → ollama/llama3:8b or :70b
├── Error resolution → ollama/codellama:13b
├── Session state capture → ollama/llama3:8b
├── Entity extraction → local NER models
└── Background agents → local models only
```

No code, no notes, no session state, no entity data leaves the machine. This is critical for ITAR-controlled aerospace code.

### What Can Go to Cloud (When Allowed)

For non-sensitive profiles (thesis, side projects):

```
Cloud-eligible requests:
├── Complex reasoning (debugging, architecture) → Claude Sonnet
├── Long-context tasks (large codebase analysis) → GPT-4o or Gemini
└── Specialized tasks (creative writing, research) → Claude or GPT-4o

Always local regardless:
├── Embeddings (sentence-transformers)
├── AST parsing (tree-sitter)
├── File watching (OS kernel)
└── Database operations (SQLite, LanceDB)
```

### The Routing Override

The `block_cloud_apis` flag is checked at the router level, not the individual feature level. This means a feature doesn't need to know whether it's in a sensitive context — it just sends a request to the router, and the router enforces the security policy:

```python
def route_request(request, profile):
    for rule in routing_rules:
        if matches(request, rule.conditions):
            model = rule.model

            # Security override: block cloud models for restricted profiles
            if profile.block_cloud_apis and is_cloud_model(model):
                model = get_local_fallback(rule)

            return model
```

---

## 8. Background Agents: Autonomous AI Tasks

### The Agent Pattern

A background agent is a scheduled task that uses LLM capabilities without direct user interaction:

```python
class BackgroundAgent:
    async def run(self, context):
        # 1. Gather data (search LanceDB, query SQLite, fetch external APIs)
        # 2. Process with LLM (summarize, extract, analyze)
        # 3. Store results (create entities, update knowledge graph)
        # 4. Notify (if something interesting was found)
        pass
```

### Scheduling with Cron Expressions

Agents use **cron expressions** to define their schedule:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *

"0 6 * * *"       → Daily at 6:00 AM
"*/30 * * * * *"   → Every 30 seconds (with seconds field)
"0 */4 * * *"      → Every 4 hours
"0 9 * * 1-5"      → Weekdays at 9:00 AM
```

The Python sidecar runs a scheduler (like `APScheduler`) that triggers agents at their configured times. Agents can also be triggered manually via the API (`POST /api/v1/trigger`).

### Agent Context

Each agent receives a context object with access to:

```python
class AgentContext:
    workspace_profile: WorkspaceProfile    # Which profile is active
    lancedb: LanceDBConnection            # Vector search
    sqlite: SQLiteConnection              # Structured data
    llm_router: ModelRouter               # LLM access (respects routing rules)
    notification_service: Notifier        # Desktop notifications
```

The agent uses these to gather information, process it, and store results — all within the security constraints of the active workspace profile.

---

## Key Takeaways

1. **Different tasks need different models.** The router matches each request to the right model based on task type, workspace security, and cost.

2. **litellm unifies the LLM landscape.** One API call works for Ollama, Claude, OpenAI, and Gemini. Provider-switching is a config change, not a code change.

3. **Context windows are token budgets.** Everything in and out of the LLM must fit. Smart truncation fills the window by priority, keeping the most valuable context.

4. **Fallback chains provide resilience.** If the primary model fails, the router tries the next model in the chain automatically.

5. **Cost tracking prevents surprise bills.** Every cloud API call is logged with its token count and cost. Dashboards show spending patterns.

6. **Security is enforced at the router level.** Sensitive profiles block cloud APIs transparently — features don't need to know about security policies.

7. **Background agents are scheduled LLM tasks.** Research daemon, pipeline monitor, and digest agent run autonomously on cron schedules, creating entities and notifications.

---

## Further Reading

- [litellm Documentation](https://docs.litellm.ai/) — Unified LLM API reference
- [Ollama](https://ollama.ai/) — Run LLMs locally
- [Anthropic API Pricing](https://www.anthropic.com/pricing) — Claude model costs
- [OpenAI Tokenizer](https://platform.openai.com/tokenizer) — Interactive tool to see how text is tokenized
- [APScheduler Documentation](https://apscheduler.readthedocs.io/) — Python task scheduling library
