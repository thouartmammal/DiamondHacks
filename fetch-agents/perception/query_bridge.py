#!/usr/bin/env python3
"""
Call the hosted Boomer Perception agent via uagents.query (stdin JSON snapshot -> stdout JSON).

Usage (PowerShell: use $env:…, not CMD’s `set`):
  $env:PERCEPTION_AGENT_ADDRESS="agent1q…"
  # or the same name as backend/.env:
  $env:AGENTVERSE_PERCEPTION_ADDRESS="agent1q…"
  echo '{"window_hours":24,...}' | py -3.12 fetch-agents/perception/query_bridge.py

Requires uagents on the **same** interpreter as `python` (use: python -m pip install …).

Python 3.14+ cannot load uagents (Pydantic v1); the script re-invokes `py -3.12` / `py -3.11` when possible.
If `uagents` is missing for your `python` but `pip install` said "satisfied", `pip` is tied to a different Python — use:
  py -0p
  "<path from list>" -m pip install -r fetch-agents/requirements-query-bridge.txt
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

_INTERNAL_ARG = "--boomer-query-internal"

# region agent log
_DEBUG_LOG = Path(__file__).resolve().parents[2] / "debug-965baa.log"


def _dbg(hypothesis_id: str, location: str, message: str, data: dict) -> None:
    try:
        payload = {
            "sessionId": "965baa",
            "hypothesisId": hypothesis_id,
            "location": location,
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        with open(_DEBUG_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass


def _bridge_query_sender():
    """
    Hosted Agentverse often ends up with SnapshotMsg in the signed-handler path only; user… senders
    then get 'Message must be sent from verified agent address'. A signing Identity produces an
    agent sender + signed envelope (see uagents asgi.py). Local agents with allow_unverified=True
    still accept signed agent senders because the unsigned handler matches first.
    """
    raw = (os.environ.get("BOOMER_QUERY_USER_SENDER") or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        from uagents_core.identity import generate_user_address

        return generate_user_address()
    seed = (os.environ.get("BOOMER_QUERY_AGENT_SEED") or "").strip()
    from uagents_core.identity import Identity

    if seed:
        return Identity.from_seed(seed, 0)
    return Identity.generate()


# endregion

# Set in bootstrap (full stdin). None = child process: read stdin normally.
_STDIN_PAYLOAD: str | None = None


def _try_reexec(payload: str) -> bool:
    """Return True if we re-exec'd and should not continue in this process."""
    script = os.path.abspath(__file__)
    for argv in (
        ["py", "-3.12", script, _INTERNAL_ARG],
        ["py", "-3.11", script, _INTERNAL_ARG],
        ["python3.12", script, _INTERNAL_ARG],
    ):
        try:
            proc = subprocess.run(
                argv,
                input=payload,
                capture_output=True,
                text=True,
                env=os.environ,
                timeout=130,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
        sys.stdout.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        sys.exit(proc.returncode)
    return False


def _uagents_spec_ok() -> bool:
    try:
        return importlib.util.find_spec("uagents") is not None
    except Exception:
        return False


def _bootstrap() -> None:
    global _STDIN_PAYLOAD

    if _INTERNAL_ARG in sys.argv:
        _STDIN_PAYLOAD = None
        return

    payload = sys.stdin.read()
    _STDIN_PAYLOAD = payload

    # 1) Python 3.14+ cannot import uagents (Pydantic v1); hand off to 3.12/3.11.
    if sys.version_info >= (3, 14):
        _try_reexec(payload)
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        "This Python is 3.14+; uagents (Pydantic v1) will not run here. "
                        "Install Python 3.12, then: py -3.12 -m pip install -r fetch-agents/requirements-query-bridge.txt "
                        'If `py -3.12` is missing, install from https://www.python.org/downloads/ '
                        "Use `py -0p` to see registered interpreters."
                    ),
                }
            )
        )
        sys.exit(1)

    # 2) `python` has no uagents (often: bare `pip` installed packages for a different Python).
    if not _uagents_spec_ok():
        _try_reexec(payload)
        exe = sys.executable
        ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        f"No module 'uagents' for this interpreter:\n  {exe}\n  Python {ver}\n\n"
                        f'Install with THIS interpreter only:\n  "{exe}" -m pip install -r fetch-agents/requirements-query-bridge.txt\n\n'
                        "If `pip install` claimed success but this still fails, `pip` was for another Python. "
                        "Run `py -0p` (Windows) or `which -a pip` / `python3 -m pip` (Unix) and align them."
                    ),
                },
                indent=2,
            )
        )
        sys.exit(1)


