# Boomer × Fetch.ai — local ASI:One agent (first), then deploy

Perception is a **local uAgent** using the **ASI:One chat protocol** and the same **ASI:One LLM** as the official example. Run it on your machine first; point **Boomer’s `query_bridge`** at the printed `agent1q…` address. Optional **Agentverse mailbox** registers the agent for **ASI:One Chat** (inspector flow).

Official guide (structure matches this repo’s `perception/agent.py`): [Create an ASI:One compatible Agent](https://uagents.fetch.ai/docs/examples/asi-1)

## 0. Local quick start (do this first)

Python **3.10–3.13** (not 3.14). Create a venv, then:

```powershell
py -3.12 -m pip install -r fetch-agents/requirements-perception-local.txt
```

1. Get an **ASI:One API key**: [asi1.ai developer](https://asi1.ai/developer) (see also [ASI:One quickstart](https://docs.asi1.ai/documentation/getting-started/quickstart#step-1-get-your-api-key)).
2. Set a **unique** agent name and seed (stable address across restarts):

```powershell
$env:ASI1_API_KEY="your-key"
$env:BOOMER_AGENT_NAME="Boomer-YourName"
$env:BOOMER_AGENT_SEED="your unique secret phrase do not share"
```

3. Run the agent:

```powershell
py -3.12 fetch-agents/perception/agent.py
```

Copy the **`Starting agent with address: agent1q…`** line.

**Browser shows `{"error": "not found"}` on `http://127.0.0.1:8001/`:** expected — there is no page at `/`. Use **`http://127.0.0.1:8001/agent_info`** (GET) to sanity-check the server, or use the **Agent inspector** URL from the log for mailbox setup.

**Mailbox / 401 / “mailbox not found”:** `BOOMER_MAILBOX=true` only turns mailbox mode on; it does **not** register you with Agentverse. You must complete **Link mailbox** (below) while the agent is running. To use **only** query_bridge on your PC, leave `BOOMER_MAILBOX` unset or run `Remove-Item Env:\BOOMER_MAILBOX` before `py fetch-agents/perception/agent.py`.

**“Not enough funds” / Almanac contract:** Use testnet registration (cheaper / dev): `$env:BOOMER_AGENT_NETWORK="testnet"` before starting the agent.

4. **Boomer bridge** (same machine, while the agent is running):

```powershell
py -3.12 -m pip install -r fetch-agents/requirements-query-bridge.txt
$env:PERCEPTION_AGENT_ADDRESS="agent1q…"   # paste from step 3
echo '{"window_hours":24,"visit_count":5,"unique_hosts":2,"top_host":"example.com","top_host_hits":3,"repeat_ratio":0.6,"who_presses_24h":0,"source":"boomer"}' | py -3.12 fetch-agents/perception/query_bridge.py
```

You should get JSON with `"ok": true` and an ASI:One-generated `user_message`.

### Env reference (`perception/agent.py`)

| Variable | Purpose |
|----------|---------|
| `ASI1_API_KEY` | Required for real LLM replies |
| `BOOMER_AGENT_NAME` | Agent name (default `Boomer-Cognitive`) |
| `BOOMER_AGENT_SEED` | **Change this** — unique seed → stable address |
| `BOOMER_AGENT_PORT` | Local port (default `8001`) |
| `BOOMER_AGENT_ENDPOINT` | Optional. Default when mailbox is off: `http://127.0.0.1:PORT/submit` so Almanac registers and **query_bridge** can reach you. Override if the bridge runs on another host. |
| `BOOMER_MAILBOX` | `true` after inspector mailbox setup; **default unset = false** (local bridge only, no 401 spam) |
| `BOOMER_AGENT_NETWORK` | `mainnet` (default) or `testnet` if you lack mainnet funds for Almanac |
| `ASI1_BASE_URL` | Default `https://api.asi1.ai/v1` |
| `ASI1_MODEL` | Default `asi1` |
| `ASI_USER_MESSAGE_MAX_CHARS` | Optional. Default **95000**. User prompt is truncated beyond this to avoid ASI errors on huge holistic payloads (memory + evidence brief + `BOOMER_RESEARCH_BRIEF`). |
| `BOOMER_RESEARCH_BRIEF` | Optional. Long text / pasted abstract snippets appended to the user message after all lenses (hosted Agent secret). Boomer Node also injects `backend/data/perception-evidence-brief.txt` into `memory_context` on each holistic build. |
| `SERPAPI_API_KEY` | Optional. [SerpApi](https://serpapi.com/manage-api-key) — **Google Search JSON API** ([docs](https://serpapi.com/search-api)). When set, **auto mode uses SerpApi first** for headlines (Google News tab by default). Counts against SerpApi plan credits. |
| `SERPAPI_GOOGLE_NEWS` | Optional. Default **1** — use Google News (`tbm=nws`). Set **0** for general web organic results only. |
| `SERPAPI_HL` / `SERPAPI_GL` | Optional. Google UI language / country (default **en** / **us**). |
| `NEWSDATA_IO_API_KEY` | Optional. [NewsData.io](https://newsdata.io) key (explicit name — avoids confusing with NewsAPI). |
| `NEWSDATA_API_KEY` | Optional. **Legacy / dual-use name:** often stores a [NewsAPI.org](https://newsapi.org/account) key when `NEWS_API_KEY` is unset (common mis-name). It is **only** sent to NewsData.io when `NEWS_HEADLINES_PROVIDER=newsdata`, or when **both** `NEWS_API_KEY` and `NEWSDATA_API_KEY` are set (first = NewsAPI, second = NewsData). If your **only** key is from NewsData.io and you keep it here, set `NEWS_HEADLINES_PROVIDER=newsdata` (or use `NEWSDATA_IO_API_KEY`). |
| `NEWS_API_KEY` | Optional. [NewsAPI.org](https://newsapi.org/account). Free developer plan is **localhost/dev only** per their terms; paid for production. |
| `NEWS_HEADLINES_PROVIDER` | Optional. **`serpapi`**, **`newsapi`**, or **`newsdata`**, or leave unset for **auto**: **SerpApi** → NewsAPI.org → NewsData (first key that resolves). |
| `NEWS_API_POLL_SECONDS` | Optional. Default **86400** (~once/day). Use shorter intervals only if your news plan allows (min 120, max 86400). |
| `NEWS_API_QUERY` | Optional. Default `dementia OR alzheimer OR cognitive health` (both providers). |
| `NEWS_API_PAGE_SIZE` | Optional. Default **5** (max **10**; NewsData free plan allows size 1–10). |
| `NEWS_HEADLINES_MAX_AGE_CHAT_SEC` | Optional. Default **300**. Before each ASI:One **Chat** turn, headlines are re-fetched if the in-memory cache is empty or older than this many seconds (helps hosted runtimes where chat may hit another worker). Set **0** to never refresh on chat (poll interval only). |
| `NEWS_CHAT_ONDEMAND` | Optional. Default **1** (on). When headlines are enabled, chat messages that look like news or health questions trigger an on-demand search (SerpApi / NewsAPI / NewsData per provider order) using the user’s wording. Set **0** to save API credits. |
| `NEWSDATA_Q_MAX_CHARS` | Optional. Default **100** (NewsData free-tier query length). |

**Log shows `ASI1 chat.completions failed`:** Check the **next log line** for the API detail (401 = bad/missing `ASI1_API_KEY`, 400/413 = payload/model). On Agentverse set **Agent Secrets** `ASI1_API_KEY` (and optional `ASI1_BASE_URL` / `ASI1_MODEL` if your ASI tenant differs).

### Link mailbox (first time — fixes 401 / “mailbox not found”)

Do this in order:

1. **`$env:BOOMER_MAILBOX="true"`** and start the agent; leave it running.
2. Open the **Agent inspector** URL from the terminal (Agentverse page that talks to `http://127.0.0.1:YOUR_PORT`).
3. In the browser: if Chrome/Brave asks for **local network access**, allow it — otherwise the inspector cannot reach your agent ([Fetch mailbox docs](https://uagents.fetch.ai/docs/agentverse/mailbox)).
4. Click **Connect** → choose **Mailbox** (not Proxy). Sign in to **Agentverse** if prompted.
5. Watch the agent terminal: you want **`[mailbox]: Successfully registered as mailbox agent in Agentverse`** (and usually `Mailbox access token acquired` instead of 401).

You do **not** need to paste extra code for our `agent.py` — the inspector handshake is enough per the [ASI:One example](https://uagents.fetch.ai/docs/examples/asi-1) and [Mailbox](https://uagents.fetch.ai/docs/agentverse/mailbox) docs.

### ASI:One Chat (after mailbox is linked)

Once registered, keep **`BOOMER_MAILBOX="true"`** and use [ASI:One Chat](https://asi1.ai/chat) / inspector “Chat with Agent” as in the uAgents guide.

---

## 1. Hosted chain: Drift → Perception (or Drift → Memory → Perception)

**Boomer Node** sets **`AGENTVERSE_PERCEPTION_ADDRESS`** to the **Drift** agent’s `agent1q…` (entry). On **Agentverse**, create secrets on the **Drift** agent:

| Secret | Value |
|--------|--------|
| **`PERCEPTION_AGENT_ADDRESS`** | **Perception** agent `agent1q…` (ASI:One). Required for Perception fallback if **Memory** is enabled; used directly when Memory is **not** set. |
| **`MEMORY_AGENT_ADDRESS`** | Optional. **Boomer Memory** agent `agent1q…` (`fetch-agents/memory/agent.py`). When set: Drift → Memory (narrative synthesis) → Perception. |
| **`BOOMER_MEMORY_TIMEOUT_SEC`** | Optional. Default **45**. Max time Drift waits for the Memory hop (Memory internally calls Perception with its own timeout). |
| **`BOOMER_PERCEPTION_TIMEOUT_SEC`** | Optional. Default **42**. Max time Drift waits for Perception when Memory is **off**, or after Memory fails. Keep total chain **under** Agentverse’s hosted submit limit (~60s) or you get **408**. |

**Memory agent secrets** (on the Memory agent, not Drift):

| Secret | Value |
|--------|--------|
| **`ASI1_API_KEY`** | ASI:One key (Memory-only system prompt; enriches `memory_context` before Perception). |
| **`PERCEPTION_AGENT_ADDRESS`** | Same Perception `agent1q…` as in the Drift row. |
| **`BOOMER_PERCEPTION_TIMEOUT_SEC`** | Optional. Default **42**. Wait for Perception after Memory synthesis. |

Flow without Memory: `SnapshotMsg` → **Drift** (enriches `drift_context`) → **Perception** → **`CognitiveOut`** → caller.

Flow with Memory: **Drift** → **Memory** (ASI synthesis appended to `memory_context`; **does not** embed raw drift metrics in the Memory ASI prompt) → **Perception** → **`CognitiveOut`** → Drift → caller.

**408 / dispenser:** The chain is deeper with Memory; reduce timeouts, ensure all three agents are **Running**, or temporarily unset **`MEMORY_AGENT_ADDRESS`** to test **Drift → Perception** only.

**`Message must be sent from verified agent address`:** Hosted runtimes often register `SnapshotMsg` on the **signed** handler path, which **rejects** `user…` senders from the bridge. The repo **`query_bridge.py` defaults to a signing `Identity`** (ephemeral agent + signed envelope), which matches that path. To force the old behavior (user sender), set **`BOOMER_QUERY_USER_SENDER=1`** (works best when the target agent uses **`allow_unverified=True`**). Optionally set **`BOOMER_QUERY_AGENT_SEED`** for a stable bridge sender address.

If **`PERCEPTION_AGENT_ADDRESS`** is unset, Drift falls back to **Guardian** (`GUARDIAN_AGENT_ADDRESS` + `DriftResult`) or **drift-only** `CognitiveOut`. If **`PERCEPTION_AGENT_ADDRESS`** is set, Guardian is **not** used for that request.

## 2. Optional: Drift → Guardian only

**Drift** + **Guardian** (`drift/agent.py`, `guardian/agent.py`) without Perception: leave **`PERCEPTION_AGENT_ADDRESS`** unset; set **`GUARDIAN_AGENT_ADDRESS`** on Drift.

The checked-in **`perception/agent.py`** is the **local** ASI:One variant (chat protocol + `on_query` for Boomer). Hosting Perception on Agentverse **Build** needs whatever dependency list Agentverse expects for **`openai`** and secrets for **`ASI1_API_KEY`** (see ASI:One docs). Redeploy Perception when the holistic prompt changes (e.g. qualitative blocks + **Support intensity** line in `[[NOTE]]`) so the dashboard can parse `supportIntensity`.

**Hosted note:** `perception/agent.py` skips loading `backend/.env` when `__file__` is missing (Agentverse runner). Set **`ASI1_API_KEY`** as **Agent Secrets**, not files.

Earlier troubleshooting notes (hosted submit `500`, digest alignment) apply to hosted paths.

---

## Model contract (keep in sync)

`SnapshotMsg` (optional `drift_context`, `memory_context`, `browser_context`, `physical_context`) and `CognitiveOut` **must match** across `perception/agent.py`, `perception/query_bridge.py`, `drift/agent.py`, `memory/agent.py`, and `guardian/agent.py`.  
After changing them, restart the local agents so **schema digests** match the bridge.

Boomer’s Node server builds those contexts in `backend/src/fetchHolisticContext.js` and sends one holistic envelope per `/cognitive/agentverse` call (short TTL cache via `FETCH_HOLISTIC_CACHE_MS`, default 90s).

`DriftResult` remains in the Drift/Guardian pair for the optional hosted chain.

## References

- [ASI:One example (chat protocol)](https://uagents.fetch.ai/docs/examples/asi-1)
- [uAgents install](https://uagents.fetch.ai/docs/getting-started/install)
- [Mailbox](https://uagents.fetch.ai/docs/agentverse/mailbox)
- [Hosted agents quickstart](https://agentverse.ai/docs/quickstart)
