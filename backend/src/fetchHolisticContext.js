import path from "path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { listVisits, normalizeHostFromUrl, isSearchEngineHost } from "./activityStore.js";
import { buildCognitiveSnapshotWithDrift } from "./cognitiveSnapshot.js";
import { getMetrics, getStateSummary, listMedia } from "./memoryStore.js";
import { getPhysicalActivityDashboard } from "./physicalActivityStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_BRIEF_PATH = path.join(__dirname, "..", "data", "perception-evidence-brief.txt");

/** @type {Promise<string> | null} */
let evidenceBriefLoadPromise = null;

async function loadEvidenceBrief() {
  if (evidenceBriefLoadPromise == null) {
    evidenceBriefLoadPromise = readFile(EVIDENCE_BRIEF_PATH, "utf8").catch(() => "");
  }
  return evidenceBriefLoadPromise;
}

const TAG_RE = /\[\[(MEMORY|BROWSER|DRIFT|NOTE)\]\]\s*/gi;

/**
 * Perception is prompted to end [[NOTE]] with: `Support intensity: Low|Moderate|Elevated` (non-diagnostic).
 * @param {string} text
 * @returns {{ level: "low" | "moderate" | "elevated" | null, label: string }}
 */
export function extractSupportIntensity(text) {
  const m = String(text || "").match(/Support intensity:\s*(Low|Moderate|Elevated)\b/i);
  if (!m) return { level: null, label: "" };
  const cap = m[1];
  const low = cap.toLowerCase();
  const level = low === "low" ? "low" : low === "elevated" ? "elevated" : "moderate";
  const label = cap.charAt(0).toUpperCase() + cap.slice(1).toLowerCase();
  return { level, label };
}

/** Remove the mandatory Support intensity line from NOTE so the card does not repeat it. */
function stripSupportIntensityFromNote(note) {
  return String(note || "")
    .split("\n")
    .filter((line) => !/^\s*Support intensity:\s*(Low|Moderate|Elevated)\b/i.test(line))
    .join("\n")
    .trim();
}

/**
 * Parse ASI:One reply into four labeled sections (fallback: all text in `note`).
 * @param {string} text
 * @returns {{
 *   sections: { memory: string, browser: string, drift: string, note: string },
 *   full: string,
 *   unparsed?: boolean,
 *   supportIntensity?: "low" | "moderate" | "elevated" | null
 * }}
 */
export function parseFetchInsightSections(text) {
  const full = typeof text === "string" ? text : "";
  const sections = {
    memory: "",
    browser: "",
    drift: "",
    note: "",
  };
  if (!full.trim()) {
    return { sections, full, unparsed: true, supportIntensity: null };
  }

  const parts = full.split(TAG_RE);
  if (parts.length < 3) {
    sections.note = full.trim();
    const { level } = extractSupportIntensity(sections.note + "\n" + full);
    sections.note = stripSupportIntensityFromNote(sections.note);
    return { sections, full, unparsed: true, supportIntensity: level };
  }

  for (let i = 1; i < parts.length; i += 2) {
    const tag = String(parts[i] || "").toLowerCase();
    const body = String(parts[i + 1] || "").trim();
    if (tag === "memory") sections.memory = body;
    else if (tag === "browser") sections.browser = body;
    else if (tag === "drift") sections.drift = body;
    else if (tag === "note") sections.note = body;
  }

  const any = sections.memory || sections.browser || sections.drift;
  const { level } = extractSupportIntensity(`${sections.note}\n${full}`);
  sections.note = stripSupportIntensityFromNote(sections.note);

  if (!any && sections.note) {
    return { sections, full, unparsed: true, supportIntensity: level };
  }
  return { sections, full, supportIntensity: level };
}

