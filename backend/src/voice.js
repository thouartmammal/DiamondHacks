import "./loadEnv.js";
import cors from "cors";
import express from "express";
import { spawn } from "child_process";
import path from "path";
import os from "node:os";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { constants as fsConstants } from "fs";
import { readFile, writeFile, mkdir, access } from "fs/promises";
import nodemailer from "nodemailer";
import memoryRoutes from "./memoryRoutes.js";
import continuityRoutes from "./continuityRoutes.js";
import remindersRoutes from "./remindersRoutes.js";
import { appendPageScan } from "./extensionScanStore.js";
import { buildFamilyMatchDisplay } from "./lovedOnesScanMatch.js";
import { matchFamilyByFace } from "./faceMatchRunner.js";
import { matchFamilyWithOpenAI } from "./whoOpenAIMatch.js";
import {
  addVisit,
  listVisits,
  recordUsagePing,
  recordBrowserAutomationComplete,
  getDashboard,
} from "./activityStore.js";
import { getPhysicalActivityDashboard } from "./physicalActivityStore.js";
import {
  addWhoPress,
  getLoggedMediaEpisodeUrl,
  getNarrative,
  parseEpisodeFromText,
} from "./memoryStore.js";
import {
  analyzeRoutinesCaregiverNegotiation,
  getRoutinesNegotiationContext,
} from "./routinesAnalysis.js";
import { getRoutineFlow } from "./routineFlowService.js";
import { isBrowserUseCloudEnabled, runBrowserTaskCloud } from "./browserUseCloud.js";
import { friendlyLineLocalTick } from "./browserProgressMessages.js";
import {
  buildCognitiveSnapshot,
  buildCognitiveSnapshotWithDrift,
} from "./cognitiveSnapshot.js";
import {
  buildHolisticCognitiveSnapshot,
  formatHolisticPayloadForVapiVariable,
  getHolisticCache,
  peekHolisticCacheForReport,
  parseFetchInsightSections,
  setHolisticCache,
} from "./fetchHolisticContext.js";
import { postCognitiveSnapshot, isCognitiveAgentConfigured } from "./agentverseClient.js";
import { fetchResearchNewsBrief } from "./researchNewsBrief.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function faceMatchNudgeFromReason(reason) {
  const map = {
    no_capture:
      "We need a fresh picture of this tab. Close this window, open it again, and tap Remember this page.",
    no_portraits:
      "Add a clear face photo for each person under Loved ones in the main app. Matching uses your photos, not names from the page.",
    deepface_not_installed:
      "Face matching isn’t set up on this computer yet. Ask whoever helps you with Boomer to finish the face-matching setup in the Boomer folder.",
    python_unavailable:
      "This computer needs a small extra piece of software for face matching, or your helper can turn that off in Boomer’s settings.",
    no_face_match:
      "We didn’t match a face this time. Try a larger face on screen, good light, and a similar photo in Loved ones.",
    face_timeout:
      "Face matching took too long (the first try can be slow). Try again in a moment.",
    bad_viewport: "We couldn’t use a picture of this tab. Try again.",
    bad_output: "Something went wrong with face matching. Try again.",
    face_script_failed:
      "Face matching couldn’t run. Ask whoever set up Boomer to check that the extra face-matching setup is complete.",
    face_engine_error: "Face matching couldn’t start. Try again later.",
    bad_input: "Something went wrong with the picture we received.",
    exception: "Something went wrong with face matching. Try again.",
  };
  return map[reason] ?? null;
}

// --- Persistent Python browser worker ---
let workerProc = null;
let workerReady = false;
const pendingTasks = new Map(); // taskId -> { resolve, reject }
let taskCounter = 0;
let workerRestartCount = 0;
let workerRestartWindowStart = Date.now();
let workerStopped = false;

function startWorker() {
  if (workerStopped) return;

  const scriptPath = path.join(__dirname, "browser_worker.py");
  const py =
    process.env.PYTHON_BROWSER_WORKER ||
    (process.platform === "win32" ? "python" : "python3");
  workerProc = spawn(py, [scriptPath], {
    env: { ...process.env },
    stdio: ["pipe", "pipe", "inherit"],
  });

  const rl = createInterface({ input: workerProc.stdout });
  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.status === "ready") {
        workerReady = true;
        workerRestartCount = 0;
        console.log("Browser worker ready");
        return;
      }
      // Match response to pending task (FIFO)
      const [firstKey] = pendingTasks.keys();
      if (firstKey !== undefined) {
        const { resolve, reject } = pendingTasks.get(firstKey);
        pendingTasks.delete(firstKey);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.output ?? "(done)");
      }
    } catch {}
  });

  workerProc.on("exit", (code) => {
    console.warn(`Browser worker exited (${code}), restarting...`);
    workerReady = false;
    for (const { reject } of pendingTasks.values()) {
      reject(new Error("Worker restarted"));
    }
    pendingTasks.clear();

    const now = Date.now();
    if (now - workerRestartWindowStart > 60_000) {
      workerRestartWindowStart = now;
      workerRestartCount = 0;
    }
    workerRestartCount += 1;
    if (workerRestartCount >= 6) {
      workerStopped = true;
      console.error(
        "[browser_worker] Stopped after repeated crashes. From the backend folder run: pip install -r requirements-worker.txt " +
          "with the same Python Node uses (set PYTHON_BROWSER_WORKER to that python.exe if needed). " +
          "Or set SKIP_BROWSER_WORKER=1 to run without browser automation.",
      );
      return;
    }
    setTimeout(startWorker, 2000);
  });

  workerProc.on("error", (err) => {
    console.error("Worker process error:", err);
  });
}

function runBrowserTask(task) {
  return new Promise((resolve, reject) => {
    if (!workerProc || !workerReady) {
      reject(new Error("Browser worker not ready yet"));
      return;
    }
    const id = ++taskCounter;
    pendingTasks.set(id, { resolve, reject });
    workerProc.stdin.write(JSON.stringify({ task }) + "\n");
  });
}

/**
 * @param {string} task
 * @param {{ onProgress?: (message: string) => void }} [opts]
 */
async function runBrowserAutomationTask(task, opts = {}) {
  if (isBrowserUseCloudEnabled()) {
    return runBrowserTaskCloud(task, opts);
  }
  return runBrowserTask(task);
}

