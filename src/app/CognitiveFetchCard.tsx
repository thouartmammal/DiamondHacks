import { useCallback, useState, type ReactNode } from "react";
import { Eye, Loader2, Play, Satellite, Stethoscope } from "lucide-react";
import { apiUrl } from "../lib/apiUrl";
import { cn } from "./components/ui/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { FetchThinkingTrace } from "./FetchThinkingTrace";

type DriftPayload = {
  score: number;
  severity: string;
  hints: string[];
};

type InsightSections = {
  memory: string;
  browser: string;
  drift: string;
  note: string;
};

type AgentversePayload =
  | {
      ok: true;
      data: {
        user_message: string;
        drift_score?: number;
        severity?: string;
        mode?: string;
        chain?: string;
      };
    }
  | { ok: false; error?: string };

type HolisticSnapshot = {
  window_hours?: number;
  visit_count?: number;
  unique_hosts?: number;
  top_host?: string;
  top_host_hits?: number;
  repeat_ratio?: number;
  who_presses_24h?: number;
  source?: string;
};

type CognitiveResponse = {
  drift?: DriftPayload | null;
  baseline?: unknown;
  snapshot?: HolisticSnapshot | null;
  agentverse?: AgentversePayload;
  cognitiveAgentConfigured?: boolean;
  sections?: InsightSections | null;
  insightUnparsed?: boolean | null;
  cached?: boolean;
};

function isAgentSuccess(r: CognitiveResponse | null): boolean {
  return Boolean(
    r?.agentverse && "ok" in r.agentverse && r.agentverse.ok && "data" in r.agentverse,
  );
}

function GlassPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="dashboard-glass-hover-surface will-change-transform">
      <div className={cn("dashboard-glass-panel", className)}>{children}</div>
    </div>
  );
}

function SectionBlock({
  title,
  tag,
  body,
  tone = "indigo",
}: {
  title: string;
  tag: string;
  body: string;
  tone?: "indigo" | "rose";
}) {
  if (!body.trim()) return null;
  const tagAccent = tone === "rose" ? "text-rose-300/70" : "text-slate-500";
  const labelAccent = tone === "rose" ? "text-rose-200/90" : "text-indigo-200/90";
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        tone === "rose"
          ? "border-rose-400/20 bg-rose-950/25"
          : "border-white/10 bg-white/[0.04]",
      )}
    >
      <p className={cn("text-[0.65rem] font-bold uppercase tracking-[0.16em]", labelAccent)}>
        {title}{" "}
        <span className={cn("font-mono normal-case tracking-normal", tagAccent)}>[[{tag}]]</span>
      </p>
      <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-100">{body.trim()}</p>
    </div>
  );
}