/** Passive browser-behavior summary from visits (no keystroke / tab timing yet). */
export async function buildBrowserBehaviorContext({ windowHours = 24 } = {}) {
  const wh = Math.max(1, Math.min(168, Number(windowHours) || 24));
  const visits = await listVisits({ limit: 4000 });
  const now = Date.now();
  const windowMs = wh * 60 * 60 * 1000;
  const start = now - windowMs;
  const recent = visits.filter((v) => {
    const t = new Date(v.visitedAt).getTime();
    return !Number.isNaN(t) && t >= start && t < now;
  });

  let searchHits = 0;
  const hostCounts = Object.create(null);
  for (const v of recent) {
    const h = normalizeHostFromUrl(v.url) || "";
    if (!h) continue;
    if (isSearchEngineHost(h)) searchHits++;
    hostCounts[h] = (hostCounts[h] || 0) + 1;
  }
  const revisitHosts = Object.entries(hostCounts).filter(([, c]) => c >= 4).length;
  const lines = [
    `Window: last ${wh}h, visits recorded: ${recent.length}.`,
    `Search-engine page loads (proxy for queries/refinding): ${searchHits}.`,
    `Hosts visited at least 4 times in window (possible loops/repeat): ${revisitHosts}.`,
    "Fine-grained typing speed, tab open/close dwell, and confusion loops are not logged yet — use visit patterns only.",
  ];
  return lines.join("\n");
}

/** Long-term memory / narrative operational summary for the Memory agent lens. */
export async function buildMemoryAgentContext() {
  const [summary, metrics] = await Promise.all([getStateSummary(), getMetrics({ weeks: 4 })]);
  const lastWeek = metrics.weekly[0];
  const lines = [
    `Media events logged: ${summary.mediaCount}; assertions: ${summary.assertionCount}; reconciliations: ${summary.reconciliationCount}.`,
    `Narrative inconsistencies (all time): ${summary.inconsistencyCount}; last 14 days: ${metrics.last14DaysCount}.`,
  ];
  if (lastWeek) {
    lines.push(
      `Most recent week bucket: ${lastWeek.weekStart}–${lastWeek.weekEnd}: ` +
        `${lastWeek.inconsistencyCount} inconsistencies, avg severity proxy ${lastWeek.avgSeverityProxy}.`,
    );
  }
  lines.push(`Narrative seq: ${metrics.narrative?.narrativeSeq ?? "—"}; series: ${metrics.narrative?.seriesKey ?? "—"}.`);
  const friendsLog = await listMedia({ seriesKey: "friends", limit: 20 }).catch(() => []);
  if (friendsLog.length) {
    const eps = [
      ...new Set(
        friendsLog.map((e) => e.episodeNumber).filter((n) => n != null && Number.isFinite(Number(n))),
      ),
    ].sort((a, b) => Number(a) - Number(b));
    lines.push(
      `Media: user has been watching Friends on YouTube — logged episodes: ${eps.join(", ")}. When they mention an episode by number, gently confirm and offer to open it.`,
    );
  }
  lines.push(metrics.disclaimer || "Operational counts only — not a clinical assessment.");
  return lines.join("\n");
}

