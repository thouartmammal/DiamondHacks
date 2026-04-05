import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "reminders.json");

/** @typedef {{ id: string, title: string, note: string | null, dueAt: string | null, createdAt: string, source: 'voice' | 'chat' | 'manual' }} Reminder */

/** @type {{ reminders: Reminder[] } | null} */
let cache = null;

async function ensureLoaded() {
  if (cache) return cache;
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    cache = JSON.parse(raw);
  } catch {
    cache = { reminders: [] };
  }
  if (!Array.isArray(cache.reminders)) cache.reminders = [];
  return cache;
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function normalizeDueAt(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

/**
 * @param {{ title: string, note?: string | null, dueAt?: string | null, source?: 'voice' | 'chat' | 'manual' }} input
 */
export async function addReminder(input) {
  const db = await ensureLoaded();
  const title = String(input.title || "").trim().slice(0, 500);
  if (!title) {
    throw new Error("title required");
  }
  const note =
    input.note != null && String(input.note).trim()
      ? String(input.note).trim().slice(0, 2000)
      : null;
  const dueAt = normalizeDueAt(input.dueAt);
  const source =
    input.source === "voice" || input.source === "chat" || input.source === "manual"
      ? input.source
      : "manual";
  const reminder = {
    id: randomUUID(),
    title,
    note,
    dueAt,
    createdAt: new Date().toISOString(),
    source,
  };
  db.reminders.push(reminder);
  await persist();
  return reminder;
}

export async function listReminders() {
  const db = await ensureLoaded();
  const copy = [...db.reminders];
  copy.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return copy;
}

export async function deleteReminder(id) {
  const db = await ensureLoaded();
  const len = db.reminders.length;
  db.reminders = db.reminders.filter((r) => r.id !== id);
  if (db.reminders.length === len) return false;
  await persist();
  return true;
}
