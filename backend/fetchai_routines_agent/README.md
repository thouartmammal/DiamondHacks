# Routines agent (stub)

Optional HTTP service for **`FETCHAI_ROUTINES_AGENT_URL`**. The Boomer backend POSTs:

```json
{
  "context": {
    "personalitySnippet": "...",
    "hoursOnline": 0,
    "memorySlipsLast14Days": 0,
    "averageMediaMood": 0,
    "perceivedSelfAge": 55,
    "mediaAgeBand": "adult"
  },
  "physicalSnapshot": {
    "perceivedSelfAge": 55,
    "averageMediaMood": 0,
    "averageMediaMoodLabel": "...",
    "mediaAgeBand": "adult",
    "estimatedContentAgeYears": null
  }
}
```

Respond with JSON that includes **`caregiverHealth.negotiatedSummaryForProvider`** (single clinician-facing memo after simulated agent negotiation). Optional: `disclaimer`, `providerQuestions`. Legacy responses with **`caregiverHealth.negotiation`** (`engagementAgent`, `safeguardsAgent`, `moderatorNote`) are still accepted and folded into one note by `normalizeRoutinesAgentResponse` in `backend/src/fetchAiRoutinesBridge.js`.

## Run locally

```bash
cd backend/fetchai_routines_agent
python main.py
```

Default port **8098** (`ROUTINES_AGENT_PORT` to override). In `backend/.env`:

```env
FETCHAI_ROUTINES_AGENT_URL=http://127.0.0.1:8098/
# optional: FETCHAI_ROUTINES_API_KEY=...
```

If the URL is unset, Node uses **local negotiation** in `routinesAnalysis.js` (no Python required).

## Related: routine tab flow (Node-only)

`GET http://127.0.0.1:3001/routine/flow` mines up to **5** destinations from **`activity.db`** when present (`BOOMER_ACTIVITY_DB` or `backend/data/activity.db`), else from **JSON** visits. Used for **“Open my routine”** in the app and the Vapi tool `open_my_routine`. See `backend/src/routineFlowService.js`.
