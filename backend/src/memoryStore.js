import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "memory.json");

/** @typedef {{ id: string, occurredAt: string, url: string, title: string, description: string, seriesKey: string, episodeNumber: number | null, dayIndex: number }} MediaEvent */
/** @typedef {{ id: string, assertedAt: string, rawText: string, seriesKey: string | null, parsedEpisode: number | null, priorLastEpisode: number | null }} Assertion */
/** @typedef {{ id: string, createdAt: string, assertionId: string | null, priorNarrativeSeq: number, newNarrativeSeq: number, anchorEventId: string | null, resolutionType: string, notes: string }} Reconciliation */
/** @typedef {{ id: string, detectedAt: string, seriesKey: string, type: string, severity: number, detail: string, assertionId: string | null, priorEpisode: number | null, assertedEpisode: number | null }} InconsistencyEvent */
/** @typedef {{ seriesKey: string, narrativeSeq: number, lastConfirmedEpisode: number | null, updatedAt: string }} NarrativeState */

/** @type {{ mediaEvents: MediaEvent[], assertions: Assertion[], reconciliations: Reconciliation[], inconsistencies: InconsistencyEvent[], narrative: NarrativeState }} */
let cache = null;

async function ensureLoaded() {
  if (cache) return cache;
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    cache = JSON.parse(raw);
  } catch {
    cache = {
      mediaEvents: [],
      assertions: [],
      reconciliations: [],
      inconsistencies: [],
      narrative: {
        seriesKey: "default",
        narrativeSeq: 0,
        lastConfirmedEpisode: null,
        updatedAt: new Date().toISOString(),
      },
    };
  }
  if (!cache.narrative) {
    cache.narrative = {
      seriesKey: "default",
      narrativeSeq: 0,
      lastConfirmedEpisode: null,
      updatedAt: new Date().toISOString(),
    };
  }
  return cache;
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Extract episode number from natural language */
export function parseEpisodeFromText(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.toLowerCase();
  const patterns = [
    /(?:episode|ep\.?)\s*(\d+)/i,
    /season\s*\d+\s*(?:episode|ep\.?)\s*(\d+)/i,
    /\bs(\d+)e(\d+)\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return Number(m[m.length - 1]);
  }
  return null;
}

function severityForEpisodeGap(prior, asserted) {
  if (prior == null || asserted == null) return 0.3;
  const gap = Math.abs(prior - asserted);
  return Math.min(1, gap / 10 + (gap >= 2 ? 0.2 : 0));
}

/**
 * @param {{ url: string, title?: string, description?: string, seriesKey?: string, episodeNumber?: number | null, occurredAt?: string }} input
 */
export async function addMediaEvent(input) {
  const s = await ensureLoaded();
  const seriesKey = (input.seriesKey || "default").trim() || "default";
  const occurredAt = input.occurredAt || new Date().toISOString();
  const dayStart = occurredAt.slice(0, 10);

  const sameDay = s.mediaEvents.filter(
    (e) => e.seriesKey === seriesKey && e.occurredAt.slice(0, 10) === dayStart
  );
  const dayIndex =
    sameDay.length > 0
      ? Math.max(...sameDay.map((e) => e.dayIndex))
      : Math.max(0, ...s.mediaEvents.filter((e) => e.seriesKey === seriesKey).map((e) => e.dayIndex)) + 1;

  const ev = {
    id: id(),
    occurredAt,
    url: String(input.url).trim(),
    title: String(input.title || "").trim() || "Untitled",
    description: String(input.description || "").trim(),
    seriesKey,
    episodeNumber:
      input.episodeNumber != null && !Number.isNaN(Number(input.episodeNumber))
        ? Number(input.episodeNumber)
        : null,
    dayIndex,
  };
  s.mediaEvents.push(ev);
  if (ev.episodeNumber != null) {
    if (s.narrative.seriesKey !== seriesKey) {
      s.narrative.seriesKey = seriesKey;
    }
    s.narrative.lastConfirmedEpisode = ev.episodeNumber;
    s.narrative.narrativeSeq = Math.max(s.narrative.narrativeSeq, ev.episodeNumber);
    s.narrative.updatedAt = new Date().toISOString();
  }
  await persist();
  return ev;
}

/**
 * Record a user assertion; if it contradicts logs, log inconsistency and optionally auto-reconcile.
 * @param {{ rawText: string, seriesKey?: string, autoReconcile?: boolean }} input
 */
