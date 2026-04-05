/**
 * Continuity verdicts can be delegated to a Fetch.ai–hosted agent or companion service
 * (e.g. Agentverse REST endpoint, ASI workflow, or local Python agent from fetchai_continuity_agent/).
 *
 * Set FETCHAI_CONTINUITY_AGENT_URL to POST target. Body: { message, pageUrl, recentReality }.
 * Expected JSON: { status, headline, pitch?, conflicts?, reminders? } — recentReality is re-attached by the Boomer backend.
 */

const TIMEOUT_MS = 25_000;

/**
 * @param {string} url
 * @param {{ message: string, pageUrl: string | null, recentReality: unknown }} body
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function invokeFetchAiContinuityAgent(url, body) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json" };
    const key = process.env.FETCHAI_CONTINUITY_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[Continuity] Fetch.ai agent HTTP", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = await res.json();
    if (!json || typeof json !== "object") return null;
    return /** @type {Record<string, unknown>} */ (json);
  } catch (e) {
    console.warn("[Continuity] Fetch.ai agent call failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {unknown} data
 */
export function normalizeAgentContinuityResponse(data) {
  if (!data || typeof data !== "object") return null;
  const d = /** @type {Record<string, unknown>} */ (data);
  const status = d.status;
  const headline = d.headline;
  if (status !== "ok" && status !== "conflict" && status !== "uncertain") return null;
  if (typeof headline !== "string" || !headline.trim()) return null;

  const conflicts = Array.isArray(d.conflicts) ? d.conflicts : [];
  const reminders = Array.isArray(d.reminders) ? d.reminders.map(String) : [];
  const pitch =
    typeof d.pitch === "string"
      ? d.pitch
      : "Scams don't only trick people—they contradict what really happened. Continuity Guardian grounds you in what this app remembers.";

  const cleanConflicts = conflicts
    .filter(
      (c) =>
        c &&
        typeof c === "object" &&
        typeof /** @type {{ title?: string }} */ (c).title === "string" &&
        typeof /** @type {{ detail?: string }} */ (c).detail === "string",
    )
    .map((c) => {
      const x = /** @type {{ code?: string, severity?: string, title: string, detail: string }} */ (c);
      const sev = x.severity === "high" || x.severity === "medium" || x.severity === "low" ? x.severity : "medium";
      return {
        code: typeof x.code === "string" ? x.code : "agent",
        severity: sev,
        title: x.title,
        detail: x.detail,
      };
    });

  const sourceTag =
    d.source === "memory-anchor"
      ? "memory-anchor"
      : d.source === "local-rules"
        ? "local"
        : "fetch-ai";

  return {
    status,
    headline: headline.trim(),
    pitch,
    conflicts: cleanConflicts,
    reminders,
    source: sourceTag,
  };
}
