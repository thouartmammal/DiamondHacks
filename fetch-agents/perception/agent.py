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
import asyncio
import json
import os
import re
import socket
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

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
# Holistic snapshots + evidence brief can be huge; ASI APIs often reject oversize requests (opaque 4xx).
try:
    _ASI_USER_MAX = int((os.environ.get("ASI_USER_MESSAGE_MAX_CHARS") or "95000").strip())
except ValueError:
    _ASI_USER_MAX = 95000

# --- optional headlines (auto: SerpApi → NewsAPI.org → NewsData.io by first key that resolves) → _snapshot_user_text ---
# Default ~24h polling — tune NEWS_API_POLL_SECONDS per provider quotas.
try:
    _NEWS_POLL_SECONDS = float((os.environ.get("NEWS_API_POLL_SECONDS") or "86400").strip())
except ValueError:
    _NEWS_POLL_SECONDS = 86400.0
_NEWS_POLL_SECONDS = max(120.0, min(_NEWS_POLL_SECONDS, 86400.0))
try:
    _NEWS_PAGE_SIZE = int((os.environ.get("NEWS_API_PAGE_SIZE") or "5").strip())
except ValueError:
    _NEWS_PAGE_SIZE = 5
_NEWS_PAGE_SIZE = max(1, min(_NEWS_PAGE_SIZE, 10))
_NEWS_QUERY = (os.environ.get("NEWS_API_QUERY") or "dementia OR alzheimer OR cognitive health").strip()
# NewsData free tier: character limit on `q` (see pricing table on newsdata.io).
try:
    _NEWSDATA_Q_MAX = int((os.environ.get("NEWSDATA_Q_MAX_CHARS") or "100").strip())
except ValueError:
    _NEWSDATA_Q_MAX = 100
_NEWSDATA_Q_MAX = max(20, min(_NEWSDATA_Q_MAX, 512))

_news_lock = threading.Lock()
_news_cached_block: dict[str, str] = {"text": ""}
_headline_cache_updated_at: float = 0.0


def _normalize_news_api_key(raw: str) -> str:
    """Strip whitespace, BOM / zero-width chars, and one pair of surrounding quotes (common .env / secrets UI pastes)."""
    k = (raw or "").strip().lstrip("\ufeff\u200b\u200c\u200d").strip()
    if len(k) >= 2 and k[0] == k[-1] and k[0] in "'\"":
        k = k[1:-1].strip()
    return k


def _newsapi_key() -> str:
    """Key for https://newsapi.org — use NEWS_API_KEY, or NEWSDATA_API_KEY when that is unset (common mis-name).

    When NEWS_HEADLINES_PROVIDER=newsdata only, the sole NEWSDATA_API_KEY is reserved for NewsData.io (see _newsdata_io_key).
    """
    k = _normalize_news_api_key(os.environ.get("NEWS_API_KEY") or "")
    if k:
        return k
    p = (os.environ.get("NEWS_HEADLINES_PROVIDER") or "").strip().lower()
    if p in ("newsdata", "newsdata.io", "data"):
        return ""
    return _normalize_news_api_key(os.environ.get("NEWSDATA_API_KEY") or "")


def _newsdata_io_key() -> str:
    """Key for https://newsdata.io — NEWSDATA_IO_API_KEY, or NEWSDATA_API_KEY only for NewsData-only / two-key setups."""
    k = _normalize_news_api_key(os.environ.get("NEWSDATA_IO_API_KEY") or "")
    if k:
        return k
    p = (os.environ.get("NEWS_HEADLINES_PROVIDER") or "").strip().lower()
    if p in ("newsdata", "newsdata.io", "data"):
        return _normalize_news_api_key(os.environ.get("NEWSDATA_API_KEY") or "")
    if _normalize_news_api_key(os.environ.get("NEWS_API_KEY") or ""):
        return _normalize_news_api_key(os.environ.get("NEWSDATA_API_KEY") or "")
    return ""


def _serpapi_key() -> str:
    """SerpApi private key — https://serpapi.com/manage-api-key"""
    return _normalize_news_api_key(os.environ.get("SERPAPI_API_KEY") or "")