export async function addAssertion(input) {
  const s = await ensureLoaded();
  const rawText = String(input.rawText || "").trim();
  if (!rawText) throw new Error("rawText required");

  const seriesKey = (input.seriesKey || s.narrative.seriesKey || "default").trim() || "default";
  const parsedEpisode = parseEpisodeFromText(rawText);
  const priorLast = s.narrative.lastConfirmedEpisode;

  const assertion = {
    id: id(),
    assertedAt: new Date().toISOString(),
    rawText,
    seriesKey,
    parsedEpisode,
    priorLastEpisode: priorLast,
  };
  s.assertions.push(assertion);

  let reconciliation = null;

  if (
    parsedEpisode != null &&
    priorLast != null &&
    parsedEpisode !== priorLast &&
    input.autoReconcile !== false
  ) {
    const anchor = [...s.mediaEvents]
      .filter((e) => e.seriesKey === seriesKey && e.episodeNumber === parsedEpisode)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))[0];

    const inc = {
      id: id(),
      detectedAt: new Date().toISOString(),
      seriesKey,
      type: "episode_mismatch",
      severity: severityForEpisodeGap(priorLast, parsedEpisode),
      detail: `User asserted episode ${parsedEpisode}; last logged was ${priorLast}.`,
      assertionId: assertion.id,
      priorEpisode: priorLast,
      assertedEpisode: parsedEpisode,
    };
    s.inconsistencies.push(inc);

    if (anchor) {
      const priorSeq = s.narrative.narrativeSeq;
      const newSeq = parsedEpisode;
      s.narrative.narrativeSeq = newSeq;
      s.narrative.lastConfirmedEpisode = parsedEpisode;
      s.narrative.seriesKey = seriesKey;
      s.narrative.updatedAt = new Date().toISOString();

      reconciliation = {
        id: id(),
        createdAt: new Date().toISOString(),
        assertionId: assertion.id,
        priorNarrativeSeq: priorSeq,
        newNarrativeSeq: newSeq,
        anchorEventId: anchor.id,
        resolutionType: "reanchor_to_prior_episode_event",
        notes: `Narrative re-anchored to episode ${parsedEpisode} using media log at ${anchor.occurredAt}.`,
      };
      s.reconciliations.push(reconciliation);
    }
  }

  await persist();
  return {
    assertion,
    reconciliation,
    inconsistency:
      parsedEpisode != null &&
      priorLast != null &&
      parsedEpisode !== priorLast
        ? s.inconsistencies[s.inconsistencies.length - 1]
        : null,
  };
}

export async function listMedia({ seriesKey, limit = 100 } = {}) {
  const s = await ensureLoaded();
  let rows = [...s.mediaEvents].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  if (seriesKey) rows = rows.filter((e) => e.seriesKey === seriesKey);
  return rows.slice(0, limit);
}

/** Group media by calendar day for "daily URL" view */
export async function getScheduleByDay({ daysBack = 14 } = {}) {
  const s = await ensureLoaded();
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const byDay = new Map();
  for (const e of s.mediaEvents) {
    const t = new Date(e.occurredAt).getTime();
    if (t < cutoff) continue;
    const key = e.occurredAt.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, events]) => ({ date, events }));
}

export async function getNarrative() {
  const s = await ensureLoaded();
  return { ...s.narrative };
}

/**
 * Weekly inconsistency metrics (not clinical — operational counts for caregivers).
 */
export async function getMetrics({ weeks = 8 } = {}) {
  const s = await ensureLoaded();
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const buckets = [];

  for (let w = 0; w < weeks; w++) {
    const end = now - w * weekMs;
    const start = end - weekMs;
    const inRange = s.inconsistencies.filter((i) => {
      const t = new Date(i.detectedAt).getTime();
      return t >= start && t < end;
    });
    const severities = inRange.map((i) => i.severity);
    const avgSev =
      severities.length === 0 ? 0 : severities.reduce((a, b) => a + b, 0) / severities.length;
    buckets.push({
      weekIndex: w,
      weekStart: new Date(start).toISOString().slice(0, 10),
      weekEnd: new Date(end).toISOString().slice(0, 10),
      inconsistencyCount: inRange.length,
      avgSeverityProxy: Math.round(avgSev * 1000) / 1000,
    });
  }

  const totalAllTime = s.inconsistencies.length;
  const recent14d = s.inconsistencies.filter((i) => {
    return new Date(i.detectedAt).getTime() >= now - 14 * 24 * 60 * 60 * 1000;
  }).length;

  return {
    disclaimer:
      "Operational counts only — not a medical assessment. Share with trusted caregivers as appropriate.",
    totalInconsistenciesLogged: totalAllTime,
    last14DaysCount: recent14d,
    weekly: buckets,
    narrative: { ...s.narrative },
  };
}

export async function getStateSummary() {
  const s = await ensureLoaded();
  return {
    mediaCount: s.mediaEvents.length,
    assertionCount: s.assertions.length,
    reconciliationCount: s.reconciliations.length,
    inconsistencyCount: s.inconsistencies.length,
  };
}

/**
 * Calendar-day rollup of narrative inconsistencies (for wellness / activity dashboards).
 * @param {{ days?: number }} opts
 * @returns {Promise<{ date: string, count: number, avgSeverity: number }[]>}
 */
