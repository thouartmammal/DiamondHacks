"""
Continuity Guardian evaluation — same contract as Node checkContinuityLocal.
Run as the implementation behind FETCHAI_CONTINUITY_AGENT_URL (Fetch.ai / Agentverse HTTP bridge).
"""
from __future__ import annotations

import re
from typing import Any, TypedDict


class Conflict(TypedDict):
    code: str
    severity: str
    title: str
    detail: str


PITCH = (
    "Scams don't only trick people—they contradict what really happened. "
    "Continuity Guardian grounds you in what this app remembers."
)

BRAND_RULES: list[dict[str, Any]] = [
    {"id": "amazon", "label": "Amazon", "host_re": re.compile(r"(^|\.)amazon\.", re.I), "text_re": re.compile(r"\bamazon\b", re.I)},
    {"id": "paypal", "label": "PayPal", "host_re": re.compile(r"(^|\.)paypal\.com$", re.I), "text_re": re.compile(r"\bpaypal\b", re.I)},
    {"id": "microsoft", "label": "Microsoft", "host_re": re.compile(r"(^|\.)microsoft\.com$", re.I), "text_re": re.compile(r"\bmicrosoft\b|\bms\s*account\b", re.I)},
    {"id": "google", "label": "Google", "host_re": re.compile(r"(^|\.)google\.", re.I), "text_re": re.compile(r"\bgoogle\b|\bgmail\b", re.I)},
    {"id": "apple", "label": "Apple", "host_re": re.compile(r"(^|\.)apple\.com$", re.I), "text_re": re.compile(r"\bapple\s*(id|account)\b|\bicloud\b", re.I)},
    {"id": "netflix", "label": "Netflix", "host_re": re.compile(r"(^|\.)netflix\.com$", re.I), "text_re": re.compile(r"\bnetflix\b", re.I)},
    {
        "id": "bank",
        "label": "a major bank",
        "host_re": re.compile(r"chase\.|wellsfargo|bankofamerica|citibank|^usbank\.|^pnc\.|^truist\.", re.I),
        "text_re": re.compile(r"\bchase\b|\bwells fargo\b|\bbank of america\b|\bcitibank\b|\bu\.s\.\s*bank\b", re.I),
    },
]

ACCOUNT_STRESS_RE = re.compile(
    r"account\s+(is\s+)?(locked|suspended|restricted|limited|on\s+hold)|locked\s+out|suspicious\s+activity|"
    r"unauthorized\s+access|verify\s+your\s+(account|identity)|unusual\s+activity",
    re.I,
)
URGENT_RE = re.compile(
    r"urgent|immediately|right\s+now|within\s+\d+|24\s*hours|expires\s+soon|act\s+now|last\s+chance|asap",
    re.I,
)
PASSWORD_RESET_RE = re.compile(
    r"reset\s+(your\s+)?password|password\s+reset|forgot\s+your\s+password|update\s+your\s+password|click\s+to\s+unlock",
    re.I,
)
MONEY_PRESSURE_RE = re.compile(
    r"you\s+owe|payment\s+due|past\s+due|outstanding\s+balance|\birs\b|tax\s+debt|arrest\s+warrant|"
    r"social\s+security\s*(number)?|wire\s+transfer|western\s+union|bitcoin|crypto\s+wallet",
    re.I,
)
ORDER_RE = re.compile(
    r"\byou\s+(have\s+)?(ordered|purchased|bought)\b|\border\s+#|your\s+order\s+(has\s+)?(shipped|been)",
    re.I,
)
GIFT_CARD_RE = re.compile(r"gift\s*card|prepaid\s*card|vanilla\s*card|reload\s*card", re.I)
MEETING_RE = re.compile(
    r"join\s+(this\s+)?(call|meeting|zoom|teams)|click\s+to\s+join|screen\s+connect|remote\s+support|"
    r"download\s+anydesk|teamviewer",
    re.I,
)


def _norm_host(url: str | None) -> str | None:
    if not url or not isinstance(url, str):
        return None
    u = url.strip()
    if not re.match(r"^https?://", u, re.I):
        return None
    try:
        from urllib.parse import urlparse

        h = urlparse(u).hostname or ""
        return re.sub(r"^www\.", "", h.lower()) if h else None
    except Exception:
        return None


def host_matches_brand(host: str, host_re: re.Pattern) -> bool:
    if not host:
        return False
    h = re.sub(r"^www\.", "", host.lower())
    return bool(host_re.search(h))


def saw_brand_in_window(reality: dict, rule: dict) -> bool:
    top = reality.get("topHostsRecent") or []
    host_re = rule["host_re"]
    for row in top:
        h = row.get("host") if isinstance(row, dict) else None
        if h and host_matches_brand(str(h), host_re):
            return True
    return False


def brands_mentioned_in_text(text: str) -> list[dict]:
    return [r for r in BRAND_RULES if r["text_re"].search(text)]


def parse_episode_from_text(text: str) -> int | None:
    t = text.lower()
    patterns = [
        re.compile(r"(?:episode|ep\.?)\s*(\d+)", re.I),
        re.compile(r"season\s*\d+\s*(?:episode|ep\.?)\s*(\d+)", re.I),
        re.compile(r"\bs(\d+)e(\d+)\b", re.I),
    ]
    for pat in patterns:
        m = pat.search(t)
        if m:
            return int(m.groups()[-1])
    return None


