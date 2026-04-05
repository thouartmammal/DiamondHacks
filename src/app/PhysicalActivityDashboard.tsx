import { useCallback, useEffect, useMemo, useId, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FlyingBluePapersOverlay } from "./FlyingBluePapersOverlay";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Brain, Heart, Lock, X } from "lucide-react";
import { apiUrl } from "../lib/apiUrl";
import owlPng from "../assets/owl.png";
import { cn } from "./components/ui/utils";
import { DashboardSkyBackground } from "./DashboardSkyBackground";
import { CognitiveFetchCard } from "./CognitiveFetchCard";
import { WellnessHumanSilhouette } from "./WellnessHumanSilhouette";
import { useTranslation } from "../i18n/LanguageContext";

export type PhysicalActivityPayload = {
  averageMediaMood: number;
  averageMediaMoodLabel: string;
  mediaAgeBand: "kids" | "teen" | "adult" | "senior" | "mixed";
  mediaAgeDescription: string;
  estimatedContentAgeYears: number | null;
  moodSeries: { date: string; mood: number; moodDriver?: string }[];
  memoryLossDegreeSeries: { date: string; value: number; memoryDriver?: string }[];
  memoryLossFrequencySeries: { date: string; count: number; frequencyDriver?: string }[];
};

function GlassPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="dashboard-glass-hover-surface min-w-0 will-change-transform">
      <div className={cn("dashboard-glass-panel min-w-0", className)}>
        {children}
      </div>
    </div>
  );
}

const chartAxis = { stroke: "rgba(186, 230, 253, 0.28)", fontSize: 11 };
const tickFill = "rgba(224, 242, 254, 0.75)";
const gridStroke = "rgba(186, 230, 253, 0.12)";

/** Same block size for both plots so charts match; Recharts needs a definite height. */
const WELLNESS_CHART_PLOT_CLASS =
  "relative h-[min(52vh,480px)] min-h-[300px] w-full shrink-0";
const WELLNESS_CHART_MIN_HEIGHT = 300;

const PHYSICAL_ACTIVITY_SESSION_KEY = "boomer-physical-activity-unlocked";
const PHYSICAL_ACTIVITY_PASSWORD = "1234";

function shortDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type CombinedMoodDegreePoint = {
  date: string;
  mood: number | null;
  degree: number | null;
  moodDriver?: string;
  memoryDriver?: string;
  isMoodMin?: boolean;
  isMoodMax?: boolean;
  isDegreeMin?: boolean;
  isDegreeMax?: boolean;
};

function mergeMoodAndDegreeSeries(
  moodSeries: PhysicalActivityPayload["moodSeries"],
  degreeSeries: PhysicalActivityPayload["memoryLossDegreeSeries"],
): CombinedMoodDegreePoint[] {
  const moodByDate = new Map(moodSeries.map((m) => [m.date, m]));
  const degreeByDate = new Map(degreeSeries.map((d) => [d.date, d]));
  const dates = [...new Set([...moodByDate.keys(), ...degreeByDate.keys()])].sort();
  return dates.map((date) => {
    const m = moodByDate.get(date);
    const d = degreeByDate.get(date);
    return {
      date,
      mood: m ? m.mood : null,
      degree: d ? d.value : null,
      moodDriver: m?.moodDriver,
      memoryDriver: d?.memoryDriver,
    };
  });
}

function withMoodDegreeExtrema(points: CombinedMoodDegreePoint[]): CombinedMoodDegreePoint[] {
  const moods = points.map((p) => p.mood).filter((x): x is number => x != null);
  const degrees = points.map((p) => p.degree).filter((x): x is number => x != null);
  const moodMin = moods.length ? Math.min(...moods) : null;
  const moodMax = moods.length ? Math.max(...moods) : null;
  const degMin = degrees.length ? Math.min(...degrees) : null;
  const degMax = degrees.length ? Math.max(...degrees) : null;
  return points.map((p) => ({
    ...p,
    isMoodMin: p.mood != null && moodMin != null && p.mood === moodMin,
    isMoodMax: p.mood != null && moodMax != null && p.mood === moodMax,
    isDegreeMin: p.degree != null && degMin != null && p.degree === degMin,
    isDegreeMax: p.degree != null && degMax != null && p.degree === degMax,
  }));
}

