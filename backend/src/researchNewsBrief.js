/**
 * Optional headlines for the cognitive insight dashboard — SerpApi (preferred) or NewsData.io (matches Perception).
 * SerpApi: https://serpapi.com/search-api  ·  NewsData: https://newsdata.io/documentation
 */

function normalizeKey(raw) {
  let k = String(raw ?? "").trim();
  if (k.length >= 2 && k[0] === k[k.length - 1] && `'"`.includes(k[0])) {
    k = k.slice(1, -1).trim();
  }
  return k;
}

function serpApiKey() {
  return normalizeKey(process.env.SERPAPI_API_KEY ?? "");
}

/** NewsData.io key: NEWSDATA_IO_API_KEY, or NEWSDATA_API_KEY in newsdata-only / two-key setups (matches perception/agent.py). */
function newsDataIoKey() {
  const io = normalizeKey(process.env.NEWSDATA_IO_API_KEY ?? "");
  if (io) return io;
  const prov = String(process.env.NEWS_HEADLINES_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (prov === "newsdata" || prov === "newsdata.io" || prov === "data") {
    return normalizeKey(process.env.NEWSDATA_API_KEY ?? "");
  }
  if (normalizeKey(process.env.NEWS_API_KEY ?? "")) {
    return normalizeKey(process.env.NEWSDATA_API_KEY ?? "");
  }
  return "";
}

function truncateQ(q, max) {
  const s = String(q ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max).replace(/\s+\S*$/, "");
  return cut || s.slice(0, max);
}

function mapResults(results, maxN) {
  if (!Array.isArray(results)) return [];
  const out = [];
  for (const art of results) {
    const title = String(art?.title ?? "").trim();
    if (!title || title.toLowerCase() === "[removed]") continue;
    out.push({
      title,
      source: String(art?.source_name ?? art?.source_id ?? "").trim(),
      link: String(art?.link ?? "").trim(),
      pubDate: String(art?.pubDate ?? "")
        .trim()
        .slice(0, 19),
    });
    if (out.length >= maxN) break;
  }
  return out;
}

function mapSerpNewsResults(rows, maxN) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const title = String(row?.title ?? "").trim();
    if (!title) continue;
    let source = row?.source;
    if (typeof source === "object" && source != null) source = source.name;
    source = String(source ?? "").trim();
    const link = String(row?.link ?? "").trim();
    const pubDate = String(row?.date ?? row?.iso_date ?? "")
      .trim()
      .slice(0, 19);
    out.push({ title, source, link, pubDate });
    if (out.length >= maxN) break;
  }
  return out;
}

function mapSerpOrganicResults(rows, maxN) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const title = String(row?.title ?? "").trim();
    if (!title) continue;
    let source = String(row?.source ?? "").trim();
    if (!source) {
      const dl = String(row?.displayed_link ?? "").trim();
      source = dl.split(" › ")[0].trim();
    }
    const link = String(row?.link ?? "").trim();
    const pubDate = String(row?.date ?? "")
      .trim()
      .slice(0, 19);
    out.push({ title, source, link, pubDate });
    if (out.length >= maxN) break;
  }
  return out;
}

/**
 * @returns {Promise<
 *   | { ok: true; items: Array<{ title: string; source: string; link: string; pubDate: string }>; queryUsed: string; fetchedAt: string; broadFallback?: boolean }
 *   | { ok: false; disabled?: boolean; message?: string }
 * >}
 */
async function fetchResearchNewsBriefSerpApi() {
  const apiKey = serpApiKey();
  if (!apiKey) {
    return { ok: false, disabled: true, message: "Set SERPAPI_API_KEY for SerpApi (see https://serpapi.com/manage-api-key )." };
  }

  const baseQ = (
    process.env.NEWS_INSIGHT_QUERY ||
    process.env.NEWS_API_QUERY ||
    "alzheimer OR dementia OR brain health OR cognitive health"
  ).trim();
  const qPrimary = truncateQ(baseQ, 2000);

  let size = 5;
  try {
    size = Math.min(10, Math.max(1, Number(process.env.NEWS_API_PAGE_SIZE ?? "5") || 5));
  } catch {
    size = 5;
  }

  const hl = String(process.env.SERPAPI_HL ?? "en").trim() || "en";
  const gl = String(process.env.SERPAPI_GL ?? "us").trim() || "us";
  const useGoogleNews = process.env.SERPAPI_GOOGLE_NEWS !== "0";

  const fetchedAt = new Date().toISOString();

  /**
   * @param {Record<string, string>} extra
   */
  async function serpRequest(extra) {
    const u = new URL("https://serpapi.com/search.json");
    u.searchParams.set("engine", "google");
    u.searchParams.set("q", qPrimary);
    u.searchParams.set("api_key", apiKey);
    u.searchParams.set("hl", hl.slice(0, 12));
    u.searchParams.set("gl", gl.slice(0, 8));
    u.searchParams.set("num", String(size));
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== "") u.searchParams.set(k, String(v));
    }
    const res = await fetch(u.toString(), {
      headers: { "User-Agent": "BoomerBrowse-Node/1.0" },
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { err: `Invalid JSON: ${text.slice(0, 120)}` };
    }
    if (data?.error) {
      return { err: String(data.error) };
    }
    const meta = data?.search_metadata;
    if (meta?.status === "Error") {
      return { err: String(data?.error || "SerpApi search error") };
    }
    return { data };
  }

  let items = [];
  let broadFallback = false;

  if (useGoogleNews) {
    const r1 = await serpRequest({ tbm: "nws" });
    if (r1.err) {
      return { ok: false, message: r1.err };
    }
    const d1 = r1.data;
    items = mapSerpNewsResults(d1?.news_results, size);
    if (!items.length && Array.isArray(d1?.organic_results) && d1.organic_results.length) {
      items = mapSerpOrganicResults(d1.organic_results, size);
    }
    if (!items.length) {
      const r2 = await serpRequest({});
      if (r2.err) {
        return {
          ok: false,
          message: `Google News had no rows; web fallback failed: ${r2.err}`,
        };
      }
      items = mapSerpOrganicResults(r2.data?.organic_results, size);
      broadFallback = true;
    }
  } else {
    const r = await serpRequest({});
    if (r.err) {
      return { ok: false, message: r.err };
    }
    items = mapSerpOrganicResults(r.data?.organic_results, size);
  }

  if (!items.length) {
    return {
      ok: false,
      message: "No results from SerpApi for this query (try NEWS_INSIGHT_QUERY).",
    };
  }

  return {
    ok: true,
    items,
    queryUsed: broadFallback ? `${qPrimary} (no news tab hits — web results)` : qPrimary,
    fetchedAt,
    broadFallback,
  };
}

