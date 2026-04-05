import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "activity.json");

const DEFAULT_USAGE = {
  firstSeenAt: null,
  totalAppMs: 0,
  timeSavedMs: 0,
  browserTasksCompleted: 0,
  hostStats: {},
};

/** Digital dashboard: top sites + personality from visits in this rolling window only (not lifetime hostStats). */
const DASHBOARD_VISIT_WINDOW_DAYS = 30;
const DASHBOARD_VISIT_WINDOW_MS = DASHBOARD_VISIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

let cache = null;

async function ensureLoaded() {
  if (cache) return cache;
  await mkdir(DATA_DIR, { recursive: true });
  try {
    cache = JSON.parse(await readFile(STORE_PATH, "utf8"));
  } catch {
    cache = { visits: [], usage: { ...DEFAULT_USAGE } };
  }
  if (!cache.visits) cache.visits = [];
  if (!cache.usage) cache.usage = { ...DEFAULT_USAGE, hostStats: {} };
  if (cache.usage.hostStats == null || typeof cache.usage.hostStats !== "object") {
    cache.usage.hostStats = {};
  }
  if (cache.usage.firstSeenAt === undefined) cache.usage.firstSeenAt = null;
  if (cache.usage.totalAppMs === undefined) cache.usage.totalAppMs = 0;
  if (cache.usage.timeSavedMs === undefined) cache.usage.timeSavedMs = 0;
  if (cache.usage.browserTasksCompleted === undefined) cache.usage.browserTasksCompleted = 0;
  return cache;
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeHostFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function bumpHost(url, title) {
  const host = normalizeHostFromUrl(url);
  if (!host) return;
  const s = cache;
  if (!s.usage.firstSeenAt) s.usage.firstSeenAt = new Date().toISOString();
  const cur = s.usage.hostStats[host] || { count: 0, lastTitle: "", sampleUrl: url };
  cur.count += 1;
  cur.lastTitle = (title && String(title).trim()) || cur.lastTitle;
  cur.sampleUrl = url;
  s.usage.hostStats[host] = cur;
}

export async function addVisit({ url, title, visitedAt }) {
  const s = await ensureLoaded();
  const visit = {
    id: id(),
    url,
    title: title || url,
    visitedAt: visitedAt || new Date().toISOString(),
  };
  s.visits.unshift(visit);
  if (s.visits.length > 1000) s.visits = s.visits.slice(0, 1000);
  bumpHost(url, title);
  await persist();
  return visit;
}

export async function listVisits({ limit = 50, search } = {}) {
  const s = await ensureLoaded();
  let rows = s.visits;
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (v) => v.url.toLowerCase().includes(q) || v.title.toLowerCase().includes(q)
    );
  }
  return rows.slice(0, limit);
}

/** Called from the app on a timer while the tab is active (capped per request). */
export async function recordUsagePing(deltaMs) {
  const s = await ensureLoaded();
  const n = Math.max(0, Math.min(Number(deltaMs) || 0, 120_000));
  if (n === 0) {
    if (!s.usage.firstSeenAt) s.usage.firstSeenAt = new Date().toISOString();
    await persist();
    return;
  }
  if (!s.usage.firstSeenAt) s.usage.firstSeenAt = new Date().toISOString();
  s.usage.totalAppMs += n;
  await persist();
}

/**
 * After a successful Boomer browser assist - estimates time saved and URLs touched.
 * @param {string} task
 */
export async function recordBrowserAutomationComplete(task) {
  const s = await ensureLoaded();
  if (!s.usage.firstSeenAt) s.usage.firstSeenAt = new Date().toISOString();
  s.usage.browserTasksCompleted += 1;
  s.usage.timeSavedMs += 5 * 60 * 1000;

  const text = typeof task === "string" ? task : "";
  const urls = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const u of urls) {
    bumpHost(u, "Browser task");
  }
  await persist();
}

/** Short label for personality text - never paste long subdomain chains. */
function shortHostLabel(host) {
  if (!host || typeof host !== "string") return "a site you like";
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h.length <= 28) return h;
  const parts = h.split(".").filter(Boolean);
  if (parts.length >= 2) {
    const base = parts.slice(-2).join(".");
    if (base.length <= 32) return base;
  }
  return `${h.slice(0, 22)}…`;
}

/**
 * @param {{ host: string, visitCount: number }[]} topSites
 */
