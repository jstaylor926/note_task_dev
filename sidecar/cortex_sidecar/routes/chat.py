import logging
import json
import asyncio
import sys
import os
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Body, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import litellm
from datetime import datetime

logger = logging.getLogger("cortex-sidecar")

router = APIRouter(prefix="/api/v1")

class Message(BaseModel):
    role: str # system, user, assistant
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    model: str = "ollama/llama3" # Default to local llama3 via Ollama
    stream: bool = False
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None

class SynthesisRequest(BaseModel):
    raw_signals: Dict[str, Any]
    model: str = "ollama/llama3"

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
        raise HTTPException(status_code=500, detail=str(e))

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
        return json.loads(content)
    except Exception as e:
        logger.error(f"Synthesis error: {e}")
        # Rule-based fallback
        return {
            "summary": "Session synthesis failed, using rule-based fallback.",
            "blockers": ["Synthesis error: " + str(e)],
            "next_steps": ["Check LLM connectivity (Ollama)"],
            "active_context": "Unknown"
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
