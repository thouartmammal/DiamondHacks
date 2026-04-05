import { listVisits, normalizeHostFromUrl } from "./activityStore.js";
import { getNarrative, listMedia, parseEpisodeFromText } from "./memoryStore.js";
import {
  invokeFetchAiContinuityAgent,
  normalizeAgentContinuityResponse,
} from "./fetchAiContinuityBridge.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const SHOP_RE =
  /amazon|ebay|etsy|walmart|target|bestbuy|costco|shopify|paypal|checkout|stripe|homedepot|lowes|kohls|macys/i;

/** @type {{ id: string, label: string, hostRe: RegExp, textRe: RegExp }[]} */
export const BRAND_RULES = [
  { id: "amazon", label: "Amazon", hostRe: /(^|\.)amazon\./i, textRe: /\bamazon\b/i },
  { id: "paypal", label: "PayPal", hostRe: /(^|\.)paypal\.com$/i, textRe: /\bpaypal\b/i },
  {
    id: "microsoft",
    label: "Microsoft",
    hostRe: /(^|\.)microsoft\.com$/i,
    textRe: /\bmicrosoft\b|\bms\s*account\b/i,
  },
  {
    id: "google",
    label: "Google",
    hostRe: /(^|\.)google\./i,
    textRe: /\bgoogle\b|\bgmail\b/i,
  },
  { id: "apple", label: "Apple", hostRe: /(^|\.)apple\.com$/i, textRe: /\bapple\s*(id|account)\b|\bicloud\b/i },
  { id: "netflix", label: "Netflix", hostRe: /(^|\.)netflix\.com$/i, textRe: /\bnetflix\b/i },
  {
    id: "bank",
    label: "a major bank",
    hostRe: /chase\.|wellsfargo|bankofamerica|citibank|^usbank\.|^pnc\.|^truist\./i,
    textRe: /\bchase\b|\bwells fargo\b|\bbank of america\b|\bcitibank\b|\bu\.s\.\s*bank\b/i,
  },
];

/**
 * @param {string} host
 * @param {{ hostRe: RegExp }} rule
 */
function hostMatchesBrand(host, rule) {
  if (!host || typeof host !== "string") return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  return rule.hostRe.test(h);
}

/**
 * @param {Awaited<ReturnType<typeof buildRecentReality>>} reality
 * @param {{ hostRe: RegExp }} rule
 */
function sawBrandInWindow(reality, rule) {
  return reality.topHostsRecent.some(({ host }) => hostMatchesBrand(host, rule));
}

/**
 * @param {string} text
 */
function brandsMentionedInText(text) {
  return BRAND_RULES.filter((r) => r.textRe.test(text));
}

const ACCOUNT_STRESS_RE =
  /account\s+(is\s+)?(locked|suspended|restricted|limited|on\s+hold)|locked\s+out|suspicious\s+activity|unauthorized\s+access|verify\s+your\s+(account|identity)|unusual\s+activity/i;

const URGENT_RE =
  /urgent|immediately|right\s+now|within\s+\d+|24\s*hours|expires\s+soon|act\s+now|last\s+chance|asap/i;

const PASSWORD_RESET_RE =
  /reset\s+(your\s+)?password|password\s+reset|forgot\s+your\s+password|update\s+your\s+password|click\s+to\s+unlock/i;

const MONEY_PRESSURE_RE =
  /you\s+owe|payment\s+due|past\s+due|outstanding\s+balance|\birs\b|tax\s+debt|arrest\s+warrant|social\s+security\s*(number)?|wire\s+transfer|western\s+union|bitcoin|crypto\s+wallet/i;

const ORDER_RE =
  /\byou\s+(have\s+)?(ordered|purchased|bought)\b|\border\s+#|your\s+order\s+(has\s+)?(shipped|been)/i;

const GIFT_CARD_RE = /gift\s*card|prepaid\s*card|vanilla\s*card|reload\s*card/i;

const MEETING_RE =
  /join\s+(this\s+)?(call|meeting|zoom|teams)|click\s+to\s+join|screen\s+connect|remote\s+support|download\s+anydesk|teamviewer/i;