function inferPersonalitySummary(topSites) {
  if (!topSites.length) {
    return "We're still learning your favorites - browse a bit more and your personality snapshot will appear here. It's just for fun, not science.";
  }

  let studyScore = 0;
  let musicScore = 0;
  let newsScore = 0;
  let shopScore = 0;
  let socialScore = 0;
  let streamScore = 0;
  let fantasyScore = 0;

  for (const row of topSites) {
    const host = String(row.host || "").toLowerCase();
    const w = Math.max(1, Number(row.visitCount) || 1);
    if (
      /\.edu$|\.edu\.|canvas|blackboard|coursera|khanacademy|quizlet|scholar\.google|studentemployment|campus|brightspace|moodle|classroom\.google|chegg|duolingo|edx|udemy|grammarly|notion|study|school|university|college|homework|academic|researchgate|jstor|arxiv/i.test(
        host
      )
    ) {
      studyScore += w;
    }
    if (/wikipedia\.org/i.test(host)) {
      studyScore += w * 0.6;
    }
    if (/spotify|soundcloud|music\.youtube|bandcamp|tidal|last\.fm|deezer|pandora|music\.apple/i.test(host)) {
      musicScore += w * 1.2;
    }
    if (/youtube\.com|youtu\.be/i.test(host)) {
      streamScore += w;
      musicScore += w * 0.45;
    }
    if (/twitch|netflix|hulu|disney|hbo|primevideo|peacock|paramount/i.test(host)) {
      streamScore += w;
    }
    if (/bbc\.|cnn\.|reuters|nytimes|news\.|npr\.|theguardian/i.test(host)) {
      newsScore += w;
    }
    if (/amazon\.|ebay\.|etsy\.|walmart|target\.|shopify/i.test(host)) {
      shopScore += w;
    }
    if (/facebook|instagram|messenger|whatsapp|twitter|x\.com|reddit|tiktok/i.test(host)) {
      socialScore += w;
    }
    if (/harrypotter|pottermore|fandom\.com|fanfiction|wikia|goodreads|tvtropes|imdb\.com/i.test(host)) {
      fantasyScore += w;
    }
  }

  const hosts = topSites.map((t) => t.host);
  const topLabel = shortHostLabel(hosts[0]);

  const studyWins =
    studyScore >= musicScore && studyScore >= streamScore * 0.65 && studyScore >= fantasyScore;
  if (studyScore >= 1.5 && studyWins) {
    return "You've been on a lot of studying and school-related sites - you're a nerd, and we mean that in the best way. Keep chasing that GPA.";
  }
  if (musicScore >= 2.5 || (musicScore >= 1.5 && /spotify|soundcloud|music\./i.test(hosts.join(" ")))) {
    return "Streaming and music keep rising to the top - you're a music guru. Hope the playlist slaps.";
  }
  if (fantasyScore >= 1 && studyScore < 1.5) {
    return "Fantasy and fandom keep popping up - you're a lore collector. Spoilers beware.";
  }
  if (streamScore >= 3 && studyScore < 2) {
    return "Your history screams 'one more video' - you're a certified rabbit-hole explorer. The algorithm knows your name.";
  }
  if (newsScore >= 2) {
    return "News and headlines keep showing up - you're plugged in. Remember to touch grass sometimes.";
  }
  if (shopScore >= 2) {
    return "Shopping tabs are doing overtime - you've got practical errands on lock.";
  }
  if (socialScore >= 2) {
    return "Social feeds are getting a workout - you stay connected. Don't forget the people three feet away too.";
  }

  const traits = new Set();
  for (const h of hosts) {
    const host = h.toLowerCase();
    if (/youtube|netflix|hulu|disney|twitch|spotify/.test(host)) {
      traits.add("you enjoy shows, music, and stories");
    }
    if (/bbc|cnn|reuters|nytimes|news|npr|theguardian/.test(host)) {
      traits.add("you like keeping up with the news");
    }
    if (/wikipedia|edu|arxiv|scholar/.test(host)) {
      traits.add("you're curious and enjoy learning");
    }
    if (/amazon|ebay|etsy|walmart|target|shop/.test(host)) {
      traits.add("you use the web for practical shopping and errands");
    }
    if (/facebook|instagram|messenger|whatsapp|twitter|x\.com/.test(host)) {
      traits.add("you stay connected to people online");
    }
    if (/bank|chase|wells|credit|pay/.test(host)) {
      traits.add("you handle life admin online");
    }
    if (/recipe|cook|food/.test(host)) {
      traits.add("food and cooking matter to you");
    }
    if (/health|mayo|webmd|nih/.test(host)) {
      traits.add("you look up health information thoughtfully");
    }
  }
  if (traits.size === 0) {
    return `Your recent favorites (starting with ${topLabel}) paint an eclectic mix - keep exploring. This is just for fun, not science.`;
  }
  return `Based on the sites you visit most, you seem like someone who ${[...traits].join(", ")}. Lighthearted guess - not a psychological profile.`;
}

