import logging
import json
import asyncio
import sys
import os
import re
import shutil
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import litellm

logger = logging.getLogger("cortex-sidecar")

router = APIRouter(prefix="/api/v1")

SAFE_FILTER_VALUE_RE = re.compile(r"^[A-Za-z0-9_./:\\\- ]+$")


def sanitize_filter_value(field: str, value: str) -> str:
    if not value:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_FILTER",
                    "message": f"{field} cannot be empty",
                    "retryable": False,
                }
            },
        )
    if not SAFE_FILTER_VALUE_RE.fullmatch(value):
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_FILTER",
                    "message": f"{field} contains unsupported characters",
                    "retryable": False,
                }
            },
        )
    return value.replace("'", "''")

class Message(BaseModel):
    role: str # system, user, assistant
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    model: str = "ollama/llama3" # Default to local llama3 via Ollama
    stream: bool = False
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    context_strategy: str = "none"
    context: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None

class SynthesisRequest(BaseModel):
    raw_signals: Dict[str, Any]
    model: str = "ollama/llama3"

class RagQueryRequest(BaseModel):
    query: str
    limit: int = 10
    mode: str = "hybrid"  # vector | hybrid
    rerank: bool = False
    source_types: Optional[List[str]] = None
    file_path_prefix: Optional[str] = None
    git_branch: Optional[str] = None

class TerminalTranslateRequest(BaseModel):
    query: str
    context: Optional[Dict[str, Any]] = None
    model: str = "ollama/llama3"

class TerminalResolveRequest(BaseModel):
    command: str
    exit_code: int
    output: str
    context: Optional[Dict[str, Any]] = None
    model: str = "ollama/llama3"

class TriggerRequest(BaseModel):
    agent: str
    params: Optional[Dict[str, Any]] = None

# Configure litellm if needed (e.g., set success/failure callbacks)
# litellm.success_callback = ["posthog"] 

async def chat_stream_generator(messages: List[Dict[str, str]], model: str, **kwargs):
    """Generator for litellm streaming responses."""
    try:
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            stream=True,
            **kwargs
        )
        async for chunk in response:
            content = chunk.choices[0].delta.content
            if content:
                yield f"data: {json.dumps({'content': content})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        logger.error(f"Chat streaming error: {e}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

@router.post("/chat")
async def chat_endpoint(req: ChatRequest):
    """Unified chat endpoint using litellm."""
    messages_dict = [{"role": m.role, "content": m.content} for m in req.messages]
    
    # Extra litellm kwargs
    kwargs = {}
    if req.temperature is not None:
        kwargs["temperature"] = req.temperature
    if req.max_tokens is not None:
        kwargs["max_tokens"] = req.max_tokens

    if req.stream:
        return StreamingResponse(
            chat_stream_generator(messages_dict, req.model, **kwargs),
            media_type="text/event-stream"
        )
    
    try:
        response = await litellm.acompletion(
            model=req.model,
            messages=messages_dict,
            **kwargs
        )
        return response
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(
            status_code=502,
            detail={
                "error": {
                    "code": "CHAT_PROVIDER_ERROR",
                    "message": str(e),
                    "retryable": True,
                }
            },
        )

@router.get("/models")
async def list_models():
    """List effective model availability for routing diagnostics."""
    models: List[Dict[str, Any]] = []

    if shutil.which("ollama"):
        models.append(
            {
                "id": "ollama/llama3",
                "provider": "ollama",
                "availability": "available",
                "local": True,
                "default": True,
            }
        )
    else:
        models.append(
            {
                "id": "ollama/llama3",
                "provider": "ollama",
                "availability": "unavailable",
                "local": True,
                "default": True,
            }
        )

    if os.environ.get("OPENAI_API_KEY"):
        models.append(
            {
                "id": "openai/gpt-4.1-mini",
                "provider": "openai",
                "availability": "available",
                "local": False,
                "default": False,
            }
        )
    if os.environ.get("ANTHROPIC_API_KEY"):
        models.append(
            {
                "id": "anthropic/claude-3-5-sonnet-latest",
                "provider": "anthropic",
                "availability": "available",
                "local": False,
                "default": False,
            }
        )

    return {"default_model": "ollama/llama3", "models": models}

