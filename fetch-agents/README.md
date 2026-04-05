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

## 1. Hosted chain: Drift → Perception (recommended)

**Boomer Node** sets **`AGENTVERSE_PERCEPTION_ADDRESS`** to the **Drift** agent’s `agent1q…` (entry). On **Agentverse**, create secrets on the **Drift** agent:

| Secret | Value |
|--------|--------|
| **`PERCEPTION_AGENT_ADDRESS`** | Hosted or local **Perception** agent `agent1q…` (ASI:One). |
| **`BOOMER_PERCEPTION_TIMEOUT_SEC`** | Optional. Default **42**. Max time Drift waits for Perception/ASI; must stay **under** Agentverse’s hosted submit limit (~60s) or you get **408** `Timed out waiting for agent response`. |

Flow: `query_bridge` sends **`SnapshotMsg`** → **Drift** (scores drift, appends a short hosted-drift line to `drift_context`) → **`send_and_receive`** → **Perception** → **`CognitiveOut`** back through Drift to the bridge. No Node change beyond pointing the env at Drift.

**408 / dispenser:** If stderr shows `[dispenser]: … 408 … Timed out waiting for agent response`, the **Drift** handler did not finish before hosting cut it off—usually Perception/ASI was slow. Lower **`BOOMER_PERCEPTION_TIMEOUT_SEC`** on Drift (e.g. **35**), speed up ASI, ensure **both** agents show **Running**, or temporarily set **`AGENTVERSE_PERCEPTION_ADDRESS`** to **Perception** only (skip Drift) to confirm the rest of the stack.

**`Message must be sent from verified agent address`:** Hosted runtimes often register `SnapshotMsg` on the **signed** handler path, which **rejects** `user…` senders from the bridge. The repo **`query_bridge.py` defaults to a signing `Identity`** (ephemeral agent + signed envelope), which matches that path. To force the old behavior (user sender), set **`BOOMER_QUERY_USER_SENDER=1`** (works best when the target agent uses **`allow_unverified=True`**). Optionally set **`BOOMER_QUERY_AGENT_SEED`** for a stable bridge sender address.

If **`PERCEPTION_AGENT_ADDRESS`** is unset, Drift falls back to **Guardian** (`GUARDIAN_AGENT_ADDRESS` + `DriftResult`) or **drift-only** `CognitiveOut`. If **`PERCEPTION_AGENT_ADDRESS`** is set, Guardian is **not** used for that request.

## 2. Optional: Drift → Guardian only

**Drift** + **Guardian** (`drift/agent.py`, `guardian/agent.py`) without Perception: leave **`PERCEPTION_AGENT_ADDRESS`** unset; set **`GUARDIAN_AGENT_ADDRESS`** on Drift.

The checked-in **`perception/agent.py`** is the **local** ASI:One variant (chat protocol + `on_query` for Boomer). Hosting Perception on Agentverse **Build** needs whatever dependency list Agentverse expects for **`openai`** and secrets for **`ASI1_API_KEY`** (see ASI:One docs).

**Hosted note:** `perception/agent.py` skips loading `backend/.env` when `__file__` is missing (Agentverse runner). Set **`ASI1_API_KEY`** as **Agent Secrets**, not files.

Earlier troubleshooting notes (hosted submit `500`, digest alignment) apply to hosted paths.

---

## Model contract (keep in sync)

`SnapshotMsg` (optional `drift_context`, `memory_context`, `browser_context`, `physical_context`) and `CognitiveOut` **must match** across `perception/agent.py`, `perception/query_bridge.py`, `drift/agent.py`, and `guardian/agent.py`.  
After changing them, restart the local perception agent so **schema digests** match the bridge.

Boomer’s Node server builds those contexts in `backend/src/fetchHolisticContext.js` and sends one holistic envelope per `/cognitive/agentverse` call (short TTL cache via `FETCH_HOLISTIC_CACHE_MS`, default 90s).

`DriftResult` remains in the Drift/Guardian pair for the optional hosted chain.

## References

- [ASI:One example (chat protocol)](https://uagents.fetch.ai/docs/examples/asi-1)
- [uAgents install](https://uagents.fetch.ai/docs/getting-started/install)
- [Mailbox](https://uagents.fetch.ai/docs/agentverse/mailbox)
- [Hosted agents quickstart](https://agentverse.ai/docs/quickstart)