/** Exclude search portals so "top sites" reflect destinations, not jump-off pages. */
export function isSearchEngineHost(host) {
  if (!host || typeof host !== "string") return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  if (/(\.|^)google\.[a-z.]+$/i.test(h)) return true;
  if (h === "bing.com" || h.endsWith(".bing.com")) return true;
  if (h.includes("duckduckgo")) return true;
  if (h === "yahoo.com" || h.startsWith("search.yahoo.") || h.includes(".search.yahoo.com")) return true;
  if (h === "search.brave.com") return true;
  if (h.includes("ecosia.org")) return true;
  if (h.includes("startpage.com")) return true;
  if (h.includes("qwant.com")) return true;
  if (h.includes("baidu.com") || /\.yandex\.(com|ru|net)$/i.test(h)) return true;
  if (h === "ask.com" || h === "dogpile.com" || h.includes("aolsearch.com")) return true;
  if (h.includes("searx.")) return true;
  return false;
}

export async function getDashboard() {
  const s = await ensureLoaded();
  const cutoff = Date.now() - DASHBOARD_VISIT_WINDOW_MS;
  const visitsInWindow = s.visits.filter((v) => {
    if (v == null || v.visitedAt == null) return false;
    const t = new Date(v.visitedAt).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });

  const merged = new Map();
  // Newest-first list: first time we see a host is their most recent visit in the window
  for (const v of visitsInWindow) {
    const host = normalizeHostFromUrl(v.url);
    if (!host) continue;
    const cur = merged.get(host) || { count: 0, lastTitle: "", sampleUrl: "" };
    const isFirst = cur.count === 0;
    cur.count += 1;
    if (isFirst) {
      if (v.title) cur.lastTitle = v.title;
      if (v.url) cur.sampleUrl = v.url;
    }
    merged.set(host, cur);
  }

  const topSites = [...merged.entries()]
    .filter(([host]) => !isSearchEngineHost(host))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([host, data]) => ({
      host,
      visitCount: data.count,
      lastTitle: data.lastTitle,
      sampleUrl: data.sampleUrl,
    }));

  const personality = inferPersonalitySummary(topSites);

  const totalAppMs = s.usage.totalAppMs || 0;
  const timeSavedMs = s.usage.timeSavedMs || 0;
  const hoursOnline = Math.round((totalAppMs / (1000 * 60 * 60)) * 10) / 10;
  const timeSavedHours = Math.round((timeSavedMs / (1000 * 60 * 60)) * 10) / 10;

  let tenureLabel = "just getting started";
  let tenureDays = 0;
  if (s.usage.firstSeenAt) {
    tenureDays = Math.max(
      0,
      (Date.now() - new Date(s.usage.firstSeenAt).getTime()) / (24 * 60 * 60 * 1000)
    );
    if (tenureDays < 1) tenureLabel = "less than a day";
    else if (tenureDays < 14) tenureLabel = `${Math.floor(tenureDays)} day${Math.floor(tenureDays) === 1 ? "" : "s"}`;
    else if (tenureDays < 60) tenureLabel = `${Math.floor(tenureDays / 7)} weeks`;
    else tenureLabel = `${Math.floor(tenureDays / 30)} months`;
  }

  return {
    topSites,
    personality,
    hoursOnline,
    timeSavedHours,
    browserTasksCompleted: s.usage.browserTasksCompleted || 0,
    tenureDays: Math.round(tenureDays * 10) / 10,
    tenureLabel,
    firstSeenAt: s.usage.firstSeenAt,
    topSitesWindowDays: DASHBOARD_VISIT_WINDOW_DAYS,
  };
}
