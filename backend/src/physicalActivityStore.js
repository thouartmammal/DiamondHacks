import { listVisits, normalizeHostFromUrl } from "./activityStore.js";
import {
  getDailyInconsistencyDetailRollup,
  getDailyWhoPressRollup,
} from "./memoryStore.js";

function lastNDates(n) {
  const day = 24 * 60 * 60 * 1000;
  const dates = [];
  for (let i = n - 1; i >= 0; i--) {
    dates.push(new Date(Date.now() - i * day).toISOString().slice(0, 10));
  }
  return dates;
}

const POS_MOOD = [
  /\b(comedy|funny|laugh|uplift|feel-?good|wholesome|heartwarming|triumph|joy|celebrat|cute\s*(baby|animal|cat|dog)|relax|meditation|yoga|nature\s*doc|peaceful|inspir|success\s*story)\b/i,
  /\b(recipe|cooking|garden|craft|hobby|music\s*video|concert|acoustic)\b/i,
];
const NEG_MOOD = [
  /\b(horror|tragedy|shooting|terror|war\s*crime|distress|graphic\s*violence|anxiety|panic|died|death\s*toll|breaking:\s*.*disaster)\b/i,
  /\b(true\s*crime|murder|serial\s*killer|nsfw|explicit)\b/i,
];
const POS_HOST = /spotify|soundcloud|calm\.com|headspace|duolingo|khanacademy/i;
const NEWS_HOST = /bbc\.|cnn|reuters|nytimes|theguardian|npr\.|news\./i;

const KID_SIGNAL = /kids\.youtube|pbs\s*kids|nick\s*jr|nickelodeon|cocomelon|cartoonito|disney\s*junior|sesame|cbeebies|cartoon\s*network(?!\s*adult)/i;
const TEEN_SIGNAL = /\b(tiktok|roblox|fortnite|snapchat|minecraft\s*lets\s*play|anime\s*crunchy)\b|crunchyroll\.|twitch\.tv\/(?!directory)/i;
const SENIOR_SIGNAL = /\b(classic\s*cinema|golden\s*age|black\s*and\s*white|nostalgia|bing\s*crosby|fred\s*astaire|tcm\.|britbox.*classic)\b/i;
const ADULT_SIGNAL = /netflix|hulu|primevideo|hbo|peacock|paramount|documentary|linkedin|nytimes|wsj/i;

/**
 * Lexicon + host-aware score for a single visit title/URL [-1, 1].
 */
function scoreVisitMood(title, url) {
  const text = `${title || ""} ${url || ""}`;
  const t = text.toLowerCase();
  let score = 0;
  let hits = 0;
  for (const re of POS_MOOD) {
    if (re.test(t)) {
      score += 0.42;
      hits++;
    }
  }
  for (const re of NEG_MOOD) {
    if (re.test(t)) {
      score -= 0.48;
      hits++;
    }
  }
  try {
    const host = normalizeHostFromUrl(url) || "";
    if (POS_HOST.test(host)) {
      score += 0.12;
      hits++;
    }
    if (NEWS_HOST.test(host)) {
      score -= 0.08;
      hits++;
    }
  } catch {
    /* ignore */
  }
  if (hits === 0) return 0.06;
  const dampened = score / Math.sqrt(hits);
  return Math.max(-1, Math.min(1, dampened));
}

function votingAgeBand(visits) {
  let kids = 0;
  let teen = 0;
  let adult = 0;
  let senior = 0;
  for (const v of visits) {
    const blob = `${v.url} ${v.title || ""}`;
    const w = 1;
    if (KID_SIGNAL.test(blob)) kids += 2.5 * w;
    if (TEEN_SIGNAL.test(blob)) teen += 1.8 * w;
    if (SENIOR_SIGNAL.test(blob)) senior += 2 * w;
    if (ADULT_SIGNAL.test(blob)) adult += 1.2 * w;
    try {
      const h = normalizeHostFromUrl(v.url) || "";
      if (/youtube\.com|youtu\.be/i.test(h)) adult += 0.35;
      if (/kids\.youtube/i.test(h)) kids += 3;
    } catch {
      /* ignore */
    }
  }
  const scores = [
    ["kids", kids],
    ["teen", teen],
    ["adult", adult + 0.01],
    ["senior", senior],
  ].filter(([, s]) => s > 0);
  if (scores.length === 0) return { band: "mixed", description: "Not enough media titles yet to infer an age skew - browse or log shows and this will sharpen." };
  scores.sort((a, b) => b[1] - a[1]);
  const top = scores[0][0];
  const second = scores[1]?.[1] || 0;
  if (scores[0][1] > 0 && second > scores[0][1] * 0.65) {
    return {
      band: "mixed",
      description:
        "Your titles span several age moods (family, general web, and streaming). Keep browsing - the tapestry fills in over time.",
    };
  }
  switch (top) {
    case "kids":
      return {
        band: "kids",
        description:
          "Many visits look kid- or family-oriented (channels, learning, or all-ages titles).",
      };
    case "teen":
      return {
        band: "teen",
        description: "Frequent youth-skewing platforms or titles (social, games, or creator culture).",
      };
    case "senior":
      return {
        band: "senior",
        description: "Signals point toward classic or nostalgia-forward programming and discovery.",
      };
    default:
      return {
        band: "adult",
        description: "Broadly adult-leaning media and general web (news, streaming, productivity).",
      };
  }
}