function InsightBody({ data, tone = "indigo" }: { data: CognitiveResponse; tone?: "indigo" | "rose" }) {
  const agentOk = data.agentverse && "ok" in data.agentverse && data.agentverse.ok;
  const message =
    agentOk && data.agentverse && "data" in data.agentverse
      ? data.agentverse.data.user_message
      : null;
  const bridgeError =
    data.agentverse && "ok" in data.agentverse && !data.agentverse.ok
      ? data.agentverse.error || "Fetch agent call failed"
      : null;
  const fetchChain =
    agentOk && data.agentverse && "data" in data.agentverse
      ? data.agentverse.data.chain
      : undefined;
  const drift = data.drift;
  const sec = data.sections;
  const showSections =
    sec && (sec.memory || sec.browser || sec.drift || sec.note) && !data.insightUnparsed;

  return (
    <div className="flex max-h-[min(70vh,520px)] flex-col gap-3 overflow-y-auto pr-1">
      {data.cached ? (
        <p className="text-xs text-slate-500">This run was served from a short server cache (≈90s).</p>
      ) : null}

      {fetchChain === "drift-only" ? (
        <div
          className={cn(
            "rounded-xl border px-3 py-2 text-sm",
            tone === "rose"
              ? "border-rose-400/40 bg-rose-950/40 text-rose-50"
              : "border-amber-400/35 bg-amber-950/30 text-amber-50",
          )}
          role="status"
        >
          <span className="font-semibold">Hosted Drift is in drift-only mode.</span> The response is a
          short template, not ASI-tagged sections. In{" "}
          <span className="font-medium">Agentverse → your Drift agent → Secrets</span>, set{" "}
          <code className="rounded bg-black/25 px-1 text-[0.8em]">PERCEPTION_AGENT_ADDRESS</code> to your
          hosted Perception <span className="font-mono text-[0.85em]">agent1q…</span> address, then rerun.
        </div>
      ) : null}

      {drift && (drift.severity === "low" || drift.severity === "medium") && (
        <div
          className={cn(
            "rounded-xl border px-3 py-2 text-sm",
            drift.severity === "medium"
              ? "border-amber-400/35 bg-amber-950/35 text-amber-50"
              : "border-cyan-400/25 bg-cyan-950/25 text-cyan-50",
          )}
        >
          <span className="font-semibold">Local drift heuristics (prior window):</span>{" "}
          <span className="tabular-nums">{drift.severity}</span>
          <span className="text-slate-300"> · score {drift.score}</span>
          {drift.hints?.length ? (
            <ul className="mt-1 list-inside list-disc text-slate-200/90">
              {drift.hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {showSections && sec ? (
        <div className="flex flex-col gap-2.5">
          <SectionBlock title="Memory baseline" tag="MEMORY" body={sec.memory} tone={tone} />
          <SectionBlock title="Browser behavior" tag="BROWSER" body={sec.browser} tone={tone} />
          <SectionBlock title="Drift" tag="DRIFT" body={sec.drift} tone={tone} />
          <SectionBlock title="Caregiver note" tag="NOTE" body={sec.note} tone={tone} />
        </div>
      ) : null}

      {message && (data.insightUnparsed || !showSections) ? (
        <p className="min-w-0 text-base font-medium leading-relaxed text-slate-100">{message}</p>
      ) : null}

      {bridgeError && data.cognitiveAgentConfigured !== false && (
        <p className="text-sm text-amber-100/95">{bridgeError}</p>
      )}
    </div>
  );
}

export function CognitiveFetchCard({
  className,
  variant = "home",
}: {
  className?: string;
  /** home: default; wellness: compact; wellness-memo: rose clinical strip (Physical Activity / dashboard 2) */
  variant?: "home" | "wellness" | "wellness-memo";
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CognitiveResponse | null>(null);
  const [stored, setStored] = useState<CognitiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchInsight = useCallback(async (bypassCache: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        apiUrl("cognitive/agentverse", {
          window_hours: 24,
          ...(bypassCache ? { refresh: 1 } : {}),
        }),
      );
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || res.statusText);
      }
      const parsed = JSON.parse(text) as CognitiveResponse;
      setData(parsed);
      if (isAgentSuccess(parsed)) {
        setStored(parsed);
      }
      return parsed;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setData(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const runFresh = async () => {
    setModalOpen(true);
    await fetchInsight(true);
  };

  const loadCached = async () => {
    setModalOpen(true);
    await fetchInsight(false);
  };

  const regenerateInModal = async () => {
    await fetchInsight(true);
  };

  const hasStoredInsight = stored !== null && isAgentSuccess(stored);

  const bridgeError =
    data?.agentverse && "ok" in data.agentverse && !data.agentverse.ok
      ? data.agentverse.error || "Fetch agent call failed"
      : null;

  const traceSnapshot = (!loading ? data?.snapshot ?? stored?.snapshot : null) ?? null;
  const traceAgentOk = loading
    ? false
    : Boolean((data && isAgentSuccess(data)) || (stored && isAgentSuccess(stored)));
  const parseFallback =
    !loading &&
    Boolean(
      data && isAgentSuccess(data)
        ? data.insightUnparsed
        : stored && isAgentSuccess(stored) && stored.insightUnparsed,
    );
  const fetchChainForTrace =
    !loading && data && isAgentSuccess(data) && "data" in data.agentverse
      ? data.agentverse.data.chain
      : !loading && stored && isAgentSuccess(stored) && "data" in stored.agentverse
        ? stored.agentverse.data.chain
        : null;
  const insightForBody = loading
    ? null
    : data && isAgentSuccess(data)
      ? data
      : stored && isAgentSuccess(stored)
        ? stored
        : null;

  const clinical = variant === "wellness-memo";
  const sectionTone: "indigo" | "rose" = clinical ? "rose" : "indigo";

  return (
    <>
      <GlassPanel
        className={cn(
          "p-5",
          clinical &&
            "border-l-[3px] border-l-rose-400/50 bg-gradient-to-r from-rose-950/40 via-rose-950/15 to-transparent",
          className,
        )}
      >
        <div
          className={cn(
            "mb-3 flex flex-wrap items-start justify-between gap-3",
            clinical && "sm:flex-row sm:items-center sm:justify-between",
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1",
                clinical
                  ? "bg-rose-950/50 text-rose-200 ring-rose-400/30"
                  : "bg-indigo-950/40 text-indigo-200 ring-indigo-400/25",
              )}
            >
              {clinical ? (
                <Stethoscope className="h-6 w-6" strokeWidth={2} aria-hidden />
              ) : (
                <Satellite className="h-6 w-6" strokeWidth={2} aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              {clinical ? (
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">
                  Clinical handoff
                </p>
              ) : null}
              <h3
                className={cn(
                  "font-bold text-slate-100",
                  clinical ? "mt-1 text-sm leading-snug sm:text-[0.9375rem]" : "text-lg",
                )}
              >
                {variant === "wellness-memo"
                  ? "App signals — cognitive insight"
                  : variant === "wellness"
                    ? "Fetch.ai — memory, browser, drift"
                    : "Cognitive insight (Fetch.ai)"}
              </h3>
              <p
                className={cn(
                  "mt-1.5 leading-relaxed text-slate-400",
                  clinical ? "text-xs sm:text-[0.8125rem]" : "text-sm",
                )}
              >
                {variant === "wellness-memo"
                  ? "For clinicians or chart review. Holistic memory, browsing, wellness context, and drift via Fetch.ai + ASI:One (passive telemetry — no user quiz)."
                  : variant === "wellness"
                    ? "Same holistic pass as your main dashboard: narrative + visits + wellness + drift (passive)."
                    : "Memory lens + browser patterns + wellness + drift vs prior window → ASI:One. No quizzes."}
              </p>
              {hasStoredInsight ? (
                <p className="mt-1 text-xs text-slate-500">
                  Last insight saved — open it anytime with the button below.
                </p>
              ) : null}
            </div>
          </div>
          <div
            className={cn(
              "flex flex-col items-stretch gap-2 sm:items-end",
              clinical && "w-full sm:w-auto sm:flex-row sm:items-center",
            )}
          >
            <button
              type="button"
              onClick={() => {
                if (hasStoredInsight) {
                  setModalOpen(true);
                } else {
                  void runFresh();
                }
              }}
              disabled={loading}
              className={cn(
                "inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-sm transition disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                clinical
                  ? "border border-rose-400/35 bg-rose-950/35 text-rose-100 hover:bg-rose-900/45 focus-visible:outline-rose-400"
                  : "border border-indigo-400/30 bg-indigo-950/30 text-indigo-100 hover:bg-indigo-900/40 focus-visible:outline-indigo-400",
              )}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : hasStoredInsight ? (
                <Eye className="h-4 w-4" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              {hasStoredInsight ? "View previously generated result" : "Run"}
            </button>
            <button
              type="button"
              onClick={() => void loadCached()}
              disabled={loading}
              className={cn(
                "min-h-[44px] text-xs font-semibold underline-offset-4 transition disabled:opacity-50 sm:min-h-0",
                clinical
                  ? "text-rose-300 decoration-orange-400/40 hover:text-rose-200 hover:underline hover:decoration-orange-500/80"
                  : "font-medium text-slate-500 hover:text-slate-300 hover:underline",
              )}
            >
              Load cached (90s)
            </button>
          </div>
        </div>

        {!data && !loading && !error && (
          <p className="text-sm leading-relaxed text-slate-400">
            Tap <strong className="text-slate-200">Run</strong> for a fresh ASI insight (opens in a window).{" "}
            <strong className="text-slate-200">Load cached</strong> uses the server cache when available.
          </p>
        )}

        {error && (
          <p className="text-sm text-red-200" role="alert">
            {error}
          </p>
        )}

        {data && data.cognitiveAgentConfigured === false && (
          <p className="text-sm leading-relaxed text-amber-100/90">
            Set <code className="rounded bg-black/30 px-1">AGENTVERSE_PERCEPTION_ADDRESS</code> in your backend{" "}
            <code className="rounded bg-black/30 px-1">.env</code> (not a placeholder REST URL), run{" "}
            <code className="rounded bg-black/30 px-1">perception/agent.py</code>, then try again.
          </p>
        )}

        {bridgeError && data?.cognitiveAgentConfigured !== false && (
          <p className="text-sm text-amber-100/95">{bridgeError}</p>
        )}
      </GlassPanel>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent
          className={cn(
            "max-h-[92vh] max-w-[calc(100%-2rem)] overflow-y-auto border bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-md sm:max-w-2xl",
            clinical ? "border-rose-400/25" : "border-white/15",
          )}
        >
          <DialogHeader>
            {clinical ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">
                Clinical handoff
              </p>
            ) : null}
            <DialogTitle className={cn("text-slate-100", clinical && "text-rose-50")}>
              Fetch.ai cognitive insight
            </DialogTitle>
            <DialogDescription className={clinical ? "text-rose-100/65" : "text-slate-400"}>
              Live pipeline trace plus memory, browser, drift, and note when ASI succeeds.
            </DialogDescription>
          </DialogHeader>

          <FetchThinkingTrace
            loading={loading}
            clinical={clinical}
            snapshot={traceSnapshot}
            agentSucceeded={traceAgentOk}
            parseFallback={parseFallback}
            agentChain={fetchChainForTrace}
          />

          {loading ? (
            <p className="text-center text-sm text-slate-500">Synthesizing caregiver insight…</p>
          ) : insightForBody ? (
            <InsightBody data={insightForBody} tone={sectionTone} />
          ) : error && modalOpen ? (
            <p className="text-sm text-red-200" role="alert">
              {error}
            </p>
          ) : data && data.agentverse && "ok" in data.agentverse && !data.agentverse.ok ? (
            <p className="text-sm text-amber-100/95" role="status">
              {(data.agentverse as { error?: string }).error || "Fetch agent call failed"}
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              {traceAgentOk
                ? "Insight sections will appear above when the model returns tagged blocks."
                : "Run the pipeline to see ASI output, or fix Perception / bridge errors in logs."}
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <button
              type="button"
              onClick={() => void regenerateInModal()}
              disabled={loading}
              className={cn(
                "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50",
                clinical
                  ? "border-rose-400/35 bg-rose-950/40 text-rose-50 hover:bg-rose-900/50"
                  : "border-white/15 bg-white/10 text-slate-100 hover:bg-white/15",
              )}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {loading ? "Generating…" : "Generate new insight"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