type FrequencyPoint = PhysicalActivityPayload["memoryLossFrequencySeries"][number] & {
  isFreqMin?: boolean;
  isFreqMax?: boolean;
};

function withFrequencyExtrema(
  series: PhysicalActivityPayload["memoryLossFrequencySeries"],
): FrequencyPoint[] {
  if (series.length === 0) return [];
  const counts = series.map((s) => s.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return series.map((s) => ({
    ...s,
    isFreqMin: s.count === min,
    isFreqMax: s.count === max,
  }));
}

type CombinedSeriesFilter = "both" | "mood" | "degree";

const tooltipBoxClass =
  "max-w-[min(92vw,22rem)] rounded-xl border border-cyan-400/35 bg-slate-950/95 px-3 py-2 text-sm text-sky-50 shadow-lg";

function MoodMemoryTooltip({
  active,
  payload,
  label,
  filter,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CombinedMoodDegreePoint }>;
  label?: string | number;
  filter: CombinedSeriesFilter;
}) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const dateLabel = typeof label === "string" ? shortDate(label) : String(label ?? "");

  const showMoodReason =
    (filter === "both" || filter === "mood") && row.mood != null && (row.isMoodMin || row.isMoodMax);
  const showDegreeReason =
    (filter === "both" || filter === "degree") &&
    row.degree != null &&
    (row.isDegreeMin || row.isDegreeMax);

  return (
    <div className={tooltipBoxClass}>
      <p className="mb-1.5 font-semibold text-cyan-100">{dateLabel}</p>
      {(filter === "both" || filter === "mood") && row.mood != null && (
        <p className="tabular-nums text-cyan-50">
          {t("wellness.tooltipMood")}{" "}
          <span className="font-medium text-cyan-200">{row.mood.toFixed(2)}</span>
        </p>
      )}
      {(filter === "both" || filter === "degree") && row.degree != null && (
        <p className="tabular-nums text-cyan-50">
          {t("wellness.tooltipMemoryDeg")}{" "}
          <span className="font-medium text-sky-100">{row.degree.toFixed(2)}</span>
        </p>
      )}
      {showMoodReason && row.moodDriver && (
        <p className="mt-2 border-t border-white/10 pt-2 text-xs leading-snug text-cyan-100/95">
          <span className="font-semibold text-cyan-200">{t("wellness.whyMood")} </span>
          {row.moodDriver}
        </p>
      )}
      {showDegreeReason && row.memoryDriver && (
        <p className="mt-2 border-t border-white/10 pt-2 text-xs leading-snug text-cyan-100/95">
          <span className="font-semibold text-sky-200">{t("wellness.whyMemory")} </span>
          {row.memoryDriver}
        </p>
      )}
    </div>
  );
}

function FrequencyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: FrequencyPoint }>;
  label?: string | number;
}) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const dateLabel = typeof label === "string" ? shortDate(label) : String(label ?? "");
  const showReason = row.isFreqMin || row.isFreqMax;

  return (
    <div className={tooltipBoxClass}>
      <p className="mb-1.5 font-semibold text-cyan-100">{dateLabel}</p>
      <p className="tabular-nums text-cyan-50">
        {t("wellness.tooltipEvents")}{" "}
        <span className="font-medium text-cyan-200">{row.count}</span>
      </p>
      {showReason && row.frequencyDriver && (
        <p className="mt-2 border-t border-white/10 pt-2 text-xs leading-snug text-cyan-100/95">
          <span className="font-semibold text-cyan-200">{t("wellness.why")} </span>
          {row.frequencyDriver}
        </p>
      )}
    </div>
  );
}

