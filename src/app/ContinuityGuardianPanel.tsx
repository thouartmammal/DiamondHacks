import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiUrl } from "../lib/apiUrl";

type RecentReality = {
  generatedAt: string;
  windowDays: number;
  disclaimer: string;
  recentVisitCount: number;
  topHostsRecent: { host: string; count: number; lastAt: string }[];
  routineHosts: string[];
  narrative: {
    seriesKey: string;
    lastConfirmedEpisode: number | null;
    updatedAt: string;
  };
  lastMediaWithEpisode: {
    episodeNumber: number | null;
    title: string;
    occurredAt: string;
    seriesKey: string;
  } | null;
  purchaseSignals: {
    hadShoppingVisitInWindow: boolean;
    lastShoppingHost: string | null;
    lastShoppingAt: string | null;
  };
};

type Conflict = {
  code: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
};

type CheckResult = {
  status: "ok" | "conflict" | "uncertain";
  headline: string;
  pitch: string;
  conflicts: Conflict[];
  reminders: string[];
  recentReality: RecentReality;
  source?: string;
};

export function ContinuityGuardianPanel({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [reality, setReality] = useState<RecentReality | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingReality, setLoadingReality] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadReality = useCallback(async () => {
    setLoadingReality(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("continuity/reality?days=14"));
      const data = (await res.json()) as { recentReality?: RecentReality; error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.recentReality) setReality(data.recentReality);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load recent reality");
    } finally {
      setLoadingReality(false);
    }
  }, []);

  useEffect(() => {
    void loadReality();
  }, [loadReality]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(apiUrl("continuity/check"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          pageUrl: pageUrl.trim() || null,
        }),
      });
      const data = (await res.json()) as CheckResult & { error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText);
      setResult(data);
      if (data.recentReality) setReality(data.recentReality);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Check failed");
    } finally {
      setLoading(false);
    }
  }

  const statusStyles =
    result?.status === "conflict"
      ? { border: "3px solid #dc2626", badge: "#fef2f2", badgeText: "#991b1b" }
      : result?.status === "uncertain"
        ? { border: "3px solid #ca8a04", badge: "#fffbeb", badgeText: "#854d0e" }
        : result
          ? { border: "3px solid #16a34a", badge: "#f0fdf4", badgeText: "#166534" }
          : { border: "3px solid #3b82f6", badge: "#f8fbff", badgeText: "#1e3a5f" };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto py-8 px-4"
      style={{ backgroundColor: "rgba(30, 58, 95, 0.35)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl shadow-xl p-6 sm:p-8 my-auto max-h-[calc(100vh-4rem)] overflow-y-auto"
        style={{
          backgroundColor: "rgba(248, 251, 255, 0.97)",
          border: statusStyles.border,
          color: "#1e3a5f",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-4 mb-4">
          <div>
            <h2 className="text-2xl font-bold mb-1">Continuity Guardian</h2>
            <p className="text-sm leading-snug" style={{ color: "#5b7a9e" }}>
              Instead of only asking “Is this site safe?”, we ask:{" "}
              <strong>Does this match what actually happened in your recent Boomer Browse activity?</strong>{" "}
              Scams often contradict reality—we surface those clashes when we can.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 px-3 py-1 rounded-lg font-semibold text-sm sm:text-base"
            style={{ border: "2px solid #3b82f6", color: "#3b82f6" }}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {reality && (
          <div
            className="mb-5 p-4 rounded-xl text-left text-sm space-y-2"
            style={{ backgroundColor: statusStyles.badge, border: `1px solid ${statusStyles.badgeText}33` }}
          >
            <p className="font-semibold" style={{ color: statusStyles.badgeText }}>
              Your recent reality ({reality.windowDays} days in this app)
            </p>
            {loadingReality ? (
              <p style={{ color: "#5b7a9e" }}>Loading…</p>
            ) : (
              <>
                <p>
                  <strong>Visits logged:</strong> {reality.recentVisitCount} in this window.
                </p>
                {reality.topHostsRecent.length > 0 && (
                  <p>
                    <strong>Common sites here:</strong>{" "}
                    {reality.topHostsRecent.slice(0, 6).map((h) => h.host).join(", ")}
                    {reality.topHostsRecent.length > 6 ? "…" : ""}
                  </p>
                )}
                {reality.narrative.lastConfirmedEpisode != null && (
                  <p>
                    <strong>Last saved show episode:</strong> {reality.narrative.lastConfirmedEpisode}{" "}
                    <span style={{ color: "#5b7a9e" }}>({reality.narrative.seriesKey})</span>
                  </p>
                )}
                <p style={{ color: "#64748b", fontSize: "0.8rem" }}>{reality.disclaimer}</p>
              </>
            )}
          </div>
        )}

        <form onSubmit={onSubmit} className="text-left space-y-3 mb-4">
          <label className="block text-sm font-medium">
            Paste what the page, email, or caller wants you to believe
            <textarea
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-400 bg-white text-base min-h-[120px]"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Example: Your Amazon account is locked. Click here to verify…"
              disabled={loading}
            />
          </label>
          <label className="block text-sm font-medium">
            Page address (optional — helps spot mismatches)
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-400 bg-white text-base"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              placeholder="https://…"
              disabled={loading}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading || !message.trim()}
              className="px-5 py-2.5 rounded-xl font-semibold text-[#f8fbff] disabled:opacity-50"
              style={{ backgroundColor: "#2563eb" }}
            >
              {loading ? "Checking…" : "Check against my recent reality"}
            </button>
            <button
              type="button"
              onClick={() => void loadReality()}
              className="px-4 py-2.5 rounded-xl font-semibold"
              style={{ border: "2px solid #93c5fd", color: "#2563eb" }}
            >
              Refresh snapshot
            </button>
          </div>
        </form>

        {err && (
          <p className="text-red-700 text-sm mb-3" role="alert">
            {err}
          </p>
        )}

        {result && (
          <div className="text-left space-y-4 border-t border-sky-200 pt-4">
            {result.source && (
              <p className="text-xs font-bold uppercase tracking-wide text-sky-700">
                Source:{" "}
                {result.source === "memory-anchor"
                  ? "Memory anchor agent (grounded in your Boomer log)"
                  : result.source === "fetch-ai"
                    ? "External continuity service"
                    : result.source === "local"
                      ? "Local rules"
                      : result.source}
              </p>
            )}
            <p className="text-sm italic" style={{ color: "#475569" }}>
              {result.pitch}
            </p>
            <p className="text-lg font-bold" style={{ color: statusStyles.badgeText }}>
              {result.headline}
            </p>
            {result.conflicts.length > 0 && (
              <ul className="space-y-3">
                {result.conflicts.map((c) => (
                  <li
                    key={c.code + c.title}
                    className="p-3 rounded-xl text-sm"
                    style={{
                      backgroundColor: c.severity === "high" ? "#fef2f2" : "#fff7ed",
                      border: `1px solid ${c.severity === "high" ? "#fecaca" : "#fed7aa"}`,
                    }}
                  >
                    <span className="font-bold block mb-1">
                      {c.severity === "high" ? "⚠ " : "◆ "}
                      {c.title}
                    </span>
                    {c.detail}
                  </li>
                ))}
              </ul>
            )}
            {result.reminders.length > 0 && (
              <ul className="list-disc pl-5 text-sm space-y-1" style={{ color: "#334155" }}>
                {result.reminders.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
