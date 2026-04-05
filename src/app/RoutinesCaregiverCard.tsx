import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Activity,
  ClipboardList,
  Eye,
  Loader2,
  MessageCircleWarning,
  Shield,
  Sparkles,
  Stethoscope,
  Tv,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { apiUrl } from "../lib/apiUrl";
import { cn } from "./components/ui/utils";

export type NegotiationChatLine = {
  id: string;
  role: "engagement" | "safeguards";
  text: string;
};

/** Shown inside the clinician memo card (same numbers as the old top stat tiles). */
export type ClinicianMemoWellnessSnapshot = {
  averageMediaMood: number;
  averageMediaMoodLabel: string;
  mediaAgeBandLabel: string;
  mediaAgeDescription: string;
  estimatedContentAgeYears: number | null;
};

export type RoutinesAnalyzeResponse = {
  caregiverHealth?: {
    disclaimer?: string;
    negotiatedSummaryForProvider?: string;
    providerQuestions?: string[];
  };
  /** Data-driven agent dialogue; returned by POST /routines/analyze (same DB read as the memo). */
  negotiationChat?: NegotiationChatLine[];
  source?: string;
  agents_used?: string[];
  error?: string;
};

/** Only if analyze response omits negotiationChat — no invented numbers. */
const FALLBACK_NEGOTIATION: NegotiationChatLine[] = [
  {
    id: "e1",
    role: "engagement",
    text: "Engagement — Live metrics didn’t load from the server, so we can’t quote your current hours, mood, or slip counts in this run. Confirm the backend is up and try again.",
  },
  {
    id: "s1",
    role: "safeguards",
    text: "Safeguards — I won’t fabricate difficulty or frequency values. The clinician memo below may still generate if /routines/analyze succeeds.",
  },
  {
    id: "e2",
    role: "engagement",
    text: "Engagement — Once metrics load, we’ll walk through the same 14-day window the charts use: recall difficulty, slip events, and daily frequency totals.",
  },
  {
    id: "s2",
    role: "safeguards",
    text: "Safeguards — Good. Numbers first, interpretation second—and only for the chart, not as a label.",
  },
];

function normalizeNegotiationChat(raw: unknown): NegotiationChatLine[] {
  if (!Array.isArray(raw)) return FALLBACK_NEGOTIATION;
  const out: NegotiationChatLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : `x-${out.length}`;
    const role = o.role === "safeguards" ? "safeguards" : "engagement";
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (text) out.push({ id, role, text });
  }
  return out.length >= 2 ? out : FALLBACK_NEGOTIATION;
}

function GlassPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="dashboard-glass-hover-surface min-w-0 will-change-transform">
      <div className={cn("dashboard-glass-panel min-w-0", className)}>{children}</div>
    </div>
  );
}

async function parseJson(res: Response): Promise<RoutinesAnalyzeResponse> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as RoutinesAnalyzeResponse;
  } catch {
    return { error: text.slice(0, 200) };
  }
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 align-middle" aria-hidden>
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300/90 [animation-delay:0ms]" />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300/90 [animation-delay:150ms]" />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300/90 [animation-delay:300ms]" />
    </span>
  );
}

