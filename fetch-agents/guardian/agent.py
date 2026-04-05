# Boomer Guardian — Agentverse hosted agent (paste entire file into Build → agent.py)
# Keep SnapshotMsg / DriftResult / CognitiveOut identical across perception + drift + guardian.
from uagents import Agent, Context, Model

agent = Agent(name="Boomer Guardian")


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
    chain: str = "asi1"


@agent.on_message(model=DriftResult)
async def on_drift(ctx: Context, sender: str, msg: DriftResult) -> None:
    ctx.logger.info("Boomer Guardian: received DriftResult")
    mode = "assist" if msg.drift_score >= 0.45 else "standard"
    severity = (
        "medium" if msg.drift_score >= 0.65 else ("low" if msg.drift_score >= 0.45 else "none")
    )
    text = (
        f"Browsing snapshot: drift score {msg.drift_score:.2f}. "
        f"Signals: {msg.reasons}. "
    )
    if mode == "assist":
        text += (
            "More repetition than a calm baseline—Boomer can offer simpler steps and "
            "extra confirmation before important actions. Not a medical assessment."
        )
    else:
        text += "Patterns look typical for this window. Not a medical assessment."

    await ctx.send(
        sender,
        CognitiveOut(
            mode=mode,
            user_message=text.strip(),
            drift_score=msg.drift_score,
            severity=severity,
            chain="perception->drift->guardian",
        ),
    )
