/**
 * Calls Agentverse-hosted Boomer Perception agent.
 * Hosted runtime has no on_rest_post(); use uagents.query via Python bridge by default.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} fallbackExe
 * @returns {{ command: string, args: string[] }}
 */
function pythonLauncher(fallbackExe = "python") {
  const raw = process.env.AGENTVERSE_QUERY_PYTHON?.trim() || fallbackExe;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { command: fallbackExe, args: [] };
  return { command: parts[0], args: parts.slice(1) };
}

/** @returns {boolean} */
export function isCognitiveAgentConfigured() {
  return Boolean(
    process.env.AGENTVERSE_COGNITIVE_REST_URL?.trim() ||
      process.env.AGENTVERSE_PERCEPTION_ADDRESS?.trim()
  );
}

/**
 * Optional: only when AGENTVERSE_COGNITIVE_REST_URL is set (custom REST / future uAgents).
 * @returns {string | null}
 */
export async function resolveCognitiveRestUrl() {
  const direct = process.env.AGENTVERSE_COGNITIVE_REST_URL?.trim();
  return direct || null;
}

/**
 * @param {string} target
 * @param {Record<string, unknown>} snapshot
 */
async function postToRest(target, snapshot) {
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(snapshot),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        error: typeof data?.error === "string" ? data.error : res.statusText || `HTTP ${res.status}`,
        status: res.status,
        data,
      };
    }
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {Promise<{ ok: boolean, data?: object, error?: string, status?: number }>}
 */
function queryPerceptionViaPython(snapshot) {
  const addr = process.env.AGENTVERSE_PERCEPTION_ADDRESS?.trim();
  if (!addr) {
    return Promise.resolve({
      ok: false,
      error: "AGENTVERSE_PERCEPTION_ADDRESS is not set.",
    });
  }

  const script = path.join(__dirname, "..", "..", "fetch-agents", "perception", "query_bridge.py");
  const { command, args: pyPreArgs } = pythonLauncher("python");

  return new Promise((resolve) => {
    const child = spawn(command, [...pyPreArgs, script], {
      env: { ...process.env, PERCEPTION_AGENT_ADDRESS: addr },
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", (e) => {
      resolve({ ok: false, error: e.message });
    });
    child.on("close", (code) => {
      const trimmed = out.trim();
      if (code !== 0 && !trimmed) {
        resolve({
          ok: false,
          error: err.trim() || `Python bridge exited with code ${code}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.ok && parsed.data) resolve({ ok: true, data: parsed.data });
        else
          resolve({
            ok: false,
            error: typeof parsed.error === "string" ? parsed.error : "bridge failed",
            data: parsed.data,
          });
      } catch {
        resolve({
          ok: false,
          error: err.trim() || trimmed || "Invalid JSON from query bridge",
        });
      }
    });
    child.stdin.write(JSON.stringify(snapshot));
    child.stdin.end();
  });
}

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {Promise<{ ok: boolean, data?: object, error?: string, status?: number }>}
 */
export async function postCognitiveSnapshot(snapshot) {
  const restUrl = process.env.AGENTVERSE_COGNITIVE_REST_URL?.trim();
  if (restUrl) {
    return postToRest(restUrl, snapshot);
  }
  if (process.env.AGENTVERSE_PERCEPTION_ADDRESS?.trim()) {
    return queryPerceptionViaPython(snapshot);
  }
  return {
    ok: false,
    error:
      "Set AGENTVERSE_PERCEPTION_ADDRESS (plus pip install uagents; see fetch-agents/requirements-query-bridge.txt) or AGENTVERSE_COGNITIVE_REST_URL. See fetch-agents/README.md.",
  };
}