function MoodMemoryWellnessCard({
  combinedMoodDegreeSeries,
  combinedSeriesFilter,
  setCombinedSeriesFilter,
  chartInstanceKey,
}: {
  combinedMoodDegreeSeries: CombinedMoodDegreePoint[];
  combinedSeriesFilter: CombinedSeriesFilter;
  setCombinedSeriesFilter: (v: CombinedSeriesFilter) => void;
  chartInstanceKey: string;
}) {
  const { t } = useTranslation();
  const filterOptions = [
    { id: "both" as const, labelKey: "wellness.filterBoth" as const },
    { id: "mood" as const, labelKey: "wellness.filterMoodOnly" as const },
    { id: "degree" as const, labelKey: "wellness.filterMemoryOnly" as const },
  ] as const;
  return (
    <GlassPanel className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col p-3 sm:p-4">
      <div className="mb-1 flex shrink-0 flex-wrap items-center gap-2 text-sky-50/95">
        <Activity className="h-5 w-5 shrink-0 text-cyan-300" strokeWidth={2} aria-hidden />
        <span className="text-xs font-bold uppercase tracking-[0.12em] sm:text-sm">
          {t("wellness.moodMemoryCardTitle")}
        </span>
      </div>
      <p className="mb-2 shrink-0 text-sm leading-snug text-cyan-100/80">{t("wellness.moodMemoryCardBlurb")}</p>
      <div
        className="mb-2 flex shrink-0 flex-wrap gap-2"
        role="group"
        aria-label={t("wellness.filterGroupAria")}
      >
        {filterOptions.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            onClick={() => setCombinedSeriesFilter(id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300",
              combinedSeriesFilter === id
                ? "border-cyan-400/70 bg-cyan-500/25 text-sky-50 shadow-sm"
                : "border-white/20 bg-white/5 text-cyan-100/90 hover:bg-white/10",
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className={WELLNESS_CHART_PLOT_CLASS}>
        <ResponsiveContainer width="100%" height="100%" minHeight={WELLNESS_CHART_MIN_HEIGHT}>
          <ComposedChart
            data={combinedMoodDegreeSeries}
            margin={{
              top: 8,
              right: combinedSeriesFilter === "both" ? 44 : 8,
              left: 0,
              bottom: 0,
            }}
          >
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: tickFill, fontSize: 11 }}
              tickFormatter={shortDate}
              axisLine={chartAxis}
              tickLine={false}
            />
            {(combinedSeriesFilter === "both" || combinedSeriesFilter === "mood") && (
              <YAxis
                yAxisId="mood"
                domain={[-1, 1]}
                tick={{ fill: tickFill, fontSize: 11 }}
                tickFormatter={(v) => v.toFixed(1)}
                axisLine={chartAxis}
                tickLine={false}
                width={40}
                label={{
                  value: t("wellness.axisMood"),
                  angle: -90,
                  position: "insideLeft",
                  fill: tickFill,
                  fontSize: 10,
                }}
              />
            )}
            {(combinedSeriesFilter === "both" || combinedSeriesFilter === "degree") && (
              <YAxis
                yAxisId="deg"
                orientation={combinedSeriesFilter === "both" ? "right" : "left"}
                domain={[0, 1]}
                tick={{ fill: tickFill, fontSize: 11 }}
                tickFormatter={(v) => v.toFixed(1)}
                axisLine={chartAxis}
                tickLine={false}
                width={40}
                label={{
                  value: t("wellness.axisMemory"),
                  angle: combinedSeriesFilter === "both" ? 90 : -90,
                  position: combinedSeriesFilter === "both" ? "insideRight" : "insideLeft",
                  fill: tickFill,
                  fontSize: 10,
                }}
              />
            )}
            <Tooltip
              content={(props) => (
                <MoodMemoryTooltip
                  active={props.active}
                  payload={props.payload}
                  label={props.label}
                  filter={combinedSeriesFilter}
                />
              )}
            />
            {(combinedSeriesFilter === "both" || combinedSeriesFilter === "mood") && (
              <Line
                key={`${chartInstanceKey}-mood`}
                yAxisId="mood"
                type="monotone"
                dataKey="mood"
                name={t("wellness.lineMood")}
                stroke="#22d3ee"
                strokeWidth={2.5}
                dot={(dotProps: {
                  key?: string;
                  cx?: number;
                  cy?: number;
                  payload?: CombinedMoodDegreePoint;
                  dataKey?: string;
                  index?: number;
                }) => {
                  const { key: dotKey, cx, cy, payload, dataKey, index } = dotProps;
                  if (cx == null || cy == null || !payload || dataKey !== "mood") return null;
                  const big = payload.isMoodMin || payload.isMoodMax;
                  const r = big ? 5.5 : 3;
                  return (
                    <circle
                      key={`mood-${chartInstanceKey}-${dotKey ?? `${payload.date}-${String(index)}`}`}
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="#ecfeff"
                      stroke="#22d3ee"
                      strokeWidth={1}
                    />
                  );
                }}
                connectNulls
              />
            )}
            {(combinedSeriesFilter === "both" || combinedSeriesFilter === "degree") && (
              <Line
                key={`${chartInstanceKey}-degree`}
                yAxisId="deg"
                type="monotone"
                dataKey="degree"
                name={t("wellness.axisMemoryDegree")}
                stroke="#e0f2fe"
                strokeWidth={2.5}
                dot={(dotProps: {
                  key?: string;
                  cx?: number;
                  cy?: number;
                  payload?: CombinedMoodDegreePoint;
                  dataKey?: string;
                  index?: number;
                }) => {
                  const { key: dotKey, cx, cy, payload, dataKey, index } = dotProps;
                  if (cx == null || cy == null || !payload || dataKey !== "degree") return null;
                  const big = payload.isDegreeMin || payload.isDegreeMax;
                  const r = big ? 5.5 : 3;
                  return (
                    <circle
                      key={`degree-${chartInstanceKey}-${dotKey ?? `${payload.date}-${String(index)}`}`}
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="#0c4a6e"
                      stroke="#e0f2fe"
                      strokeWidth={1}
                    />
                  );
                }}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </GlassPanel>
  );
}

function MemorySlipWellnessCard({
  frequencySeriesWithExtrema,
  fillGradientId,
}: {
  frequencySeriesWithExtrema: FrequencyPoint[];
  fillGradientId: string;
}) {
  const { t } = useTranslation();
  return (
    <GlassPanel className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col p-3 sm:p-4">
      <div className="mb-1 flex shrink-0 items-center gap-2 text-sky-50/95">
        <Brain className="h-5 w-5 shrink-0 text-cyan-300" strokeWidth={2} aria-hidden />
        <span className="text-xs font-bold uppercase tracking-[0.12em] sm:text-sm">
          {t("wellness.memorySlipTitle")}
        </span>
      </div>
      <p className="mb-2 shrink-0 text-sm leading-snug text-cyan-100/80">{t("wellness.memorySlipBlurb")}</p>
      <div className={WELLNESS_CHART_PLOT_CLASS}>
        <ResponsiveContainer width="100%" height="100%" minHeight={WELLNESS_CHART_MIN_HEIGHT}>
          <AreaChart data={frequencySeriesWithExtrema} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7dd3fc" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#1e3a5f" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: tickFill, fontSize: 11 }}
              tickFormatter={shortDate}
              axisLine={chartAxis}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: tickFill, fontSize: 11 }}
              axisLine={chartAxis}
              tickLine={false}
              width={36}
            />
            <Tooltip
              content={(props) => (
                <FrequencyTooltip active={props.active} payload={props.payload} label={props.label} />
              )}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#38bdf8"
              strokeWidth={2}
              fill={`url(#${fillGradientId})`}
              activeDot={{ r: 5, strokeWidth: 1, stroke: "#bae6fd", fill: "#0ea5e9" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </GlassPanel>
  );
}

/** Avoids `response.json()` throwing on empty or non-JSON bodies (proxy errors, etc.). */
async function parseResponseJson<T extends Record<string, unknown>>(res: Response, fallback: T): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function PhysicalActivityDashboard() {
  const { t } = useTranslation();
  const [unlocked, setUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [data, setData] = useState<PhysicalActivityPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [paperBurstKey, setPaperBurstKey] = useState<number | null>(null);
  const [combinedSeriesFilter, setCombinedSeriesFilter] = useState<CombinedSeriesFilter>("both");
  const [wellnessPopup, setWellnessPopup] = useState<null | "mood" | "slip">(null);
  const slipFillPopup = useId().replace(/:/g, "");

  const clearPaperBurst = useCallback(() => setPaperBurstKey(null), []);

  useEffect(() => {
    if (!wellnessPopup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWellnessPopup(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wellnessPopup]);

  const combinedMoodDegreeSeries = useMemo(() => {
    if (!data) return [];
    return withMoodDegreeExtrema(mergeMoodAndDegreeSeries(data.moodSeries, data.memoryLossDegreeSeries));
  }, [data]);

  const frequencySeriesWithExtrema = useMemo(
    () => (data ? withFrequencyExtrema(data.memoryLossFrequencySeries) : []),
    [data],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("physical-activity"));
      const text = await res.text();
      if (!res.ok) throw new Error(text || res.statusText);
      setData(JSON.parse(text) as PhysicalActivityPayload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("wellness.couldNotLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(PHYSICAL_ACTIVITY_SESSION_KEY) === "1") setUnlocked(true);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    void load();
  }, [unlocked, load]);

  function submitUnlock(e: FormEvent) {
    e.preventDefault();
    if (passwordInput === PHYSICAL_ACTIVITY_PASSWORD) {
      try {
        sessionStorage.setItem(PHYSICAL_ACTIVITY_SESSION_KEY, "1");
      } catch {
        /* ignore */
      }
      setPwError(null);
      setUnlocked(true);
      setPasswordInput("");
    } else {
      setPwError(t("wellness.wrongPassword"));
    }
  }

  async function sendHealthReportToProvider() {
    setReportMessage(null);
    setReportBusy(true);
    try {
      let stored: { healthcareEmail?: string; emailFrom?: string; emailPassword?: string } = {};
      try {
        const raw = sessionStorage.getItem("boomer-report-email");
        if (raw) stored = JSON.parse(raw) as typeof stored;
      } catch {
        /* ignore */
      }
      const resSettings = await fetch(apiUrl("settings"));
      const settings = await parseResponseJson<{ healthcareEmail?: string; emailFrom?: string }>(
        resSettings,
        {},
      );
      const body = {
        healthcareEmail: stored.healthcareEmail ?? settings.healthcareEmail ?? "",
        emailFrom: stored.emailFrom ?? settings.emailFrom ?? "",
        emailPassword: stored.emailPassword ?? "",
      };
      const res = await fetch(apiUrl("send-report"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resData = await parseResponseJson<{ error?: string; message?: string }>(res, {});
      if (!res.ok) {
        throw new Error(
          resData.error ||
            (res.status >= 400 ? `Request failed (${res.status})` : res.statusText) ||
            "Could not send report",
        );
      }
      setReportMessage(resData.message ?? "Report sent.");
    } catch (e) {
      setReportMessage(e instanceof Error ? e.message : "Could not send report.");
    } finally {
      setReportBusy(false);
    }
  }

  function onOwlSendClick() {
    setPaperBurstKey(Date.now());
    void sendHealthReportToProvider();
  }

  return (
    <section
      id="physical-activity-dashboard"
      aria-labelledby="physical-activity-heading"
      className="relative flex h-dvh max-h-dvh w-full shrink-0 snap-start snap-always flex-col overflow-x-visible overflow-y-visible border-t border-white/10"
    >
      <DashboardSkyBackground />

      {paperBurstKey != null && (
        <FlyingBluePapersOverlay burstKey={paperBurstKey} onDone={clearPaperBurst} />
      )}

      <div
        className={cn(
          "pointer-events-auto absolute right-2 top-2 flex max-w-[min(18rem,46vw)] flex-col items-end sm:right-4 sm:top-4",
          unlocked ? "z-30" : "z-[15]",
        )}
      >
        <button
          type="button"
          onClick={onOwlSendClick}
          disabled={!unlocked || reportBusy}
          title={!unlocked ? t("wellness.lockedHint") : undefined}
          className={cn(
            "group flex w-full min-w-[12.5rem] flex-col items-center rounded-2xl border-2 border-transparent bg-transparent px-3 py-3 shadow-none outline-none backdrop-blur-none transition sm:min-w-[14rem] sm:px-4 sm:py-4",
            unlocked
              ? "hover:border-cyan-300/35 hover:opacity-95 focus-visible:border-cyan-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/60"
              : "cursor-not-allowed opacity-45",
            reportBusy && "opacity-60",
          )}
          aria-describedby="physical-activity-send-report-label"
        >
          <span className="sr-only">{t("wellness.sendSnapshotsSr")}</span>
          <img
            src={owlPng}
            alt=""
            className={cn(
              "h-auto w-[min(9.5rem,42vw)] object-contain transition duration-300 sm:w-[min(10.5rem,40vw)]",
              unlocked && "group-hover:scale-105 group-hover:drop-shadow-[0_0_16px_rgba(34,211,238,0.45)]",
            )}
            decoding="async"
          />
          <span
            id="physical-activity-send-report-label"
            className="mt-3 whitespace-pre-line text-center text-sm font-semibold leading-snug text-sky-100/95 sm:text-base"
          >
            {t("wellness.sendSnapshotsLabel")}
          </span>
        </button>
        {reportMessage && (
          <p
            className={cn(
              "mt-1.5 max-w-[11rem] text-center text-[0.65rem] leading-tight sm:text-xs",
              reportMessage.includes("sent") || reportMessage.includes("Report sent")
                ? "text-emerald-600"
                : "text-red-500",
            )}
            role="status"
          >
            {reportMessage}
          </p>
        )}
      </div>

      <div
        className={cn(
          "relative z-[1] mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-x-visible overflow-y-visible px-4 py-3 sm:px-8 sm:py-5 lg:max-w-6xl",
          !unlocked && "pointer-events-none select-none",
        )}
        aria-hidden={!unlocked}
      >
        <header className="relative mb-6 shrink-0 px-1 text-center sm:mb-8">
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-[min(100%,28rem)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse_at_center,rgba(251,146,30,0.08),transparent_68%)]"
            aria-hidden
          />
          <p className="relative mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-300 sm:text-xs">
            <Heart className="h-3.5 w-3.5 shrink-0 text-rose-300" strokeWidth={2} aria-hidden />
            {t("wellness.snapshotLabel")}
          </p>
          <h2
            id="physical-activity-heading"
            className="relative text-3xl font-bold leading-[1.1] tracking-tight text-slate-50 sm:text-4xl md:text-[2.65rem] md:leading-[1.08]"
          >
            {t("wellness.title")}
          </h2>
        </header>

        {error && (
          <div className="dashboard-glass-hover-surface mb-8 will-change-transform">
            <div
              className="dashboard-glass-panel border border-red-400/35 bg-red-950/30 px-6 py-4 text-center text-red-100"
              role="alert"
            >
              {error}
            </div>
          </div>
        )}

        {loading && !data && !error && (
          <p className="py-8 text-center text-lg text-slate-400">{t("wellness.loading")}</p>
        )}

        {data && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-y-visible lg:overflow-x-visible">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch">
              <WellnessHumanSilhouette
                className="min-h-[42vh] sm:min-h-[48vh]"
                onBrainClick={() => setWellnessPopup("mood")}
                onHeartClick={() => setWellnessPopup("slip")}
              />
            </div>

            <div className="mt-auto shrink-0 space-y-4 px-2 pb-4 pt-2 sm:px-4 sm:pb-5 sm:pt-3">
              <CognitiveFetchCard variant="wellness-memo" className="mx-auto max-w-2xl" />
            </div>
          </div>
        )}
      </div>

      {wellnessPopup &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
            <button
              type="button"
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-[10px]"
              aria-label={t("wellness.closeChart")}
              onClick={() => setWellnessPopup(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="wellness-chart-dialog-title"
              className="relative z-[1] max-h-[min(92vh,880px)] w-full max-w-5xl overflow-hidden rounded-2xl bg-slate-950/[0.97] shadow-[0_40px_80px_-24px_rgba(0,0,0,0.75)] backdrop-blur-xl"
            >
              <div className="sticky top-0 z-[2] flex items-center justify-between gap-3 bg-slate-950/85 px-3 py-2.5 backdrop-blur-md sm:px-4">
                <h2
                  id="wellness-chart-dialog-title"
                  className="min-w-0 truncate text-left text-sm font-semibold text-sky-50 sm:text-base"
                >
                  {wellnessPopup === "mood" ? t("wellness.dialogMood") : t("wellness.dialogSlip")}
                </h2>
                <button
                  type="button"
                  onClick={() => setWellnessPopup(null)}
                  className="shrink-0 rounded-full p-2 text-cyan-200/90 transition hover:bg-white/[0.06] hover:text-sky-50"
                  aria-label={t("wellness.close")}
                >
                  <X className="h-5 w-5" strokeWidth={2} />
                </button>
              </div>
              <div className="max-h-[min(calc(92vh-4rem),800px)] overflow-y-auto p-3 sm:p-5">
                {wellnessPopup === "mood" ? (
                  <MoodMemoryWellnessCard
                    combinedMoodDegreeSeries={combinedMoodDegreeSeries}
                    combinedSeriesFilter={combinedSeriesFilter}
                    setCombinedSeriesFilter={setCombinedSeriesFilter}
                    chartInstanceKey="popup-mood"
                  />
                ) : (
                  <MemorySlipWellnessCard
                    frequencySeriesWithExtrema={frequencySeriesWithExtrema}
                    fillGradientId={slipFillPopup}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {!unlocked && (
        <div
          className="absolute inset-0 z-20 flex w-full flex-col items-center justify-center bg-slate-900/80 px-4 py-8 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="physical-activity-lock-title"
        >
          <form
            onSubmit={submitUnlock}
            className="relative flex w-full max-w-md flex-col items-center rounded-2xl border border-white/60 bg-slate-800/90 px-8 py-10 shadow-2xl shadow-black/50 sm:px-10 sm:py-12"
          >
            <div
              className="mb-6 motion-safe:animate-pulse"
              style={{
                filter:
                  "drop-shadow(0 0 8px rgba(192,87,74,0.7)) drop-shadow(0 0 18px rgba(192,87,74,0.45)) drop-shadow(0 0 32px rgba(15,80,90,0.3))",
              }}
            >
              <Lock className="size-20 text-rose-300 sm:size-24" strokeWidth={1.35} aria-hidden />
            </div>
            <h3
              id="physical-activity-lock-title"
              className="mb-2 text-center text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl"
            >
              {t("wellness.lockedTitle")}
            </h3>
            <p className="mb-6 text-center text-sm text-slate-400 sm:text-base">
              {t("wellness.lockedHint")}
            </p>
            <label htmlFor="physical-activity-pw" className="sr-only">
              {t("wellness.password")}
            </label>
            <input
              id="physical-activity-pw"
              type="password"
              autoComplete="current-password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setPwError(null);
              }}
              className="mb-3 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-center text-lg tracking-widest text-slate-50 outline-none ring-0 placeholder:text-stone-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-300/30"
              placeholder={"\u2022\u2022\u2022\u2022"}
            />
            {pwError && (
              <p className="mb-3 text-center text-sm text-red-500" role="alert">
                {pwError}
              </p>
            )}
            <button
              type="submit"
              className="w-full rounded-xl bg-teal-600 py-3 text-center text-base font-semibold text-white transition hover:bg-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
            >
              {t("wellness.unlock")}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}


