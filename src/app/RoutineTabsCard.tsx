import { useCallback, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { openRoutineFlowInBrowser } from "../lib/routineFlowClient";
import { cn } from "./components/ui/utils";

function GlassPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="dashboard-glass-hover-surface will-change-transform">
      <div className={cn("dashboard-glass-panel", className)}>{children}</div>
    </div>
  );
}

export function RoutineTabsCard({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const openRoutine = useCallback(async () => {
    setBusy(true);
    setNote(null);
    setErr(null);
    try {
      const { patternSummary, opened, lines } = await openRoutineFlowInBrowser();
      setNote(
        opened > 0
          ? `Opened ${opened} tab(s). ${patternSummary.slice(0, 120)}${patternSummary.length > 120 ? "…" : ""}`
          : patternSummary || "Not enough visits yet — browse more, then try again.",
      );
      if (opened > 0 && lines) console.info("[routine flow]", lines);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open routine");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <GlassPanel className={cn("p-4 sm:p-5", className)}>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-400/15 text-cyan-300 ring-1 ring-cyan-200/25">
          <ExternalLink className="h-6 w-6" strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-sky-50">Routine tabs</h3>
          <p className="text-sm text-cyan-200/85">
            Open up to five sites inferred from recent activity (activity.db when present, otherwise saved visits).
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void openRoutine()}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-sky-400/40 bg-sky-950/40 px-4 py-2.5 text-sm font-semibold text-sky-100 shadow-sm transition hover:bg-sky-900/50 disabled:opacity-60 sm:w-auto"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Building routine…
          </>
        ) : (
          <>
            <ExternalLink className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Open routine tabs (max 5)
          </>
        )}
      </button>
      {note && (
        <p className="mt-3 text-xs leading-snug text-cyan-200/85" role="status">
          {note}
        </p>
      )}
      {err && (
        <p className="mt-3 rounded-lg border border-amber-400/35 bg-amber-950/25 px-3 py-2 text-sm text-amber-100" role="alert">
          {err}
        </p>
      )}
    </GlassPanel>
  );
}
