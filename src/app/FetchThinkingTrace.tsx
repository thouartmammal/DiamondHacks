import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { cn } from "./components/ui/utils";

type SnapshotFields = {
  window_hours?: number;
  visit_count?: number;
  unique_hosts?: number;
  top_host?: string;
  top_host_hits?: number;
  repeat_ratio?: number;
  source?: string;
};

/** Four inputs that merge into one SnapshotMsg (tree leaves). */
const TREE_LEAVES = [
  { id: "memory", label: "Memory", sub: "Narrative & recall ops" },
  { id: "browser", label: "Browser", sub: "Visits & patterns" },
  { id: "wellness", label: "Wellness", sub: "Mood / activity lens" },
  { id: "drift", label: "Drift", sub: "Vs prior window" },
] as const;

const MERGE_NODE = {
  id: "snapshot",
  title: "Holistic snapshot",
  detail: "Single SnapshotMsg JSON → Perception agent",
};

const TRUNK_STEPS = [
  {
    id: "bridge",
    title: "Query bridge",
    detail: "Node → Python uAgents → Perception address",
  },
  {
    id: "asi",
    title: "ASI:One reasoning",
    detail: "Holistic prompt → caregiver-safe language",
  },
  {
    id: "tags",
    title: "Structure output",
    detail: "[[MEMORY]] [[BROWSER]] [[DRIFT]] [[NOTE]]",
  },
] as const;

/** Phases while loading: 0 leaves, 1 merge, 2–4 trunk. */
const PHASE_LEAVES = 0;
const PHASE_MERGE = 1;
const PHASE_TRUNK_0 = 2;
const PHASE_TRUNK_1 = 3;
const PHASE_TRUNK_2 = 4;

type StepStatus = "pending" | "active" | "done" | "error";

