"""
Fetch.ai Continuity Guardian HTTP service.

Boomer Browse backend forwards continuity checks here when
FETCHAI_CONTINUITY_AGENT_URL=http://127.0.0.1:8099/v1/continuity

Deploy the same JSON contract behind Agentverse / ASI as your Fetch.ai agent endpoint.

  pip install -r requirements.txt
  python main.py
"""
from __future__ import annotations

import os
from typing import Any

from memory_anchor_agent import analyze

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
except ImportError as e:
    raise SystemExit("Install dependencies: pip install -r requirements.txt") from e

app = FastAPI(
    title="Boomer Memory Anchor Agent",
    version="2.0.0",
    description="Continuity verdicts grounded in recent_reality; LLM when configured, else rules.",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "memory-anchor-agent"}


@app.post("/v1/continuity")
async def continuity(request: Request) -> JSONResponse:
    body: dict[str, Any] = await request.json()
    message = body.get("message") if isinstance(body.get("message"), str) else ""
    page = body.get("pageUrl")
    page_url = page.strip() if isinstance(page, str) and page.strip() else None
    reality = body.get("recentReality")
    if not isinstance(reality, dict):
        return JSONResponse(
            {"error": "recentReality object required (orchestrator should send snapshot)"},
            status_code=400,
        )

    out = await analyze(message, page_url, reality)
    return JSONResponse(out)


def main() -> None:
    import uvicorn

    host = os.environ.get("CONTINUITY_AGENT_HOST", "127.0.0.1")
    port = int(os.environ.get("CONTINUITY_AGENT_PORT", "8099"))
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
