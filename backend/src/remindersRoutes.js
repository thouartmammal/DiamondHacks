import { Router } from "express";
import { addReminder, deleteReminder, listReminders } from "./remindersStore.js";

const router = Router();

/**
 * @param {string} userText
 * @returns {Promise<{ title: string, note: string | null, dueAt: string | null }>}
 */
async function parseReminderFromChat(userText) {
  const text = String(userText || "").trim();
  if (!text) {
    throw new Error("text required");
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      title: text.slice(0, 500),
      note: null,
      dueAt: null,
    };
  }

  const now = new Date().toISOString();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Extract one reminder from the user message. " +
            `Current moment (ISO, user's locale context unknown): ${now}\n` +
            "Reply with ONLY valid JSON, no markdown: " +
            '{"title":"short actionable line, max 120 chars","note":null or longer detail string,"dueAt":null or ISO8601 datetime}',
        },
        { role: "user", content: text.slice(0, 2000) },
      ],
      max_tokens: 220,
    }),
  });

  const data = await res.json();
  const raw =
    data.choices?.[0]?.message?.content?.trim() ??
    data.error?.message ??
    "";
  if (!res.ok) {
    throw new Error(typeof raw === "string" && raw ? raw : "OpenAI request failed");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
  } catch {
    return { title: text.slice(0, 500), note: null, dueAt: null };
  }

  const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 500) : "";
  if (!title) {
    return { title: text.slice(0, 500), note: null, dueAt: null };
  }
  const note =
    typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim().slice(0, 2000) : null;
  let dueAt = null;
  if (parsed.dueAt != null && String(parsed.dueAt).trim()) {
    const t = Date.parse(String(parsed.dueAt));
    if (!Number.isNaN(t)) dueAt = new Date(t).toISOString();
  }
  return { title, note, dueAt };
}

router.get("/", async (_req, res) => {
  try {
    const reminders = await listReminders();
    res.json({ reminders });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "failed" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const reminder = await addReminder({
      title: body.title,
      note: body.note,
      dueAt: body.dueAt,
      source: body.source,
    });
    res.status(201).json({ reminder });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    if (msg === "title required") {
      res.status(400).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

router.post("/from-chat", async (req, res) => {
  try {
    const text = req.body?.text;
    if (typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "text required" });
      return;
    }
    const parsed = await parseReminderFromChat(text);
    const reminder = await addReminder({
      ...parsed,
      source: "chat",
    });
    res.status(201).json({ reminder });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "failed" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const ok = await deleteReminder(String(req.params.id || ""));
    if (!ok) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "failed" });
  }
});

export default router;
