/**
 * Browser Use Cloud agent (hosted browser + LLM). Requires BROWSER_USE_API_KEY.
 * @see https://docs.browser-use.com/cloud/agent/models
 */
import { BrowserUse, BrowserUseError } from "browser-use-sdk/v3";
import { friendlyLineForCloudStatus } from "./browserProgressMessages.js";

const TERMINAL = new Set(["idle", "stopped", "timed_out", "error"]);

/**
 * SDK passes API error bodies as objects; String(obj) → "[object Object]".
 * @param {unknown} detail
 */
function formatBrowserUseDetail(detail) {
  if (detail == null || detail === "") return "";
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null && !Array.isArray(detail)) {
    const o = /** @type {Record<string, unknown>} */ (detail);
    /** FastAPI-style bodies often use { detail: "..." } */
    if (typeof o.detail === "string" && o.detail.trim()) return o.detail.trim();
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
    if (typeof o.msg === "string" && o.msg.trim()) return o.msg.trim();
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (Array.isArray(o.detail)) {
      try {
        return JSON.stringify(o.detail);
      } catch {
        /* fall through */
      }
    }
    try {
      return JSON.stringify(detail);
    } catch {
      return "";
    }
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return "";
  }
}

export function isBrowserUseCloudEnabled() {
  return Boolean(String(process.env.BROWSER_USE_API_KEY ?? "").trim());
}

/**
 * @param {string} task
 * @param {{ onProgress?: (message: string) => void }} [opts]
 * @returns {Promise<string>}
 */
export async function runBrowserTaskCloud(task, opts = {}) {
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const str = String(task ?? "").trim();
  if (!str) throw new Error("Empty browser task");

  const apiKey = String(process.env.BROWSER_USE_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("BROWSER_USE_API_KEY is not set");

  /** @type {string} SDK defaults include bu-mini / bu-max; cloud docs may list other model strings. */
  const model = String(process.env.BROWSER_USE_CLOUD_MODEL ?? "bu-max").trim() || "bu-max";

  const waitTimeout = Math.min(
    600_000,
    Math.max(60_000, Number(process.env.BOOMER_BROWSER_USE_CLOUD_TIMEOUT_MS) || 300_000),
  );

  const client = new BrowserUse({
    apiKey,
    timeout: Math.min(180_000, Math.max(30_000, Number(process.env.BROWSER_USE_HTTP_TIMEOUT_MS) || 120_000)),
  });

  let rotationIndex = 0;
  const emit = (status) => {
    if (!onProgress) return;
    onProgress(friendlyLineForCloudStatus(status, rotationIndex));
    rotationIndex += 1;
  };

  try {
    const created = await client.sessions.create({
      task: str,
      model,
      keepAlive: false,
    });
    let session = created;
    emit(session.status);

    const deadline = Date.now() + waitTimeout;
    while (!TERMINAL.has(session.status) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      session = await client.sessions.get(session.id);
      emit(session.status);
    }

    if (!TERMINAL.has(session.status)) {
      throw new Error("Browser Use Cloud task did not finish in time");
    }

    if (session.status === "error") {
      throw new Error("Browser Use Cloud reported an error for this session");
    }
    if (session.status === "timed_out") {
      throw new Error("Browser Use Cloud timed out");
    }

    const out = session.output;
    if (out == null || out === "") return "(Task completed.)";
    return typeof out === "string" ? out : String(out);
  } catch (e) {
    if (e instanceof BrowserUseError) {
      const fromDetail = formatBrowserUseDetail(e.detail);
      const fromMsg = typeof e.message === "string" ? e.message.trim() : "";
      const duplicate =
        !fromDetail ||
        !fromMsg ||
        fromDetail === fromMsg ||
        fromDetail.includes(fromMsg) ||
        fromMsg.includes(fromDetail);
      if (fromDetail && fromMsg && !duplicate) {
        throw new Error(`${fromDetail} — ${fromMsg}`);
      }
      const text = fromDetail || fromMsg || `Browser Use Cloud request failed (HTTP ${e.statusCode})`;
      throw new Error(text);
    }
    throw e;
  }
}
