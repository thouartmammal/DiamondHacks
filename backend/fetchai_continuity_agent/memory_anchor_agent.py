"""
Memory Anchor agent — Boomer Browse's continuity verdict is grounded ONLY in recent_reality
(what the app remembers: visits, shows, shopping hints). The LLM compares claims in the
message to that snapshot; it must not invent user history.

Falls back to rule-based continuity_engine if no API key or on failure.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_PITCH = (
    "Your story in Boomer Browse is the anchor. We compare scary or urgent claims to what "
    "this app actually remembers—not to replace your judgment, but to slow down when the "
    "story doesn't fit."
)

SYSTEM_PROMPT = """You are the Memory Anchor agent for Boomer Browse, an assistant for older adults and people with memory challenges.

## Ground rules (non-negotiable)
1. The ONLY source of truth about what the user did in this app is the JSON object `recent_reality`. It includes recent visit counts, common site hosts, last saved show episode, and shopping-related visit signals.
2. You MUST NOT invent visits, purchases, or logins. If something is not in `recent_reality`, say you cannot confirm it from Boomer logs.
3. A message can still be a scam even when reality is thin (cold start). Prefer status "uncertain" over false confidence.
4. Tone: calm, respectful, short sentences. Never shame the user. Never claim medical or legal certainty.

## Task
Compare the user message (email or page text, optional page URL) to `recent_reality`.
- If a brand or service is named (e.g. Spotify, Amazon) and the message claims account trouble, hacking, or urgent action: check whether that service appears plausible in recent visits. If not, that is a meaningful tension—not proof of scam, but a reason to pause.
- If the message pushes money, wire transfer, gift cards, or remote access, treat as high risk regardless of memory (still cite memory when relevant).
- If you cannot reconcile, use status "uncertain".

## Output
Return a single JSON object ONLY (no markdown fences), with this exact shape:
{
  "status": "ok" | "conflict" | "uncertain",
  "headline": "one short line for the UI",
  "pitch": "one sentence tying the verdict to memory as anchor",
  "conflicts": [ { "code": "string", "severity": "high"|"medium"|"low", "title": "string", "detail": "string" } ],
  "reminders": [ "short tip strings" ],
  "source": "memory-anchor"
}

Use empty arrays when none. Severity high for urgent money/remote access; medium for brand/account mismatch with memory; low for mild inconsistencies.
"""


def _extract_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```\s*$", "", text)
    return json.loads(text)


def _validate_agent_payload(data: dict[str, Any]) -> dict[str, Any] | None:
    if data.get("source") != "memory-anchor":
        data["source"] = "memory-anchor"
    st = data.get("status")
    if st not in ("ok", "conflict", "uncertain"):
        return None
    if not isinstance(data.get("headline"), str) or not str(data["headline"]).strip():
        return None
    if "pitch" not in data or not isinstance(data["pitch"], str):
        data["pitch"] = DEFAULT_PITCH
    if not isinstance(data.get("conflicts"), list):
        data["conflicts"] = []
    if not isinstance(data.get("reminders"), list):
        data["reminders"] = []
    return data


async def analyze_with_llm(
    message: str,
    page_url: str | None,
    recent_reality: dict[str, Any],
) -> dict[str, Any]:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

    user_content = json.dumps(
        {
            "message": message[:24000],
            "pageUrl": page_url,
            "recent_reality": recent_reality,
        },
        ensure_ascii=False,
    )

    payload = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 1200,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": "Analyze and respond with JSON only.\n\n" + user_content,
            },
        ],
    }

    import httpx

    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        r.raise_for_status()
        body = r.json()

    text = (
        body.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    if not text:
        raise RuntimeError("empty LLM response")

    parsed = _extract_json_object(text)
    validated = _validate_agent_payload(parsed)
    if not validated:
        raise RuntimeError("invalid agent JSON shape")
    return validated


async def analyze(
    message: str,
    page_url: str | None,
    recent_reality: dict[str, Any],
) -> dict[str, Any]:
    """
    Memory-anchored analysis: LLM when OPENAI_API_KEY + MEMORY_ANCHOR_USE_LLM; else rules.
    """
    use_llm = os.environ.get("MEMORY_ANCHOR_USE_LLM", "true").lower() in ("1", "true", "yes")
    if use_llm and os.environ.get("OPENAI_API_KEY", "").strip():
        try:
            return await analyze_with_llm(message, page_url, recent_reality)
        except Exception as e:
            logger.warning("Memory Anchor LLM failed, using rules fallback: %s", e)

    from continuity_engine import evaluate_continuity

    return evaluate_continuity(message, page_url, recent_reality)
