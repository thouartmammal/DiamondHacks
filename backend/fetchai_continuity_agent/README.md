# Memory Anchor agent (Boomer Browse)

This service answers: **“Does this message fit what Boomer actually remembers?”**  
Memory (`recent_reality` from the Node backend) is the **only** ground truth for user history in the prompt.

## Behavior

1. **`memory_anchor_agent.py`** (default path when `OPENAI_API_KEY` is set)  
   - Calls **OpenAI-compatible** `chat/completions` with a strict system prompt: compare claims to `recent_reality`, output JSON (`status`, `headline`, `pitch`, `conflicts`, `reminders`, `source: "memory-anchor"`).  
   - Does **not** invent visits or purchases.

2. **Fallback:** `continuity_engine.py` (rule-based), same contract, `source: "local-rules"`.

3. Point Boomer’s backend at this service:

```bash
FETCHAI_CONTINUITY_AGENT_URL=http://127.0.0.1:8099/v1/continuity
```

## Environment (LLM)

```bash
OPENAI_API_KEY=sk-...
# optional
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1   # or compatible proxy
MEMORY_ANCHOR_USE_LLM=true                # set false to force rules only
```

---

## Legacy title: Fetch.ai / Agentverse

You can still deploy the same HTTP contract behind **Agentverse** as your Fetch.ai agent endpoint:

- Run it locally for demos, or expose it via **Agentverse** / your **ASI** workflow as the tool URL.
- Point the Boomer backend at it with:

```bash
# In backend/.env (or shell)
FETCHAI_CONTINUITY_AGENT_URL=http://127.0.0.1:8099/v1/continuity
```

Optionally:

```bash
FETCHAI_CONTINUITY_API_KEY=...   # sent as Authorization: Bearer … if set
```

## Run

```bash
cd backend/fetchai_continuity_agent
pip install -r requirements.txt
python main.py
```

Defaults: `127.0.0.1:8099`. Override with `CONTINUITY_AGENT_HOST`, `CONTINUITY_AGENT_PORT`.

## Contract

`POST /v1/continuity` with JSON:

```json
{
  "message": "page or message text",
  "pageUrl": "https://optional/current-tab",
  "recentReality": { "...": "from Boomer GET /continuity/reality" }
}
```

Response (Boomer re-attaches `recentReality`):

```json
{
  "status": "ok | conflict | uncertain",
  "headline": "...",
  "pitch": "...",
  "conflicts": [],
  "reminders": [],
  "source": "fetch-ai"
}
```

## Fetch.ai / Agentverse

Register this URL (or a reverse proxy to it) as your agent’s HTTP action. The Boomer app **orchestrates**: it builds `recentReality` from local logs and sends it to your **Fetch.ai–connected** endpoint for a consistency verdict.