@router.post("/rag/query")
async def rag_query(req: RagQueryRequest, request: Request):
    """Hybrid retrieval endpoint with optional lightweight rerank."""
    if not req.query.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_QUERY",
                    "message": "query cannot be empty",
                    "retryable": False,
                }
            },
        )

    table = request.app.state.lancedb.open_table("embeddings")
    if request.app.state.model:
        vector = request.app.state.model.encode(req.query).tolist()
    else:
        vector = [0.1] * 384

    conditions: List[str] = []
    if req.source_types:
        safe_types = [sanitize_filter_value("source_type", st) for st in req.source_types]
        joined = ", ".join([f"'{t}'" for t in safe_types])
        conditions.append(f"source_type IN ({joined})")
    if req.file_path_prefix:
        prefix = sanitize_filter_value("file_path_prefix", req.file_path_prefix)
        conditions.append(f"source_file LIKE '{prefix}%'")
    if req.git_branch:
        branch = sanitize_filter_value("git_branch", req.git_branch)
        conditions.append(f"git_branch = '{branch}'")

    search = table.search(vector).limit(max(1, min(req.limit, 100)))
    if conditions:
        search = search.where(" AND ".join(conditions))

    raw_results = search.to_list()
    query_tokens = {t.lower() for t in req.query.split() if t.strip()}
    enriched: List[Dict[str, Any]] = []

    for row in raw_results:
        distance = row.pop("_distance", None)
        row.pop("vector", None)
        vector_score = round(max(0.0, 1.0 - distance), 4) if distance is not None else 0.0

        text = row.get("text", "") or ""
        token_hits = sum(1 for token in query_tokens if token in text.lower())
        lexical_score = (token_hits / max(len(query_tokens), 1)) if query_tokens else 0.0

        if req.mode == "hybrid":
            final_score = round((vector_score * 0.7) + (lexical_score * 0.3), 4)
        else:
            final_score = vector_score

        row["vector_score"] = vector_score
        row["lexical_score"] = round(lexical_score, 4)
        row["relevance_score"] = final_score
        enriched.append(row)

    enriched.sort(key=lambda r: r.get("relevance_score", 0.0), reverse=True)
    if req.rerank:
        # Lightweight rerank heuristic: prioritize exact symbol/path hits.
        query_lower = req.query.lower()
        enriched.sort(
            key=lambda r: (
                query_lower in (r.get("entity_name") or "").lower(),
                query_lower in (r.get("source_file") or "").lower(),
                r.get("relevance_score", 0.0),
            ),
            reverse=True,
        )

    return {
        "query": req.query,
        "mode": req.mode,
        "rerank": req.rerank,
        "results": enriched[: req.limit],
    }

@router.post("/session/synthesis")
async def session_synthesis(req: SynthesisRequest):
    """Synthesize raw signals into a session summary, blockers, and next steps."""
    
    system_prompt = """You are the Cortex Session Synthesizer.
Your task is to analyze raw activity signals from a developer's workspace and provide a structured summary.
Signals include recent file edits, git status, terminal activity, notes, and tasks.

Output a JSON object with the following fields:
1. "summary": A 1-2 sentence overview of the current work session.
2. "blockers": A list of identified obstacles or errors.
3. "next_steps": A list of immediate actions for the next session.
4. "active_context": A short summary of the core mental state.
5. "confidence": A float from 0.0 to 1.0.
6. "provenance": A list of concise source hints from raw_signals used for the summary.

Be technical, objective, and concise.
"""

    user_prompt = f"""Raw Signals:
{json.dumps(req.raw_signals, indent=2)}"""
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    try:
        response = await litellm.acompletion(
            model=req.model,
            messages=messages,
            response_format={ "type": "json_object" }
        )
        content = response.choices[0].message.content
        parsed = json.loads(content)
        return {
            "summary": parsed.get("summary", "No summary available."),
            "blockers": parsed.get("blockers", []),
            "next_steps": parsed.get("next_steps", []),
            "active_context": parsed.get("active_context", "Unknown"),
            "confidence": float(parsed.get("confidence", 0.5)),
            "provenance": parsed.get("provenance", []),
            "source": "llm",
        }
    except Exception as e:
        logger.error(f"Synthesis error: {e}")
        # Rule-based fallback
        return {
            "summary": "Session synthesis unavailable. Generated a deterministic fallback summary.",
            "blockers": ["Synthesis provider unavailable"],
            "next_steps": ["Review recent tasks and terminal failures"],
            "active_context": "Fallback mode",
            "confidence": 0.2,
            "provenance": ["fallback:raw_signals"],
            "source": "fallback",
        }

@router.post("/terminal/translate")
async def terminal_translate(req: TerminalTranslateRequest):
    """Translate natural language to a shell command."""
    system_prompt = """You are the Cortex Terminal Assistant. 
Your task is to translate a natural language request into a single, valid shell command.
Provide a brief explanation of what the command does.

Output a JSON object with the following fields:
1. "command": The suggested shell command.
2. "explanation": A one-sentence explanation of the command.
3. "confidence": A float between 0.0 and 1.0 representing your confidence.

Current Context:
- Platform: {platform}
- Shell: {shell}
- Project Root: {project_root}
""".format(
        platform=sys.platform,
        shell=os.environ.get("SHELL", "unknown"),
        project_root=req.context.get("project_root", "unknown") if req.context else "unknown"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": req.query}
    ]

    try:
        response = await litellm.acompletion(
            model=req.model,
            messages=messages,
            response_format={ "type": "json_object" }
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"Translation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/terminal/resolve")
async def terminal_resolve(req: TerminalResolveRequest):
    """Analyze a failed terminal command and suggest a fix."""
    system_prompt = """You are the Cortex Error Resolver.
Analyze the failed shell command and its output (including error messages) to suggest a fix.

Output a JSON object with the following fields:
1. "analysis": A short explanation of why the command failed.
2. "suggestion": A suggested command to fix the issue or retry correctly.
3. "explanation": Why this suggestion should work.

Context:
- Command: {command}
- Exit Code: {exit_code}
""".format(command=req.command, exit_code=req.exit_code)

    user_prompt = f"Terminal Output:\n{req.output}"
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    try:
        response = await litellm.acompletion(
            model=req.model,
            messages=messages,
            response_format={ "type": "json_object" }
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"Resolution error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/trigger")
async def trigger_agent(req: TriggerRequest):
    """Trigger a background agent manually."""
    from cortex_sidecar.main import agent_manager
    agent = agent_manager.get_agent(req.agent)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{req.agent}' not found")
    
    # Run once in background
    asyncio.create_task(agent.run())
    return {"status": "triggered", "agent": req.agent}
