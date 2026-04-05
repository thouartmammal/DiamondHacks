import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiUrl } from "../lib/apiUrl";

type MediaEvent = {
  id: string;
  occurredAt: string;
  url: string;
  title: string;
  description: string;
  seriesKey: string;
  episodeNumber: number | null;
  dayIndex: number;
};

type Narrative = {
  seriesKey: string;
  narrativeSeq: number;
  lastConfirmedEpisode: number | null;
  updatedAt: string;
};

type WeekMetric = {
  weekIndex: number;
  weekStart: string;
  weekEnd: string;
  inconsistencyCount: number;
  avgSeverityProxy: number;
};

type Metrics = {
  disclaimer: string;
  totalInconsistenciesLogged: number;
  last14DaysCount: number;
  weekly: WeekMetric[];
  narrative: Narrative;
};

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [seriesKey, setSeriesKey] = useState("friends");
  const [episodeNumber, setEpisodeNumber] = useState("");
  const [assertionText, setAssertionText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [schedule, setSchedule] = useState<
    { date: string; events: MediaEvent[] }[]
  >([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [nRes, sRes, mRes] = await Promise.all([
        fetch(apiUrl("memory/narrative")),
        fetch(apiUrl("memory/schedule?days=21")),
        fetch(apiUrl("memory/metrics?weeks=8")),
      ]);
      if (nRes.ok) {
        const d = (await nRes.json()) as { narrative: Narrative };
        setNarrative(d.narrative);
      }
      if (sRes.ok) {
        const d = (await sRes.json()) as {
          schedule: { date: string; events: MediaEvent[] }[];
        };
        setSchedule(d.schedule);
      }
      if (mRes.ok) {
        setMetrics((await mRes.json()) as Metrics);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load memory data");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitMedia(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(apiUrl("memory/media"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          title: title || undefined,
          description: description || undefined,
          seriesKey: seriesKey || "default",
          episodeNumber: episodeNumber ? Number(episodeNumber) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setMsg("Saved this viewing.");
      setNarrative(data.narrative);
      setUrl("");
      setTitle("");
      setDescription("");
      setEpisodeNumber("");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function submitAssertion(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(apiUrl("memory/assertions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: assertionText,
          seriesKey: seriesKey || "default",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.reconciliation) {
        setMsg(
          `Recorded. Narrative adjusted to day/episode ${data.reconciliation.newNarrativeSeq}.`
        );
      } else if (data.inconsistency) {
        setMsg(
          "Noted a difference between what you remember and the log — saved for caregivers."
        );
      } else {
        setMsg("Recorded what you remember.");
      }
      setAssertionText("");
      setNarrative(data.narrative);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto py-10 px-4"
      style={{ backgroundColor: "rgba(30, 58, 95, 0.35)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl shadow-xl p-8 my-auto"
        style={{
          backgroundColor: "rgba(248, 251, 255, 0.97)",
          border: "3px solid #3b82f6",
          color: "#1e3a5f",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold mb-1">Memory &amp; viewing</h2>
            <p className="text-sm" style={{ color: "#5b7a9e" }}>
              Gentle log of what you watch and what you remember — for you and
              trusted family. Not a medical record.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 px-3 py-1 rounded-lg font-semibold"
            style={{ border: "2px solid #3b82f6", color: "#3b82f6" }}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {narrative && (
          <div
            className="mb-6 p-4 rounded-xl text-left text-sm"
            style={{ backgroundColor: "#f8fbff", border: "1px solid #93c5fd" }}
          >
            <strong>Current story position</strong> (series:{" "}
            {narrative.seriesKey}): episode{" "}
            {narrative.lastConfirmedEpisode ?? "—"}, narrative step{" "}
            {narrative.narrativeSeq}.
          </div>
        )}

        <form onSubmit={submitMedia} className="mb-8 text-left space-y-3">
          <h3 className="font-semibold text-lg">Log today&apos;s media</h3>
          <label className="block text-sm">
            URL
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-400 bg-white"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              required
            />
          </label>
          <label className="block text-sm">
            Title
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-400 bg-white"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Friends"
            />
          </label>
          <label className="block text-sm">
            Description / notes
            <textarea
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-400 bg-white"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Episode 4 — The One with the Embryos"
            />
          </label>
          <div className="flex gap-3 flex-wrap">
            <label className="text-sm flex-1 min-w-[120px]">
              Series key
              <input
                className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-400 bg-white"
                value={seriesKey}
                onChange={(e) => setSeriesKey(e.target.value)}
              />
            </label>
            <label className="text-sm w-28">
              Episode #
              <input
                type="number"
                min={0}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-400 bg-white"
                value={episodeNumber}
                onChange={(e) => setEpisodeNumber(e.target.value)}
                placeholder="4"
              />
            </label>
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl font-semibold text-white"
            style={{ backgroundColor: "#3b82f6" }}
          >
            Save viewing
          </button>
        </form>

        <form onSubmit={submitAssertion} className="mb-8 text-left space-y-3">
          <h3 className="font-semibold text-lg">What you remember saying</h3>
          <p className="text-sm" style={{ color: "#5b7a9e" }}>
            If today you remember a different episode than we logged, say it
            here — we&apos;ll try to match an earlier time you watched that
            episode and gently align the story.
          </p>
          <textarea
            className="w-full px-3 py-2 rounded-lg border border-stone-400 bg-white"
            rows={3}
            value={assertionText}
            onChange={(e) => setAssertionText(e.target.value)}
            placeholder='e.g. "I watched episode 3 today, not episode 4"'
            required
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-xl font-semibold"
            style={{
              border: "2px solid #3b82f6",
              color: "#3b82f6",
              backgroundColor: "transparent",
            }}
          >
            Save memory
          </button>
        </form>

        <div className="mb-8 text-left">
          <h3 className="font-semibold text-lg mb-2">By day (URLs)</h3>
          {schedule.length === 0 ? (
            <p className="text-sm" style={{ color: "#5b7a9e" }}>
              No viewings logged yet.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {schedule.map(({ date, events }) => (
                <li
                  key={date}
                  className="p-3 rounded-lg"
                  style={{ backgroundColor: "#f8fbff" }}
                >
                  <strong>{date}</strong>
                  <ul className="mt-1 ml-3 list-disc">
                    {events.map((ev) => (
                      <li key={ev.id}>
                        <a
                          href={ev.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                          style={{ color: "#2563eb" }}
                        >
                          {ev.title}
                        </a>
                        {ev.episodeNumber != null && (
                          <span> — ep {ev.episodeNumber}</span>
                        )}
                        {ev.description && (
                          <span style={{ color: "#5b7a9e" }}>
                            {" "}
                            ({ev.description.slice(0, 80)}
                            {ev.description.length > 80 ? "…" : ""})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        {metrics && (
          <div className="text-left border-t border-stone-400 pt-6">
            <h3 className="font-semibold text-lg mb-1">
              For caregivers: memory pattern (not medical)
            </h3>
            <p className="text-xs mb-3" style={{ color: "#5b7a9e" }}>
              {metrics.disclaimer}
            </p>
            <p className="text-sm mb-2">
              Total logged differences: {metrics.totalInconsistenciesLogged}.
              Last 14 days: {metrics.last14DaysCount}.
            </p>
            <div className="overflow-x-auto">
              <table className="text-sm w-full border-collapse">
                <thead>
                  <tr style={{ backgroundColor: "#d4d2c4" }}>
                    <th className="p-2 text-left border border-stone-400">
                      Week
                    </th>
                    <th className="p-2 text-left border border-stone-400">
                      Count
                    </th>
                    <th className="p-2 text-left border border-stone-400">
                      Avg intensity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.weekly.map((w) => (
                    <tr key={w.weekIndex}>
                      <td className="p-2 border border-stone-300">
                        {w.weekStart} → {w.weekEnd}
                      </td>
                      <td className="p-2 border border-stone-300">
                        {w.inconsistencyCount}
                      </td>
                      <td className="p-2 border border-stone-300">
                        {w.avgSeverityProxy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {msg && (
          <p className="mt-4 text-sm font-medium" style={{ color: "#2563eb" }}>
            {msg}
          </p>
        )}
        {err && (
          <p className="mt-2 text-sm text-red-800" role="alert">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}