def _serpapi_google_news_tab() -> bool:
    """Use Google News vertical (tbm=nws) when set; set SERPAPI_GOOGLE_NEWS=0 for generic web search only."""
    v = (os.environ.get("SERPAPI_GOOGLE_NEWS") or "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _serpapi_hl_gl() -> tuple[str, str]:
    hl = (os.environ.get("SERPAPI_HL") or "en").strip() or "en"
    gl = (os.environ.get("SERPAPI_GL") or "us").strip() or "us"
    return hl[:12], gl[:8]


def _headlines_env_enabled() -> bool:
    return bool(_serpapi_key() or _newsapi_key() or _newsdata_io_key())


def _format_newsdata_results(results: list, *, block_header: str | None = None) -> str:
    """Map NewsData.io /api/1/latest `results` into the same snapshot shape as NewsAPI."""
    lines: list[str] = []
    for art in results[:_NEWS_PAGE_SIZE]:
        title = (art.get("title") or "").strip()
        if not title or title.lower() == "[removed]":
            continue
        src = (art.get("source_name") or art.get("source_id") or "").strip()
        link = (art.get("link") or "").strip()
        pub = (art.get("pubDate") or "").strip()[:19]
        desc = (art.get("description") or "").strip()
        line = f"- {title}"
        if src:
            line += f" ({src})"
        lines.append(line)
        if pub:
            lines.append(f"  published: {pub}")
        if desc:
            lines.append(f"  {desc[:420]}")
        if link:
            lines.append(f"  {link}")
    if not lines:
        return ""
    if block_header is None:
        header = (
            "--- Recent headlines (NewsData.io — general news; not medical advice for this user) ---\n"
        )
    else:
        header = block_header if block_header.endswith("\n") else block_header + "\n"
    return header + "\n".join(lines)


def _truncate_newsdata_q(q: str) -> str:
    q = re.sub(r"\s+", " ", (q or "").strip())
    if len(q) <= _NEWSDATA_Q_MAX:
        return q
    cut = q[: _NEWSDATA_Q_MAX].rsplit(" ", 1)[0]
    return cut if cut else q[:_NEWSDATA_Q_MAX]


def _news_chat_ondemand_enabled() -> bool:
    v = (os.environ.get("NEWS_CHAT_ONDEMAND") or "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _newsdata_search_q_from_chat(user_text: str) -> str | None:
    """Build a NewsData `q` from chat when the user is clearly asking for news or a health topic."""
    raw0 = (user_text or "").strip()
    if not raw0:
        return None
    raw = re.sub(r"@\w+\b", "", raw0).strip()
    raw = re.sub(
        r"^(?:(?:hi|hello|hey)[,.]?\s+)?(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:give\s+me\s+)?(?:tell\s+me\s+)?(?:some\s+)?(?:a\s+few\s+)?",
        "",
        raw,
        flags=re.I,
    ).strip()
    newsish = re.search(
        r"\b(news|headlines?|articles?|stories|breaking|what\s*(?:'?s| is)\s+going\s+on|"
        r"what\s+happened|updates?|report(?:ing)?|coverage|press)\b",
        raw,
        re.I,
    )
    healthish = re.search(
        r"\b(alzheimer'?s?|dementia|parkinson|cognitive\s+health|memory\s+loss|"
        r"brain\s+health|aging|carers?|caregiv|nih|clinical\s+trial|research\s+study|"
        r"fda|treatment|drug\s+trial)\b",
        raw,
        re.I,
    )
    if not newsish and not healthish:
        return None
    q = _truncate_newsdata_q(raw)
    return q if q else None


def _format_newsapi_articles(articles: list, *, block_header: str | None = None) -> str:
    lines: list[str] = []
    for art in articles[:_NEWS_PAGE_SIZE]:
        title = (art.get("title") or "").strip()
        if not title or title.lower() == "[removed]":
            continue
        src = ""
        s = art.get("source")
        if isinstance(s, dict):
            src = (s.get("name") or "").strip()
        link = (art.get("url") or "").strip()
        pub = (art.get("publishedAt") or "").strip()[:19]
        desc = (art.get("description") or "").strip()
        line = f"- {title}"
        if src:
            line += f" ({src})"
        lines.append(line)
        if pub:
            lines.append(f"  published: {pub}")
        if desc:
            lines.append(f"  {desc[:420]}")
        if link:
            lines.append(f"  {link}")
    if not lines:
        return ""
    if block_header is None:
        header = (
            "--- Recent headlines (NewsAPI.org — general news; not medical advice for this user) ---\n"
        )
    else:
        header = block_header if block_header.endswith("\n") else block_header + "\n"
    return header + "\n".join(lines)


def _serpapi_source_name(source_field: object) -> str:
    if isinstance(source_field, dict):
        return (source_field.get("name") or "").strip()
    return str(source_field or "").strip()


def _format_serpapi_results(
    news_results: list,
    organic_results: list,
    *,
    block_header: str | None,
    prefer_news: bool,
) -> str:
    """Shape SerpApi Google JSON (news tab and/or organic) like other headline blocks."""
    lines: list[str] = []

    def add_from_news(rows: list) -> None:
        for row in rows[:_NEWS_PAGE_SIZE]:
            if not isinstance(row, dict):
                continue
            title = (row.get("title") or "").strip()
            if not title:
                continue
            src = _serpapi_source_name(row.get("source"))
            link = (row.get("link") or "").strip()
            when = (row.get("date") or row.get("iso_date") or "").strip()[:48]
            snippet = (row.get("snippet") or "").strip()
            line = f"- {title}"
            if src:
                line += f" ({src})"
            lines.append(line)
            if when:
                lines.append(f"  date: {when}")
            if snippet:
                lines.append(f"  {snippet[:420]}")
            if link:
                lines.append(f"  {link}")

    def add_from_organic(rows: list) -> None:
        for row in rows[:_NEWS_PAGE_SIZE]:
            if not isinstance(row, dict):
                continue
            title = (row.get("title") or "").strip()
            if not title:
                continue
            src = (row.get("source") or "").strip()
            if not src:
                src = (row.get("displayed_link") or "").split(" › ")[0].strip()
            link = (row.get("link") or "").strip()
            snippet = (row.get("snippet") or "").strip()
            date = (row.get("date") or "").strip()[:48]
            line = f"- {title}"
            if src:
                line += f" ({src})"
            lines.append(line)
            if date:
                lines.append(f"  date: {date}")
            if snippet:
                lines.append(f"  {snippet[:420]}")
            if link:
                lines.append(f"  {link}")

    news_rows = [r for r in (news_results or []) if isinstance(r, dict)]
    org_rows = [r for r in (organic_results or []) if isinstance(r, dict)]
    if prefer_news and news_rows:
        add_from_news(news_rows)
    elif org_rows:
        add_from_organic(org_rows)
    elif news_rows:
        add_from_news(news_rows)

    if not lines:
        return ""
    if block_header is None:
        nws = _serpapi_google_news_tab()
        label = "Google News (via SerpApi)" if nws else "Google search (via SerpApi)"
        header = f"--- Recent headlines ({label} — not medical advice) ---\n"
    else:
        header = block_header if block_header.endswith("\n") else block_header + "\n"
    return header + "\n".join(lines)


def _fetch_serpapi_impl(
    primary_q: str,
    *,
    allow_organic_fallback: bool,
    block_header: str | None,
) -> tuple[str, str]:
    """GET https://serpapi.com/search.json — Google engine; see https://serpapi.com/search-api"""
    api_key = _serpapi_key()
    if not api_key:
        return "", "SERPAPI_API_KEY is not set."
    q = re.sub(r"\s+", " ", (primary_q or "").strip())
    if not q:
        return "", "empty SerpApi query"
    q = q[:2000]
    hl, gl = _serpapi_hl_gl()
    num = str(max(1, min(_NEWS_PAGE_SIZE, 10)))

    def one_request(with_nws: bool) -> tuple[str, str]:
        params: dict[str, str] = {
            "engine": "google",
            "q": q,
            "api_key": api_key,
            "hl": hl,
            "gl": gl,
            "num": num,
        }
        if with_nws:
            params["tbm"] = "nws"
        url = "https://serpapi.com/search.json?" + urlencode(params)
        data, net_err = _http_get_json(url)
        if net_err:
            return "", net_err
        if not data:
            return "", "no response body"
        err = data.get("error")
        if err:
            return "", str(err)
        meta = data.get("search_metadata") or {}
        if meta.get("status") == "Error":
            return "", str(data.get("error") or meta.get("json_endpoint") or "search error")
        block = _format_serpapi_results(
            data.get("news_results") or [],
            data.get("organic_results") or [],
            block_header=block_header,
            prefer_news=with_nws,
        )
        if block:
            return block, ""
        return "", "success but zero usable titles"

    diagnostics: list[str] = []
    use_nws = _serpapi_google_news_tab()
    if use_nws:
        block, err = one_request(True)
        if block:
            return block, ""
        diagnostics.append(f"nws: {err}")
        if allow_organic_fallback:
            block2, err2 = one_request(False)
            if block2:
                return block2, "nws had no lines | used web organic fallback"
            diagnostics.append(f"organic: {err2}")
        return "", "serpapi → " + "; ".join(diagnostics)
    block, err = one_request(False)
    if block:
        return block, ""
    return "", f"serpapi → {err}"


def _fetch_serpapi_block() -> tuple[str, str]:
    return _fetch_serpapi_impl(_NEWS_QUERY, allow_organic_fallback=True, block_header=None)


def _fetch_serpapi_chat_topic(primary_q: str) -> tuple[str, str]:
    q = (primary_q or "").strip()[:500]
    if not q:
        return "", "empty topic query"
    hdr = "--- Topic search — SerpApi / Google (not medical advice) ---\n"
    return _fetch_serpapi_impl(q, allow_organic_fallback=True, block_header=hdr)


def _http_get_json(url: str, extra_headers: dict[str, str] | None = None) -> tuple[dict | None, str]:
    """GET URL; return (parsed_json_or_none, error_detail). HTTP 200 body may still be status:error."""
    headers = {"User-Agent": "BoomerBrowse-Perception/1.0"}
    if extra_headers:
        headers.update(extra_headers)
    try:
        req = Request(url, headers=headers)
        with urlopen(req, timeout=25) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        return json.loads(raw), ""
    except HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")[:600]
        except Exception:
            body = str(e)
        return None, f"HTTP {e.code}: {body}"
    except URLError as e:
        return None, f"network URLError: {e.reason!r}"
    except socket.timeout:
        return None, "timeout (firewall/DNS/offline?)"
    except (TimeoutError, OSError) as e:
        return None, f"connection error: {e!r}"
    except json.JSONDecodeError as e:
        return None, f"invalid JSON: {e!r}"


def _fetch_newsdata_impl(
    primary_q: str,
    *,
    allow_top_fallback: bool,
    block_header: str | None = None,
) -> tuple[str, str]:
    """NewsData /api/1/latest. If allow_top_fallback, widen to unfiltered top stories when query returns nothing."""
    api_key = _newsdata_io_key()
    if not api_key:
        return "", "NewsData.io key not configured (NEWSDATA_IO_API_KEY, or NEWS_HEADLINES_PROVIDER=newsdata + NEWSDATA_API_KEY)."
    pq = _truncate_newsdata_q(primary_q)
    if not pq:
        return "", "empty NewsData query"

    def one_request(
        label: str,
        base: dict[str, str],
        *,
        fmt_header: str | None = None,
    ) -> tuple[str | None, str]:
        params = {"apikey": api_key, "size": str(_NEWS_PAGE_SIZE), **base}
        url = "https://newsdata.io/api/1/latest?" + urlencode(params)
        data, net_err = _http_get_json(url)
        if net_err:
            return None, f"{label}: {net_err}"
        if not data:
            return None, f"{label}: no response body"
        if data.get("status") != "success":
            msg = data.get("message") or data.get("code") or str(data)[:400]
            return None, f"{label}: {msg}"
        block = _format_newsdata_results(data.get("results") or [], block_header=fmt_header)
        if block:
            return block, ""
        return None, f"{label}: success but zero usable titles"

    diagnostics: list[str] = []
    attempts: list[tuple[str, dict[str, str], str | None]] = [
        ("en+q", {"q": pq, "language": "en"}, block_header),
        ("q-only", {"q": pq}, block_header),
    ]
    if allow_top_fallback:
        attempts.append(("top-headlines", {}, None))
    for label, extra, fmt in attempts:
        block, err = one_request(label, extra, fmt_header=fmt)
        if block:
            diag = ""
            if label != "en+q":
                diag = f"used {label} after narrower fetch had no lines"
            return block, diag
        diagnostics.append(err)
    return "", "newsdata → " + "; ".join(diagnostics)


def _fetch_newsdata_block() -> tuple[str, str]:
    """Scheduled poll: themed query, then optional generic top stories."""
    return _fetch_newsdata_impl(_NEWS_QUERY, allow_top_fallback=True, block_header=None)


def _fetch_newsdata_chat_topic(primary_q: str) -> tuple[str, str]:
    """Chat on-demand: search user's topic; if empty, try NEWS_API_QUERY (health theme) before giving up."""
    hdr = "--- Topic search — NewsData.io latest index (not medical advice) ---\n"
    block, diag = _fetch_newsdata_impl(primary_q, allow_top_fallback=False, block_header=hdr)
    if block:
        return block, diag
    pq = _truncate_newsdata_q(primary_q).lower()
    fallback_q = _truncate_newsdata_q(_NEWS_QUERY)
    if fallback_q and pq not in fallback_q.lower() and fallback_q.lower() not in pq:
        block2, diag2 = _fetch_newsdata_impl(
            fallback_q, allow_top_fallback=False, block_header=hdr
        )
        if block2:
            return block2, diag + " | fallback " + diag2
    return "", diag


def _fetch_newsapi_block() -> tuple[str, str]:
    """Sync HTTP to NewsAPI. Returns (block, diagnostic). block empty => log diagnostic (dashboard may show 0 requests if network never reached them)."""
    api_key = _newsapi_key()
    if not api_key:
        return "", "NewsAPI.org key not set (NEWS_API_KEY, or NEWSDATA_API_KEY as alias when NEWS_HEADLINES_PROVIDER is not newsdata-only)."

    def attempt(endpoint: str, params: dict[str, str]) -> tuple[str, str]:
        q = urlencode(params)
        url = f"https://newsapi.org/v2/{endpoint}?{q}"
        data, net_err = _http_get_json(url)
        if net_err:
            return "", f"{endpoint}: {net_err}"
        if not data:
            return "", f"{endpoint}: no response body"
        if data.get("status") != "ok":
            msg = data.get("message") or data.get("code") or str(data)[:400]
            return "", f"{endpoint}: {msg}"
        block = _format_newsapi_articles(data.get("articles") or [])
        if block:
            return block, ""
        return "", f"{endpoint}: status ok but no usable article titles (try NEWS_API_QUERY)."

    # Try /everything first (search); fall back to /top-headlines (works on more plans / simpler index).
    params_everything = {
        "q": _NEWS_QUERY,
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": str(_NEWS_PAGE_SIZE),
        "apiKey": api_key,
    }
    block, err_ev = attempt("everything", params_everything)
    if block:
        return block, ""
    params_top = {
        "q": _NEWS_QUERY,
        "pageSize": str(_NEWS_PAGE_SIZE),
        "apiKey": api_key,
    }
    block, err_th = attempt("top-headlines", params_top)
    if block:
        return block, f"(used top-headlines after everything failed: {err_ev})"
    return "", f"everything → {err_ev}; top-headlines → {err_th}"


def _fetch_newsapi_chat_topic(primary_q: str) -> tuple[str, str]:
    """Chat on-demand: NewsAPI /v2/everything (then top-headlines) for the user’s wording."""
    api_key = _newsapi_key()
    if not api_key:
        return "", "NewsAPI.org key not set (NEWS_API_KEY or NEWSDATA_API_KEY alias)."
    q = (primary_q or "").strip()[:500]
    if not q:
        return "", "empty topic query"
    hdr = "--- Topic search — NewsAPI.org (not medical advice) ---\n"

    def attempt(endpoint: str, params: dict[str, str]) -> tuple[str, str]:
        req_q = urlencode(params)
        url = f"https://newsapi.org/v2/{endpoint}?{req_q}"
        data, net_err = _http_get_json(url)
        if net_err:
            return "", f"{endpoint}: {net_err}"
        if not data:
            return "", f"{endpoint}: no response body"
        if data.get("status") != "ok":
            msg = data.get("message") or data.get("code") or str(data)[:400]
            return "", f"{endpoint}: {msg}"
        block = _format_newsapi_articles(data.get("articles") or [], block_header=hdr)
        if block:
            return block, ""
        return "", f"{endpoint}: status ok but no usable article titles"

    params_ev = {
        "q": q,
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": str(_NEWS_PAGE_SIZE),
        "apiKey": api_key,
    }
    block, err_ev = attempt("everything", params_ev)
    if block:
        return block, ""
    params_top = {"q": q, "pageSize": str(_NEWS_PAGE_SIZE), "apiKey": api_key}
    block, err_th = attempt("top-headlines", params_top)
    if block:
        return block, f"(used top-headlines after everything failed: {err_ev})"
    fq = (_NEWS_QUERY or "").strip()[:500]
    lp = q.lower()
    if fq and lp not in fq.lower() and fq.lower() not in lp:
        block2, err_fb = attempt(
            "everything",
            {
                "q": fq,
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": str(_NEWS_PAGE_SIZE),
                "apiKey": api_key,
            },
        )
        if block2:
            return block2, f"{err_ev}; top-headlines → {err_th} | fallback NEWS_API_QUERY"
    return "", f"everything → {err_ev}; top-headlines → {err_th}"


def _news_headlines_provider() -> str:
    """'serpapi' | 'newsapi' | 'newsdata'. NEWS_HEADLINES_PROVIDER forces; auto picks first matching key."""
    raw = (os.environ.get("NEWS_HEADLINES_PROVIDER") or "").strip().lower()
    if raw in ("serpapi", "serp", "serpapi.com", "google_serp"):
        return "serpapi"
    if raw in ("newsapi", "newsapi.org", "news"):
        return "newsapi"
    if raw in ("newsdata", "newsdata.io", "data"):
        return "newsdata"
    if _serpapi_key():
        return "serpapi"
    if _newsapi_key():
        return "newsapi"
    if _newsdata_io_key():
        return "newsdata"
    return "newsapi"


def _fetch_chat_ondemand_topic(sq: str) -> tuple[str, str]:
    """On-demand headline search for one chat turn (provider order follows NEWS_HEADLINES_PROVIDER / auto)."""
    prov = _news_headlines_provider()
    has_s = bool(_serpapi_key())
    has_n = bool(_newsapi_key())
    has_d = bool(_newsdata_io_key())
    errs: list[str] = []

    def run(name: str) -> tuple[str, str] | None:
        if name == "serpapi" and has_s:
            return _fetch_serpapi_chat_topic(sq)
        if name == "newsapi" and has_n:
            return _fetch_newsapi_chat_topic(sq)
        if name == "newsdata" and has_d:
            return _fetch_newsdata_chat_topic(sq)
        return None

    order = {
        "serpapi": ["serpapi", "newsapi", "newsdata"],
        "newsapi": ["newsapi", "newsdata", "serpapi"],
        "newsdata": ["newsdata", "newsapi", "serpapi"],
    }.get(prov, ["newsapi", "newsdata", "serpapi"])
    for name in order:
        pair = run(name)
        if pair is None:
            continue
        b, err = pair
        if b:
            return b, err
        errs.append(err)
    return "", "; ".join(errs) if errs else "no headline API keys"


def _fetch_headlines_block() -> tuple[str, str, str]:
    """Returns (block, diagnostic, provider_label)."""
    prov = _news_headlines_provider()
    has_s = bool(_serpapi_key())
    has_n = bool(_newsapi_key())
    has_d = bool(_newsdata_io_key())

    def try_serp() -> tuple[str, str, str] | None:
        if not has_s:
            return None
        block, diag = _fetch_serpapi_block()
        if block:
            return block, diag, "SerpApi"
        return None

    def try_newsapi() -> tuple[str, str, str] | None:
        if not has_n:
            return None
        block, diag = _fetch_newsapi_block()
        if block:
            return block, diag, "NewsAPI.org"
        return None

    def try_newsdata() -> tuple[str, str, str] | None:
        if not has_d:
            return None
        block, diag = _fetch_newsdata_block()
        if block:
            return block, diag, "NewsData.io"
        return None

    if prov == "serpapi":
        for fn in (try_serp, try_newsapi, try_newsdata):
            got = fn()
            if got:
                return got
        return (
            "",
            "SerpApi: SERPAPI_API_KEY not set or all attempts failed (NEWS_HEADLINES_PROVIDER=serpapi).",
            "SerpApi",
        )
    if prov == "newsapi":
        for fn in (try_newsapi, try_newsdata, try_serp):
            got = fn()
            if got:
                return got
        return (
            "",
            "NewsAPI.org key not set (NEWS_HEADLINES_PROVIDER=newsapi). Use NEWS_API_KEY or NEWSDATA_API_KEY for newsapi.org.",
            "headlines",
        )
    for fn in (try_newsdata, try_newsapi, try_serp):
        got = fn()
        if got:
            return got
    return (
        "",
        "No headline key (SERPAPI_API_KEY, or NewsAPI / NewsData keys — see fetch-agents README).",
        "headlines",
    )


def _headlines_max_age_chat_sec() -> float:
    try:
        v = float((os.environ.get("NEWS_HEADLINES_MAX_AGE_CHAT_SEC") or "300").strip())
    except ValueError:
        return 300.0
    return max(0.0, v)


def _should_refresh_headlines_for_chat() -> bool:
    """Hosted runtimes may handle chat on a different worker than startup (empty cache)."""
    with _news_lock:
        empty = not (_news_cached_block["text"] or "").strip()
        updated = _headline_cache_updated_at
    if empty:
        return True
    max_age = _headlines_max_age_chat_sec()
    if max_age <= 0:
        return False
    return (time.time() - updated) > max_age


async def _ensure_headlines_before_chat(ctx: Context) -> None:
    if not _headlines_env_enabled():
        return
    if _should_refresh_headlines_for_chat():
        await _refresh_headlines_cache(ctx)


async def _refresh_headlines_cache(ctx: Context) -> None:
    global _headline_cache_updated_at
    if not _headlines_env_enabled():
        return
    block, diagnostic, provider = await asyncio.to_thread(_fetch_headlines_block)
    if block:
        with _news_lock:
            _news_cached_block["text"] = block
            _headline_cache_updated_at = time.time()
        ctx.logger.info(f"{provider}: headline cache updated for holistic snapshots.")
        if diagnostic:
            ctx.logger.info(f"{provider} note: " + diagnostic)
        return
    auth_reject = (
        "apiKeyInvalid" in diagnostic
        or '"code":"apiKeyInvalid"' in diagnostic
        or "HTTP 401" in diagnostic
        or "HTTP 403" in diagnostic
        or "Unauthorized" in diagnostic
        or "Invalid API key" in diagnostic
    )
    if auth_reject and provider == "NewsAPI.org":
        ctx.logger.warning(
            "NewsAPI.org: API key rejected. Fix: valid NEWS_API_KEY or NEWSDATA_API_KEY (mis-named NewsAPI key). "
            "For NewsData.io use NEWSDATA_IO_API_KEY. Detail: "
            + diagnostic
        )
    elif auth_reject and provider == "NewsData.io":
        ctx.logger.warning(
            "NewsData.io: request denied (check NEWSDATA_IO_API_KEY or NEWSDATA_API_KEY in https://newsdata.io/search-dashboard ). "
            "Detail: "
            + diagnostic
        )
    elif auth_reject and provider == "SerpApi":
        ctx.logger.warning(
            "SerpApi: API key rejected or invalid — https://serpapi.com/manage-api-key . Detail: "
            + diagnostic
        )
    else:
        ctx.logger.warning(
            f"{provider}: no headlines — keeping prior cache. Detail: " + diagnostic
        )


def _news_block_for_snapshot() -> str:
    with _news_lock:
        return _news_cached_block["text"]


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
The user message carries four lenses: Memory (narrative/recall ops), Browser (visit/search patterns), drift vs prior window, Physical/wellness. It may also include **Evidence & research themes** — curated bullets and reputable public URLs (WHO, NIH NIA, etc.) for **grounding** judgments, not for diagnosing this person.

Your job is a calm synthesis — not a clinical diagnosis. **Integrate** telemetry with those research themes where helpful (e.g. variability on complex tasks, non-specificity of digital patterns, care-support framing). Prefer **evidence-informed** language over raw counts alone.

**Citations discipline:** Name a paper, journal, author, year, or DOI **only** if it appears verbatim in the user message (including the evidence brief). Otherwise use broad phrases like "research on aging often…" without fabricated references.

Reply with exactly four blocks in this order. Each block starts with its tag on its own line, then one or two short sentences (plain language).

**Qualitative focus (critical):** In [[MEMORY]], [[BROWSER]], and [[DRIFT]], describe patterns in words — e.g. "much busier than usual", "shift toward official sites", "more scattered than your typical week". **Do not paste raw counts**, percentages, or long lists of numbers from the input. One concrete number in a block at most if truly necessary.

[[MEMORY]]

[[BROWSER]]

[[DRIFT]]

[[NOTE]]
In [[NOTE]]: one short caregiver-friendly sentence, then on a **new line** exactly this pattern (pick one word for X only):
Support intensity: X
where X is exactly **Low**, **Moderate**, or **Elevated** — meaning how much **extra digital / routine support** the combined pattern suggests for the next few days (based only on passive app signals).

Then one more line: clarify that this is **not** a dementia or Alzheimer’s assessment and does not replace a clinician.

Tone throughout: reassuring, no jargon, no blame."""

_SYSTEM_CHAT = (
    _SYSTEM_BOOMER
    + "\n\n"
    "ASI:One **Chat**: The user message can include two headline blocks from Boomer Browse: "
    "(1) **On-demand topic search** — news results for *this chat* (SerpApi / Google, NewsAPI.org, or NewsData.io per operator config). "
    "(2) **Scheduled poll** — general headlines from the background fetch. "
    "For a specific topic, **prioritize block (1)** when it has items; use (2) only as extra context. "
    "Give 2–4 concrete summaries (titles/topics/sources); not medical advice; not a live ticker. "
    "If they ask for **older days** or a full archive: explain this stack typically uses **latest** feeds only (full archives may need a paid news API plan) "
    "(date-range / archive is usually a paid feature); suggest opening article links or bookmarking trusted health sites — do not invent dates or paywalled content. "
    "If block (1) is empty or has no relevant lines, say the index returned nothing for that search and suggest simpler keywords — still do not refuse because of \"no web\"."
)


def _chat_user_text_with_headlines(user_question: str, *, live_block: str = "") -> str:
    """Prefix chat with optional on-demand topic headlines plus scheduled poll cache."""
    chunks: list[str] = []
    lb = (live_block or "").strip()
    if lb:
        chunks.append(
            "=== Headlines for your topic (on-demand news search, this chat turn) ===\n" + lb
        )
    news = _news_block_for_snapshot().strip()
    if news:
        chunks.append("=== Scheduled headline poll (general; may not match their topic) ===\n" + news)
    if not chunks:
        return user_question
    return "\n\n".join(chunks) + "\n\n=== User question ===\n" + user_question


def _asi_client() -> OpenAI:
    key = (os.environ.get("ASI1_API_KEY") or "").strip()
    if not key:
        raise RuntimeError(
            "Missing ASI1_API_KEY. Create a key at https://asi1.ai/developer and set the env var."
        )
    return OpenAI(base_url=ASI1_BASE_URL, api_key=key)


def _sanitize_utf8_for_asi_api(text: str) -> str:
    """Replace lone surrogates and other unencodable chars so JSON/httpx can UTF-8 encode the body.

    Browser or memory payloads occasionally contain isolated surrogate code points (e.g. \\udc9d),
    which raise UnicodeEncodeError when the OpenAI client serializes messages.
    """
    if not text:
        return text
    return text.encode("utf-8", errors="replace").decode("utf-8")


def _truncate_user_message_for_asi(text: str, logger) -> str:
    if len(text) <= _ASI_USER_MAX:
        return text
    tail = "\n\n[... message truncated for ASI:One size limits; reduce memory_context / NewsAPI block / BOOMER_RESEARCH_BRIEF / loved-one photo payload on Node. ASI_USER_MESSAGE_MAX_CHARS=%s ...]" % (
        _ASI_USER_MAX,
    )
    cut = _ASI_USER_MAX - len(tail)
    if cut < 1000:
        cut = 1000
    out = text[:cut] + tail
    if logger is not None:
        logger.warning(
            "ASI user message truncated: %s chars -> %s (cap ASI_USER_MESSAGE_MAX_CHARS)",
            len(text),
            len(out),
        )
    return out


def _asi_error_detail(exc: BaseException) -> str:
    parts = [str(exc)]
    try:
        b = getattr(exc, "body", None)
        if b is not None:
            parts.append(repr(b)[:800])
    except Exception:
        pass
    try:
        r = getattr(exc, "response", None)
        if r is not None and hasattr(r, "text"):
            parts.append(getattr(r, "text", "")[:400])
    except Exception:
        pass
    return " | ".join(parts)[:2500]


def _call_asi1(
    user_text: str,
    system_prompt: str | None = None,
    logger=None,
) -> str:
    system = _sanitize_utf8_for_asi_api(system_prompt or _SYSTEM_BOOMER)
    user_text = _sanitize_utf8_for_asi_api(
        _truncate_user_message_for_asi(user_text, logger)
    )
    fallback = (
        "Something went wrong talking to ASI:One. Check Agent secrets: ASI1_API_KEY, ASI1_BASE_URL, "
        "ASI1_MODEL; see agent logs for the API error detail. If the message was huge, try ASI_USER_MESSAGE_MAX_CHARS."
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
        return _sanitize_utf8_for_asi_api(str(r.choices[0].message.content or ""))
    except Exception as e:
        if logger is not None:
            # Single string: Agentverse log UI often drops %-format extra args.
            logger.error("ASI1 chat.completions failed — " + _asi_error_detail(e))
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

    await _ensure_headlines_before_chat(ctx)
    live_block = ""
    if _news_chat_ondemand_enabled() and _headlines_env_enabled():
        sq = _newsdata_search_q_from_chat(text)
        if sq:
            live_block, live_diag = await asyncio.to_thread(_fetch_chat_ondemand_topic, sq)
            if live_block:
                ctx.logger.info(
                    "Chat on-demand headlines (%s) q=%r → %s chars"
                    % (_news_headlines_provider(), sq, len(live_block))
                )
            else:
                ctx.logger.info(
                    "Chat on-demand headlines q=%r → no rows (%s)" % (sq, live_diag[:400])
                )
    payload = _chat_user_text_with_headlines(text, live_block=live_block)
    ctx.logger.info(
        "Chat turn: live_chars=%s cached_chars=%s user_chars=%s"
        % (len(live_block.strip()), len(_news_block_for_snapshot().strip()), len(text))
    )
    response = _call_asi1(
        payload,
        system_prompt=_SYSTEM_CHAT,
        logger=ctx.logger,
    )
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
    if _headlines_env_enabled():
        p = _news_headlines_provider()
        prov_map = {"serpapi": "SerpApi (Google)", "newsapi": "NewsAPI.org", "newsdata": "NewsData.io"}
        prov = prov_map.get(p, p)
        ctx.logger.info(
            f"{prov} headlines (primary): poll every {_NEWS_POLL_SECONDS}s, query={_NEWS_QUERY!r}, "
            f"pageSize={_NEWS_PAGE_SIZE}. Auto: SerpApi (SERPAPI_API_KEY), else NewsAPI.org, else NewsData.io — first key wins. "
            f"Override: NEWS_HEADLINES_PROVIDER=serpapi|newsapi|newsdata."
        )
        await _refresh_headlines_cache(ctx)
    else:
        ctx.logger.info(
            "Headlines: disabled (set SERPAPI_API_KEY and/or news keys per fetch-agents README)."
        )


@agent.on_interval(period=_NEWS_POLL_SECONDS)
async def _headlines_interval(_ctx: Context) -> None:
    await _refresh_headlines_cache(_ctx)


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
    news = _news_block_for_snapshot().strip()
    if news:
        base += "\n" + news + "\n"
    # Hosted/local: optional operator-supplied brief (pubmed excerpts, org policy, etc.)
    extra = (os.environ.get("BOOMER_RESEARCH_BRIEF") or "").strip()
    if extra:
        base += (
            "\n--- Extra research / policy brief (operator-supplied via BOOMER_RESEARCH_BRIEF) ---\n"
            + extra
            + "\n"
        )
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
