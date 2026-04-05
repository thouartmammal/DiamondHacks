import { apiUrl } from "./apiUrl";

export type RoutineStep = {
  order: number;
  host: string;
  url: string;
  title: string;
  visitCountWindow?: number;
  reason?: string;
};

export type RoutineFlowResponse = {
  source?: string;
  patternSummary?: string;
  steps?: RoutineStep[];
  maxSteps?: number;
  agents_used?: string[];
  error?: string;
};

/** Fetch mined routine; open up to 5 https URLs in new tabs (staggered). */
export async function openRoutineFlowInBrowser(): Promise<{
  patternSummary: string;
  opened: number;
  lines: string;
}> {
  const res = await fetch(apiUrl("routine/flow"));
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as RoutineFlowResponse;
  if (!res.ok) throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
  const steps = Array.isArray(data.steps) ? data.steps : [];
  let opened = 0;
  for (let i = 0; i < steps.length; i++) {
    const u = typeof steps[i].url === "string" ? steps[i].url.trim() : "";
    if (!/^https?:\/\//i.test(u)) continue;
    window.open(u, "_blank", "noopener,noreferrer");
    opened += 1;
    if (i < steps.length - 1) {
      await new Promise((r) => setTimeout(r, 450));
    }
  }
  const lines = steps
    .filter((s) => /^https?:\/\//i.test(String(s.url || "")))
    .map((s, i) => `${i + 1}. ${s.host} — ${s.url}`)
    .join("\n");
  return {
    patternSummary: data.patternSummary ?? "",
    opened,
    lines,
  };
}
