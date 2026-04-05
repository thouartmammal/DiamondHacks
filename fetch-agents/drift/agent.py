# Boomer Drift — Agentverse hosted agent (paste into Build → agent.py)
# Agent secrets (Agentverse):
#   PERCEPTION_AGENT_ADDRESS = Perception (ASI:One) agent1q…  → Drift → Perception → reply (or fallback if Memory fails)
#   MEMORY_AGENT_ADDRESS     = optional Boomer Memory agent1q… → Drift → Memory → Perception (recommended for fuller [[MEMORY]])
#   BOOMER_MEMORY_TIMEOUT_SEC   = optional, default 45 (seconds) — wait for Memory hop; keep under hosted limit with Perception inside Memory.
#   BOOMER_PERCEPTION_TIMEOUT_SEC = optional, default 42 (seconds). Hosted Agentverse often 408s if the
#       whole handler waits too long for ASI:One; keep this *below* your platform submit limit (~60s).
#   GUARDIAN_AGENT_ADDRESS = Guardian agent1q…                → used only if PERCEPTION_AGENT_ADDRESS is unset
# Boomer Node .env: AGENTVERSE_PERCEPTION_ADDRESS = this Drift agent (entry); Perception is not the Node target when chaining.
import json
import os
import time
from pathlib import Path

from uagents import Agent, Context, Model

agent = Agent(name="Boomer Drift")


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


class DriftResult(Model):
    drift_score: float
    reasons: str
    top_host: str
    top_host_hits: int
    visit_count: int


class CognitiveOut(Model):
    mode: str
    user_message: str
    drift_score: float
    severity: str
    # Default must match perception/agent.py + query_bridge.py or response_type digests diverge.
    chain: str = "asi1"


# region agent log
@agent.on_event("startup")
async def _boomer_debug_startup(ctx: Context):
    """Writes SnapshotMsg digest to repo debug log (local) + Agent logs (hosted)."""
    try:
        d = Model.build_schema_digest(SnapshotMsg)
        if ctx.logger:
            ctx.logger.info(
                f"BOOMER_DEBUG Drift startup SnapshotMsg digest={d} "
                f"on_message allow_unverified=True expected",
            )
        log_path = Path(__file__).resolve().parents[2] / "debug-965baa.log"
        payload = {
            "sessionId": "965baa",
            "hypothesisId": "H1",
            "location": "drift/agent.py:startup",
            "message": "hosted_drift_snapshot_digest",
            "data": {"snapshot_schema_digest": d},
            "timestamp": int(time.time() * 1000),
        }
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass


# endregion


def _enriched_snapshot_for_perception(msg: SnapshotMsg, drift_score: float, reasons_str: str) -> SnapshotMsg:
    line = (
        f"Hosted Drift agent: score {drift_score:.4f}; signals: {reasons_str}. "
        "Not a medical assessment."
    )
    base = (msg.drift_context or "").strip()
    merged = f"{base}\n\n{line}" if base else line
    return SnapshotMsg(
        window_hours=msg.window_hours,
        visit_count=msg.visit_count,
        unique_hosts=msg.unique_hosts,
        top_host=msg.top_host,
        top_host_hits=msg.top_host_hits,
        repeat_ratio=msg.repeat_ratio,
        who_presses_24h=msg.who_presses_24h,
        source=msg.source,
        drift_context=merged,
        memory_context=msg.memory_context,
        browser_context=msg.browser_context,
        physical_context=msg.physical_context,
    )