function bandToYears(band) {
  switch (band) {
    case "kids":
      return 9;
    case "teen":
      return 16;
    case "senior":
      return 62;
    case "adult":
      return 38;
    default:
      return null;
  }
}

function moodLabel(avg) {
  if (avg >= 0.35) return "Mostly positive or uplifting titles lately";
  if (avg >= 0.12) return "Gently positive - a mix of light and serious pages";
  if (avg >= -0.12) return "Mostly neutral - occasional uplift";
  if (avg >= -0.35) return "Leans serious or heavy themes on average";
  return "Heavy or tense themes dominate recent titles (take breaks if you need to)";
}

/**
 * "Cognitive load" proxy from same-day inconsistency events [0,1].
 */
function memoryStressProxy(count, avgSeverity) {
  if (count <= 0) return 0;
  const freq = 1 - Math.exp(-count / 2.2);
  const sev = Math.min(1, avgSeverity * 1.15);
  return Math.min(1, 0.45 * freq + 0.55 * sev);
}

/**
 * Blend media-inferred mood with memory friction (same day): friction pulls the curve down slightly.
 */
function holisticMood(mediaMood, stress) {
  const w = memoryStressProxy(stress.count, stress.avgSeverity);
  const y = mediaMood * (1 - 0.22 * w) - 0.12 * w;
  return Math.max(-1, Math.min(1, Math.round(y * 1000) / 1000));
}

function truncateDriver(s, max = 240) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Human-readable “why” for mood on a day (media titles + narrative-slip stress).
 */
