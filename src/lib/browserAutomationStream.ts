import { apiUrl } from "./apiUrl";

type StreamEvent = { type?: string; message?: string; output?: string; error?: string };

function parseSseBlocks(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        events.push(JSON.parse(line.slice(6)) as StreamEvent);
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
  return { events, rest };
}

/**
 * POST /browser-automation/stream — consumes SSE and returns final task output text.
 */
export async function runBrowserAutomationStream(
  task: string,
  onProgress: (message: string) => void,
): Promise<string> {
  const trimmed = task.trim();
  if (!trimmed) throw new Error("Empty task");

  const res = await fetch(apiUrl("browser-automation/stream"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ task: trimmed }),
  });

  if (!res.ok) {
    const t = await res.text();
    let err = res.statusText;
    try {
      const j = JSON.parse(t) as { error?: string };
      if (j.error) err = j.error;
    } catch {
      if (t) err = t.slice(0, 300);
    }
    throw new Error(err);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const dec = new TextDecoder();
  let buf = "";
  let output = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const { events, rest } = parseSseBlocks(buf);
    buf = rest;
    for (const ev of events) {
      if (ev.type === "progress" && ev.message) onProgress(ev.message);
      if (ev.type === "done") output = typeof ev.output === "string" ? ev.output : "";
      if (ev.type === "error") throw new Error(ev.error || "Browser task failed");
    }
  }

  if (buf.trim()) {
    const { events } = parseSseBlocks(buf + "\n\n");
    for (const ev of events) {
      if (ev.type === "progress" && ev.message) onProgress(ev.message);
      if (ev.type === "done") output = typeof ev.output === "string" ? ev.output : "";
      if (ev.type === "error") throw new Error(ev.error || "Browser task failed");
    }
  }

  return output || "(done)";
}
