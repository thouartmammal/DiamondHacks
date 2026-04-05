# Boomer Memory — Agentverse hosted agent (paste into Build → agent.py)
#
# Role: **Longitudinal memory / narrative synthesis only** — not browsing drift, not holistic integration.
# Enriches `memory_context` with an ASI:One paragraph, then forwards the same SnapshotMsg envelope to Perception.
#
# Agent secrets (Agentverse, on this Memory agent):
#   ASI1_API_KEY              — required for synthesis (https://asi1.ai/developer)
#   PERCEPTION_AGENT_ADDRESS  — your Perception agent1q… (terminal hop before the user sees [[MEMORY]]/[[BROWSER]]/…)
#   ASI1_BASE_URL             — optional, default https://api.asi1.ai/v1
#   ASI1_MODEL                — optional, default asi1
#   BOOMER_PERCEPTION_TIMEOUT_SEC — optional, default 42 (max wait for Perception reply)
#
# Hosted chain (recommended): Node/bridge → **Drift** → **Memory** (this file) → **Perception**
# On **Drift**, set Agent secret MEMORY_AGENT_ADDRESS = this Memory agent’s agent1q…
# Drift should still set PERCEPTION_AGENT_ADDRESS for fallback if Memory times out.
#
# Model contract: SnapshotMsg + CognitiveOut must match perception/agent.py, drift/agent.py, guardian/agent.py, query_bridge.py
import json
import os
import time
from pathlib import Path

from openai import OpenAI
from uagents import Agent, Context, Model

agent = Agent(name="Boomer Memory")


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int((os.getenv(name) or str(default)).strip())
    except ValueError:
        v = default
    return max(lo, min(hi, v))


class SnapshotMsg(Model):
    window_hours: float
    visit_count: int
    unique_hosts: int
    top_host: str
    top_host_hits: int
    repeat_ratio: float
    who_presses_24h: int
    source: str = "boomer"
    drift_context: str = ""
    memory_context: str = ""
    browser_context: str = ""
    physical_context: str = ""


class CognitiveOut(Model):
    mode: str
    user_message: str
    drift_score: float
    severity: str
    chain: str = "asi1"


# Distinct from Drift (metrics) and Perception (four tagged panels): only narrative / recall / consistency lens.
_SYSTEM_MEMORY_LENS = """You are the **Boomer Browse Memory lens** agent on the Fetch.ai stack.

Your exclusive job: synthesize **narrative memory and recall-relevant signals** from the text the user pastes.
Think like a careful note-taker for a caregiver: themes, stability vs change in story, operational memory stats,
and gentle observations that could matter for continuity of care.

STRICT RULES:
- Do **not** summarize browsing drift, visit volume, repeat_ratio, top sites, or “who pressed” counts — other agents cover that.
- Do **not** diagnose dementia, Alzheimer’s, or any medical condition.
- Do **not** output [[MEMORY]] tags or four blocks; emit **plain prose only** (one short paragraph, or 2–4 bullet lines).
- Stay calm, respectful, concrete; no jargon."""

# ASI client
_ASI1_BASE_URL = os.environ.get("ASI1_BASE_URL", "https://api.asi1.ai/v1")
_ASI1_MODEL = os.environ.get("ASI1_MODEL", "asi1")


def _asi_client() -> OpenAI:
    key = (os.environ.get("ASI1_API_KEY") or "").strip()
    if not key:
        raise RuntimeError(
            "Missing ASI1_API_KEY. Set it as an Agentverse secret or env var (https://asi1.ai/developer).",
        )
    return OpenAI(base_url=_ASI1_BASE_URL, api_key=key)


def _call_memory_asi(user_text: str, logger) -> str:
    fallback = (
        "[Memory agent] ASI:One call failed — check ASI1_API_KEY. "
        "Perception will still run with the original memory_context."
    )
    try:
        client = _asi_client()
        r = client.chat.completions.create(
            model=_ASI1_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_MEMORY_LENS},
                {"role": "user", "content": user_text},
            ],
            max_tokens=900,
        )
        return str(r.choices[0].message.content).strip() or fallback
    except Exception:
        if logger is not None:
            logger.exception("Memory agent ASI chat failed")
        return fallback


def _memory_synthesis_user_prompt(msg: SnapshotMsg) -> str:
    """Deliberately omit drift_context body so the model does not parrot Drift."""
    mc = (msg.memory_context or "").strip() or "(No memory/narrative block was supplied from Boomer Node.)"
    bc = (msg.browser_context or "").strip()
    pc = (msg.physical_context or "").strip()
    parts = [
        "Boomer Browse — **Memory-lens synthesis request** (passive telemetry; user was not quizzed).",
        "",
        "Browsing-stress and drift metrics are intentionally omitted from this prompt; do not ask for them.",
        "",
        "--- memory_context (narrative / operational memory stats from Node) ---",
        mc,
    ]
    if bc:
        parts.extend(["", "--- browser_context (high-level visit/search patterns; use lightly, one clause max) ---", bc[:2000]])
    if pc:
        parts.extend(["", "--- physical_context (wellness dashboard digest; optional tone context only) ---", pc[:2000]])
    parts.append("")
    parts.append("Now produce your synthesis per the system rules (plain text only).")
    return "\n".join(parts)


