/**
 * OpenAI vision + page text: compare what's on screen to the loved-ones family tree.
 * Sends the tab screenshot plus each saved Loved-one portrait (when present) for face comparison.
 */

import { buildFamilyMatchDisplay } from "./lovedOnesScanMatch.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_REFERENCE_PORTRAITS = 6;
/**
 * Loved-one photos are read from `loved-ones.json` (not the extension POST). Phone camera
 * data URLs are often 1–8MB; a ~200KB cap made `refs=0` for everyone with real uploads.
 */
const MAX_LOVED_ONE_PORTRAIT_DATA_URL_CHARS = 6_000_000;
const MAX_LOVED_ONE_PORTRAIT_FETCH_BYTES = 5_000_000;

/**
 * Loved-one `picture` must become a data URL for our OpenAI calls.
 * Accepts existing data URLs or http(s) when the image is publicly fetchable (no login).
 * @param {string} debugLabel - for logs when a portrait is skipped
 */
async function resolvePortraitDataUrl(picRaw, debugLabel = "") {
  const label = debugLabel.trim() || "person";
  const s = typeof picRaw === "string" ? picRaw.trim() : "";
  if (!s) return "";
  if (s.startsWith("data:image")) {
    if (s.length < 100) return "";
    if (s.length > MAX_LOVED_ONE_PORTRAIT_DATA_URL_CHARS) {
      console.warn(
        `[who-openai] skip portrait (${label}): data URL is ${s.length} chars (max ${MAX_LOVED_ONE_PORTRAIT_DATA_URL_CHARS}). Re-save a smaller JPEG in Loved ones or compress the photo.`,
      );
      return "";
    }
    return s;
  }
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(s, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    clearTimeout(tid);
    if (!res.ok) {
      console.warn(`[who-openai] skip portrait (${label}): URL HTTP ${res.status}`);
      return "";
    }
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (!ctype.startsWith("image/")) {
      console.warn(`[who-openai] skip portrait (${label}): not an image (${ctype || "no content-type"})`);
      return "";
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 80 || buf.length > MAX_LOVED_ONE_PORTRAIT_FETCH_BYTES) {
      console.warn(
        `[who-openai] skip portrait (${label}): downloaded ${buf.length} bytes (max ${MAX_LOVED_ONE_PORTRAIT_FETCH_BYTES}).`,
      );
      return "";
    }
    const b64 = buf.toString("base64");
    const mime = ctype.split(";")[0].trim() || "image/jpeg";
    const dataUrl = `data:${mime};base64,${b64}`;
    if (dataUrl.length > MAX_LOVED_ONE_PORTRAIT_DATA_URL_CHARS) {
      console.warn(`[who-openai] skip portrait (${label}): inline size exceeds max after fetch.`);
      return "";
    }
    return dataUrl;
  } catch {
    console.warn(`[who-openai] skip portrait (${label}): fetch failed or timed out`);
    return "";
  }
}

/**
 * @param {{
 *   viewportCapture: string | null,
 *   textPreview: string,
 *   pageTitle: string,
 *   pageUrl: string,
 *   loved: { people?: unknown[] },
 * }} opts
 * @returns {Promise<
 *   | { ok: true, familyMatch: { headline: string, message: string, name: string } }
 *   | { ok: true, noMatch: true, nudge: string }
 *   | { ok: false, reason: string }
 * >}
 */