function AnalysisWellnessContext({ snapshot }: { snapshot: ClinicianMemoWellnessSnapshot }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 sm:p-4">
      <p className="mb-3 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-rose-300">
        Media mood &amp; media age (analysis context)
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-5">
        <div>
          <div className="mb-1 flex items-center gap-2 text-slate-200">
            <Activity className="h-4 w-4 shrink-0 text-rose-300" strokeWidth={2} aria-hidden />
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.12em]">Media mood</span>
          </div>
          <p className="text-lg font-extrabold text-slate-50 sm:text-xl">{snapshot.averageMediaMoodLabel}</p>
          <p className="mt-1 text-xs leading-snug text-slate-400">
            From titles &amp; metadata. Score{" "}
            <span className="tabular-nums text-slate-200">
              {snapshot.averageMediaMood >= 0 ? "+" : ""}
              {snapshot.averageMediaMood.toFixed(2)}
            </span>{" "}
            (−1 to +1).
          </p>
        </div>
        <div className="min-w-0 sm:col-span-1">
          <div className="mb-1 flex items-center gap-2 text-slate-200">
            <Tv className="h-4 w-4 shrink-0 text-teal-300" strokeWidth={2} aria-hidden />
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.12em]">Media age</span>
          </div>
          <p className="text-base font-extrabold text-slate-50 sm:text-lg">{snapshot.mediaAgeBandLabel}</p>
          <p className="mt-1 text-xs leading-snug text-slate-400">{snapshot.mediaAgeDescription}</p>
          {snapshot.estimatedContentAgeYears != null && (
            <p className="mt-1 text-xs text-slate-400">
              Est. content age:{" "}
              <span className="font-semibold tabular-nums text-slate-100">~{snapshot.estimatedContentAgeYears} yrs</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


export function RoutinesCaregiverCard({
  className,
  wellnessSnapshot,
  surface = "card",
}: {
  className?: string;
  wellnessSnapshot?: ClinicianMemoWellnessSnapshot;
  /** `inline` = no glass panel; link-style actions for hero layouts. */
  surface?: "card" | "inline";
}) {
  const dialogTitleId = useId();
  /** New run invalidates in-flight fetch/script from a previous Run click. */
  const runIdRef = useRef(0);
  /** False after dismiss — stops chat animation; fetch may still complete for the card. */
  const negotiationModalOpenRef = useRef(false);
  const fetchDoneRef = useRef(false);
  const scriptDoneRef = useRef(false);
  const resultRef = useRef<RoutinesAnalyzeResponse | null>(null);
  const errRef = useRef<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [viewAnalysisAvailable, setViewAnalysisAvailable] = useState(false);
  const [routineBusy, setRoutineBusy] = useState(false);
  const [routineNote, setRoutineNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<RoutinesAnalyzeResponse | null>(null);

  const [negotiationOpen, setNegotiationOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<NegotiationChatLine[]>([]);
  const [scriptDone, setScriptDone] = useState(false);
  const [fetchDone, setFetchDone] = useState(false);

  useEffect(() => {
    fetchDoneRef.current = fetchDone;
  }, [fetchDone]);
  useEffect(() => {
    scriptDoneRef.current = scriptDone;
  }, [scriptDone]);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);
  useEffect(() => {
    errRef.current = err;
  }, [err]);

  useEffect(() => {
    if (negotiationOpen && fetchDone && scriptDone) {
      setBusy(false);
    }
  }, [negotiationOpen, fetchDone, scriptDone]);

  const closeNegotiationModal = useCallback(() => {
    negotiationModalOpenRef.current = false;
    setNegotiationOpen(false);
    setBusy(false);
    const done = fetchDoneRef.current && scriptDoneRef.current;
    const memoText = resultRef.current?.caregiverHealth?.negotiatedSummaryForProvider;
    const lastErr = errRef.current;
    if (done && (Boolean(memoText?.trim()) || Boolean(lastErr))) {
      setViewAnalysisAvailable(true);
    }
  }, []);

  const openViewAnalysis = useCallback(() => {
    negotiationModalOpenRef.current = true;
    setNegotiationOpen(true);
    setScriptDone(true);
    setFetchDone(true);
  }, []);

  const run = useCallback(async () => {
    const runId = ++runIdRef.current;
    setBusy(true);
    setViewAnalysisAvailable(false);
    setErr(null);
    setResult(null);
    setChatMessages([]);
    setScriptDone(false);
    setFetchDone(false);

    let scriptLines: NegotiationChatLine[] = FALLBACK_NEGOTIATION;

    try {
      const res = await fetch(apiUrl("routines/analyze"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await parseJson(res);
      if (runId !== runIdRef.current) return;
      if (!res.ok) {
        setErr(data.error || `Request failed (${res.status})`);
        setResult(null);
      } else {
        setResult(data);
        scriptLines = normalizeNegotiationChat(data.negotiationChat);
      }
    } catch (e) {
      if (runId === runIdRef.current) {
        setErr(e instanceof Error ? e.message : "Request failed");
        setResult(null);
      }
    } finally {
      if (runId === runIdRef.current) {
        setFetchDone(true);
      }
    }

    if (runId !== runIdRef.current) return;

    negotiationModalOpenRef.current = true;
    setNegotiationOpen(true);

    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    void (async () => {
      try {
        for (const line of scriptLines) {
          await wait(520);
          if (runId !== runIdRef.current) return;
          if (!negotiationModalOpenRef.current) {
            if (runId === runIdRef.current) setScriptDone(true);
            return;
          }
          setChatMessages((prev) => [...prev, line]);
          await wait(380);
        }
        await wait(400);
        if (runId === runIdRef.current) setScriptDone(true);
      } catch {
        if (runId === runIdRef.current) setScriptDone(true);
      }
    })();
  }, []);

  const memo = result?.caregiverHealth?.negotiatedSummaryForProvider;
  const disclaimer = result?.caregiverHealth?.disclaimer;
  const questions = result?.caregiverHealth?.providerQuestions ?? [];

  const showOutcome = fetchDone && scriptDone;
  const waitingOnServer = scriptDone && !fetchDone;
  const waitingOnScript = fetchDone && !scriptDone;

  const modal =
    negotiationOpen &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        role="presentation"
      >
        <button
          type="button"
          className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
          aria-label="Close negotiation dialog"
          onClick={closeNegotiationModal}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          className="relative z-[101] flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-cyan-400/30 bg-slate-950/95 shadow-2xl shadow-black/50"
        >
          <div className="relative flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3 pr-3 sm:px-5 sm:pr-4">
            <div className="min-w-0 flex-1 pr-10">
              <h2 id={dialogTitleId} className="text-base font-bold text-sky-50 sm:text-lg">
                Agent negotiation
              </h2>
              <p className="text-xs text-cyan-200/80">Engagement and safeguards — talking to the chart, not the patient</p>
            </div>
            <button
              type="button"
              onClick={closeNegotiationModal}
              className="absolute right-2 top-2 shrink-0 rounded-xl p-2 text-cyan-200/90 transition hover:bg-white/10 hover:text-sky-50 sm:right-3 sm:top-3"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
            <div className="space-y-3">
              {wellnessSnapshot && <AnalysisWellnessContext snapshot={wellnessSnapshot} />}
              {chatMessages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex gap-2",
                    m.role === "safeguards" ? "flex-row-reverse" : "flex-row",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1",
                      m.role === "engagement"
                        ? "bg-cyan-500/20 text-cyan-200 ring-cyan-300/30"
                        : "bg-amber-950/60 text-amber-100 ring-amber-400/25",
                    )}
                  >
                    {m.role === "engagement" ? (
                      <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
                    ) : (
                      <Shield className="h-4 w-4" strokeWidth={2} aria-hidden />
                    )}
                  </div>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed shadow-sm",
                      m.role === "engagement"
                        ? "rounded-tl-sm border border-cyan-400/25 bg-sky-950/80 text-sky-100"
                        : "rounded-tr-sm border border-amber-400/20 bg-slate-900/90 text-amber-50/95",
                    )}
                  >
                    <p className="text-[0.65rem] font-bold uppercase tracking-wide text-cyan-200/75">
                      {m.role === "engagement" ? "Engagement" : "Safeguards"}
                    </p>
                    <p className="mt-1 text-[0.9375rem]">{m.text}</p>
                  </div>
                </div>
              ))}

              {!scriptDone && chatMessages.length > 0 && (
                <p className="pl-11 text-xs text-cyan-300/80">
                  <TypingDots /> <span className="ml-1">Agents negotiating…</span>
                </p>
              )}

              {waitingOnServer && (
                <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-900/80 px-3 py-2 text-sm text-cyan-100/90">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  Waiting for server consensus…
                </div>
              )}

              {waitingOnScript && !waitingOnServer && (
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-cyan-200/85">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  Finishing agent dialogue…
                </div>
              )}

              {showOutcome && err && (
                <p
                  className="rounded-xl border border-amber-400/35 bg-amber-950/30 px-3 py-2 text-sm text-amber-100"
                  role="alert"
                >
                  {err}
                </p>
              )}

              {showOutcome && !err && memo && (
                <div className="rounded-xl border border-emerald-400/25 bg-emerald-950/20 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-100/95">
                    <ClipboardList className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Negotiated consensus (for provider)
                  </div>
                  {result?.source && (
                    <p className="mb-2 text-[0.65rem] text-cyan-200/75">
                      Source: <span className="font-medium text-cyan-100/85">{result.source}</span>
                      {result.agents_used?.length ? ` · ${result.agents_used.join(", ")}` : null}
                    </p>
                  )}
                  <p className="max-h-[min(40vh,280px)] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-sky-100/95">
                    {memo}
                  </p>
                  {questions.length > 0 && (
                    <ul className="mt-3 list-inside list-disc space-y-1 border-t border-white/10 pt-3 text-xs text-cyan-100/90">
                      {questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  )}
                  {disclaimer && (
                    <p className="mt-3 border-t border-white/10 pt-3 text-[0.7rem] leading-snug text-cyan-200/75">
                      {disclaimer}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-white/10 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={closeNegotiationModal}
              className="w-full rounded-xl border border-cyan-400/40 bg-cyan-500/20 py-2.5 text-sm font-semibold text-sky-50 transition hover:bg-cyan-500/30"
            >
              {showOutcome ? "Close" : "Dismiss"}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  const body = (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        surface === "inline" && "items-center text-center sm:items-start sm:text-left",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Stethoscope
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0 text-rose-300",
            surface === "inline" && "hidden sm:block",
          )}
          strokeWidth={2}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">Clinical handoff</p>
          <h3 className="mt-1 text-sm font-semibold leading-snug text-slate-50 sm:text-[0.9375rem]">
            App signals — clinician memo
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400 sm:text-[0.8125rem]">
            For clinicians or chart review. Run analysis for perceived age, media mood, media age, negotiation, and
            memo.
          </p>
        </div>
      </div>
      <div
        className={cn(
          "flex shrink-0 flex-row flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:justify-end",
        )}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (viewAnalysisAvailable && !busy) {
              openViewAnalysis();
            } else {
              void run();
            }
          }}
          className={cn(
            "inline-flex min-h-[44px] items-center justify-center gap-2 text-sm font-semibold transition disabled:opacity-50",
            surface === "inline"
              ? "text-rose-300 underline decoration-orange-400/40 underline-offset-4 hover:text-rose-200 hover:decoration-orange-500/80"
              : "w-full rounded-xl border border-teal-400/30 bg-gradient-to-b from-teal-500/20 to-teal-600/10 px-4 py-2 text-xs text-slate-50 shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset] sm:w-auto",
          )}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Running analysis…
            </>
          ) : viewAnalysisAvailable ? (
            <>
              <Eye className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              View analysis
            </>
          ) : (
            <>
              <MessageCircleWarning className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Run negotiated analysis
            </>
          )}
        </button>
        {viewAnalysisAvailable && !busy && (
          <button
            type="button"
            onClick={() => void run()}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-2 text-sm font-medium transition",
              surface === "inline"
                ? "text-stone-400 hover:text-slate-200"
                : "w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-slate-200 hover:bg-stone-100 sm:w-auto",
            )}
          >
            <MessageCircleWarning className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            New analysis
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {modal}
      {surface === "inline" ? (
        <div className={cn("w-full", className)}>{body}</div>
      ) : (
        <GlassPanel
          className={cn(
            "border-l-[3px] border-l-teal-400/50 bg-gradient-to-r from-teal-900/30 to-transparent p-3 sm:p-4",
            className,
          )}
        >
          {body}
        </GlassPanel>
      )}
    </>
  );
}

/** Same POST as the dashboard — for Vapi tool results (plain text summary for voice readout). */
export async function fetchRoutinesAnalyzeForVoice(): Promise<string> {
  const res = await fetch(apiUrl("routines/analyze"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await parseJson(res);
  if (!res.ok) return data.error || `Routines analyze failed (${res.status})`;
  const memo = data.caregiverHealth?.negotiatedSummaryForProvider;
  const qs = data.caregiverHealth?.providerQuestions ?? [];
  const disc = data.caregiverHealth?.disclaimer ?? "";
  if (!memo) return disc || "No negotiated summary returned.";
  const parts = [memo];
  if (qs.length) parts.push("", "Suggested clinician follow-up:", ...qs.map((q) => `• ${q}`));
  if (disc) parts.push("", disc);
  return parts.join("\n");
}