function moodDriverFromVisits(dayVisits, inc, reasonSamples) {
  const stress = memoryStressProxy(inc.count, inc.avgSeverity);
  const slipBits = [];
  if (inc.count > 0) {
    slipBits.push(
      `${inc.count} narrative slip${inc.count === 1 ? "" : "s"} (avg severity ${inc.avgSeverity.toFixed(2)})`,
    );
    if (reasonSamples.length) {
      slipBits.push(`Examples: ${reasonSamples.slice(0, 2).map((r) => truncateDriver(r, 100)).join(" · ")}`);
    }
  }
  if (dayVisits.length === 0) {
    if (inc.count === 0) {
      return truncateDriver("No visits and no slips — near-neutral baseline.");
    }
    return truncateDriver(
      `No page visits; mood reflects narrative slips only. ${slipBits.join(" ")}`.trim(),
    );
  }
  const titles = dayVisits
    .map((v) => String(v.title || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const titlePart =
    titles.length > 0
      ? `From titles (${dayVisits.length} visit${dayVisits.length === 1 ? "" : "s"}): ${titles.join(" · ")}.`
      : `${dayVisits.length} visit${dayVisits.length === 1 ? "" : "s"} (neutral title signals).`;
  const blend =
    stress > 0.05
      ? ` Blended with slip stress (${(stress * 100).toFixed(0)}% load) — pulls mood toward neutral/heavy.`
      : "";
  const slipSuffix = slipBits.length ? ` ${slipBits.join(" ")}` : "";
  return truncateDriver(`${titlePart}${blend}${slipSuffix}`);
}

function memoryDriverFromInc(inc, reasonSamples, whoCount = 0) {
  if (inc.count === 0 && whoCount === 0) {
    return "No slips that day — value is the low baseline (not zero so the line stays visible).";
  }
  const parts = [
    `${inc.count} slip${inc.count === 1 ? "" : "s"}`,
    `avg severity ${inc.avgSeverity.toFixed(2)}`,
    `stress index ${memoryStressProxy(inc.count, inc.avgSeverity).toFixed(2)}`,
  ];
  if (whoCount > 0) {
    parts.push(`${whoCount} "Who?" press${whoCount === 1 ? "" : "es"} (face/name recognition signal)`);
  }
  if (reasonSamples.length) {
    parts.push(`Detail: ${truncateDriver(reasonSamples[0], 180)}`);
  }
  return truncateDriver(parts.join(". ") + ".");
}

function frequencyDriverFromInc(inc, reasonSamples, whoCount = 0) {
  const total = inc.count + whoCount;
  if (total === 0) {
    return "No narrative, mismatch, or \"Who?\" events logged for this day.";
  }
  const parts = [];
  if (inc.count > 0) {
    parts.push(`${inc.count} narrative event${inc.count === 1 ? "" : "s"} (severity avg ${inc.avgSeverity.toFixed(2)})`);
  }
  if (whoCount > 0) {
    parts.push(`${whoCount} "Who?" press${whoCount === 1 ? "" : "es"}`);
  }
  const head = parts.join(" + ") + ".";
  if (!reasonSamples.length) return truncateDriver(head);
  return truncateDriver(`${head} Example: ${truncateDriver(reasonSamples[0], 160)}`);
}

export async function getPhysicalActivityDashboard() {
  const dates = lastNDates(21);
  const visits = await listVisits({ limit: 2500 });
  const cutoff = dates[0];
  const recentVisits = visits.filter((v) => typeof v.visitedAt === "string" && v.visitedAt.slice(0, 10) >= cutoff);

  const byDay = new Map();
  for (const d of dates) byDay.set(d, []);
  for (const v of recentVisits) {
    const day = v.visitedAt.slice(0, 10);
    if (!byDay.has(day)) continue;
    byDay.get(day).push(v);
  }

  const incRollup = await getDailyInconsistencyDetailRollup({ days: 21 });
  const incByDate = new Map(incRollup.map((r) => [r.date, r]));

  const whoRollup = await getDailyWhoPressRollup({ days: 21 });
  const whoByDate = new Map(whoRollup.map((r) => [r.date, r]));

  const moodSeries = dates.map((date) => {
    const dayVisits = byDay.get(date) || [];
    const inc = incByDate.get(date) || { count: 0, avgSeverity: 0, reasonSamples: [] };
    const samples = inc.reasonSamples || [];
    if (dayVisits.length === 0) {
      const mood = holisticMood(0.04, inc);
      return {
        date,
        mood,
        moodDriver: moodDriverFromVisits(dayVisits, inc, samples),
      };
    }
    const rawAvg =
      dayVisits.reduce((acc, v) => acc + scoreVisitMood(v.title, v.url), 0) / dayVisits.length;
    const m = holisticMood(rawAvg, inc);
    return {
      date,
      mood: m,
      moodDriver: moodDriverFromVisits(dayVisits, inc, samples),
    };
  });

  const averageMediaMood =
    moodSeries.length > 0
      ? Math.round((moodSeries.reduce((acc, r) => acc + r.mood, 0) / moodSeries.length) * 1000) /
        1000
      : 0;
  const averageMediaMoodLabel = moodLabel(averageMediaMood);

  const { band: mediaAgeBand, description: mediaAgeDescription } = votingAgeBand(recentVisits);
  const estimatedContentAgeYears = bandToYears(mediaAgeBand);

  const memoryLossDegreeSeries = dates.map((date) => {
    const inc = incByDate.get(date) || { count: 0, avgSeverity: 0, reasonSamples: [] };
    const who = whoByDate.get(date) || { count: 0, avgSeverity: 0 };
    const samples = inc.reasonSamples || [];
    // Blend inconsistency events + who-presses: each who-press adds to count with severity 0.6
    const blendedCount = inc.count + who.count;
    const blendedSeverity =
      blendedCount === 0
        ? 0
        : (inc.count * inc.avgSeverity + who.count * who.avgSeverity) / blendedCount;
    const v =
      blendedCount === 0
        ? 0.02
        : Math.min(0.98, Math.max(0.04, memoryStressProxy(blendedCount, blendedSeverity)));
    return {
      date,
      value: Math.round(v * 1000) / 1000,
      memoryDriver: memoryDriverFromInc(
        { count: blendedCount, avgSeverity: blendedSeverity },
        samples,
        who.count,
      ),
    };
  });

  const memoryLossFrequencySeries = dates.map((date) => {
    const inc = incByDate.get(date) || { count: 0, avgSeverity: 0, reasonSamples: [] };
    const who = whoByDate.get(date) || { count: 0, avgSeverity: 0 };
    const samples = inc.reasonSamples || [];
    const totalCount = inc.count + who.count;
    return {
      date,
      count: totalCount,
      whoCount: who.count,
      frequencyDriver: frequencyDriverFromInc(
        { count: inc.count, avgSeverity: inc.avgSeverity },
        samples,
        who.count,
      ),
    };
  });

  const visitDaysWithData = dates.filter((d) => (byDay.get(d) || []).length > 0).length;

  return {
    averageMediaMood,
    averageMediaMoodLabel,
    mediaAgeBand,
    mediaAgeDescription,
    estimatedContentAgeYears,
    moodSeries,
    memoryLossDegreeSeries,
    memoryLossFrequencySeries,
    meta: {
      computedAt: new Date().toISOString(),
      windowDays: 21,
      visitsInWindow: recentVisits.length,
      visitDaysWithData,
      inconsistencyEventsInWindow: incRollup.reduce((a, r) => a + r.count, 0),
      blendNote:
        "Mood blends page-title heuristics with same-day narrative slips (episode mismatches). Estimates only - not clinical.",
    },
  };
}