def evaluate_continuity(message: str, page_url: str | None, recent_reality: dict) -> dict:
    text = (message or "").strip()
    conflicts: list[Conflict] = []
    reminders: list[str] = []
    uncertain = False
    reality = recent_reality

    if not text:
        return {
            "status": "uncertain",
            "headline": "Paste what the page or message says",
            "pitch": (
                "Scams rewrite reality. Continuity Guardian checks whether a claim fits what "
                "Boomer Browse remembers about your recent browsing and shows."
            ),
            "conflicts": [],
            "reminders": [
                "Copy text from an email, pop-up, or script—then press Check. "
                "We only compare to activity logged in this app."
            ],
            "source": "local-rules",
        }

    page_host = _norm_host(page_url)

    narrative = reality.get("narrative") or {}
    last_ep = narrative.get("lastConfirmedEpisode")
    ep_claim = parse_episode_from_text(text)
    if ep_claim is not None and last_ep is not None and ep_claim != last_ep:
        conflicts.append(
            {
                "code": "episode_mismatch",
                "severity": "medium",
                "title": "Episode number may not match what we last saved",
                "detail": (
                    f"This mentions episode {ep_claim}, but the last episode on file for your saved shows is {last_ep}. "
                    "That can be fine—just double-check before assuming you skipped ahead."
                ),
            }
        )

    if ACCOUNT_STRESS_RE.search(text):
        brands = brands_mentioned_in_text(text)
        if not brands:
            uncertain = True
            reminders.append(
                "We see a stressful account message, but no clear company name. "
                "If it asks for a password, card, or remote access, pause and check with someone you trust."
            )
        else:
            for b in brands:
                if not saw_brand_in_window(reality, b):
                    conflicts.append(
                        {
                            "code": "brand_account_claim_no_visit",
                            "severity": "high",
                            "title": f"Sounds like {b['label']}—but you haven't visited them here recently",
                            "detail": (
                                f"In the last {reality.get('windowDays', 14)} days we don't see {b['label']} in your "
                                "Boomer Browse visit log. That doesn't prove the message is fake—you might use another "
                                "browser or app—but it doesn't match what we see here. Slow down before signing in or paying."
                            ),
                        }
                    )
                else:
                    reminders.append(
                        f"You've visited {b['label']}-related sites in this window—but urgent “locked account” messages "
                        "are still a common scam. Confirm using the official app or a phone number you already trust, "
                        "not from this message."
                    )

    if PASSWORD_RESET_RE.search(text) and URGENT_RE.search(text):
        uncertain = True
        reminders.append(
            "We don't record failed logins, so we can't verify an emergency reset. Urgent password links are a classic "
            "scam pattern—open the site you trust by typing it in the address bar or from your bookmarks."
        )
    elif PASSWORD_RESET_RE.search(text):
        reminders.append(
            "Password reset pages need extra care—prefer the site you normally use, opened from bookmarks or typed yourself."
        )

    if MONEY_PRESSURE_RE.search(text):
        conflicts.append(
            {
                "code": "money_pressure_script",
                "severity": "high",
                "title": "High-pressure money language",
                "detail": (
                    "Messages about owing money, taxes, warrants, or urgent wire or crypto are often scams—especially "
                    "if this came out of the blue."
                ),
            }
        )

    purchase = reality.get("purchaseSignals") or {}
    sounds_like_order = ORDER_RE.search(text) or (
        bool(GIFT_CARD_RE.search(text) and re.search(r"\$\s*\d+|\d+\s*dollars?", text, re.I))
    )
    if sounds_like_order and not purchase.get("hadShoppingVisitInWindow"):
        conflicts.append(
            {
                "code": "purchase_claim_no_recent_shopping",
                "severity": "medium",
                "title": "Purchase story vs your shopping trail in Boomer Browse",
                "detail": (
                    "This sounds like you already bought something or must pay—but we don't see common shopping sites in "
                    "your recent visits here. You might shop in-store, by phone, or in another browser—so this isn't "
                    "proof—just a reason to pause."
                ),
            }
        )

    if MEETING_RE.search(text):
        conflicts.append(
            {
                "code": "remote_session_pitch",
                "severity": "high",
                "title": "“Join this call” or remote-access pitches",
                "detail": (
                    "Scammers often push instant calls or remote desktop tools. Unless you expected this from someone "
                    "you know, treat it as risky."
                ),
            }
        )

    if page_host and ACCOUNT_STRESS_RE.search(text):
        for b in brands_mentioned_in_text(text):
            if not host_matches_brand(page_host, b["host_re"]) and saw_brand_in_window(reality, b):
                conflicts.append(
                    {
                        "code": "page_host_brand_mismatch",
                        "severity": "high",
                        "title": "Web address doesn't match the company named in the text",
                        "detail": (
                            f"The page host is {page_host}, which doesn't fit the usual pattern for {b['label']}. "
                            "Don't enter passwords on unfamiliar addresses."
                        ),
                    }
                )

    has_conflict = any(c["severity"] in ("high", "medium") for c in conflicts)
    if has_conflict:
        status = "conflict"
    elif uncertain:
        status = "uncertain"
    else:
        status = "ok"

    headline = (
        "This may not match your recent reality in Boomer Browse"
        if status == "conflict"
        else "We couldn't fully verify this—go slowly"
        if status == "uncertain"
        else "No strong contradiction with your recent Boomer log"
    )

    return {
        "status": status,
        "headline": headline,
        "pitch": PITCH,
        "conflicts": conflicts,
        "reminders": reminders,
        "source": "local-rules",
    }
