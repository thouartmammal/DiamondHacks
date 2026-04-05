import { listVisits, normalizeHostFromUrl } from "./activityStore.js";
import { countWhoPressesInLastHours } from "./memoryStore.js";

/**
 * Aggregate visit stats for [startMs, endMs).
 * @param {Array<{ url: string, visitedAt: string }>} visits
 */
export function computeHostStatsForRange(visits, startMs, endMs) {
  const inRange = visits.filter((v) => {
    const t = new Date(v.visitedAt).getTime();
    return !Number.isNaN(t) && t >= startMs && t < endMs;
  });

  const hosts = Object.create(null);
  for (const v of inRange) {
    const h = normalizeHostFromUrl(v.url) || "";
    if (!h) continue;
    hosts[h] = (hosts[h] || 0) + 1;
  }
  const entries = Object.entries(hosts).sort((a, b) => b[1] - a[1]);
  const [topHost, topHits] = entries[0] || ["", 0];
  const visitCount = inRange.length;
  const uniqueHosts = entries.length;
  const repeatRatio = visitCount > 0 ? topHits / visitCount : 0;

  return {
    visit_count: visitCount,
    unique_hosts: uniqueHosts,
    top_host: topHost,
    top_host_hits: topHits,
    repeat_ratio: Math.round(repeatRatio * 1000) / 1000,
  };
}

/**
 * @param {ReturnType<typeof computeHostStatsForRange>} baseline
 * @param {ReturnType<typeof computeHostStatsForRange>} current
 */
export function computeDriftFromMetrics(baseline, current) {
  const vBase = Math.max(0, baseline.visit_count);
  const vCur = current.visit_count;
  const visitDelta = vCur - vBase;
  const visitStress =
    vBase < 1 ? Math.min(1, vCur / 20) : Math.min(2, Math.abs(visitDelta) / vBase);
  const repeatDelta = Math.abs(current.repeat_ratio - baseline.repeat_ratio);
  const score = Math.min(
    1,
    0.35 * Math.min(visitStress, 1.5) / 1.5 + 0.45 * Math.min(repeatDelta * 2.5, 1) + 0.2 * (uniqueHostShift(baseline, current) ? 1 : 0),
  );

  let severity = "none";
  if (score >= 0.45) severity = "medium";
  else if (score >= 0.2) severity = "low";

  const hints = [];
  if (Math.abs(visitDelta) >= 5 && vBase >= 3)
    hints.push(
      visitDelta > 0
        ? `More visits than your usual window (+${visitDelta}).`
        : `Fewer visits than your usual window (${visitDelta}).`,
    );
  if (repeatDelta >= 0.15)
    hints.push(
      current.repeat_ratio > baseline.repeat_ratio
        ? "You are spending a larger share of time on one site than before."
        : "Your browsing is more spread out than your prior window.",
    );
  if (baseline.top_host && current.top_host && baseline.top_host !== current.top_host)
    hints.push(`Top site changed from "${baseline.top_host}" to "${current.top_host}".`);

  return {
    score: Math.round(score * 1000) / 1000,
    severity,
    hints,
    visit_delta: visitDelta,
    repeat_delta: Math.round(repeatDelta * 1000) / 1000,
  };
}

function uniqueHostShift(baseline, current) {
  if (!baseline.top_host || !current.top_host) return false;
  return baseline.top_host !== current.top_host && baseline.visit_count > 3 && current.visit_count > 3;
}

function buildDriftContextParagraph(baseline, current, windowHours, drift) {
  const wh = windowHours;
  const lines = [
    `COGNITIVE BASELINE (previous ${wh}h, passive): ${baseline.visit_count} visits, ${baseline.unique_hosts} unique sites, top "${baseline.top_host || "—"}" (${baseline.top_host_hits} hits), repeat_ratio ${baseline.repeat_ratio}.`,
    `CURRENT WINDOW (${wh}h): ${current.visit_count} visits, ${current.unique_hosts} unique sites, top "${current.top_host || "—"}" (${current.top_host_hits} hits), repeat_ratio ${current.repeat_ratio}.`,
    `Drift score (heuristic): ${drift.score}, severity: ${drift.severity}.`,
  ];
  if (drift.hints.length) lines.push(`Notes: ${drift.hints.join(" ")}`);
  return lines.join("\n");
}

/**
 * Current window + prior window of equal length → baseline + drift; snapshot includes drift_context for ASI:One.
 * @param {{ windowHours?: number }} opts
 */
export async function buildCognitiveSnapshotWithDrift({ windowHours = 24 } = {}) {
  const wh = Math.max(1, Math.min(168, Number(windowHours) || 24));
  const visits = await listVisits({ limit: 8000 });
  const now = Date.now();
  const windowMs = wh * 60 * 60 * 1000;
  const currentStart = now - windowMs;
  const baselineStart = now - 2 * windowMs;
  const baselineEnd = currentStart;

  const current = computeHostStatsForRange(visits, currentStart, now);
  const baseline = computeHostStatsForRange(visits, baselineStart, baselineEnd);

  const who24 =
    wh >= 24 ? await countWhoPressesInLastHours(24) : await countWhoPressesInLastHours(wh);

  const drift = computeDriftFromMetrics(baseline, current);
  const driftContext = buildDriftContextParagraph(baseline, current, wh, drift);

  const snapshot = {
    window_hours: wh,
    visit_count: current.visit_count,
    unique_hosts: current.unique_hosts,
    top_host: current.top_host,
    top_host_hits: current.top_host_hits,
    repeat_ratio: current.repeat_ratio,
    who_presses_24h: who24,
    source: "boomer",
    drift_context: driftContext,
  };

  return {
    snapshot,
    baseline: {
      window_hours: wh,
      period: "prior_equal_window",
      ...baseline,
    },
    drift,
  };
}

/**
 * Build a browsing snapshot for the Agentverse perception agent (last N hours).
 * @param {{ windowHours?: number }} opts
 * @returns {Promise<{
 *   window_hours: number,
 *   visit_count: number,
 *   unique_hosts: number,
 *   top_host: string,
 *   top_host_hits: number,
 *   repeat_ratio: number,
 *   who_presses_24h: number,
 *   source: string,
 *   drift_context: string
 * }>}
 */
export async function buildCognitiveSnapshot({ windowHours = 24 } = {}) {
  const { snapshot } = await buildCognitiveSnapshotWithDrift({ windowHours });
  return snapshot;
}