def _result_to_dict(resp) -> dict:
    from uagents_core.envelope import Envelope

    cognitive_out = globals().get("CognitiveOut")
    if cognitive_out is not None and isinstance(resp, cognitive_out):
        return resp.model_dump()

    if isinstance(resp, dict):
        return resp

    if isinstance(resp, str):
        return json.loads(resp)

    if isinstance(resp, Envelope):
        raw = resp.decode_payload()
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode("utf-8")
        return json.loads(raw) if isinstance(raw, str) else dict(raw)

    raise TypeError(f"Unhandled response type: {type(resp)!r}")


def _msg_status_transient(detail: str) -> bool:
    """True if Agentverse / hosting errors are often transient (worth retrying)."""
    d = (detail or "").lower()
    return any(
        x in d
        for x in (
            "500",
            "502",
            "503",
            "408",
            "internal server",
            "bad gateway",
            "gateway timeout",
            "timed out",
            "temporarily unavailable",
            "service unavailable",
        )
    )


async def _run_async() -> None:
    import asyncio

    from uagents.communication import send_sync_message
    from uagents_core.identity import is_user_address
    from uagents_core.types import DeliveryStatus, MsgStatus

    addr = (
        os.environ.get("PERCEPTION_AGENT_ADDRESS")
        or os.environ.get("AGENTVERSE_PERCEPTION_ADDRESS")
        or ""
    ).strip()
    if not addr:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        "Missing agent address. In PowerShell use: "
                        '$env:PERCEPTION_AGENT_ADDRESS="agent1q..." '
                        "(CMD's `set VAR=value` does not set the environment for PowerShell.) "
                        "Same as backend/.env: $env:AGENTVERSE_PERCEPTION_ADDRESS=\"...\""
                    ),
                }
            )
        )
        sys.exit(1)

    raw = sys.stdin.read() if _STDIN_PAYLOAD is None else _STDIN_PAYLOAD
    if not raw.strip():
        print(json.dumps({"ok": False, "error": "No JSON on stdin"}))
        sys.exit(1)

    data = json.loads(raw)
    msg = SnapshotMsg(**data)

    cognitive_out_cls = globals().get("CognitiveOut")
    if cognitive_out_cls is None:
        print(json.dumps({"ok": False, "error": "Internal error: CognitiveOut model not initialized"}))
        sys.exit(1)

    from uagents import Model as _UAgentModel

    snapshot_digest = _UAgentModel.build_schema_digest(SnapshotMsg)
    cognitive_digest = _UAgentModel.build_schema_digest(cognitive_out_cls)
    # H1/H2: which agent address is targeted; H3: digest used by bridge vs hosted registration
    _dbg(
        "H1,H2,H3",
        "query_bridge.py:_run_async",
        "pre_send",
        {
            "destination_prefix": addr[:18],
            "destination_len": len(addr),
            "snapshot_schema_digest": snapshot_digest,
            "cognitive_out_digest": cognitive_digest,
            "starts_agent1q": addr.startswith("agent1q"),
        },
    )

    max_attempts = max(1, int(os.environ.get("BOOMER_QUERY_MAX_ATTEMPTS", "3")))
    backoff_sec = max(0.5, float(os.environ.get("BOOMER_QUERY_BACKOFF_SEC", "4")))

    query_sender = _bridge_query_sender()
    if isinstance(query_sender, str):
        _qs_preview = query_sender[:14]
        _qs_mode = "user"
    else:
        _qs_preview = query_sender.address[:14]
        _qs_mode = "agent"
    _dbg(
        "H4,H6",
        "query_bridge.py:_run_async",
        "query_sender",
        {
            "mode": _qs_mode,
            "sender_prefix": _qs_preview,
            "is_user_address": is_user_address(query_sender) if isinstance(query_sender, str) else False,
        },
    )

    resp = None
    try:
        for attempt in range(max_attempts):
            resp = await send_sync_message(
                destination=addr,
                message=msg,
                response_type=cognitive_out_cls,
                sender=query_sender,
                timeout=120,
            )
            if not isinstance(resp, MsgStatus):
                break
            if (
                resp.status == DeliveryStatus.FAILED
                and _msg_status_transient(resp.detail)
                and attempt < max_attempts - 1
            ):
                _dbg(
                    "H1",
                    "query_bridge.py:_run_async",
                    "delivery_retry",
                    {
                        "attempt": attempt,
                        "detail_snip": (resp.detail or "")[:180],
                        "has_verified_err": "verified" in (resp.detail or "").lower(),
                    },
                )
                await asyncio.sleep(backoff_sec * (attempt + 1))
                continue
            break

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

    if isinstance(resp, MsgStatus):
        _dbg(
            "H1,H2",
            "query_bridge.py:_run_async",
            "delivery_final_failure",
            {
                "status": str(resp.status.value),
                "detail_snip": (resp.detail or "")[:220],
                "has_verified_err": "verified" in (resp.detail or "").lower(),
            },
        )
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"Agentverse delivery failed ({resp.status.value}): {resp.detail}",
                    "destination": resp.destination,
                    "endpoint": resp.endpoint,
                    "hint": (
                        "408 / 'Timed out waiting for agent response': hosted handler took too long. "
                        "If using Drift→Perception, Agentverse may kill the request while Drift waits for ASI:One. "
                        "Set Agent secret BOOMER_PERCEPTION_TIMEOUT_SEC on Drift lower (e.g. 35–42), ensure Perception is Running, "
                        "or point AGENTVERSE_PERCEPTION_ADDRESS at Perception only to skip Drift. "
                        "Other failures: stderr ERROR [dispenser] shows HTTP status; check Agent Logs digest vs BOOMER_PRINT_AGENT_DIGESTS. "
                        "Stop/Run the agent; empty endpoint can mean registration issues."
                    ),
                },
                indent=2,
            )
        )
        sys.exit(1)

    try:
        payload = _result_to_dict(resp)
        _dbg("H1", "query_bridge.py:_run_async", "ok_true", {"chain": (payload.get("chain") if isinstance(payload, dict) else None)})
        print(json.dumps({"ok": True, "data": payload}))
    except TypeError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


