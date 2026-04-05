import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const LOG_PATH = path.join(DATA_DIR, "extension-page-scans.jsonl");

/**
 * Append one scan line for future family-tree / context features (not a full mirror of the page).
 * @param {{ url: string, title?: string, textPreview?: string, mode: 'auto' | 'manual' | 'who', receivedAt?: string }} row
 */
export async function appendPageScan(row) {
  const receivedAt = row.receivedAt || new Date().toISOString();
  const textPreview =
    typeof row.textPreview === "string"
      ? row.textPreview.slice(0, 12000)
      : "";
  const line = JSON.stringify({
    receivedAt,
    mode: row.mode,
    url: String(row.url || "").slice(0, 2048),
    title: String(row.title || "").slice(0, 500),
    textLen: textPreview.length,
    textPreview,
  });
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(LOG_PATH, line + "\n", "utf8");
}