# Same as perception: query_bridge uses generate_user_address() (user… prefix), not a signed agent.
@agent.on_message(model=SnapshotMsg, replies={CognitiveOut}, allow_unverified=True)
async def on_snapshot(ctx: Context, sender: str, msg: SnapshotMsg) -> None:
    # region agent log
    try:
        from uagents_core.identity import is_user_address as _is_ua

        log_path = Path(__file__).resolve().parents[2] / "debug-965baa.log"
        payload = {
            "sessionId": "965baa",
            "hypothesisId": "H1,H4",
            "location": "drift/agent.py:on_snapshot",
            "message": "handler_entered",
            "data": {
                "sender_prefix": (sender or "")[:10],
                "sender_is_user": _is_ua(sender or ""),
            },
            "timestamp": int(time.time() * 1000),
        }
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass
    # endregion
    ctx.logger.info("Boomer Drift: received SnapshotMsg")
    score = min(
        1.0,
        msg.repeat_ratio * 1.15
        + (0.18 if msg.top_host_hits >= 6 else 0)
        + (0.12 if msg.visit_count >= 25 else 0)
        + (0.08 * min(3, msg.who_presses_24h)),
    )
    reasons: list[str] = []
    if msg.repeat_ratio > 0.38:
        reasons.append("high_share_top_host")
    if msg.top_host_hits >= 6:
        reasons.append("many_hits_same_host")
    if msg.visit_count >= 25:
        reasons.append("high_visit_volume")
    if msg.who_presses_24h >= 2:
        reasons.append("who_button_signals")
    reasons_str = ";".join(reasons) if reasons else "within_typical_range"

    dr = DriftResult(
        drift_score=round(score, 4),
        reasons=reasons_str,
        top_host=msg.top_host or "",
        top_host_hits=msg.top_host_hits,
        visit_count=msg.visit_count,
    )

    perception = (os.getenv("PERCEPTION_AGENT_ADDRESS") or "").strip()
    if perception == ctx.agent.address:
        ctx.logger.error("PERCEPTION_AGENT_ADDRESS must be Perception agent, not Drift")
        await ctx.send(
            sender,
            CognitiveOut(
                mode="standard",
                user_message="Misconfigured PERCEPTION_AGENT_ADDRESS (cannot equal Drift address).",
                drift_score=dr.drift_score,
                severity="none",
                chain="drift-config-error",
            ),
        )
        return

    if perception:
        forward = _enriched_snapshot_for_perception(msg, dr.drift_score, reasons_str)

        memory_addr = (os.getenv("MEMORY_AGENT_ADDRESS") or "").strip()
        if memory_addr == ctx.agent.address:
            ctx.logger.error("MEMORY_AGENT_ADDRESS must be Memory agent, not Drift")
            await ctx.send(
                sender,
                CognitiveOut(
                    mode="standard",
                    user_message="Misconfigured MEMORY_AGENT_ADDRESS (cannot equal Drift address).",
                    drift_score=dr.drift_score,
                    severity="none",
                    chain="drift-config-error",
                ),
            )
            return
        if memory_addr and memory_addr == perception:
            ctx.logger.error("MEMORY_AGENT_ADDRESS must be Memory agent, not Perception")
            await ctx.send(
                sender,
                CognitiveOut(
                    mode="standard",
                    user_message="Misconfigured MEMORY_AGENT_ADDRESS (cannot equal PERCEPTION_AGENT_ADDRESS).",
                    drift_score=dr.drift_score,
                    severity="none",
                    chain="drift-config-error",
                ),
            )
            return

        if memory_addr:
            m_timeout = _int_env("BOOMER_MEMORY_TIMEOUT_SEC", 45, 15, 115)
            ctx.logger.info(f"Boomer Drift: calling Memory (timeout {m_timeout}s)")
            m_reply, m_status = await ctx.send_and_receive(
                memory_addr,
                forward,
                response_type=CognitiveOut,
                timeout=m_timeout,
                sync=True,
            )
            if isinstance(m_reply, CognitiveOut):
                ctx.logger.info("Boomer Drift: forwarding Memory→Perception CognitiveOut to caller")
                await ctx.send(sender, m_reply)
                return
            ctx.logger.warning(
                f"Memory hop failed ({m_status}); falling back to Perception without Memory synthesis",
            )

        p_timeout = _int_env("BOOMER_PERCEPTION_TIMEOUT_SEC", 42, 15, 115)
        ctx.logger.info(f"Boomer Drift: calling Perception (timeout {p_timeout}s)")
        p_reply, p_status = await ctx.send_and_receive(
            perception,
            forward,
            response_type=CognitiveOut,
            timeout=p_timeout,
            sync=True,
        )
        if isinstance(p_reply, CognitiveOut):
            ctx.logger.info("Boomer Drift: forwarding Perception CognitiveOut to caller")
            await ctx.send(sender, p_reply)
            return
        ctx.logger.warning(f"Perception reply failed: {p_status}")
        await ctx.send(
            sender,
            CognitiveOut(
                mode="standard",
                user_message=(
                    "Drift computed but Perception did not return in time. "
                    f"Drift score {dr.drift_score:.2f}. Not a medical assessment."
                ),
                drift_score=dr.drift_score,
                severity="none",
                chain="drift-perception-fallback",
            ),
        )
        return

    guardian = (os.getenv("GUARDIAN_AGENT_ADDRESS") or "").strip()
    if guardian == ctx.agent.address:
        ctx.logger.error("GUARDIAN_AGENT_ADDRESS must be Guardian agent, not Drift")
        await ctx.send(
            sender,
            CognitiveOut(
                mode="standard",
                user_message="Misconfigured GUARDIAN_AGENT_ADDRESS (cannot equal Drift address).",
                drift_score=dr.drift_score,
                severity="none",
                chain="drift-config-error",
            ),
        )
        return

    if not guardian:
        mode = "assist" if dr.drift_score >= 0.45 else "standard"
        sev = "medium" if dr.drift_score >= 0.65 else ("low" if dr.drift_score >= 0.45 else "none")
        await ctx.send(
            sender,
            CognitiveOut(
                mode=mode,
                user_message=(
                    f"Drift-only (hosted): score {dr.drift_score:.2f}; signals: {reasons_str}. "
                    "No ASI tags yet — add PERCEPTION_AGENT_ADDRESS on Drift for Drift→Perception, "
                    "or MEMORY_AGENT_ADDRESS + PERCEPTION_AGENT_ADDRESS for Drift→Memory→Perception. "
                    "Or set GUARDIAN_AGENT_ADDRESS for the Guardian chain."
                ),
                drift_score=dr.drift_score,
                severity=sev,
                chain="drift-only",
            ),
        )
        return

    g_reply, status = await ctx.send_and_receive(
        guardian,
        dr,
        response_type=CognitiveOut,
        timeout=120,
        sync=True,
    )
    if isinstance(g_reply, CognitiveOut):
        await ctx.send(sender, g_reply)
    else:
        ctx.logger.warning(f"Guardian reply failed: {status}")
        await ctx.send(
            sender,
            CognitiveOut(
                mode="standard",
                user_message=(
                    "Drift computed but Guardian did not return in time. "
                    f"Drift score {dr.drift_score:.2f}. Not a medical assessment."
                ),
                drift_score=dr.drift_score,
                severity="none",
                chain="drift-fallback",
            ),
        )