/** Wellness / physical dashboard digest for ASI (Memory Anchor + mood series). */
export async function buildPhysicalWellnessContext() {
  const dash = await getPhysicalActivityDashboard();
  const lastMood = dash.moodSeries?.[dash.moodSeries.length - 1];
  const lastDeg = dash.memoryLossDegreeSeries?.[dash.memoryLossDegreeSeries.length - 1];
  const lines = [
    `Media mood avg: ${dash.averageMediaMood} (${dash.averageMediaMoodLabel}).`,
    `Content age band: ${dash.mediaAgeBand} — ${dash.mediaAgeDescription}.`,
    `Latest mood point: ${lastMood?.date ?? "—"} mood=${lastMood?.mood ?? "—"}${lastMood?.moodDriver ? ` driver: ${lastMood.moodDriver}` : ""}.`,
    `Latest narrative-stress proxy: ${lastDeg?.date ?? "—"} value=${lastDeg?.value ?? "—"}${lastDeg?.memoryDriver ? ` driver: ${lastDeg.memoryDriver}` : ""}.`,
    `Window: ~${dash.meta?.windowDays ?? 21} days; visit days with data: ${dash.meta?.visitDaysWithData ?? "—"}.`,
    dash.meta?.blendNote || "",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Full holistic snapshot for Fetch perception agent (Memory + Browser + Drift + Physical lenses).
 * @param {{ windowHours?: number }} opts
 */
export async function buildHolisticCognitiveSnapshot({ windowHours = 24 } = {}) {
  const wh = Math.max(1, Math.min(168, Number(windowHours) || 24));
  const [bundle, memoryContext, browserContext, physicalContext, evidenceBrief] = await Promise.all([
    buildCognitiveSnapshotWithDrift({ windowHours: wh }),
    buildMemoryAgentContext(),
    buildBrowserBehaviorContext({ windowHours: wh }),
    buildPhysicalWellnessContext(),
    loadEvidenceBrief(),
  ]);

  const brief = (evidenceBrief || "").trim();
  const memCore = (memoryContext || "").trim();
  const memory_context = brief
    ? `${memCore}\n\n--- Evidence & research themes (curated; ground judgments with telemetry) ---\n\n${brief}`
    : memCore;

  const snapshot = {
    ...bundle.snapshot,
    memory_context,
    browser_context: browserContext,
    physical_context: physicalContext,
  };

  return {
    snapshot,
    baseline: bundle.baseline,
    drift: bundle.drift,
  };
}

/** @type {{ at: number, payload: object } | null} */
let holisticCache = null;

/**
 * Latest successful holistic payload for caregiver email (not TTL-evicted; updated on each setHolisticCache).
 * Survives short-TTL expiry of {@link getHolisticCache}.
 * @type {{ at: number, payload: object } | null}
 */
let holisticCacheLastForReport = null;

/**
 * Short TTL cache so multiple dashboards querying the same holistic insight do not triple-bill ASI.
 * @param {number} ttlMs
 */
export function getHolisticCache(ttlMs = 90000) {
  if (!holisticCache) return null;
  if (Date.now() - holisticCache.at > ttlMs) {
    holisticCache = null;
    return null;
  }
  return holisticCache.payload;
}

export function setHolisticCache(payload) {
  const entry = { at: Date.now(), payload };
  holisticCache = entry;
  holisticCacheLastForReport = entry;
}

/** @returns {{ at: number, payload: object } | null} */
export function peekHolisticCacheForReport() {
  return holisticCacheLastForReport;
}

/**
 * Build text for Vapi `variableValues.boomer_holistic_context` (system prompt {{boomer_holistic_context}}).
 * Uses cached /cognitive/agentverse payload only — no extra ASI calls.
 * @param {object | null | undefined} payload Same shape as setHolisticCache (sections, supportIntensity, snapshot, agentverse).
 * @param {number} maxChars
 * @returns {string}
 */
export function formatHolisticPayloadForVapiVariable(payload, maxChars = 2400) {
  if (!payload || typeof payload !== "object") return "";
  const cap = Math.max(400, Math.min(16000, Number(maxChars) || 2400));
  const parts = [];

  const si = payload.supportIntensity;
  if (si === "low" || si === "moderate" || si === "elevated") {
    const label = si.charAt(0).toUpperCase() + si.slice(1);
    parts.push(`Support intensity: ${label} (from app telemetry — adapt tone only; not diagnostic).`);
  }

  const sec = payload.sections;
  const hasSections =
    sec &&
    typeof sec === "object" &&
    (String(sec.memory || "").trim() ||
      String(sec.browser || "").trim() ||
      String(sec.drift || "").trim() ||
      String(sec.note || "").trim());

  if (hasSections) {
    if (String(sec.memory || "").trim()) parts.push(`[Memory]\n${String(sec.memory).trim()}`);
    if (String(sec.browser || "").trim()) parts.push(`[Browser]\n${String(sec.browser).trim()}`);
    if (String(sec.drift || "").trim()) parts.push(`[Drift]\n${String(sec.drift).trim()}`);
    if (String(sec.note || "").trim()) parts.push(`[Note]\n${String(sec.note).trim()}`);
  } else {
    const av = payload.agentverse;
    const um =
      av && typeof av === "object" && av.ok && av.data && typeof av.data.user_message === "string"
        ? String(av.data.user_message).trim()
        : "";
    if (um) parts.push(um);
  }

  const phys = payload.snapshot?.physical_context;
  if (typeof phys === "string" && phys.trim()) {
    parts.push(`[Wellness / media mood]\n${phys.trim()}`);
  }

  let out = parts.filter(Boolean).join("\n\n");
  if (!out.trim()) return "";
  if (out.length > cap) out = `${out.slice(0, cap - 1)}…`;
  return out;
}