/**
 * @returns {Promise<
 *   | { ok: true; items: Array<{ title: string; source: string; link: string; pubDate: string }>; queryUsed: string; fetchedAt: string; broadFallback?: boolean }
 *   | { ok: false; disabled?: boolean; message?: string }
 * >}
 */
async function fetchResearchNewsBriefNewsData() {
  const apiKey = newsDataIoKey();
  if (!apiKey) {
    return {
      ok: false,
      disabled: true,
      message:
        "Set NEWSDATA_IO_API_KEY (NewsData.io), or NEWS_HEADLINES_PROVIDER=newsdata with NEWSDATA_API_KEY, or two keys NEWS_API_KEY + NEWSDATA_API_KEY.",
    };
  }

  let maxQ = 100;
  try {
    maxQ = Math.min(512, Math.max(20, Number(process.env.NEWSDATA_Q_MAX_CHARS ?? "100") || 100));
  } catch {
    maxQ = 100;
  }

  const baseQ = (
    process.env.NEWS_INSIGHT_QUERY ||
    process.env.NEWS_API_QUERY ||
    "alzheimer OR dementia OR brain health OR cognitive health"
  ).trim();
  const qPrimary = truncateQ(baseQ, maxQ);

  let size = 5;
  try {
    size = Math.min(10, Math.max(1, Number(process.env.NEWS_API_PAGE_SIZE ?? "5") || 5));
  } catch {
    size = 5;
  }

  const fetchedAt = new Date().toISOString();

  /**
   * @param {Record<string, string>} params
   */
  async function request(params) {
    const u = new URL("https://newsdata.io/api/1/latest");
    u.searchParams.set("apikey", apiKey);
    u.searchParams.set("size", String(size));
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") u.searchParams.set(k, String(v));
    }
    const res = await fetch(u.toString(), {
      headers: { "User-Agent": "BoomerBrowse-Node/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { httpStatus: res.status, err: `Invalid JSON: ${text.slice(0, 120)}` };
    }
    if (!res.ok) {
      return {
        httpStatus: res.status,
        err: data?.message || data?.code || text.slice(0, 200),
      };
    }
    if (data?.status !== "success") {
      return { httpStatus: res.status, err: data?.message || data?.results || "NewsData status not success" };
    }
    return { data };
  }

  const tryEn = await request({ q: qPrimary, language: "en" });
  if (tryEn.err) {
    return { ok: false, message: String(tryEn.err) };
  }
  let items = mapResults(tryEn.data?.results, size);
  let broadFallback = false;
  if (!items.length) {
    const tryQ = await request({ q: qPrimary });
    if (!tryQ.err && tryQ.data?.status === "success") {
      items = mapResults(tryQ.data?.results, size);
    }
  }
  if (!items.length) {
    const tryTop = await request({});
    if (!tryTop.err && tryTop.data?.status === "success") {
      items = mapResults(tryTop.data?.results, size);
      broadFallback = true;
    }
  }

  if (!items.length) {
    return {
      ok: false,
      message: "No indexed headlines returned for this query (try NEWS_INSIGHT_QUERY).",
    };
  }

  return {
    ok: true,
    items,
    queryUsed: broadFallback ? `${qPrimary} (no hits — showing general latest)` : qPrimary,
    fetchedAt,
    broadFallback,
  };
}

/**
 * @returns {Promise<
 *   | { ok: true; items: Array<{ title: string; source: string; link: string; pubDate: string }>; queryUsed: string; fetchedAt: string; broadFallback?: boolean }
 *   | { ok: false; disabled?: boolean; message?: string }
 * >}
 */
export async function fetchResearchNewsBrief() {
  if (serpApiKey()) {
    return fetchResearchNewsBriefSerpApi();
  }
  if (!newsDataIoKey()) {
    return {
      ok: false,
      disabled: true,
      message:
        "Set SERPAPI_API_KEY (SerpApi / Google), or NewsData keys (NEWSDATA_IO_API_KEY / README).",
    };
  }
  return fetchResearchNewsBriefNewsData();
}