// Start worker on boot (optional; see requirements-worker.txt). Cloud API skips local Playwright worker.
if (process.env.SKIP_BROWSER_WORKER === "1" || isBrowserUseCloudEnabled()) {
  workerStopped = true;
  if (isBrowserUseCloudEnabled()) {
    console.log("[browser] Browser Use Cloud enabled (BROWSER_USE_API_KEY). Local browser worker not started.");
  } else {
    console.warn("[browser_worker] SKIP_BROWSER_WORKER=1 — automation worker not started.");
  }
} else {
  startWorker();
}

const app = express();
// Chrome extensions use a "private network request" to loopback; browsers may send a PNA preflight.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  next();
});
app.use(
  cors({
    origin: true,
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Access-Control-Request-Private-Network"],
  }),
);
/** Loved-one profiles may include base64 photos (often 5–15MB JSON per save). */
app.use(express.json({ limit: "40mb" }));
// Declare UTF-8 so clients never mis-decode JSON (avoids "â€"" mojibake for "—" etc.)
app.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return send(body);
  };
  next();
});
// Accept /api/* as well as /* (Vite proxy strips /api; some clients call the backend with full prefix.)
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) {
    req.url = req.url.slice(4);
  } else if (req.url === "/api") {
    req.url = "/";
  }
  next();
});
app.use("/memory", memoryRoutes);
app.use("/continuity", continuityRoutes);
app.use("/reminders", remindersRoutes);

