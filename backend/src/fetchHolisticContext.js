import { listVisits, normalizeHostFromUrl, isSearchEngineHost } from "./activityStore.js";
import { buildCognitiveSnapshotWithDrift } from "./cognitiveSnapshot.js";
import { getMetrics, getStateSummary } from "./memoryStore.js";
import { getPhysicalActivityDashboard } from "./physicalActivityStore.js";

const TAG_RE = /\[\[(MEMORY|BROWSER|DRIFT|NOTE)\]\]\s*/gi;

/**
 * Parse ASI:One reply into four labeled sections (fallback: all text in `note`).
 * @param {string} text
 * @returns {{ sections: { memory: string, browser: string, drift: string, note: string }, full: string, unparsed?: boolean }}
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
    return { sections, full, unparsed: true };
  }

  const parts = full.split(TAG_RE);
  if (parts.length < 3) {
    sections.note = full.trim();
    return { sections, full, unparsed: true };
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
  if (!any && sections.note) {
    return { sections, full, unparsed: true };
  }
  return { sections, full };
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
  lines.push(metrics.disclaimer || "Operational counts only — not a clinical assessment.");
  return lines.join("\n");
}

/** Wellness / physical dashboard digest for ASI (Memory Anchor + mood series). */
export async function buildPhysicalWellnessContext() {
  const dash = await getPhysicalActivityDashboard();
  const lastMood = dash.moodSeries?.[dash.moodSeries.length - 1];
  const lastDeg = dash.memoryLossDegreeSeries?.[dash.memoryLossDegreeSeries.length - 1];
  const lines = [
    `Perceived self age (user): ${dash.perceivedSelfAge}; media mood avg: ${dash.averageMediaMood} (${dash.averageMediaMoodLabel}).`,
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
  const [bundle, memoryContext, browserContext, physicalContext] = await Promise.all([
    buildCognitiveSnapshotWithDrift({ windowHours: wh }),
    buildMemoryAgentContext(),
    buildBrowserBehaviorContext({ windowHours: wh }),
    buildPhysicalWellnessContext(),
  ]);

  const snapshot = {
    ...bundle.snapshot,
    memory_context: memoryContext,
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
  holisticCache = { at: Date.now(), payload };
}