export async function buildRecentReality({ windowDays = 14 } = {}) {
  const visits = await listVisits({ limit: 400 });
  const cutoff = Date.now() - windowDays * DAY_MS;
  const recentVisits = visits.filter((v) => new Date(v.visitedAt).getTime() >= cutoff);

  /** @type {Map<string, number>} */
  const hostCount = new Map();
  /** @type {Map<string, number>} */
  const hostLastAt = new Map();

  for (const v of recentVisits) {
    const h = normalizeHostFromUrl(v.url);
    if (!h) continue;
    const hn = h.toLowerCase().replace(/^www\./, "");
    hostCount.set(hn, (hostCount.get(hn) || 0) + 1);
    const t = new Date(v.visitedAt).getTime();
    if (!hostLastAt.has(hn) || t > hostLastAt.get(hn)) {
      hostLastAt.set(hn, t);
    }
  }

  const topHostsRecent = [...hostCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([host, count]) => ({
      host,
      count,
      lastAt: new Date(hostLastAt.get(host)).toISOString(),
    }));

  const routineHosts = [...hostCount.entries()].filter(([, c]) => c >= 3).map(([h]) => h);

  let lastShopping = null;
  for (const v of recentVisits) {
    const h = normalizeHostFromUrl(v.url);
    if (h && SHOP_RE.test(h)) {
      lastShopping = { host: h, at: v.visitedAt, title: v.title };
      break;
    }
  }

  const narrative = await getNarrative();
  const mediaAll = await listMedia({ limit: 80 });
  const recentMedia = mediaAll.filter((m) => new Date(m.occurredAt).getTime() >= cutoff);
  const lastEpMedia =
    recentMedia.find((m) => m.episodeNumber != null) ||
    mediaAll.find((m) => m.episodeNumber != null) ||
    null;

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    disclaimer:
      "Continuity Guardian uses only what Boomer Browse has logged (visits and shows you saved). It is not your bank or store and cannot see all purchases. When in doubt, ask someone you trust.",
    recentVisitCount: recentVisits.length,
    topHostsRecent,
    routineHosts,
    narrative: {
      seriesKey: narrative.seriesKey,
      lastConfirmedEpisode: narrative.lastConfirmedEpisode,
      updatedAt: narrative.updatedAt,
    },
    lastMediaWithEpisode: lastEpMedia
      ? {
          episodeNumber: lastEpMedia.episodeNumber,
          title: lastEpMedia.title,
          occurredAt: lastEpMedia.occurredAt,
          seriesKey: lastEpMedia.seriesKey,
        }
      : null,
    purchaseSignals: {
      hadShoppingVisitInWindow: Boolean(lastShopping),
      lastShoppingHost: lastShopping?.host ?? null,
      lastShoppingAt: lastShopping?.at ?? null,
    },
  };
}

const PITCH =
  "Scams don’t only trick people—they contradict what really happened. Continuity Guardian grounds you in what this app remembers.";

/**
 * Compare a claim to recent reality (local rules — also used when Fetch.ai agent is offline).
 * @param {{ message?: string, pageUrl?: string | null, recentReality: Awaited<ReturnType<typeof buildRecentReality>> }} input
 */
