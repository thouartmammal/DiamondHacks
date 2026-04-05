/**
 * Optional viewport → loved-one face match (extension page-scan).
 * Spawns Python + DeepFace when portraits exist; see .env.example (requirements-face).
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FACE_TIMEOUT_MS = Math.min(
  120_000,
  Math.max(15_000, Number(process.env.BOOMER_FACE_MATCH_TIMEOUT_MS) || 45_000),
);

function pythonFaceCommand() {
  const explicit = (process.env.PYTHON_FACE_MATCH || "").trim();
  if (explicit) return explicit;
  return process.platform === "win32" ? "python" : "python3";
}

/**
 * @param {string | null} viewportCapture data:image/...;base64,...
 * @param {{ people?: unknown[] }} loved from readLovedOnes()
 * @returns {Promise<{ match?: Record<string, unknown>, reason?: string }>}
 */
export async function matchFamilyByFace(viewportCapture, loved) {
  const flag = (process.env.BOOMER_FACE_MATCH || "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") {
    return { reason: "skipped" };
  }

  if (!viewportCapture || typeof viewportCapture !== "string" || !viewportCapture.startsWith("data:image")) {
    return { reason: "no_capture" };
  }

  const people = Array.isArray(loved?.people) ? loved.people : [];
  const withPic = people.filter(
    (p) =>
      p &&
      typeof p === "object" &&
      typeof /** @type {{ picture?: string }} */ (p).picture === "string" &&
      String(p.picture).startsWith("data:image") &&
      String(p.picture).length > 80,
  );

  if (withPic.length === 0) {
    return { reason: "no_portraits" };
  }

  const portraits = withPic.map((p) => {
    const r = /** @type {Record<string, unknown>} */ (p);
    return {
      id: r.id != null ? String(r.id) : "",
      name: typeof r.name === "string" ? r.name : "",
      relationship: typeof r.relationship === "string" ? r.relationship : "",
      customRelationship: typeof r.customRelationship === "string" ? r.customRelationship : "",
      picture: String(r.picture),
    };
  });

  const scriptPath = path.join(__dirname, "face_match_worker.py");
  const py = pythonFaceCommand();
  const stdinPayload = JSON.stringify({ viewport: viewportCapture, portraits });

  try {
    const out = await runPythonJson(py, scriptPath, stdinPayload, FACE_TIMEOUT_MS);
    if (!out || typeof out !== "object") {
      return { reason: "bad_output" };
    }
    if (out.reason && typeof out.reason === "string") {
      return { reason: out.reason };
    }
    if (out.match && typeof out.match === "object") {
      const match = { ...out.match };
      if (typeof out.distance === "number") {
        match._faceDistance = out.distance;
      }
      return { match };
    }
    return { reason: "no_face_match" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "face_timeout") return { reason: "face_timeout" };
    if (msg === "python_unavailable") return { reason: "python_unavailable" };
    if (msg === "face_script_failed") return { reason: "face_script_failed" };
    return { reason: "exception" };
  }
}

/**
 * @param {string} pyCmd
 * @param {string} scriptPath
 * @param {string} stdinPayload
 * @param {number} timeoutMs
 */
function runPythonJson(pyCmd, scriptPath, stdinPayload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(pyCmd, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      reject(new Error("face_timeout"));
    }, timeoutMs);

    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (code === "ENOENT") reject(new Error("python_unavailable"));
      else reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) {
        const tail = (stderr || stdout).slice(-400);
        console.warn("[face-match] python exit", code, tail);
        reject(new Error("face_script_failed"));
        return;
      }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error("bad_output"));
      }
    });
    try {
      proc.stdin?.write(stdinPayload, "utf8");
      proc.stdin?.end();
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}
