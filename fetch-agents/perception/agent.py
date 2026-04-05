# Boomer cognitive agent — local-first, ASI:One compatible (chat protocol).
# Guide: https://uagents.fetch.ai/docs/examples/asi-1
#
# venv (Python 3.10–3.13):
#   pip install uagents==0.24 openai
# Set ASI1_API_KEY (https://asi1.ai/developer) and unique BOOMER_AGENT_NAME / BOOMER_AGENT_SEED.
#
# Run:  python agent.py
# Boomer Node can call the same process via query_bridge.py using PERCEPTION_AGENT_ADDRESS
# (the agent1q… line printed at startup) while this agent is running.
import os
from pathlib import Path

def _load_env_for_perception() -> None:
    """Load repo root and backend/.env like Node's voice server (backend/.env wins on duplicates).

    Skips when __file__ is unset (e.g. Agentverse hosted runs code via exec without __file__);
    use Agent Secrets / env there instead of filesystem .env.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    try:
        here = __file__
    except NameError:
        return
    root = Path(here).resolve().parent.parent.parent
    load_dotenv(root / ".env")
    load_dotenv(root / "backend" / ".env", override=True)


_load_env_for_perception()

from datetime import datetime
from uuid import uuid4

from openai import OpenAI
from uagents import Agent, Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

# --- agent identity (override with env) ---
AGENT_NAME = os.environ.get("BOOMER_AGENT_NAME", "Boomer-Cognitive")
AGENT_SEED = os.environ.get(
    "BOOMER_AGENT_SEED",
    "replace-with-your-unique-boomer-seed-phrase-do-not-use-in-production",
)
AGENT_PORT = int(os.environ.get("BOOMER_AGENT_PORT", "8001"))
# Unset / empty → mailbox off so local + query_bridge works without Agentverse mailbox setup.
# Set BOOMER_MAILBOX=true after you create a mailbox in the inspector (ASI:One Chat path).
_mb = os.environ.get("BOOMER_MAILBOX")
if _mb is None or str(_mb).strip() == "":
    MAILBOX = False
else:
    MAILBOX = str(_mb).strip().lower() in ("1", "true", "yes", "on")

_net = (os.environ.get("BOOMER_AGENT_NETWORK") or "mainnet").strip().lower()
AGENT_NETWORK = "testnet" if _net == "testnet" else "mainnet"
ASI1_BASE_URL = os.environ.get("ASI1_BASE_URL", "https://api.asi1.ai/v1")
ASI1_MODEL = os.environ.get("ASI1_MODEL", "asi1")

# Boomer-facing models (keep in sync with query_bridge.py and drift/guardian agents).
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


_SYSTEM_BOOMER = """You are a calm, respectful assistant for older adults and caregivers (Boomer Browse).
You interpret short summaries of browsing activity: visits, top sites, repetition, and optional context.
Give one or two short sentences: reassuring, concrete, no jargon. If something looks unusual, note it gently.
Do not shame; offer optional next steps (e.g. take a break, verify a site)."""

_SYSTEM_HOLISTIC = """You assist Boomer Browse: passive telemetry only (no questions asked of the user).
The user message has four lenses: core window metrics, optional drift vs prior window, Memory (narrative/recall ops), Browser (visit/search patterns), Physical/wellness summary.
Reply with exactly four blocks in this order. Each block starts with its tag on its own line, then 1–2 short sentences.

[[MEMORY]]

[[BROWSER]]

[[DRIFT]]

[[NOTE]]

