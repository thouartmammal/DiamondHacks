/**
 * Optional Fetch.ai / Agentverse endpoint for caregiver-facing copy.
 * POST body: { context, physicalSnapshot? }
 * Preferred JSON:
 *   { negotiatedSummaryForProvider: string }
 *   { caregiverHealth: { negotiatedSummaryForProvider, disclaimer?, providerQuestions? } }
 * Legacy (still accepted, normalized to one provider note):
 *   { negotiation: { engagementAgent, safeguardsAgent, moderatorNote } }
 */

/** Longer when remote runs multi-step LLM negotiation. */
const TIMEOUT_MS = 90_000;

/**
 * @param {string} url
 * @param {{ context: Record<string, unknown>, physicalSnapshot?: Record<string, unknown> }} body
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function invokeFetchAiRoutinesAgent(url, body) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json" };
    const key = process.env.FETCHAI_ROUTINES_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[Routines] Fetch.ai agent HTTP", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = await res.json();
    if (!json || typeof json !== "object") return null;
    return /** @type {Record<string, unknown>} */ (json);
  } catch (e) {
    console.warn("[Routines] Fetch.ai agent call failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fold legacy three-agent text into one provider-facing paragraph.
 * @param {string} engagement
 * @param {string} safeguards
 * @param {string} moderator
 */
function foldLegacyToProviderNote(engagement, safeguards, moderator) {
  return [
    "Internal negotiation (engagement vs. safeguards agents) produced the following consensus for clinician review—not for unsupervised patient-facing use as medical advice.",
    "",
    "Engagement-side inputs: " + engagement,
    "",
    "Safeguards-side inputs: " + safeguards,
    "",
    "Synthesized moderator line: " + moderator,
  ].join("\n");
}

/**
 * @param {unknown} data
 * @returns {{
 *   negotiatedSummaryForProvider: string,
 *   disclaimer?: string,
 *   providerQuestions?: string[],
 * } | null}
 */
export function normalizeRoutinesAgentResponse(data) {
  if (!data || typeof data !== "object") return null;
  const d = /** @type {Record<string, unknown>} */ (data);

  const ch = d.caregiverHealth && typeof d.caregiverHealth === "object" ? /** @type {Record<string, unknown>} */ (d.caregiverHealth) : null;

  let single = typeof d.negotiatedSummaryForProvider === "string" ? d.negotiatedSummaryForProvider.trim() : "";
  if (!single && ch && typeof ch.negotiatedSummaryForProvider === "string") {
    single = ch.negotiatedSummaryForProvider.trim();
  }

  if (single) {
    let disclaimer = typeof d.disclaimer === "string" ? d.disclaimer.trim() : "";
    if (!disclaimer && ch && typeof ch.disclaimer === "string") disclaimer = ch.disclaimer.trim();

    let providerQuestions = [];
    if (ch && Array.isArray(ch.providerQuestions)) providerQuestions = ch.providerQuestions.map(String).filter(Boolean);
    if (!providerQuestions.length && Array.isArray(d.providerQuestions)) {
      providerQuestions = d.providerQuestions.map(String).filter(Boolean);
    }
    if (!providerQuestions.length && ch && Array.isArray(ch.caregiverQuestions)) {
      providerQuestions = ch.caregiverQuestions.map(String).filter(Boolean);
    }

    return {
      negotiatedSummaryForProvider: single,
      disclaimer: disclaimer || undefined,
      providerQuestions: providerQuestions.length ? providerQuestions : undefined,
    };
  }

  let neg = d.negotiation;
  if (!neg || typeof neg !== "object") {
    if (ch && "negotiation" in ch) neg = /** @type {Record<string, unknown>} */ (ch).negotiation;
  }
  if (!neg || typeof neg !== "object") return null;
  const n = /** @type {Record<string, unknown>} */ (neg);

  const engagementAgent = typeof n.engagementAgent === "string" ? n.engagementAgent.trim() : "";
  const safeguardsAgent = typeof n.safeguardsAgent === "string" ? n.safeguardsAgent.trim() : "";
  const moderatorNote = typeof n.moderatorNote === "string" ? n.moderatorNote.trim() : "";

  if (!engagementAgent || !safeguardsAgent || !moderatorNote) return null;

  let disclaimer = typeof d.disclaimer === "string" ? d.disclaimer.trim() : "";
  if (!disclaimer && ch && typeof ch.disclaimer === "string") disclaimer = ch.disclaimer.trim();

  let providerQuestions = [];
  if (ch && Array.isArray(ch.providerQuestions)) providerQuestions = ch.providerQuestions.map(String).filter(Boolean);
  if (!providerQuestions.length && Array.isArray(d.providerQuestions)) {
    providerQuestions = d.providerQuestions.map(String).filter(Boolean);
  }
  if (!providerQuestions.length && ch && Array.isArray(ch.caregiverQuestions)) {
    providerQuestions = ch.caregiverQuestions.map(String).filter(Boolean);
  }

  return {
    negotiatedSummaryForProvider: foldLegacyToProviderNote(engagementAgent, safeguardsAgent, moderatorNote),
    disclaimer: disclaimer || undefined,
    providerQuestions: providerQuestions.length ? providerQuestions : undefined,
  };
}
