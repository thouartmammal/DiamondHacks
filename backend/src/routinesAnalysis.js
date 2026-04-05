import { getDashboard } from "./activityStore.js";
import { getPhysicalActivityDashboard } from "./physicalActivityStore.js";
import { getMetrics } from "./memoryStore.js";
import { invokeFetchAiRoutinesAgent, normalizeRoutinesAgentResponse } from "./fetchAiRoutinesBridge.js";

/** Last 14 calendar days as YYYY-MM-DD (inclusive). */
function last14DateSet() {
  const set = new Set();
  for (let i = 13; i >= 0; i--) {
    set.add(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }
  return set;
}

/**
 * Rolling 14-day stats from physical-activity series (aligned with chart window semantics).
 * @param {Awaited<ReturnType<typeof getPhysicalActivityDashboard>>} phys
 */
function computeMemorySeries14d(phys) {
  const d14 = last14DateSet();
  const degSeries = phys.memoryLossDegreeSeries || [];
  const freqSeries = phys.memoryLossFrequencySeries || [];

  const degrees = [];
  for (const p of degSeries) {
    if (!d14.has(p.date)) continue;
    if (p.value != null && !Number.isNaN(Number(p.value))) {
      degrees.push(Number(p.value));
    }
  }
  const avgMemorySlipDegree14d = degrees.length ? degrees.reduce((a, b) => a + b, 0) / degrees.length : null;
  const maxMemorySlipDegree14d = degrees.length ? Math.max(...degrees) : null;

  let sumSlipFrequency14d = 0;
  let maxDailySlipFrequency14d = 0;
  for (const p of freqSeries) {
    if (!d14.has(p.date)) continue;
    const c = Number(p.count) || 0;
    sumSlipFrequency14d += c;
    maxDailySlipFrequency14d = Math.max(maxDailySlipFrequency14d, c);
  }
  const avgDailySlipFrequency14d = sumSlipFrequency14d / 14;

  return {
    avgMemorySlipDegree14d,
    maxMemorySlipDegree14d,
    sumSlipFrequency14d,
    maxDailySlipFrequency14d,
    avgDailySlipFrequency14d,
  };
}

/**
 * Data-driven dialogue for the UI (numbers + memory-signal intensity, not meta “report tone”).
 * @param {Record<string, unknown>} s
 * @returns {{ id: string, role: 'engagement' | 'safeguards', text: string }[]}
 */
export function buildNegotiationChatLines(s) {
  const h = typeof s.hoursOnline === "number" ? s.hoursOnline : 0;
  const tasks = typeof s.browserTasksCompleted === "number" ? s.browserTasksCompleted : 0;
  const mood = typeof s.averageMediaMood === "number" ? s.averageMediaMood : 0;
  const moodLabel = typeof s.averageMediaMoodLabel === "string" ? s.averageMediaMoodLabel : "neutral trend";

  const slip14 = Number(s.memorySlipsLast14Days) || 0;
  const slipTot = Number(s.memorySlipsTotalLogged) || 0;

  const avgDeg = s.avgMemorySlipDegree14d != null ? Number(s.avgMemorySlipDegree14d) : null;
  const maxDeg = s.maxMemorySlipDegree14d != null ? Number(s.maxMemorySlipDegree14d) : null;
  const sumFreq = Number(s.sumSlipFrequency14d) || 0;
  const maxDaily = Number(s.maxDailySlipFrequency14d) || 0;
  const avgDailyFreq = typeof s.avgDailySlipFrequency14d === "number" ? s.avgDailySlipFrequency14d : sumFreq / 14;

  const degStr = avgDeg != null && !Number.isNaN(avgDeg) ? avgDeg.toFixed(2) : "n/a";
  const maxDegStr = maxDeg != null && !Number.isNaN(maxDeg) ? maxDeg.toFixed(2) : "n/a";

  let intensityBand;
  if (slip14 === 0 && (avgDeg == null || avgDeg < 0.2) && sumFreq < 3) {
    intensityBand = "light in this 14-day window—few logged friction signals";
  } else if (slip14 >= 20 || (maxDeg != null && maxDeg >= 0.75) || maxDaily >= 8) {
    intensityBand = "elevated on these in-app metrics—flag for clinician correlation, not a diagnosis";
  } else if (slip14 >= 6 || (avgDeg != null && avgDeg >= 0.42) || maxDaily >= 4 || sumFreq >= 18) {
    intensityBand = "moderate—several distinct signals in the same window worth noting on the chart";
  } else {
    intensityBand = "mixed or modest—some activity, but not a spike on every axis";
  }

  return [
    {
      id: "e1",
      role: "engagement",
      text: `Engagement — From the logs: ~${h} h with the assistant visible, ${tasks} assisted browser task${tasks === 1 ? "" : "s"}, media mood ${mood.toFixed(2)} (${moodLabel}). Recall-check difficulty (0–1) averaged ${degStr} over the last 14 days with a peak of ${maxDegStr}.`,
    },
    {
      id: "s1",
      role: "safeguards",
      text: `Safeguards — Narrative mismatch events: ${slip14} in 14 days, ${slipTot} logged all-time. “Tip of tongue” / forgotten-detail counts sum to ${sumFreq} across those 14 days (worst day ${maxDaily}; ~${avgDailyFreq.toFixed(1)} per day on average). Those are app tallies—noise, multitasking, or real inconsistency has to be sorted out in clinic.`,
    },
    {
      id: "e2",
      role: "engagement",
      text: `Engagement — So the combined picture is ${intensityBand}. I’m weighting the difficulty line (${degStr} avg) against slip volume (${slip14} events) and daily frequency (${sumFreq} summed)—when they diverge, I treat it as “worth watching,” not proof.`,
    },
    {
      id: "s2",
      role: "safeguards",
      text: `Safeguards — Agreed. For the clinician memo we’ll carry the numbers verbatim: ${slip14} slip events / 14d, difficulty avg ${degStr} (max ${maxDegStr}), frequency sum ${sumFreq} (peak day ${maxDaily}). We state intensity as in-app only and stop there.`,
    },
  ];
}

/**
 * @param {Awaited<ReturnType<typeof getDashboard>>} dash
 * @param {Awaited<ReturnType<typeof getPhysicalActivityDashboard>>} phys
 * @param {Awaited<ReturnType<typeof getMetrics>>} mem
 */
function buildNegotiationSnapshot(dash, phys, mem) {
  const series14 = computeMemorySeries14d(phys);
  return {
    hoursOnline: dash.hoursOnline,
    browserTasksCompleted: dash.browserTasksCompleted,
    memorySlipsLast14Days: Number(mem.last14DaysCount) || 0,
    memorySlipsTotalLogged: Number(mem.totalInconsistenciesLogged) || 0,
    averageMediaMood: phys.averageMediaMood,
    averageMediaMoodLabel: phys.averageMediaMoodLabel,
    ...series14,
  };
}

/**
 * Live metrics + scripted chat lines for the negotiation modal (same stores as /routines/analyze).
 */
export async function getRoutinesNegotiationContext() {
  const [dash, phys, mem] = await Promise.all([
    getDashboard(),
    getPhysicalActivityDashboard(),
    getMetrics({ weeks: 4 }),
  ]);

  const snapshot = buildNegotiationSnapshot(dash, phys, mem);

  return {
    ...snapshot,
    negotiationChat: buildNegotiationChatLines(snapshot),
  };
}

/**
 * Compact payload for remote agents (no PII beyond browsing stats).
 */
function summarizeContext(dash, phys, mem) {
  return {
    personalitySnippet: typeof dash.personality === "string" ? dash.personality.slice(0, 400) : "",
    hoursOnline: dash.hoursOnline,
    browserTasksCompleted: dash.browserTasksCompleted,
    tenureLabel: dash.tenureLabel,
    memorySlipsLast14Days: mem.last14DaysCount,
    memorySlipsTotalLogged: mem.totalInconsistenciesLogged,
    lastNarrativeEpisode: mem.narrative?.lastConfirmedEpisode ?? null,
    averageMediaMood: phys.averageMediaMood,
    averageMediaMoodLabel: phys.averageMediaMoodLabel,
    mediaAgeBand: phys.mediaAgeBand,
  };
}

/**
 * Simulated agent negotiation → single clinician-facing note (local fallback).
 * Tone: third person, addressed to treating clinician / chart review—not direct patient counseling.
 */
function localNegotiationFromMetrics(dash, phys, mem) {
  const slips14 = Number(mem.last14DaysCount) || 0;
  const slipsTotal = Number(mem.totalInconsistenciesLogged) || 0;
  const mood = typeof phys.averageMediaMood === "number" ? phys.averageMediaMood : 0;
  const moodLabel = typeof phys.averageMediaMoodLabel === "string" ? phys.averageMediaMoodLabel : "neutral trend";
  const hours = typeof dash.hoursOnline === "number" ? dash.hoursOnline : 0;
  const tasks = typeof dash.browserTasksCompleted === "number" ? dash.browserTasksCompleted : 0;
  const personality =
    typeof dash.personality === "string" && dash.personality.trim()
      ? dash.personality.trim().slice(0, 280)
      : "Limited browsing-style signal yet (insufficient site diversity).";

  const engagementView = `In-app engagement signals: approximately ${hours} hour${hours === 1 ? "" : "s"} with the assistant visible; ${tasks} assisted browser task${tasks === 1 ? "" : "s"} completed. Browsing-style summary (heuristic): ${personality} Media-inferred mood index ${mood.toFixed(2)} (${moodLabel}).`;

  const safeguardsView = `Safety constraints: this platform does not diagnose. Narrative-slip counts are operational logs only (${slips14} in 14 days, ${slipsTotal} all-time). High counts may reflect metadata noise, multitasking, or true inconsistency—clinical correlation is required. Screen-estimated mood is not a mental-health instrument.`;

  const slipConsensus =
    slips14 === 0
      ? "Consensus: no logged slips in 14 days; no special escalation from this signal alone."
      : slips14 >= 8
        ? "Consensus: slip frequency is elevated in-app; consider whether in-office cognitive or safety assessment is indicated and whether collateral history aligns."
        : "Consensus: moderate slip activity logged; correlate with visit history and real-world function before inferring significance.";

  const moodAddendum =
    mood < -0.2
      ? "Media mood is somewhat negative on title heuristics—if relevant, explore mood and sleep in clinic."
      : null;

  const keyNumbers = `Key numbers for the record: ${hours}h app time, mood ${mood.toFixed(2)}, slips ${slips14} (14d) / ${slipsTotal} (total).`;

  const negotiatedSummaryForProvider = [
    "Dear colleague — for chart review: two internal agents (engagement vs. safeguards) negotiated to the following single consensus. Do not use verbatim as unsupervised patient-facing medical advice.",
    engagementView,
    safeguardsView,
    slipConsensus,
    moodAddendum,
    keyNumbers,
  ]
    .filter(Boolean)
    .join("\n\n");

  const providerQuestions = [
    slips14 > 0
      ? "Is formal cognitive assessment or neurology referral appropriate given slip frequency and your clinical picture?"
      : null,
    "Does collateral history from family align with these operational app metrics?",
    mood < -0.2 ? "Any mood or sleep concerns warranting separate evaluation?" : null,
    "Are medications, hydration, and vision/hearing stable since last visit?",
  ].filter(Boolean);

  return {
    caregiverHealth: {
      disclaimer: `${mem.disclaimer ?? "Operational counts only — not a medical assessment."} This note is generated for licensed clinicians and caregivers reviewing the chart; it is not a diagnosis.`,
      negotiatedSummaryForProvider,
      providerQuestions,
    },
  };
}

/**
 * @returns {Promise<{ caregiverHealth: object, source: string, agents_used?: string[], negotiationChat: ReturnType<typeof buildNegotiationChatLines> }>}
 */
export async function analyzeRoutinesCaregiverNegotiation() {
  const [dash, phys, mem] = await Promise.all([
    getDashboard(),
    getPhysicalActivityDashboard(),
    getMetrics({ weeks: 4 }),
  ]);

  const negotiationChat = buildNegotiationChatLines(buildNegotiationSnapshot(dash, phys, mem));

  const context = summarizeContext(dash, phys, mem);
  const physicalSnapshot = {
    averageMediaMood: phys.averageMediaMood,
    averageMediaMoodLabel: phys.averageMediaMoodLabel,
    mediaAgeBand: phys.mediaAgeBand,
    estimatedContentAgeYears: phys.estimatedContentAgeYears,
  };
  const url = process.env.FETCHAI_ROUTINES_AGENT_URL?.trim();

  if (url) {
    const raw = await invokeFetchAiRoutinesAgent(url, { context, physicalSnapshot });
    const normalized = normalizeRoutinesAgentResponse(raw);
    if (normalized) {
      const baseDisclaimer =
        mem.disclaimer ??
        "Operational counts only — not a medical assessment. For clinician / caregiver review.";
      return {
        caregiverHealth: {
          disclaimer: normalized.disclaimer || baseDisclaimer,
          negotiatedSummaryForProvider: normalized.negotiatedSummaryForProvider,
          providerQuestions: normalized.providerQuestions,
        },
        negotiationChat,
        source: "fetch-ai",
        agents_used: ["remote-routines-agent-negotiation"],
      };
    }
  }

  const local = localNegotiationFromMetrics(dash, phys, mem);
  return {
    ...local,
    negotiationChat,
    source: "local",
    agents_used: ["local-negotiation-pair→single-provider-note"],
  };
}
