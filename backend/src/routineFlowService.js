import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { listVisits, normalizeHostFromUrl, isSearchEngineHost } from "./activityStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const ROUTINE_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
const MAX_STEPS = 5;

/**
 * Fixed daily routine (Gmail → YouTube → Messenger). Set to `[]` to mine steps from activity again.
 * @type {{ title: string, url: string }[]}
 */
const HARDCODED_DAILY_ROUTINE = [
  { title: "Gmail", url: "https://mail.google.com/" },
  { title: "YouTube", url: "https://www.youtube.com/" },
  { title: "Messenger", url: "https://www.messenger.com/" },
];

function activityDbPath() {
  if (process.env.BOOMER_ACTIVITY_DB) return process.env.BOOMER_ACTIVITY_DB;
  return path.join(DATA_DIR, "activity.db");
}

/**
 * Prefer SQLite activity store when present (same path family as optional migrations).
 * @returns {{ url: string, title: string, visitedAt: string }[] | null}
 */
function readVisitsFromSqlite() {
  const p = activityDbPath();
  if (!fs.existsSync(p)) return null;
  let db;
  try {
    db = new Database(p, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.warn("[routineFlow] could not open SQLite:", e instanceof Error ? e.message : e);
    return null;
  }
  try {
    const rows = db
      .prepare(
        `SELECT url, title, visited_at AS visitedAt
         FROM visits
         ORDER BY visited_at DESC
         LIMIT 1500`,
      )
      .all();
    return rows.map((r) => ({
      url: String(r.url || "").trim(),
      title: String(r.title || "").trim() || "(no title)",
      visitedAt: typeof r.visitedAt === "string" ? r.visitedAt : new Date().toISOString(),
    }));
  } catch (e) {
    console.warn("[routineFlow] SQLite visits query failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

function isAllowedHttpUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Build up to MAX_STEPS destinations: chronological “first seen” order in-window,
 * then fill by visit frequency. One canonical URL per host (most recent in window).
 */
export function buildRoutineFlow(visits) {
  const cutoff = Date.now() - ROUTINE_WINDOW_MS;
  const filtered = visits.filter((v) => {
    if (!isAllowedHttpUrl(v.url)) return false;
    const t = new Date(v.visitedAt).getTime();
    if (Number.isNaN(t) || t < cutoff) return false;
    const host = normalizeHostFromUrl(v.url);
    if (!host || isSearchEngineHost(host)) return false;
    return true;
  });

  if (filtered.length === 0) {
    return {
      patternSummary:
        "Not enough recent visits in the last few weeks to infer a routine. Browse a bit more and try again.",
      steps: [],
    };
  }

  const ascending = [...filtered].sort(
    (a, b) => new Date(a.visitedAt).getTime() - new Date(b.visitedAt).getTime(),
  );

  /** @type {Map<string, { count: number, lastUrl: string, lastTitle: string, lastAt: number }>} */
  const stats = new Map();
  for (const v of filtered) {
    const host = normalizeHostFromUrl(v.url);
    if (!host) continue;
    const t = new Date(v.visitedAt).getTime();
    const cur = stats.get(host) || { count: 0, lastUrl: v.url, lastTitle: v.title, lastAt: 0 };
    cur.count += 1;
    if (t >= cur.lastAt) {
      cur.lastAt = t;
      cur.lastUrl = v.url;
      cur.lastTitle = v.title || cur.lastTitle;
    }
    stats.set(host, cur);
  }

  const orderFirstSeen = [];
  const seen = new Set();
  for (const v of ascending) {
    const host = normalizeHostFromUrl(v.url);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    orderFirstSeen.push(host);
  }

  const byFreq = [...stats.entries()].sort((a, b) => b[1].count - a[1].count).map(([h]) => h);

  /** @type {string[]} */
  const merged = [];
  for (const h of orderFirstSeen) {
    if (merged.length >= MAX_STEPS) break;
    if (!merged.includes(h)) merged.push(h);
  }
  for (const h of byFreq) {
    if (merged.length >= MAX_STEPS) break;
    if (!merged.includes(h)) merged.push(h);
  }

  const steps = merged.slice(0, MAX_STEPS).map((host, i) => {
    const s = stats.get(host);
    return {
      order: i + 1,
      host,
      url: s.lastUrl,
      title: s.lastTitle,
      visitCountWindow: s.count,
      reason: `Seen ${s.count} time${s.count === 1 ? "" : "s"} in the last ~3 weeks; ordered by typical session flow, then popularity.`,
    };
  });

  const hostsLine = steps.map((s) => s.host).join(" → ");
  const patternSummary = `From your recent browsing pattern, a sensible ${steps.length}-stop flow is: ${hostsLine}. These are destinations you actually use — not medical or clinical advice.`;

  return { patternSummary, steps };
}

/**
 * @returns {Promise<{ source: string, patternSummary: string, steps: object[], maxSteps: number, agents_used: string[] }>}
 */
export async function getRoutineFlow() {
  if (HARDCODED_DAILY_ROUTINE.length > 0) {
    const steps = HARDCODED_DAILY_ROUTINE.map((item, i) => {
      const url = String(item.url || "").trim();
      const host = normalizeHostFromUrl(url) || "site";
      return {
        order: i + 1,
        host,
        url,
        title: item.title || host,
        visitCountWindow: 0,
        reason: "Configured fixed routine (routineFlowService.js).",
      };
    });
    const titles = steps.map((s) => s.title).join(" → ");
    return {
      source: "hardcoded",
      patternSummary: `Your daily routine: ${titles}.`,
      steps,
      maxSteps: MAX_STEPS,
      agents_used: ["hardcoded-routine"],
    };
  }

  let source = "json";
  let visits = readVisitsFromSqlite();
  if (visits?.length) {
    source = "sqlite";
  } else {
    const rows = await listVisits({ limit: 1200 });
    visits = rows.map((v) => ({
      url: v.url,
      title: v.title || v.url,
      visitedAt: v.visitedAt || new Date().toISOString(),
    }));
  }

  const { patternSummary, steps } = buildRoutineFlow(visits);
  return {
    source,
    patternSummary,
    steps,
    maxSteps: MAX_STEPS,
    agents_used: ["local-activity-pattern-sequencer"],
  };
}