Tone: reassuring, concrete, no jargon, no blame. Not a medical diagnosis."""


def _asi_client() -> OpenAI:
    key = (os.environ.get("ASI1_API_KEY") or "").strip()
    if not key:
        raise RuntimeError(
            "Missing ASI1_API_KEY. Create a key at https://asi1.ai/developer and set the env var."
        )
    return OpenAI(base_url=ASI1_BASE_URL, api_key=key)


def _call_asi1(
    user_text: str,
    system_prompt: str | None = None,
    logger=None,
) -> str:
    system = system_prompt or _SYSTEM_BOOMER
    fallback = (
        "Something went wrong talking to ASI:One. Check ASI1_API_KEY and try again."
    )
    try:
        client = _asi_client()
        r = client.chat.completions.create(
            model=ASI1_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_text},
            ],
            max_tokens=2048,
        )
        return str(r.choices[0].message.content)
    except Exception:
        if logger is not None:
            logger.exception("ASI1 chat.completions failed")
        return fallback


# Mailbox on: no explicit endpoint (Agentverse mailbox URL is used; ASI-1 doc style).
# Mailbox off: must set a public HTTP endpoint or Almanac skips registration and
# query_bridge cannot resolve agent1q… → this machine ("No endpoints provided").
_LOCAL_SUBMIT = f"http://127.0.0.1:{AGENT_PORT}/submit"
_agent_kwargs = dict(
    name=AGENT_NAME,
    seed=AGENT_SEED,
    port=AGENT_PORT,
    mailbox=MAILBOX,
    network=AGENT_NETWORK,
    publish_agent_details=True,
)
if not MAILBOX:
    _agent_kwargs["endpoint"] = [
        os.environ.get("BOOMER_AGENT_ENDPOINT", _LOCAL_SUBMIT),
    ]

agent = Agent(**_agent_kwargs)

protocol = Protocol(spec=chat_protocol_spec)


@protocol.on_message(ChatMessage)
async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.now(), acknowledged_msg_id=msg.msg_id),
    )

    text = ""
    for item in msg.content:
        if isinstance(item, TextContent):
            text += item.text

    if not text.strip():
        text = "(empty message)"

    response = _call_asi1(text, logger=ctx.logger)
    try:
        await ctx.send(
            sender,
            ChatMessage(
                timestamp=datetime.utcnow(),
                msg_id=uuid4(),
                content=[
                    TextContent(type="text", text=response),
                    EndSessionContent(type="end-session"),
                ],
            ),
        )
    except Exception:
        ctx.logger.exception("Error sending chat reply")


@protocol.on_message(ChatAcknowledgement)
async def handle_chat_ack(_ctx: Context, _sender: str, _msg: ChatAcknowledgement):
    pass


agent.include(protocol, publish_manifest=True)


@agent.on_event("startup")
async def _startup(ctx: Context) -> None:
    # Agentverse StorageLogger.info only accepts a single string (no %-format extra args).
    ctx.logger.info(
        f"Local URL for this agent: http://127.0.0.1:{AGENT_PORT} "
        f"(paths: /agent_info, /submit for POST only)",
    )
    ctx.logger.info(
        f"Boomer cognitive agent: SnapshotMsg digest = {Model.build_schema_digest(SnapshotMsg)}",
    )
    ctx.logger.info(
        f"Boomer cognitive agent: CognitiveOut digest = {Model.build_schema_digest(CognitiveOut)}",
    )
    if not (os.environ.get("ASI1_API_KEY") or "").strip():
        ctx.logger.error(
            "ASI1_API_KEY is not set — chat and snapshot handler will return fallback messages."
        )
    if MAILBOX:
        ctx.logger.info(
            "Mailbox mode: BOOMER_MAILBOX is on — you must *link* the mailbox once via the Inspector "
            "(this is not automatic). Until then, 401 / 'mailbox not found' is expected."
        )
        ctx.logger.info(
            "Steps: keep this agent running → open the Inspector URL above → Connect → choose Mailbox → "
            "sign in to Agentverse if asked → allow browser *local network access* if Chrome prompts."
        )
        ctx.logger.info(
            "Success looks like: [mailbox]: Successfully registered as mailbox agent in Agentverse"
        )
        ctx.logger.info(
            "Local bridge only (no mailbox): exit, then Remove-Item Env:\\BOOMER_MAILBOX (or set false) and restart."
        )
    else:
        ctx.logger.info(
            "Mailbox off — OK for query_bridge on localhost. Set BOOMER_MAILBOX=true for ASI:One Chat, "
            "then use Inspector → Connect → Mailbox."
        )


def _use_holistic(req: SnapshotMsg) -> bool:
    return bool(
        (req.drift_context or "").strip()
        or (req.memory_context or "").strip()
        or (req.browser_context or "").strip()
        or (req.physical_context or "").strip()
    )


def _snapshot_user_text(req: SnapshotMsg) -> str:
    base = (
        "Boomer Browse — passive browsing snapshot (user was not quizzed).\n\n"
        f"- Hours window: {req.window_hours}\n"
        f"- Visits: {req.visit_count}\n"
        f"- Unique sites: {req.unique_hosts}\n"
        f"- Top site: {req.top_host} ({req.top_host_hits} hits)\n"
        f"- Repeat ratio: {req.repeat_ratio}\n"
        f"- \"Who?\" presses (24h): {req.who_presses_24h}\n"
        f"- Source: {req.source}\n"
    )
    dc = (req.drift_context or "").strip()
    if dc:
        base += "\n--- Drift (prior window vs current) ---\n" + dc + "\n"
    mc = (req.memory_context or "").strip()
    if mc:
        base += "\n--- Memory / narrative lens (operational) ---\n" + mc + "\n"
    bc = (req.browser_context or "").strip()
    if bc:
        base += "\n--- Browser behavior lens (visits / search proxy) ---\n" + bc + "\n"
    pc = (req.physical_context or "").strip()
    if pc:
        base += "\n--- Physical / wellness dashboard lens ---\n" + pc + "\n"
    return base


# Same as deprecated on_query: allow unsigned user-address senders (query_bridge / send_sync_message).
@agent.on_message(model=SnapshotMsg, replies={CognitiveOut}, allow_unverified=True)
async def on_cognitive_snapshot(ctx: Context, sender: str, req: SnapshotMsg) -> None:
    _from = (sender[:16] + "…") if sender and len(sender) > 16 else (sender or "?")
    ctx.logger.info(f"Boomer: snapshot message from {_from}")
    sys_prompt = _SYSTEM_HOLISTIC if _use_holistic(req) else _SYSTEM_BOOMER
    msg = _call_asi1(_snapshot_user_text(req), system_prompt=sys_prompt, logger=ctx.logger)
    await ctx.send(
        sender,
        CognitiveOut(
            mode="standard",
            user_message=msg,
            drift_score=0.0,
            severity="none",
            chain="boomer-asi1-local",
        ),
    )


if __name__ == "__main__":
    agent.run()