def main() -> None:
    global SnapshotMsg, CognitiveOut

    try:
        from uagents import Model
    except ModuleNotFoundError:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        f'Import failed. Run: "{sys.executable}" -m pip install uagents'
                    ),
                }
            )
        )
        sys.exit(1)

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

    globals()["SnapshotMsg"] = SnapshotMsg
    globals()["CognitiveOut"] = CognitiveOut

    if (os.environ.get("BOOMER_SKIP_DRIFT_CHAIN") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    ):
        print(
            "Boomer query_bridge: BOOMER_SKIP_DRIFT_CHAIN is set in this shell but is ignored here. "
            "Add it as a Secret on the hosted Perception agent in Agentverse; it only applies after delivery succeeds.",
            file=sys.stderr,
        )

    if (os.environ.get("BOOMER_PRINT_AGENT_DIGESTS") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        import sys

        print(
            "Boomer query_bridge digests (compare to Agentverse Perception startup logs):",
            file=sys.stderr,
        )
        print(f"  SnapshotMsg    = {Model.build_schema_digest(SnapshotMsg)}", file=sys.stderr)
        print(f"  CognitiveOut   = {Model.build_schema_digest(CognitiveOut)}", file=sys.stderr)

    import asyncio

    asyncio.run(_run_async())


if __name__ == "__main__":
    _bootstrap()
    main()