def _enriched_snapshot_after_memory(msg: SnapshotMsg, synthesis: str) -> SnapshotMsg:
    block = (
        "— Boomer Memory agent (Fetch.ai) —\n"
        f"{synthesis}\n"
        "— End memory-agent layer —"
    )
    base = (msg.memory_context or "").strip()
    merged = f"{base}\n\n{block}" if base else block
    return SnapshotMsg(
        window_hours=msg.window_hours,
        visit_count=msg.visit_count,
        unique_hosts=msg.unique_hosts,
        top_host=msg.top_host,
        top_host_hits=msg.top_host_hits,
        repeat_ratio=msg.repeat_ratio,
        who_presses_24h=msg.who_presses_24h,
        source=msg.source,
        drift_context=msg.drift_context,
        memory_context=merged,
        browser_context=msg.browser_context,
        physical_context=msg.physical_context,
    )


@agent.on_event("startup")
async def _memory_startup(ctx: Context):
    try:
        d = Model.build_schema_digest(SnapshotMsg)
        ctx.logger.info(
            f"Boomer Memory: SnapshotMsg digest={d} (must match Drift/Perception/Guardian/query_bridge)",
        )
        log_path = Path(__file__).resolve().parents[2] / "debug-965baa.log"
        payload = {
            "sessionId": "965baa",
            "hypothesisId": "MEM1",
            "location": "memory/agent.py:startup",
            "message": "boomer_memory_agent_startup",
            "data": {"snapshot_schema_digest": str(d)},
            "timestamp": int(time.time() * 1000),
        }
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass
    if not (os.environ.get("ASI1_API_KEY") or "").strip():
        ctx.logger.error("ASI1_API_KEY is not set — memory synthesis will use fallback text until configured.")
    if not (os.environ.get("PERCEPTION_AGENT_ADDRESS") or "").strip():
        ctx.logger.error(
            "PERCEPTION_AGENT_ADDRESS is not set — Memory agent cannot forward to Perception.",
        )


@agent.on_message(model=SnapshotMsg, replies={CognitiveOut}, allow_unverified=True)
async def on_snapshot(ctx: Context, sender: str, msg: SnapshotMsg) -> None:
    ctx.logger.info("Boomer Memory: received SnapshotMsg")

    perception = (os.getenv("PERCEPTION_AGENT_ADDRESS") or "").strip()
    if not perception:
        await ctx.send(
            sender,
            CognitiveOut(
                mode="standard",
                user_message="Memory agent misconfigured: PERCEPTION_AGENT_ADDRESS is not set.",
                drift_score=0.0,
                severity="none",
                chain="memory-config-error",
            ),
        )
        return
    if perception == ctx.agent.address:
        await ctx.send(
            sender,
            CognitiveOut(
                mode="standard",
                user_message="Misconfigured PERCEPTION_AGENT_ADDRESS (cannot equal Memory agent address).",
                drift_score=0.0,
                severity="none",
                chain="memory-config-error",
            ),
        )
        return

    user_prompt = _memory_synthesis_user_prompt(msg)
    synthesis = _call_memory_asi(user_prompt, ctx.logger)
    forward = _enriched_snapshot_after_memory(msg, synthesis)

    p_timeout = _int_env("BOOMER_PERCEPTION_TIMEOUT_SEC", 42, 15, 115)
    ctx.logger.info(f"Boomer Memory: calling Perception (timeout {p_timeout}s)")
    p_reply, p_status = await ctx.send_and_receive(
        perception,
        forward,
        response_type=CognitiveOut,
        timeout=p_timeout,
        sync=True,
    )
    if isinstance(p_reply, CognitiveOut):
        ctx.logger.info("Boomer Memory: forwarding Perception CognitiveOut to caller")
        await ctx.send(sender, p_reply)
        return

    ctx.logger.warning(f"Perception reply failed after Memory synthesis: {p_status}")
    await ctx.send(
        sender,
        CognitiveOut(
            mode="standard",
            user_message=(
                "Memory layer ran, but Perception did not return in time. "
                "Try raising BOOMER_PERCEPTION_TIMEOUT_SEC on this agent, or check Perception/ASI health. "
                "Not a medical assessment."
            ),
            drift_score=0.0,
            severity="none",
            chain="memory-perception-fallback",
        ),
    )


if __name__ == "__main__":
    agent.run()