export async function getDailyInconsistencyRollup({ days = 21 } = {}) {
  const s = await ensureLoaded();
  const dayMs = 24 * 60 * 60 * 1000;
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(Date.now() - i * dayMs).toISOString().slice(0, 10));
  }
  if (dates.length === 0) return [];
  const minDay = dates[0];
  const maxDay = dates[dates.length - 1];
  const map = new Map();
  for (const d of dates) map.set(d, { count: 0, severities: [] });

  for (const inc of s.inconsistencies) {
    const day = typeof inc.detectedAt === "string" ? inc.detectedAt.slice(0, 10) : null;
    if (!day || day < minDay || day > maxDay) continue;
    const bucket = map.get(day);
    if (!bucket) continue;
    bucket.count += 1;
    const sev = Math.min(1, Math.max(0, Number(inc.severity) || 0));
    bucket.severities.push(sev);
  }

  return dates.map((date) => {
    const bucket = map.get(date);
    const avgSeverity =
      !bucket || bucket.severities.length === 0
        ? 0
        : Math.round(
            (bucket.severities.reduce((a, b) => a + b, 0) / bucket.severities.length) * 1000,
          ) / 1000;
    return { date, count: bucket?.count ?? 0, avgSeverity };
  });
}

/**
 * Same calendar rollup as {@link getDailyInconsistencyRollup}, plus sample `detail` strings per day
 * for dashboard tooltips (min/max “why” explanations).
 * @param {{ days?: number }} opts
 * @returns {Promise<{ date: string, count: number, avgSeverity: number, reasonSamples: string[] }[]>}
 */
export async function getDailyInconsistencyDetailRollup({ days = 21 } = {}) {
  const s = await ensureLoaded();
  const dayMs = 24 * 60 * 60 * 1000;
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(Date.now() - i * dayMs).toISOString().slice(0, 10));
  }
  if (dates.length === 0) return [];
  const minDay = dates[0];
  const maxDay = dates[dates.length - 1];
  const map = new Map();
  for (const d of dates) map.set(d, { count: 0, severities: [], details: [] });

  for (const inc of s.inconsistencies) {
    const day = typeof inc.detectedAt === "string" ? inc.detectedAt.slice(0, 10) : null;
    if (!day || day < minDay || day > maxDay) continue;
    const bucket = map.get(day);
    if (!bucket) continue;
    bucket.count += 1;
    const sev = Math.min(1, Math.max(0, Number(inc.severity) || 0));
    bucket.severities.push(sev);
    const d = typeof inc.detail === "string" && inc.detail.trim() ? inc.detail.trim() : "";
    if (d && bucket.details.length < 4) bucket.details.push(d);
  }

  return dates.map((date) => {
    const bucket = map.get(date);
    const avgSeverity =
      !bucket || bucket.severities.length === 0
        ? 0
        : Math.round(
            (bucket.severities.reduce((a, b) => a + b, 0) / bucket.severities.length) * 1000,
          ) / 1000;
    return {
      date,
      count: bucket?.count ?? 0,
      avgSeverity,
      reasonSamples: bucket?.details?.length ? [...bucket.details] : [],
    };
  });
}

// ─── Who? button presses ──────────────────────────────────────────────────────

/**
 * Record a single "Who?" button press from the browser extension.
 * @param {{ url?: string, title?: string, pressedAt?: string }} input
 */
export async function addWhoPress(input = {}) {
  const s = await ensureLoaded();
  if (!Array.isArray(s.whoPresses)) s.whoPresses = [];
  const press = {
    id: id(),
    pressedAt: input.pressedAt || new Date().toISOString(),
    url: String(input.url || "").trim(),
    title: String(input.title || "").trim(),
  };
  s.whoPresses.push(press);
  await persist();
  return press;
}

/**
 * Daily rollup of "Who?" presses for the last N days.
 * Each press contributes +1 to frequency and a fixed severity of 0.6
 * (asking "who is this?" is a meaningful recognition signal).
 * @param {{ days?: number }} opts
 * @returns {Promise<{ date: string, count: number, avgSeverity: number }[]>}
 */
/** Count extension "Who?" presses in the last `hours` (wall clock). */
export async function countWhoPressesInLastHours(hours = 24) {
  const s = await ensureLoaded();
  const ms = Math.max(1, Number(hours) || 24) * 60 * 60 * 1000;
  const cutoff = Date.now() - ms;
  let n = 0;
  for (const p of s.whoPresses || []) {
    const t = typeof p.pressedAt === "string" ? new Date(p.pressedAt).getTime() : NaN;
    if (!Number.isNaN(t) && t >= cutoff) n += 1;
  }
  return n;
}

export async function getDailyWhoPressRollup({ days = 21 } = {}) {
  const s = await ensureLoaded();
  const dayMs = 24 * 60 * 60 * 1000;
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(Date.now() - i * dayMs).toISOString().slice(0, 10));
  }
  const minDay = dates[0];
  const maxDay = dates[dates.length - 1];
  const map = new Map();
  for (const d of dates) map.set(d, 0);

  for (const p of (s.whoPresses || [])) {
    const day = typeof p.pressedAt === "string" ? p.pressedAt.slice(0, 10) : null;
    if (!day || day < minDay || day > maxDay) continue;
    if (map.has(day)) map.set(day, map.get(day) + 1);
  }

  // Each "Who?" press has a fixed severity of 0.6 — it's a direct recognition signal.
  const WHO_SEVERITY = 0.6;
  return dates.map((date) => ({
    date,
    count: map.get(date) ?? 0,
    avgSeverity: (map.get(date) ?? 0) > 0 ? WHO_SEVERITY : 0,
  }));
}
