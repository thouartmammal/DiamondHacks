#!/usr/bin/env python3
"""
Minimal routines / caregiver negotiation stub for local dev.
POST JSON: { "context": {...}, "physicalSnapshot": {...} }
Returns JSON compatible with backend/src/fetchAiRoutinesBridge.js normalizeRoutinesAgentResponse.

Replace this with a real Fetch.ai / LLM pipeline in production.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("ROUTINES_AGENT_PORT", "8098"))


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path not in ("/", "/v1/routines"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            body = {}

        ctx = body.get("context") or {}
        phys = body.get("physicalSnapshot") or {}
        mood = float(phys.get("averageMediaMood") or 0)
        label = str(phys.get("averageMediaMoodLabel") or "neutral trend")
        slips = int(ctx.get("memorySlipsLast14Days") or 0)
        snippet = str(ctx.get("personalitySnippet") or "")[:200]

        negotiated = (
            "Dear colleague — stub agent: engagement and safeguards agents reached a single consensus for chart review "
            "(not for unsupervised patient use).\n\n"
            f"In-app signals: media mood ~{mood:.2f} ({label}). "
            f"Browsing-style snippet (heuristic): {snippet or '—'}.\n\n"
            "Safety: this platform cannot diagnose. Narrative-slip counts are operational only "
            f"({slips} in 14 days per payload). Correlate with history and exam.\n\n"
            "Replace this stub with a production LLM negotiation pipeline."
        )

        out = {
            "caregiverHealth": {
                "disclaimer": (
                    "Stub routines agent — operational signals only; not a medical assessment. "
                    "Deploy a real agent for production."
                ),
                "negotiatedSummaryForProvider": negotiated,
                "providerQuestions": [
                    "Does collateral history align with these app-reported slip counts?",
                    "Is in-office cognitive assessment indicated given your clinical context?",
                ],
            }
        }
        data = json.dumps(out).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[fetchai_routines_agent] {args[0] if args else fmt}")


if __name__ == "__main__":
    print(f"http://127.0.0.1:{PORT}/  (POST / or /v1/routines)")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