export async function matchFamilyWithOpenAI(opts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok: false, reason: "no_openai_key" };
  }

  const people = Array.isArray(opts.loved?.people) ? opts.loved.people : [];
  if (people.length === 0) {
    return { ok: false, reason: "no_family" };
  }

  const textPreview = String(opts.textPreview || "").trim();
  const viewportCapture =
    opts.viewportCapture && String(opts.viewportCapture).startsWith("data:image")
      ? opts.viewportCapture
      : null;

  if (!viewportCapture && textPreview.length < 8) {
    return { ok: false, reason: "insufficient_input" };
  }

  const tree = people
    .map((p) => {
      const r = p && typeof p === "object" ? /** @type {Record<string, unknown>} */ (p) : {};
      return {
        id: r.id != null ? String(r.id) : "",
        name: typeof r.name === "string" ? r.name.trim() : "",
        relationship: typeof r.relationship === "string" ? r.relationship : "",
        customRelationship: typeof r.customRelationship === "string" ? r.customRelationship : "",
        parentIds: Array.isArray(r.parentIds) ? r.parentIds.map(String) : [],
        memories: typeof r.memories === "string" ? r.memories.trim().slice(0, 240) : "",
      };
    })
    .filter((x) => x.name);

  if (tree.length === 0) {
    return { ok: false, reason: "no_family" };
  }

  /** @type {{ id: string; name: string; picture: string }[]} */
  const referencePortraits = [];
  let nonEmptyPictureFields = 0;
  for (const p of people) {
    const r = p && typeof p === "object" ? /** @type {Record<string, unknown>} */ (p) : {};
    const rawPic = r.picture;
    if (rawPic != null && String(rawPic).trim() !== "") nonEmptyPictureFields += 1;
    const pname =
      typeof r.name === "string" && r.name.trim() ? r.name.trim() : r.id != null ? `id ${r.id}` : "?";
    const pic = await resolvePortraitDataUrl(
      typeof rawPic === "string" ? rawPic : rawPic != null ? String(rawPic) : "",
      pname,
    );
    if (!pic) continue;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;
    referencePortraits.push({
      id: r.id != null ? String(r.id) : "",
      name,
      picture: pic,
    });
    if (referencePortraits.length >= MAX_REFERENCE_PORTRAITS) break;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const hasRefs = referencePortraits.length > 0;
  if (!hasRefs && tree.length > 0) {
    if (nonEmptyPictureFields > 0) {
      console.warn(
        `[who-openai] no usable reference portraits (${nonEmptyPictureFields} picture field(s) set but all skipped — see skip reasons above, or file path mismatch). Loved ones file: set BOOMER_USER_DATA to match the Boomer app if needed.`,
      );
    } else {
      console.warn(
        `[who-openai] no reference portraits (${tree.length} people; no picture data). Add photos under Loved ones in Boomer.`,
      );
    }
  }

  /** @type {Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>} */
  const userContent = [
    {
      type: "text",
      text: [
        'The user tapped "Who?" while viewing a webpage (often a social photo or profile).',
        "",
        hasRefs
          ? "The FIRST image is a screenshot of their browser (what they see). The following images are **reference portraits** you must use: compare any visible faces in the screenshot to those reference photos. Same person may look different (angle, age, lighting, glasses, hair) — use medium confidence when reasonably plausible, high when very likely the same individual."
          : "The FIRST image is a screenshot of their browser. There are **no saved reference portraits** in the family list — match only using visible **names, captions, tags, or profile labels** on screen against the JSON below.",
        "",
        `Page title: ${opts.pageTitle || "(none)"}`,
        `Page URL: ${opts.pageUrl || "(unknown)"}`,
        "",
        "Visible page text (may be truncated):",
        textPreview.slice(0, 6000) || "(none extracted)",
        "",
        "Family tree JSON (id, name, relationship, parentIds, memories):",
        JSON.stringify(tree),
        "",
        "Reply with ONLY valid JSON (no markdown):",
        '{"matches":[{"personId":"","name":"","confidence":"high|medium|low","reason":""}],"summary":""}',
        "personId must be an id from the tree when you have a match. If no plausible match: matches:[], summary: one short friendly sentence.",
      ].join("\n"),
    },
  ];

  if (viewportCapture) {
    userContent.push({
      type: "image_url",
      image_url: { url: viewportCapture, detail: "high" },
    });
  }

  for (const ref of referencePortraits) {
    userContent.push({
      type: "text",
      text: `Reference portrait for **${ref.name}** (personId in JSON: "${ref.id}"). Compare faces in the screenshot to this person.`,
    });
    userContent.push({
      type: "image_url",
      image_url: { url: ref.picture, detail: "low" },
    });
  }

  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        messages: [
          {
            role: "system",
            content:
              "You help users recognize people on web pages vs their saved family list. " +
              "When reference portraits are provided, prioritize **facial similarity** to those photos as well as on-screen names. " +
              "Social sites (Facebook, Instagram, etc.) often show photos with little text — rely on the screenshot and portraits. " +
              "Never invent people not in the JSON. Output only the JSON object the user requested.",
          },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (e) {
    console.error("[who-openai] fetch", e);
    return { ok: false, reason: "openai_fetch_failed" };
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!res.ok) {
    console.error("[who-openai] api", data.error?.message || raw);
    return { ok: false, reason: "openai_error" };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
  } catch {
    console.warn("[who-openai] parse", raw.slice(0, 160));
    return { ok: false, reason: "bad_json" };
  }

  const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
  let summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "We could not match anyone from your family tree on this page.";

  if (matches.length === 0) {
    if (!hasRefs && viewportCapture && tree.length > 0) {
      const actionable =
        "Who? could not match anyone. Your Loved ones have names but no usable face photos (Facebook photo pages also have almost no text to match). In Boomer open Loved ones, edit each person, tap Upload photo and add a clear face, save, then try Who? again.";
      console.log(
        `[who-openai] no match; refs=${referencePortraits.length} viewport=yes (add portraits in Loved ones)`,
      );
      return { ok: true, noMatch: true, nudge: actionable };
    }
    if (!hasRefs && viewportCapture) {
      summary +=
        " Add clear face photos for each person under Loved ones in Boomer — Who? compares those to what you see on screen.";
    }
    console.log(
      `[who-openai] no match; refs=${referencePortraits.length} viewport=${viewportCapture ? "yes" : "no"}`,
    );
    return { ok: true, noMatch: true, nudge: summary };
  }

  const rank = { high: 3, medium: 2, low: 1 };
  const sorted = [...matches].sort((a, b) => {
    const sa = rank[String(a?.confidence || "").toLowerCase()] || 0;
    const sb = rank[String(b?.confidence || "").toLowerCase()] || 0;
    return sb - sa;
  });

  const best = sorted[0] || {};
  const pid = String(best.personId || "").trim();
  const bestName = String(best.name || "").trim();
  const reason = typeof best.reason === "string" ? best.reason.trim() : "";

  /** @type {Record<string, unknown> | undefined} */
  let person = people.find((p) => p && String(/** @type {{id:unknown}} */ (p).id) === pid);
  if (!person && bestName) {
    const lower = bestName.toLowerCase();
    person = people.find(
      (p) => p && String(/** @type {{name?:string}} */ (p).name || "").trim().toLowerCase() === lower,
    );
  }

  if (!person || typeof person !== "object") {
    return { ok: true, noMatch: true, nudge: summary };
  }

  const base = buildFamilyMatchDisplay(
    /** @type {{ name?: string, relationship?: string, customRelationship?: string }} */ (person),
  );
  const extra = [reason, summary].filter(Boolean).join(" ");
  console.log(`[who-openai] match person=${base.name} refs=${referencePortraits.length}`);
  return {
    ok: true,
    familyMatch: {
      headline: base.headline,
      message: extra ? `${base.message} ${extra}` : base.message,
      name: base.name,
    },
  };
}