function NodeShell({
  status,
  clinical,
  compact,
  children,
}: {
  status: StepStatus;
  clinical: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative z-[2] flex gap-2 rounded-lg border transition-all duration-300",
        compact ? "px-2 py-1.5" : "gap-3 px-2.5 py-2",
        status === "active" &&
          (clinical
            ? "border-rose-400/55 bg-rose-500/15 shadow-[0_0_16px_-4px_rgba(244,63,94,0.4)]"
            : "border-indigo-400/55 bg-indigo-500/15 shadow-[0_0_16px_-4px_rgba(99,102,241,0.4)]"),
        status === "done" && "border-white/12 bg-white/[0.04]",
        status === "error" && "border-amber-400/40 bg-amber-950/30",
        status === "pending" && "border-white/[0.06] bg-slate-950/40 opacity-50",
      )}
    >
      <div className={cn("flex shrink-0 items-center justify-center", compact ? "h-7 w-7" : "h-8 w-8")}>
        {status === "done" ? (
          <Check
            className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", clinical ? "text-rose-300" : "text-indigo-300")}
            strokeWidth={2.5}
          />
        ) : status === "active" ? (
          <Loader2
            className={cn(
              "animate-spin",
              compact ? "h-3.5 w-3.5" : "h-4 w-4",
              clinical ? "text-rose-200" : "text-indigo-200",
            )}
            aria-hidden
          />
        ) : status === "error" ? (
          <AlertCircle className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", "text-amber-300")} strokeWidth={2} />
        ) : (
          <span className={cn("rounded-full bg-slate-600", compact ? "h-1.5 w-1.5" : "h-2 w-2")} aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TreeConnectorsSVG({
  leavesLit,
  mergeLit,
  clinical,
}: {
  leavesLit: boolean;
  mergeLit: boolean;
  clinical: boolean;
}) {
  const stroke = clinical ? "rgba(244,63,94,0.45)" : "rgba(129,140,248,0.5)";
  const strokeDim = "rgba(148,163,184,0.2)";
  const s = leavesLit || mergeLit ? stroke : strokeDim;

  return (
    <svg
      viewBox="0 0 100 26"
      className="pointer-events-none relative z-[1] -mt-1 mb-1 w-full max-w-[min(100%,28rem)] mx-auto h-[1.4rem] shrink-0"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {/* Branches: four leaf bottoms (top of svg) converge to center hub */}
      <path
        d="M 12.5 2 V 9 L 50 22 M 37.5 2 V 9 L 50 22 M 62.5 2 V 9 L 50 22 M 87.5 2 V 9 L 50 22"
        fill="none"
        stroke={s}
        strokeWidth={1.15}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-colors duration-300"
      />
      {/* Trunk stem down from hub toward merge node */}
      <line
        x1="50"
        y1="22"
        x2="50"
        y2="25.5"
        stroke={mergeLit ? stroke : strokeDim}
        strokeWidth={1.15}
        strokeLinecap="round"
        className="transition-colors duration-300"
      />
    </svg>
  );
}

type TraceResearchNews =
  | {
      ok: true;
      items: unknown[];
      broadFallback?: boolean;
    }
  | { ok: false; disabled?: boolean; message?: string }
  | null
  | undefined;

export function FetchThinkingTrace({
  loading,
  clinical,
  snapshot,
  agentSucceeded,
  parseFallback,
  agentChain,
  researchNews,
}: {
  loading: boolean;
  clinical: boolean;
  snapshot?: SnapshotFields | null;
  agentSucceeded: boolean;
  parseFallback?: boolean;
  /** e.g. `drift-only` from hosted Drift when PERCEPTION_AGENT_ADDRESS is unset */
  agentChain?: string | null;
  /** NewsData headlines fetched on the voice server in parallel with the holistic snapshot */
  researchNews?: TraceResearchNews;
}) {
  const [livePhase, setLivePhase] = useState(0);

  useEffect(() => {
    if (!loading) {
      setLivePhase(PHASE_TRUNK_2 + 1);
      return;
    }
    setLivePhase(PHASE_LEAVES);
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const p = Math.min(Math.floor(elapsed / 420), PHASE_TRUNK_2);
      setLivePhase(p);
    }, 100);
    return () => clearInterval(id);
  }, [loading]);

  const snapLine =
    snapshot &&
    (typeof snapshot.visit_count === "number" || typeof snapshot.top_host === "string")
      ? [
          typeof snapshot.visit_count === "number" ? `${snapshot.visit_count} visits` : null,
          snapshot.top_host ? `top: ${snapshot.top_host}` : null,
          typeof snapshot.repeat_ratio === "number"
            ? `repeat ${(snapshot.repeat_ratio * 100).toFixed(0)}%`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  function trunkStatus(i: number): StepStatus {
    const phaseForStep = PHASE_TRUNK_0 + i;
    if (loading) {
      if (livePhase > phaseForStep) return "done";
      if (livePhase === phaseForStep) return "active";
      return "pending";
    }
    if (agentSucceeded) {
      if (parseFallback && i === TRUNK_STEPS.length - 1 && agentChain !== "drift-only") return "error";
      return "done";
    }
    if (i <= 0) return "done";
    if (i === 1) return "error";
    return "pending";
  }

  const leavesDone = !loading || livePhase > PHASE_LEAVES;
  const mergeDone = !loading || livePhase > PHASE_MERGE;

  const leafBoxStatus = (): StepStatus => {
    if (loading) {
      if (livePhase > PHASE_LEAVES) return "done";
      if (livePhase === PHASE_LEAVES) return "active";
      return "pending";
    }
    return "done";
  };

  const mergeBoxStatus = (): StepStatus => {
    if (loading) {
      if (livePhase > PHASE_MERGE) return "done";
      if (livePhase === PHASE_MERGE) return "active";
      return "pending";
    }
    return "done";
  };

  const branchesLit = leavesDone;
  const stemLit = mergeDone;

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3 sm:px-4",
        clinical
          ? "border-rose-400/25 bg-gradient-to-br from-rose-950/40 to-slate-950/40"
          : "border-indigo-400/20 bg-gradient-to-br from-indigo-950/30 to-slate-950/50",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p
          className={cn(
            "text-[10px] font-bold uppercase tracking-[0.14em]",
            clinical ? "text-rose-300/90" : "text-indigo-200/90",
          )}
        >
          Live Fetch trace
        </p>
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Running pipeline…
          </span>
        ) : (
          <span
            className={cn(
              "text-xs font-medium",
              agentSucceeded && agentChain !== "drift-only"
                ? "text-emerald-300/90"
                : "text-amber-200/90",
            )}
          >
            {agentSucceeded && agentChain === "drift-only"
              ? "Drift-only (add Perception secret on Drift)"
              : agentSucceeded
                ? "Pipeline complete"
                : "Ingest complete · ASI check logs"}
          </span>
        )}
      </div>
      {snapLine ? (
        <p className="mb-3 font-mono text-[0.65rem] leading-relaxed text-slate-500">{snapLine}</p>
      ) : null}

      <div className="flex flex-col items-stretch" role="tree" aria-label="Fetch cognitive pipeline tree">
        {/* —— Tree leaves (breadth) —— */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2" role="group" aria-label="Context inputs">
          {TREE_LEAVES.map((leaf) => (
            <NodeShell key={leaf.id} status={leafBoxStatus()} clinical={clinical} compact>
              <p className="text-[0.7rem] font-bold leading-tight text-slate-100">{leaf.label}</p>
              <p className="text-[0.6rem] leading-snug text-slate-500">{leaf.sub}</p>
            </NodeShell>
          ))}
        </div>

        <TreeConnectorsSVG leavesLit={branchesLit} mergeLit={stemLit} clinical={clinical} />

        {/* —— Merge node —— */}
        <div className="mx-auto w-full max-w-md" role="treeitem" aria-level={2}>
          <NodeShell status={mergeBoxStatus()} clinical={clinical}>
            <p className="text-xs font-semibold text-slate-100">{MERGE_NODE.title}</p>
            <p className="text-[0.7rem] leading-snug text-slate-500">{MERGE_NODE.detail}</p>
          </NodeShell>
        </div>

        {/* —— News index (voice server → NewsData.io, parallel to this trace) —— */}
        {!loading &&
        researchNews &&
        researchNews.ok &&
        Array.isArray(researchNews.items) &&
        researchNews.items.length > 0 ? (
          <div className="mx-auto mt-2 w-full max-w-md" role="treeitem" aria-level={2}>
            <NodeShell status="done" clinical={clinical}>
              <p className="text-xs font-semibold text-slate-100">Brain-health headline index</p>
              <p className="text-[0.7rem] leading-snug text-slate-500">
                {researchNews.broadFallback
                  ? "NewsData returned general latest stories (your topic keywords had no matches in their index this run)."
                  : `NewsData latest index: ${researchNews.items.length} article(s) on Alzheimer’s / brain-health style keywords — see list below. Not medical advice.`}
              </p>
            </NodeShell>
          </div>
        ) : !loading && researchNews && !researchNews.ok && !researchNews.disabled ? (
          <div className="mx-auto mt-2 w-full max-w-md">
            <NodeShell status="error" clinical={clinical}>
              <p className="text-xs font-semibold text-slate-100">Brain-health headline index</p>
              <p className="text-[0.7rem] leading-snug text-amber-200/85">
                {researchNews.message ?? "Headlines request failed — check NEWSDATA_API_KEY on the voice server."}
              </p>
            </NodeShell>
          </div>
        ) : null}

        {/* —— Trunk: vertical spine + steps —— */}
        <div className="relative mx-auto mt-1 flex w-full max-w-md flex-col items-stretch pl-4 sm:pl-5">
          <div
            className={cn(
              "absolute bottom-2 left-[11px] top-2 w-px sm:left-[13px]",
              clinical ? "bg-rose-500/25" : "bg-indigo-500/25",
            )}
            aria-hidden
          />
          {TRUNK_STEPS.map((step, i) => {
            const status = trunkStatus(i);
            return (
              <div key={step.id} className="relative z-[2] mb-2 last:mb-0" role="treeitem" aria-level={3 + i}>
                <div className="-ml-1 flex items-stretch gap-2">
                  <div className="flex w-5 shrink-0 justify-center pt-3 sm:w-6">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full border-2 border-slate-800",
                        status === "done" &&
                          (clinical ? "border-rose-300 bg-rose-400/90" : "border-indigo-300 bg-indigo-400/90"),
                        status === "active" &&
                          (clinical ? "border-rose-200 bg-rose-500 animate-pulse" : "border-indigo-200 bg-indigo-500 animate-pulse"),
                        status === "error" && "border-amber-300 bg-amber-500/80",
                        status === "pending" && "border-slate-600 bg-slate-800",
                      )}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <NodeShell status={status} clinical={clinical}>
                      <p className="text-xs font-semibold text-slate-100">{step.title}</p>
                      <p className="text-[0.7rem] leading-snug text-slate-500">{step.detail}</p>
                      {agentChain === "drift-only" && i === TRUNK_STEPS.length - 1 ? (
                        <p className="mt-1 text-[0.65rem] text-slate-400">
                          Template only — no [[MEMORY]]… tags until Drift forwards to Perception.
                        </p>
                      ) : status === "error" && i === TRUNK_STEPS.length - 1 ? (
                        <p className="mt-1 text-[0.65rem] text-amber-200/90">
                          Model reply kept as single block (tags optional).
                        </p>
                      ) : null}
                    </NodeShell>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