// Track URL visits from the browser extension
app.post("/activity", async (req, res) => {
  try {
    const { url, title, visitedAt } = req.body ?? {};
    if (!url) { res.status(400).json({ error: "url required" }); return; }
    const visit = await addVisit({ url, title, visitedAt });
    res.json({ visit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Quick health check for the browser extension (same port as /loved-ones). */
app.get("/extension/ping", (_req, res) => {
  res.json({ ok: true, service: "boomer-voice" });
});

/** "Who?" button press from the extension — records a face/name recognition signal. */
app.post("/extension/who-press", async (req, res) => {
  try {
    const body = req.body ?? {};
    const press = await addWhoPress({
      url: body.url || "",
      title: body.title || "",
    });
    res.json({ ok: true, id: press.id });
  } catch (err) {
    console.error("[who-press]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

/** Full-page text snapshots from the extension (manual scan or optional auto mode). */
app.post("/extension/page-scan", async (req, res) => {
  try {
    const body = req.body ?? {};
    const mode =
      body.mode === "auto" ? "auto" : body.mode === "who" ? "who" : "manual";
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    const title = typeof body.title === "string" ? body.title : "";
    const textPreview = typeof body.textPreview === "string" ? body.textPreview : "";
    const viewportCapture =
      typeof body.viewportCapture === "string" && body.viewportCapture.startsWith("data:image")
        ? body.viewportCapture
        : null;
    const url = rawUrl || "(unknown)";
    if (!rawUrl && !textPreview.trim() && !viewportCapture) {
      res.status(400).json({ error: "Need page URL, text, or a screenshot" });
      return;
    }

    const t0 = Date.now();
    console.log(
      `[page-scan] ${mode} url=${url.slice(0, 120)} textLen=${textPreview.length} viewport=${viewportCapture ? viewportCapture.length : 0}`,
    );

    await appendPageScan({ url: rawUrl || url, title, textPreview, mode });

    let familyMatch = null;
    let familyMatchNudge = null;
    try {
      const loved = await readLovedOnes();

      if (mode === "who") {
        const ai = await matchFamilyWithOpenAI({
          viewportCapture,
          textPreview,
          pageTitle: title,
          pageUrl: rawUrl || url,
          loved,
        });
        if (ai.ok && "familyMatch" in ai && ai.familyMatch) {
          familyMatch = ai.familyMatch;
          console.log(`[page-scan] openai who-match in ${Date.now() - t0}ms`);
        } else if (ai.ok && "noMatch" in ai && ai.noMatch && ai.nudge) {
          familyMatchNudge = ai.nudge;
          console.log(`[page-scan] openai who no-match in ${Date.now() - t0}ms`);
        } else if (!ai.ok) {
          if (ai.reason === "no_openai_key") {
            familyMatchNudge =
              'Who? uses OpenAI to compare what you see to your Loved ones list. Add OPENAI_API_KEY to your Boomer backend .env file (see .env.example), restart the voice server (npm run voice), and try again. DeepFace is not used for this button.';
          } else if (ai.reason === "no_family") {
            familyMatchNudge =
              "Add people to Loved ones in the Boomer app first, then try Who? again.";
          } else if (ai.reason === "insufficient_input") {
            familyMatchNudge =
              "We couldn't read enough from this page. Scroll so faces or names are visible, then tap Who? again.";
          } else {
            console.warn(`[page-scan] openai who failed: ${ai.reason}`);
            familyMatchNudge =
              "Could not compare this page to your family list right now. Check OPENAI_API_KEY and try again.";
          }
        }
      } else if (!familyMatch) {
        const faceResult = await matchFamilyByFace(viewportCapture, loved);
        const ms = Date.now() - t0;
        console.log(`[page-scan] face done in ${ms}ms reason=${faceResult.reason ?? "ok"}`);
        if (faceResult.match && typeof faceResult.match === "object") {
          const raw = { ...faceResult.match };
          delete raw._faceDistance;
          familyMatch = buildFamilyMatchDisplay(raw);
        } else if (!familyMatchNudge) {
          if (faceResult.reason === "skipped") {
            familyMatchNudge =
              "Face photo matching is turned off on this computer. Ask whoever set up Boomer if you want that feature on.";
          } else if (faceResult.reason) {
            familyMatchNudge = faceMatchNudgeFromReason(faceResult.reason);
          }
        }
      }
    } catch (e) {
      console.error("[page-scan] face/loved-ones error:", e?.message ?? e);
    }

    res.json({
      ok: true,
      mode,
      savedChars: textPreview.length,
      familyMatch,
      familyMatchNudge,
    });
  } catch (err) {
    console.error("[page-scan] failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

// List recent activity
app.get("/activity", async (req, res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const search = req.query.search ? String(req.query.search) : undefined;
    const visits = await listVisits({ limit, search });
    res.json({ visits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Usage heartbeat while the app tab is active (for “hours online”)
app.post("/usage/ping", async (req, res) => {
  try {
    const deltaMs = Number(req.body?.deltaMs) || 0;
    await recordUsagePing(deltaMs);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

// Dashboard: favorites, personality blurb, time stats
app.get("/dashboard", async (_req, res) => {
  try {
    const data = await getDashboard();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

/**
 * Fetch.ai holistic insight: browsing + baseline/drift + memory narrative + browser heuristics + wellness.
 * Query: window_hours (default 24), refresh=1 bypasses short server cache.
 */
app.get("/cognitive/agentverse", async (req, res) => {
  try {
    const windowHours =
      req.query.window_hours != null ? Number(req.query.window_hours) : 24;
    const bypassCache = req.query.refresh === "1" || req.query.refresh === "true";
    const ttl = Number(process.env.FETCH_HOLISTIC_CACHE_MS || 90000);
    if (!bypassCache && ttl > 0) {
      const cached = getHolisticCache(ttl);
      if (cached) {
        res.json({ ...cached, cached: true });
        return;
      }
    }
    const [bundle, researchNews] = await Promise.all([
      buildHolisticCognitiveSnapshot({ windowHours }),
      fetchResearchNewsBrief(),
    ]);
    const agentverse = await postCognitiveSnapshot(bundle.snapshot);
    let parsed = null;
    if (agentverse.ok && agentverse.data && typeof agentverse.data.user_message === "string") {
      parsed = parseFetchInsightSections(agentverse.data.user_message);
    }
    const payload = {
      snapshot: bundle.snapshot,
      baseline: bundle.baseline,
      drift: bundle.drift,
      agentverse,
      researchNews,
      sections: parsed ? parsed.sections : null,
      insightUnparsed: parsed ? Boolean(parsed.unparsed) : null,
      supportIntensity: parsed?.supportIntensity ?? null,
      cognitiveAgentConfigured: isCognitiveAgentConfigured(),
    };
    if (ttl > 0) setHolisticCache(payload);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

/**
 * POST body: optional window_hours, or a full manual SnapshotMsg-shaped object
 * (top_host, visit_count, repeat_ratio, …) for demos without local activity data.
 */
app.post("/cognitive/agentverse/analyze", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const hasManualShape =
      typeof body.top_host === "string" &&
      Number.isFinite(Number(body.visit_count)) &&
      Number.isFinite(Number(body.repeat_ratio));
    let baseline = null;
    let drift = null;
    const snapshot = hasManualShape
      ? {
          window_hours: Math.max(1, Math.min(168, Number(body.window_hours) || 24)),
          visit_count: Math.max(0, Math.floor(Number(body.visit_count))),
          unique_hosts: Math.max(0, Math.floor(Number(body.unique_hosts) || 0)),
          top_host: body.top_host,
          top_host_hits: Math.max(0, Math.floor(Number(body.top_host_hits) || 0)),
          repeat_ratio: Math.max(0, Number(body.repeat_ratio)),
          who_presses_24h: Math.max(0, Math.floor(Number(body.who_presses_24h) || 0)),
          source: "boomer",
          drift_context:
            typeof body.drift_context === "string" ? body.drift_context : "",
          memory_context:
            typeof body.memory_context === "string" ? body.memory_context : "",
          browser_context:
            typeof body.browser_context === "string" ? body.browser_context : "",
          physical_context:
            typeof body.physical_context === "string" ? body.physical_context : "",
        }
      : await (async () => {
          const bundle = await buildHolisticCognitiveSnapshot({
            windowHours:
              body.window_hours != null ? Number(body.window_hours) : 24,
          });
          baseline = bundle.baseline;
          drift = bundle.drift;
          return bundle.snapshot;
        })();
    const researchNewsPromise = fetchResearchNewsBrief();
    const agentverse = await postCognitiveSnapshot(snapshot);
    const researchNews = await researchNewsPromise;
    let parsed = null;
    if (agentverse.ok && agentverse.data && typeof agentverse.data.user_message === "string") {
      parsed = parseFetchInsightSections(agentverse.data.user_message);
    }
    res.json({
      snapshot,
      baseline,
      drift,
      agentverse,
      researchNews,
      sections: parsed ? parsed.sections : null,
      insightUnparsed: parsed ? Boolean(parsed.unparsed) : null,
      supportIntensity: parsed?.supportIntensity ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

// Physical Activity: perceived age, media mood/age, mood & memory time series
app.get("/physical-activity", async (_req, res) => {
  try {
    const data = await getPhysicalActivityDashboard();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

/** Live metrics + data-driven agent dialogue lines for the negotiation modal (same DBs as analyze). */
app.get("/routines/metrics", async (_req, res) => {
  try {
    const data = await getRoutinesNegotiationContext();
    res.json(data);
  } catch (err) {
    console.error("[routines/metrics]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

/** Two-perspective wellness summary (remote agent if configured, else local copy from real metrics). */
app.post("/routines/analyze", async (_req, res) => {
  try {
    const data = await analyzeRoutinesCaregiverNegotiation();
    res.json(data);
  } catch (err) {
    console.error("[routines/analyze]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

/** Pattern-mined routine: up to 5 sites from activity.db (if present) else JSON visits. */
app.get("/routine/flow", async (_req, res) => {
  try {
    const data = await getRoutineFlow();
    res.json(data);
  } catch (err) {
    console.error("[routine/flow]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

// Loved ones CRUD — bundled sample data + writable copy under BOOMER_USER_DATA (Electron userData)
const LOVED_ONES_TOUCHED = "loved-ones.touched";

/** Strip UTF-8 BOM so JSON.parse works (some editors save loved-ones.json with BOM). */
function parseJsonUtf8(raw) {
  return JSON.parse(String(raw).replace(/^\uFEFF/, ""));
}

const lovedOnesBundledPath = () => path.join(__dirname, "..", "data", "loved-ones.json");

/**
 * Writable loved-ones store. Matches Electron (`BOOMER_USER_DATA` = app.getPath("userData"))
 * so `npm run voice` / `dev:all` see the same photos as the desktop app.
 * When env is unset: Windows %APPDATA%\\Boomer Browse, macOS Application Support, Linux .config.
 */
function boomerUserDataRoot() {
  if (process.env.BOOMER_USER_DATA) return process.env.BOOMER_USER_DATA;
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Boomer Browse");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Boomer Browse");
  }
  return path.join(home, ".config", "Boomer Browse");
}

const lovedOnesStoragePath = () => path.join(boomerUserDataRoot(), "loved-ones.json");

function lovedOnesTouchedPath() {
  return path.join(boomerUserDataRoot(), LOVED_ONES_TOUCHED);
}

async function userHasEditedLovedOnes() {
  try {
    await access(lovedOnesTouchedPath(), fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function markLovedOnesUserEdited() {
  try {
    await writeFile(lovedOnesTouchedPath(), "1", "utf8");
  } catch (e) {
    console.warn("markLovedOnesUserEdited:", e);
  }
}

async function readBundledLovedOnesSample() {
  try {
    const raw = await readFile(lovedOnesBundledPath(), "utf8");
    const data = parseJsonUtf8(raw);
    if (!Array.isArray(data.people) || data.people.length === 0) return null;
    return data;
  } catch (e) {
    console.warn("[loved-ones] bundled sample unreadable:", lovedOnesBundledPath(), e?.message ?? e);
    return null;
  }
}

async function seedFromBundledToStorage() {
  const data = await readBundledLovedOnesSample();
  if (!data) return { people: [] };
  await writeLovedOnes(data);
  console.log("[loved-ones] seeded", data.people.length, "people from bundle →", lovedOnesStoragePath());
  return data;
}

async function readLovedOnes() {
  const storage = lovedOnesStoragePath();
  let data;
  try {
    data = parseJsonUtf8(await readFile(storage, "utf8"));
  } catch {
    data = null;
  }

  if (!data || !Array.isArray(data.people)) {
    try {
      const legacy = parseJsonUtf8(await readFile(lovedOnesBundledPath(), "utf8"));
      if (legacy && Array.isArray(legacy.people) && legacy.people.length > 0) {
        await writeLovedOnes(legacy);
        console.log("[loved-ones] migrated repo data/loved-ones.json →", storage);
        return legacy;
      }
    } catch {
      /* no legacy sample */
    }
    return seedFromBundledToStorage();
  }

  if (data.people.length === 0 && !(await userHasEditedLovedOnes())) {
    const sample = await readBundledLovedOnesSample();
    if (sample) {
      await writeLovedOnes(sample);
      console.log("[loved-ones] replaced empty store with bundle sample →", storage);
      return sample;
    }
  }

  return data;
}
async function writeLovedOnes(data) {
  const p = lovedOnesStoragePath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

app.get("/loved-ones", async (_req, res) => {
  res.json(await readLovedOnes());
});

app.post("/loved-ones", async (req, res) => {
  const data = await readLovedOnes();
  const person = { id: Date.now().toString(), ...req.body };
  data.people.push(person);
  await writeLovedOnes(data);
  await markLovedOnesUserEdited();
  res.json(person);
});

app.put("/loved-ones/:id", async (req, res) => {
  const data = await readLovedOnes();
  const want = String(req.params.id);
  const idx = data.people.findIndex(p => String(p.id) === want);
  if (idx === -1) { res.status(404).json({ error: "not found" }); return; }
  const merged = { ...data.people[idx], ...req.body };
  if (!Array.isArray(merged.parentIds)) merged.parentIds = [];
  data.people[idx] = merged;
  await writeLovedOnes(data);
  await markLovedOnesUserEdited();
  res.json(data.people[idx]);
});

app.delete("/loved-ones/:id", async (req, res) => {
  const data = await readLovedOnes();
  const want = String(req.params.id);
  data.people = data.people.filter(p => String(p.id) !== want);
  await writeLovedOnes(data);
  await markLovedOnesUserEdited();
  res.json({ ok: true });
});

let wakeWordDetected = false;

// Wake word endpoint — called by Python listener when "hi boomer" is detected
app.post("/wake-word", (_req, res) => {
  res.json({ ok: true });
  // Notify the frontend via SSE or polling — use a simple flag
  wakeWordDetected = true;
  setTimeout(() => { wakeWordDetected = false; }, 3000);
});

app.get("/wake-word-poll", (_req, res) => {
  res.json({ detected: wakeWordDetected });
});

// Get/save email settings
app.get("/settings", (_req, res) => {
  res.json({
    emailFrom: process.env.EMAIL_FROM || "",
    healthcareEmail: process.env.HEALTHCARE_EMAIL || "",
  });
});

/** Gmail app passwords are 16 chars; users often paste with spaces — SMTP expects none. */
function normalizeSmtpPassword(pass) {
  if (pass == null || typeof pass !== "string") return "";
  return pass.replace(/\s+/g, "").trim();
}

function formatSendReportSmtpError(err) {
  const raw =
    err && typeof err === "object" && "response" in err && err.response
      ? String(err.response)
      : err instanceof Error
        ? err.message
        : String(err);
  if (
    /535|5\.7\.8|Invalid login|BadCredentials|Username and Password not accepted|authentication failed/i.test(
      raw,
    )
  ) {
    return [
      "Gmail rejected the login (535). Fix it with these checks:",
      "1) Turn on 2-Step Verification for the sender Google account.",
      '2) Create an App Password: https://myaccount.google.com/apppasswords — label e.g. "Boomer Browse".',
      "3) Paste that 16-character password in settings (not your normal Gmail password).",
      "4) The sender email must be exactly that same Gmail address.",
      "Details: https://support.google.com/mail/?p=BadCredentials",
    ].join(" ");
  }
  return err instanceof Error ? err.message : "Failed to send report";
}

function escapeHtml(s) {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  if (s == null || s === "") return "";
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Send health report to healthcare provider
app.post("/send-report", async (req, res) => {
  const { healthcareEmail, emailFrom, emailPassword } = req.body ?? {};
  const to = (healthcareEmail || process.env.HEALTHCARE_EMAIL || "").toString().trim();
  const from = (emailFrom || process.env.EMAIL_FROM || "").toString().trim();
  const pass = normalizeSmtpPassword(
    emailPassword != null && emailPassword !== ""
      ? emailPassword
      : process.env.EMAIL_PASSWORD || "",
  );

  if (!to || !from || !pass) {
    res.status(400).json({ error: "Missing email configuration. Please set EMAIL_FROM, EMAIL_PASSWORD and HEALTHCARE_EMAIL in settings." });
    return;
  }

  try {
    const [visits, lovedData, dash1, dash2] = await Promise.all([
      listVisits({ limit: 50 }),
      readLovedOnes(),
      getDashboard(),
      getPhysicalActivityDashboard(),
    ]);
    const holisticEntry = peekHolisticCacheForReport();
    const lovedOnes = lovedData.people ?? [];
    const now = new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    const topSitesRows =
      dash1.topSites?.length > 0
        ? dash1.topSites
            .map(
              s =>
                `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(s.host)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${Number(s.visitCount) || 0}</td></tr>`,
            )
            .join("")
        : "<tr><td colspan='2' style='padding:8px'>No top sites in the rolling window.</td></tr>";

    const nSeries = dash2.moodSeries?.length || 0;
    const take = Math.min(7, nSeries);
    const seriesStart = Math.max(0, nSeries - take);
    const wellnessSeriesRows = [];
    for (let i = seriesStart; i < nSeries; i++) {
      const m = dash2.moodSeries[i];
      const d = dash2.memoryLossDegreeSeries[i];
      const f = dash2.memoryLossFrequencySeries[i];
      if (!m) continue;
      wellnessSeriesRows.push(
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(m.date)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${typeof m.mood === "number" ? m.mood.toFixed(2) : "—"}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${d && typeof d.value === "number" ? d.value.toFixed(2) : "—"}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${f && typeof f.count === "number" ? f.count : "—"}</td></tr>`,
      );
    }
    const wellnessRowsHtml =
      wellnessSeriesRows.length > 0
        ? wellnessSeriesRows.join("")
        : "<tr><td colspan='4' style='padding:8px'>No series data.</td></tr>";

    let holisticBlock = "";
    if (!holisticEntry) {
      holisticBlock = `<p style="color:#5a6b5b">No Fetch.ai holistic insight cached yet on this device. Open the cognitive insight (Fetch) card or a dashboard that loads it at least once while the voice server is running.</p>`;
    } else {
      const p = holisticEntry.payload;
      const cachedWhen = new Date(holisticEntry.at).toLocaleString("en-GB", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const agent = p.agentverse;
      const agentOk = agent && agent.ok === true;
      const userMsg =
        agentOk && agent.data && typeof agent.data.user_message === "string" ? agent.data.user_message : "";
      const errMsg =
        agent && agent.ok === false && typeof agent.error === "string" ? agent.error : "";
      const drift = p.drift;
      const driftBits =
        drift && typeof drift.score === "number"
          ? `<p style="margin:8px 0 0"><strong>Usage drift (heuristic):</strong> score ${drift.score}, severity ${escapeHtml(String(drift.severity || "—"))}</p>`
          : "";
      const support =
        p.supportIntensity != null && String(p.supportIntensity).trim()
          ? `<p style="margin:8px 0 0"><strong>Support intensity (non-diagnostic):</strong> ${escapeHtml(String(p.supportIntensity))}</p>`
          : "";
      const insightHtml = userMsg
        ? `<div style="margin-top:12px;padding:14px;background:#fff;border-radius:8px;border:1px solid #e2e8e0;white-space:pre-wrap;font-size:0.95rem;line-height:1.45">${escapeHtml(userMsg).replace(/\n/g, "<br/>")}</div>`
        : errMsg
          ? `<p style="color:#b45309">Holistic agent did not succeed: ${escapeHtml(errMsg)}</p>`
          : `<p style="color:#5a6b5b">No insight text in cache.</p>`;
      const snap = p.snapshot;
      const snapLine =
        snap && typeof snap === "object"
          ? `<p style="margin:8px 0 0;font-size:0.88rem;color:#64748b">Snapshot: ~${escapeHtml(String(snap.window_hours ?? "—"))}h window · visits ${escapeHtml(String(snap.visit_count ?? "—"))} · top host ${escapeHtml(String(snap.top_host || "—"))}</p>`
          : "";
      holisticBlock = `<p style="color:#5a6b5b;margin:0 0 8px"><strong>Holistic insight (Fetch.ai / Perception, most recent cache):</strong> ${escapeHtml(cachedWhen)}</p>${snapLine}${driftBits}${support}${insightHtml}`;
    }

    const activityRows = visits.visits?.length
      ? visits.visits
          .slice(0, 20)
          .map(v => {
            const url = typeof v.url === "string" ? v.url : "";
            const href = /^https?:\/\//i.test(url) ? url : "#";
            const title = typeof v.title === "string" ? v.title : "";
            return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${new Date(v.visitedAt).toLocaleString()}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(title)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee"><a href="${escapeAttr(href)}">${escapeHtml(url.slice(0, 60))}</a></td></tr>`;
          })
          .join("")
      : "<tr><td colspan='3' style='padding:8px'>No recent activity recorded.</td></tr>";

    const familyRows = lovedOnes.length
      ? lovedOnes
          .map(
            p =>
              `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(p.name)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(p.relationship)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(p.contactSite || "")}</td></tr>`,
          )
          .join("")
      : "<tr><td colspan='3' style='padding:8px'>No family members recorded.</td></tr>";

    const html = `
      <div style="font-family:sans-serif;max-width:700px;margin:0 auto;color:#2d3c2e">
        <h1 style="background:#4a5f4b;color:#e8e6dc;padding:20px 24px;margin:0;border-radius:8px 8px 0 0">Boomer Browse — Health Report</h1>
        <div style="background:#f5f4ee;padding:16px 24px;border-radius:0 0 8px 8px">
          <p style="color:#5a6b5b">Generated on <strong>${now}</strong></p>

          <h2 style="color:#4a5f4b;margin-top:24px">Activity dashboard (summary)</h2>
          <p style="color:#2d3c2e;margin:8px 0">${escapeHtml(dash1.personality || "")}</p>
          <ul style="margin:8px 0 0;padding-left:20px;color:#2d3c2e">
            <li>Hours in app (tracked): <strong>${dash1.hoursOnline}</strong></li>
            <li>Time saved (estimate): <strong>${dash1.timeSavedHours} hrs</strong></li>
            <li>Assisted browser tasks: <strong>${dash1.browserTasksCompleted}</strong></li>
            <li>Journey: <strong>${escapeHtml(dash1.tenureLabel)}</strong>${dash1.firstSeenAt ? ` (since ${escapeHtml(String(dash1.firstSeenAt).slice(0, 10))})` : ""}</li>
            <li>Top sites window: <strong>${dash1.topSitesWindowDays ?? 30}</strong> days</li>
          </ul>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-top:12px">
            <thead><tr style="background:#4a5f4b;color:#e8e6dc">
              <th style="padding:8px 12px;text-align:left">Top site</th>
              <th style="padding:8px 12px;text-align:left">Visits</th>
            </tr></thead>
            <tbody>${topSitesRows}</tbody>
          </table>

          <h2 style="color:#4a5f4b;margin-top:24px">Physical Activity / wellness dashboard</h2>
          <p style="color:#5a6b5b;font-size:0.9rem">Estimates from browsing and in-app signals — not clinical.</p>
          <ul style="margin:8px 0 0;padding-left:20px;color:#2d3c2e">
            <li>Media mood (rolling): <strong>${typeof dash2.averageMediaMood === "number" ? dash2.averageMediaMood.toFixed(2) : "—"}</strong> (${escapeHtml(dash2.averageMediaMoodLabel || "")})</li>
            <li>Content age band: <strong>${escapeHtml(dash2.mediaAgeBand || "")}</strong> — ${escapeHtml(dash2.mediaAgeDescription || "")}</li>
          </ul>
          <p style="margin:10px 0 4px;font-size:0.88rem;color:#64748b">Last ${take} days (mood · memory stress · slip count)</p>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-top:4px">
            <thead><tr style="background:#4a5f4b;color:#e8e6dc">
              <th style="padding:8px 12px;text-align:left">Date</th>
              <th style="padding:8px 12px;text-align:left">Mood</th>
              <th style="padding:8px 12px;text-align:left">Memory °</th>
              <th style="padding:8px 12px;text-align:left">Slips</th>
            </tr></thead>
            <tbody>${wellnessRowsHtml}</tbody>
          </table>
          <p style="margin-top:8px;font-size:0.8rem;color:#64748b">${escapeHtml(dash2.meta?.blendNote || "")}</p>

          <h2 style="color:#4a5f4b;margin-top:24px">Holistic insight (Fetch.ai)</h2>
          ${holisticBlock}

          <h2 style="color:#4a5f4b;margin-top:24px">Recent Digital Activity (last 20 visits)</h2>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
            <thead><tr style="background:#4a5f4b;color:#e8e6dc">
              <th style="padding:8px 12px;text-align:left">Time</th>
              <th style="padding:8px 12px;text-align:left">Page</th>
              <th style="padding:8px 12px;text-align:left">URL</th>
            </tr></thead>
            <tbody>${activityRows}</tbody>
          </table>

          <h2 style="color:#4a5f4b;margin-top:24px">Family & Contacts</h2>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
            <thead><tr style="background:#4a5f4b;color:#e8e6dc">
              <th style="padding:8px 12px;text-align:left">Name</th>
              <th style="padding:8px 12px;text-align:left">Relationship</th>
              <th style="padding:8px 12px;text-align:left">Contact via</th>
            </tr></thead>
            <tbody>${familyRows}</tbody>
          </table>

          <p style="margin-top:24px;color:#5a6b5b;font-size:0.85rem">This report was automatically generated by Boomer Browse.</p>
        </div>
      </div>`;

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: from, pass },
    });

    await transporter.sendMail({
      from: `"Boomer Browse" <${from}>`,
      to,
      subject: `Boomer Browse Health Report — ${now}`,
      html,
    });

    res.json({ ok: true, message: `Report sent to ${to}` });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: formatSendReportSmtpError(err) });
  }
});

// Returns the Vapi assistant ID + optional overrides (conversational: user speaks first, then model / client can reply).
app.get("/vapi-config", (_req, res) => {
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  if (!assistantId) {
    res.status(503).json({ error: "VAPI_ASSISTANT_ID is not set in .env" });
    return;
  }

  const holisticEnabled = !/^0|false$/i.test(String(process.env.VAPI_HOLISTIC_CONTEXT ?? "1"));
  const maxHolistic = Number(process.env.VAPI_HOLISTIC_CONTEXT_MAX_CHARS || 2400);
  let boomerHolisticContext = "";
  if (holisticEnabled) {
    const entry = peekHolisticCacheForReport();
    const p = entry && typeof entry.payload === "object" ? entry.payload : null;
    boomerHolisticContext = formatHolisticPayloadForVapiVariable(p, maxHolistic);
  }

  res.json({
    assistantId,
    assistantOverrides: {
      firstMessageMode: "assistant-waits-for-user",
      variableValues: {
        boomer_holistic_context: boomerHolisticContext,
      },
    },
  });
});

/**
 * User wants more than opening a thread — compose/send text (any language), ask-in-chat, etc.
 * If true, we must not use the "open URL only" short-circuit and should run Browser Use with full intent.
 * @param {string} task
 */
function taskNeedsMessagingAutomation(task) {
  const t = String(task ?? "").toLowerCase();
  if (/\b(texting|text\s+|dm\b|write\s+|send(ing)?\s+|type\s+|tell\s+|reply\s+|compose|draft)\b/.test(t)) return true;
  if (/\bask\s+/.test(t)) return true;
  if (/\bsay\s+/.test(t)) return true;
  if (/\bmessage\s+(?:my|him|her|them)\b/.test(t)) return true;
  if (/\bin\s+(?:vietnamese|spanish|french|chinese|korean|japanese|german|italian|portuguese|arabic|hindi)\b/.test(t))
    return true;
  return false;
}

/** Prefix for messages that should skip Browser Use and return as plain assistant text (e.g. no routine data yet). */
const ROUTINE_INLINE_MESSAGE_PREFIX = "__BOOMER_ROUTINE_MSG__:";

function isRoutineInlineMessage(enriched) {
  return String(enriched ?? "").startsWith(ROUTINE_INLINE_MESSAGE_PREFIX);
}

function stripRoutineInlineMessage(enriched) {
  return String(enriched ?? "").slice(ROUTINE_INLINE_MESSAGE_PREFIX.length);
}

/** "Open my routine / daily routine" → use mined URLs locally, not Browser Use Cloud (remote browser opens nothing on the user’s machine). */
function isOpenRoutineBrowsingTask(task) {
  const raw = String(task ?? "").trim();
  if (!raw) return false;
  const t = raw.toLowerCase();
  const mentionsRoutine =
    /\b(routines?|daily\s+routine|my\s+routine)\b/.test(t) || (/\bdaily\b/.test(t) && /\broutine\b/.test(t));
  if (!mentionsRoutine) return false;
  return /\b(open|show|take\s+me|start|launch|go\s+to|visit|bring\s+up|run)\b/.test(t) || /^(open|show)\s+/i.test(raw);
}

// Searches activity history AND loved ones to resolve vague tasks
async function resolveTaskWithHistory(task) {
  // Check loved ones first for "call/contact [name/relationship]" patterns
  try {
    const people = (await readLovedOnes()).people ?? [];
    if (people.length > 0) {
      const t = task.toLowerCase();
      const isContactRequest =
        /\b(call|contact|text(ing)?|dm|message|video call|facetime|whatsapp|ring|chat with|talk to|speak to)\b/.test(t);
      if (isContactRequest) {
        for (const p of people) {
          const nameMatch = p.name && t.includes(p.name.toLowerCase());
          const relMatch = p.relationship && t.includes(p.relationship.toLowerCase());
          if (nameMatch || relMatch) {
            const contactHref = (p.contactLink || p.contactURL || "").trim();
            if (contactHref) {
              console.debug(
                `[browser-automation] Resolved contact request for "${p.name}" (${p.relationship || "contact"}) → ${contactHref}`,
              );
              if (taskNeedsMessagingAutomation(task)) {
                return (
                  `Go to ${contactHref}. User request: ${task}. ` +
                  `In this chat, complete the request: log in if needed, focus the message composer, ` +
                  `type the full message the user asked for (correct language and wording), then click Send. ` +
                  `If you cannot send (e.g. UI blocked or confirmation needed), leave the text in the box and report that.`
                );
              }
              return `Open this URL to contact ${p.name}: ${contactHref}`;
            } else if (p.contactSite) {
              // No direct link — open the app and search for the person's name, then ask for confirmation
              const searchUrls = {
                whatsapp: "https://web.whatsapp.com",
                facetime: "https://facetime.apple.com",
                facebook: "https://www.facebook.com/messages",
                messenger: "https://www.messenger.com",
                skype: "https://web.skype.com",
                zoom: "https://zoom.us",
                teams: "https://teams.microsoft.com",
                telegram: "https://web.telegram.org",
                signal: "https://signal.org/download",
              };
              const siteKey = Object.keys(searchUrls).find(k => p.contactSite.toLowerCase().includes(k));
              const baseUrl = siteKey ? searchUrls[siteKey] : `https://www.google.com/search?q=${encodeURIComponent(p.contactSite)}`;
              console.log(`No contact link for "${p.name}", opening ${p.contactSite} to search`);
              return `Open ${baseUrl}, search for "${p.name}", and once you find their profile or chat, stop and do not call or message yet. The assistant will ask the user to confirm.`;
            }
          }
        }
      }
    }
  } catch {}

  // Logged YouTube Friends episodes (memory.json) → open matching search when user names an episode
  try {
    const raw = String(task ?? "");
    const t = raw.toLowerCase();
    const ep = parseEpisodeFromText(raw);
    if (ep != null && ep >= 1) {
      const nar = await getNarrative();
      const mentionsFriends = /\bfriends\b/.test(t);
      const watchingIntent =
        /\b(watching|watch|open|play|episode|ep\.?)\b/.test(t) ||
        /i\s*['']?m\s+(on|at|watching)\b/.test(t);
      const useFriends =
        mentionsFriends || (String(nar.seriesKey || "") === "friends" && watchingIntent);
      if (useFriends) {
        const logged = await getLoggedMediaEpisodeUrl("friends", ep);
        const url =
          logged ||
          `https://www.youtube.com/results?search_query=${encodeURIComponent(`Friends season 1 episode ${ep}`)}`;
        console.log(`[browser-automation] Friends episode ${ep} → ${url.slice(0, 120)}`);
        const line = `Alright — opening episode ${ep} of Friends on YouTube for you.`;
        return `${line}\n\nOpen this URL: ${url}`;
      }
    }
  } catch {}

  try {
    if (isOpenRoutineBrowsingTask(task)) {
      const flow = await getRoutineFlow();
      const steps = flow.steps ?? [];
      const urls = steps
        .map((s) => String(s?.url ?? "").trim())
        .filter((u) => /^https?:\/\//i.test(u));
      if (urls.length === 0) {
        return `${ROUTINE_INLINE_MESSAGE_PREFIX}${flow.patternSummary || "No routine steps yet."}`;
      }
      return urls.map((u) => `Open this URL: ${u}`).join("\n");
    }
  } catch {}

  // Fall back to activity history
  const visits = await listVisits({ limit: 100 }).catch(() => []);
  if (!visits.length) return task;

  // Build a compact history string for the LLM
  const historyLines = visits.slice(0, 50).map((v, i) =>
    `${i + 1}. "${v.title}" — ${v.url} (visited ${v.visitedAt.slice(0, 10)})`
  ).join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a browser assistant. The user has a browsing history. 
If their request refers to something they previously visited, return the exact URL from history.
If no history match, return the best URL to fulfill the request.
Reply with ONLY a JSON object: {"url": "...", "matched": true/false}`,
        },
        {
          role: "user",
          content: `User request: "${task}"\n\nBrowsing history:\n${historyLines}`,
        },
      ],
      max_tokens: 100,
    }),
  });

  const data = await response.json();
  try {
    const parsed = JSON.parse(data.choices[0].message.content.trim());
    if (parsed.url) {
      console.log(`Resolved "${task}" → ${parsed.url} (matched: ${parsed.matched})`);
      return `Open this URL: ${parsed.url}`;
    }
  } catch {}
  return task;
}

/**
 * When loved-ones or browsing history already resolved to a concrete https URL, running Browser Use
 * Cloud only drives a remote VM (nothing visible locally). Skip the worker and return immediately.
 * @param {string} enriched
 */
function isResolvedDirectBrowserTask(enriched) {
  const s = String(enriched ?? "").trim();
  if (!s || isRoutineInlineMessage(s)) return false;
  if (/^Open this URL to contact\b/i.test(s)) return true;
  const lines = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  const openLines = lines.filter(
    (l) =>
      /^Open this URL to contact\b/i.test(l) || /^Open this URL:\s*(https?:\/\/|tel:)/i.test(l),
  );
  if (openLines.length === 0) return false;
  for (const l of lines) {
    if (
      /^Open this URL to contact\b/i.test(l) ||
      /^Open this URL:\s*(https?:\/\/|tel:)/i.test(l)
    ) {
      continue;
    }
    if (/\bhttps?:\/\//i.test(l)) return false;
  }
  return openLines.every(
    (l) =>
      /^Open this URL to contact\b/i.test(l) || /^Open this URL:\s*(https?:\/\/|tel:)/i.test(l),
  );
}

// Runs a browser task: Browser Use Cloud when BROWSER_USE_API_KEY is set, else local Python + Playwright.
app.post("/browser-automation", async (req, res) => {
  const task = req.body?.task;
  if (!task || typeof task !== "string") {
    res.status(400).json({ error: "Expected JSON body { task: string }" });
    return;
  }
  const useCloud = isBrowserUseCloudEnabled();
  if (!useCloud && !process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: "OPENAI_API_KEY is not set in .env (required for local browser worker)" });
    return;
  }
  if (!useCloud && (!workerProc || !workerReady)) {
    res.status(503).json({
      error:
        "Browser worker not ready. Set BROWSER_USE_API_KEY for Browser Use Cloud, or install the local worker (see requirements-worker.txt) and remove SKIP_BROWSER_WORKER.",
    });
    return;
  }
  console.debug(`[browser-automation] ${useCloud ? "cloud" : "local"} task:`, task.slice(0, 200));
  addVisit({ url: task, title: `Browser task: ${task}`, visitedAt: new Date().toISOString() }).catch(() => {});

  let enrichedTask = task;
  if (process.env.OPENAI_API_KEY) {
    enrichedTask = await resolveTaskWithHistory(task).catch(() => task);
  }

  if (isRoutineInlineMessage(enrichedTask)) {
    void recordBrowserAutomationComplete(task).catch(() => {});
    res.json({ output: stripRoutineInlineMessage(enrichedTask), taskId: null, liveUrl: null });
    return;
  }

  if (isResolvedDirectBrowserTask(enrichedTask) && !taskNeedsMessagingAutomation(task)) {
    console.log(`[browser-automation] Direct contact/history URL — skipping worker: ${enrichedTask.slice(0, 160)}`);
    void recordBrowserAutomationComplete(task).catch(() => {});
    res.json({ output: enrichedTask, taskId: null, liveUrl: null });
    return;
  }

  try {
    const output = await runBrowserAutomationTask(enrichedTask);
    await recordBrowserAutomationComplete(task).catch(() => {});
    res.json({ output, taskId: null, liveUrl: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Browser task failed" });
  }
});

/** Server-Sent Events: friendly progress lines while the browser task runs (templates only). */
app.post("/browser-automation/stream", async (req, res) => {
  const task = req.body?.task;
  if (!task || typeof task !== "string") {
    res.status(400).json({ error: "Expected JSON body { task: string }" });
    return;
  }
  const useCloud = isBrowserUseCloudEnabled();
  if (!useCloud && !process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: "OPENAI_API_KEY is not set in .env (required for local browser worker)" });
    return;
  }
  if (!useCloud && (!workerProc || !workerReady)) {
    res.status(503).json({
      error:
        "Browser worker not ready. Set BROWSER_USE_API_KEY for Browser Use Cloud, or install the local worker (see requirements-worker.txt) and remove SKIP_BROWSER_WORKER.",
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  /** @param {Record<string, unknown>} obj */
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  console.debug(`[browser-automation/stream] ${useCloud ? "cloud" : "local"} task:`, task.slice(0, 200));
  addVisit({ url: task, title: `Browser task: ${task}`, visitedAt: new Date().toISOString() }).catch(() => {});

  let enrichedTask = task;
  if (process.env.OPENAI_API_KEY) {
    try {
      enrichedTask = await resolveTaskWithHistory(task);
    } catch {
      enrichedTask = task;
    }
  }

  if (isRoutineInlineMessage(enrichedTask)) {
    send({ type: "progress", message: "Checked your usual sites…" });
    send({ type: "done", output: stripRoutineInlineMessage(enrichedTask) });
    void recordBrowserAutomationComplete(task).catch(() => {});
    res.end();
    return;
  }

  if (isResolvedDirectBrowserTask(enrichedTask) && !taskNeedsMessagingAutomation(task)) {
    console.log(`[browser-automation/stream] Direct contact/history URL — skipping worker: ${enrichedTask.slice(0, 160)}`);
    send({
      type: "progress",
      message: enrichedTask.includes("\n") ? "Opening your usual sites…" : "Opening saved link…",
    });
    send({ type: "done", output: enrichedTask });
    void recordBrowserAutomationComplete(task).catch(() => {});
    res.end();
    return;
  }

  try {
    if (useCloud) {
      const output = await runBrowserAutomationTask(enrichedTask, {
        onProgress: (message) => send({ type: "progress", message }),
      });
      await recordBrowserAutomationComplete(task).catch(() => {});
      send({ type: "done", output });
    } else {
      let tick = 0;
      send({ type: "progress", message: friendlyLineLocalTick(tick++) });
      const iv = setInterval(() => {
        send({ type: "progress", message: friendlyLineLocalTick(tick++) });
      }, 4450);
      try {
        const output = await runBrowserTask(enrichedTask);
        send({ type: "progress", message: "Finished." });
        await recordBrowserAutomationComplete(task).catch(() => {});
        send({ type: "done", output });
      } finally {
        clearInterval(iv);
      }
    }
  } catch (err) {
    console.error(err);
    send({ type: "error", error: err instanceof Error ? err.message : "Browser task failed" });
  }
  res.end();
});

const PORT = Number(process.env.PORT) || 3001;
const LISTEN_HOST = process.env.BOOMER_LISTEN_HOST || "127.0.0.1";

function skipWakeWord() {
  return /^(1|true|yes)$/i.test(String(process.env.SKIP_WAKE_WORD ?? ""));
}

/**
 * Wake listener runs in a child process; if PyAudio / mic / Python fails, the child exits.
 * The Node API keeps running — ECONNREFUSED on /api/* means this server never started (e.g. only `vite` was run).
 */
function startWakeWordListener() {
  if (skipWakeWord()) {
    console.log("[wake] Skipped (SKIP_WAKE_WORD=1). Voice API stays up.");
    return;
  }
  const wakeScript = path.join(__dirname, "wake_word.py");
  const candidates = [
    ["py", ["-3.12", wakeScript]],
    ["python", [wakeScript]],
    ["python3", [wakeScript]],
  ];
  let idx = 0;
  const tryNext = () => {
    if (idx >= candidates.length) {
      console.warn("[wake] No working Python launcher found — wake word disabled. Voice API is fine.");
      return;
    }
    const [cmd, args] = candidates[idx++];
    const child = spawn(cmd, args, {
      env: { ...process.env },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", () => tryNext());
    child.on("spawn", () => {
      console.log(`[wake] Listener started (${cmd}). Exits are non-fatal for the API.`);
      child.on("exit", (code, signal) => {
        if (signal) {
          console.warn(`[wake] Listener stopped (signal ${signal}).`);
          return;
        }
        if (code === 0 || code === null) return;
        const hex = typeof code === "number" ? ` (0x${code.toString(16)})` : "";
        console.warn(
          `[wake] Listener exited with code ${code}${hex}. Often PyAudio / mic / DLL. ` +
            `Set SKIP_WAKE_WORD=1 to silence. Voice server on :${PORT} is still running.`,
        );
      });
    });
  };
  tryNext();
}

app.listen(PORT, LISTEN_HOST, () => {
  const hint =
    LISTEN_HOST === "0.0.0.0"
      ? `http://127.0.0.1:${PORT} and http://localhost:${PORT}`
      : `http://${LISTEN_HOST === "127.0.0.1" ? "127.0.0.1" : LISTEN_HOST}:${PORT}`;
  console.log(`Voice server listening on ${hint}`);
  console.log("[loved-ones] file:", lovedOnesStoragePath());
  startWakeWordListener();
});