export function checkContinuityLocal({ message, pageUrl, recentReality: reality }) {
  const text = String(message || "").trim();
  /** @type {{ code: string, severity: 'high' | 'medium' | 'low', title: string, detail: string }[]} */
  const conflicts = [];
  const reminders = [];
  let uncertain = false;

  if (!text) {
    return {
      status: "uncertain",
      headline: "Paste what the page or message says",
      pitch:
        "Scams rewrite reality. Continuity Guardian checks whether a claim fits what Boomer Browse remembers about your recent browsing and shows.",
      conflicts: [],
      reminders: [
        "Copy text from an email, pop-up, or script—then press Check. We only compare to activity logged in this app.",
      ],
      recentReality: reality,
      source: "local",
    };
  }

  const pageHost = pageUrl ? normalizeHostFromUrl(String(pageUrl)) : null;

  const epClaim = parseEpisodeFromText(text);
  const lastEp = reality.narrative.lastConfirmedEpisode;
  if (epClaim != null && lastEp != null && epClaim !== lastEp) {
    conflicts.push({
      code: "episode_mismatch",
      severity: "medium",
      title: "Episode number may not match what we last saved",
      detail: `This mentions episode ${epClaim}, but the last episode on file for your saved shows is ${lastEp}. That can be fine—just double-check before assuming you skipped ahead.`,
    });
  }

  if (ACCOUNT_STRESS_RE.test(text)) {
    const brands = brandsMentionedInText(text);
    if (brands.length === 0) {
      uncertain = true;
      reminders.push(
        "We see a stressful account message, but no clear company name. If it asks for a password, card, or remote access, pause and check with someone you trust.",
      );
    } else {
      for (const b of brands) {
        if (!sawBrandInWindow(reality, b)) {
          conflicts.push({
            code: "brand_account_claim_no_visit",
            severity: "high",
            title: `Sounds like ${b.label}—but you haven’t visited them here recently`,
            detail: `In the last ${reality.windowDays} days we don’t see ${b.label} in your Boomer Browse visit log. That doesn’t prove the message is fake—you might use another browser or app—but it doesn’t match what we see here. Slow down before signing in or paying.`,
          });
        } else {
          reminders.push(
            `You’ve visited ${b.label}-related sites in this window—but urgent “locked account” messages are still a common scam. Confirm using the official app or a phone number you already trust, not from this message.`,
          );
        }
      }
    }
  }

  if (PASSWORD_RESET_RE.test(text) && URGENT_RE.test(text)) {
    uncertain = true;
    reminders.push(
      "We don’t record failed logins, so we can’t verify an emergency reset. Urgent password links are a classic scam pattern—open the site you trust by typing it in the address bar or from your bookmarks.",
    );
  } else if (PASSWORD_RESET_RE.test(text)) {
    reminders.push(
      "Password reset pages need extra care—prefer the site you normally use, opened from bookmarks or typed yourself.",
    );
  }

  if (MONEY_PRESSURE_RE.test(text)) {
    conflicts.push({
      code: "money_pressure_script",
      severity: "high",
      title: "High-pressure money language",
      detail:
        "Messages about owing money, taxes, warrants, or urgent wire or crypto are often scams—especially if this came out of the blue.",
    });
  }

  const soundsLikeOrder =
    ORDER_RE.test(text) || (GIFT_CARD_RE.test(text) && /\$\s*\d+|\d+\s*dollars?/i.test(text));
  if (soundsLikeOrder && !reality.purchaseSignals.hadShoppingVisitInWindow) {
    conflicts.push({
      code: "purchase_claim_no_recent_shopping",
      severity: "medium",
      title: "Purchase story vs your shopping trail in Boomer Browse",
      detail:
        "This sounds like you already bought something or must pay—but we don’t see common shopping sites in your recent visits here. You might shop in-store, by phone, or in another browser—so this isn’t proof—just a reason to pause.",
    });
  }

  if (MEETING_RE.test(text)) {
    conflicts.push({
      code: "remote_session_pitch",
      severity: "high",
      title: "“Join this call” or remote-access pitches",
      detail:
        "Scammers often push instant calls or remote desktop tools. Unless you expected this from someone you know, treat it as risky.",
    });
  }

  if (pageHost && ACCOUNT_STRESS_RE.test(text)) {
    const brands = brandsMentionedInText(text);
    for (const b of brands) {
      if (!hostMatchesBrand(pageHost, b) && sawBrandInWindow(reality, b)) {
        conflicts.push({
          code: "page_host_brand_mismatch",
          severity: "high",
          title: "Web address doesn’t match the company named in the text",
          detail: `The page host is ${pageHost}, which doesn’t fit the usual pattern for ${b.label}. Don’t enter passwords on unfamiliar addresses.`,
        });
      }
    }
  }

  const hasConflict = conflicts.some((c) => c.severity === "high" || c.severity === "medium");
  const status = hasConflict ? "conflict" : uncertain ? "uncertain" : "ok";
  const headline =
    status === "conflict"
      ? "This may not match your recent reality in Boomer Browse"
      : status === "uncertain"
        ? "We couldn’t fully verify this—go slowly"
        : "No strong contradiction with your recent Boomer log";

  return {
    status,
    headline,
    pitch: PITCH,
    conflicts,
    reminders,
    recentReality: reality,
    source: "local",
  };
}

/**
 * Build reality, then ask Fetch.ai agent (if configured), else local rules.
 * @param {{ message?: string, pageUrl?: string | null }} input
 */
export async function checkContinuity({ message, pageUrl } = {}) {
  const text = String(message || "").trim();
  const reality = await buildRecentReality();

  if (!text) {
    return checkContinuityLocal({ message: "", pageUrl, recentReality: reality });
  }

  const agentUrl = (process.env.FETCHAI_CONTINUITY_AGENT_URL || "").trim();
  if (agentUrl) {
    const raw = await invokeFetchAiContinuityAgent(agentUrl, {
      message: text,
      pageUrl: pageUrl != null && String(pageUrl).trim() ? String(pageUrl).trim() : null,
      recentReality: reality,
    });
    const normalized = raw ? normalizeAgentContinuityResponse(raw) : null;
    if (normalized) {
      return {
        ...normalized,
        recentReality: reality,
      };
    }
  }

  return checkContinuityLocal({
    message: text,
    pageUrl,
    recentReality: reality,
  });
}
