import {
  useCallback,
  useEffect,
  useId,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  ArrowUpToLine,
  BarChart3,
  CalendarDays,
  Clock,
  Globe,
  Loader2,
  Sparkles,
  Sun,
  Timer,
} from "lucide-react";
import { apiUrl } from "../lib/apiUrl";
import { cn } from "./components/ui/utils";
import { DashboardSkyBackground } from "./DashboardSkyBackground";
import { RoutineTabsCard } from "./RoutineTabsCard";
import { SandTimerGimbal } from "./SandTimerGimbal";
import { useTranslation } from "../i18n/LanguageContext";

type TopSite = {
  host: string;
  visitCount: number;
  lastTitle: string;
  sampleUrl: string;
};

type DashboardPayload = {
  topSites: TopSite[];
  personality: string;
  hoursOnline: number;
  timeSavedHours: number;
  browserTasksCompleted: number;
  tenureDays: number;
  tenureLabel: string;
  firstSeenAt: string | null;
  /** Rolling window (days) used for visit counts + personality; from API. */
  topSitesWindowDays?: number;
};

function faviconUrlForHost(host: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function SiteFavicon({
  host,
  className,
}: {
  host: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-800/30 ring-1 ring-white/15",
          className,
        )}
      >
        <Globe className="h-5 w-5 text-rose-300" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <img
      src={faviconUrlForHost(host)}
      alt=""
      width={36}
      height={36}
      decoding="async"
      loading="lazy"
      className={cn(
        "h-9 w-9 shrink-0 rounded-xl bg-white/90 object-contain p-0.5 ring-1 ring-cyan-200/30",
        className,
      )}
      onError={() => setBroken(true)}
    />
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
      <div
        className={cn(
          "dashboard-glass-panel",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function FlowSparkline({ subtitle }: { subtitle: string }) {
  const { t } = useTranslation();
  const uid = useId().replace(/:/g, "");
  const gradLine = `${uid}-spark-line`;
  const gradArea = `${uid}-spark-area`;
  const now = new Date();
  const timeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const curve = "M 4 32 Q 36 30 60 14 T 116 6";
  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur-sm">
      <div className="flex items-center justify-between text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-slate-400">
        <span>{t("dashboard.yourRhythm")}</span>
        <span className="tabular-nums tracking-normal text-slate-200">{timeLabel}</span>
      </div>
      <svg viewBox="0 0 120 44" className="mt-1 h-10 w-full" aria-hidden>
        <defs>
          <linearGradient id={gradLine} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#fb923c" stopOpacity="1" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id={gradArea} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fb923c" stopOpacity="0.35" />
            <stop offset="45%" stopColor="#f97316" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${curve} L 116 40 L 4 40 Z`}
          fill={`url(#${gradArea})`}
        />
        <path
          d={curve}
          fill="none"
          stroke={`url(#${gradLine})`}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx="44"
          cy="22"
          r="4"
          fill="#fff7ed"
          stroke="#f97316"
          strokeWidth="1.5"
        />
      </svg>
      <p className="mt-1 text-sm leading-snug text-slate-300">{subtitle}</p>
    </div>
  );
}

function StatGlass({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="flex items-center gap-2 text-slate-300">
        <Icon className="h-5 w-5 shrink-0 text-rose-300" strokeWidth={2} aria-hidden />
        <span className="text-xs font-bold uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-extrabold tabular-nums tracking-tight text-slate-50 sm:text-3xl">
        {value}
      </p>
      <p className="mt-1.5 text-sm leading-snug text-slate-400">{hint}</p>
    </GlassPanel>
  );
}

const statsRevealEase = "ease-[cubic-bezier(0.22,1,0.36,1)]";

export function HomeDashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Start visible so one-screen layout fits without an extra tap (older users). */
  const [statsRevealed, setStatsRevealed] = useState(true);
  /** Drives CSS transitions after stats mount (avoids first paint already “entered”). */
  const [statsEnter, setStatsEnter] = useState(false);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const res = await fetch(apiUrl("dashboard"));
      const text = await res.text();
      if (!res.ok) {
        const hint =
          text.includes("<!DOCTYPE") || text.includes("<html")
            ? `Server returned ${res.status} (is the voice backend running on port 3001?)`
            : text || res.statusText;
        throw new Error(hint);
      }
      setData(JSON.parse(text) as DashboardPayload);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("dashboard.couldNotLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
    const onFocus = () => load({ silent: true });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  useEffect(() => {
    if (!statsRevealed) {
      setStatsEnter(false);
      return;
    }
    setStatsEnter(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setStatsEnter(true));
    });
    return () => cancelAnimationFrame(id);
  }, [statsRevealed]);

  return (
    <section
      id="your-boomer-dashboard"
      aria-labelledby="dashboard-heading"
      className="relative -mt-px flex h-dvh max-h-dvh w-full shrink-0 snap-start snap-always flex-col overflow-x-visible overflow-y-visible border-t border-white/10"
    >
      <DashboardSkyBackground />

      <div className="relative z-[1] mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-3 pb-4 sm:px-6 sm:py-4 sm:pb-5 md:px-8">
        <header className="mb-2 shrink-0 text-center sm:mb-3">
          <p className="mb-0.5 text-base font-medium text-slate-400">{t("dashboard.activitySummary")}</p>
          <h2
            id="dashboard-heading"
            className="mb-1 text-2xl font-bold leading-tight tracking-tight text-slate-50 sm:text-3xl md:text-4xl"
          >
            {t("dashboard.title")}
          </h2>
        </header>

        {loadError && (
          <div className="dashboard-glass-hover-surface mb-8 will-change-transform">
            <div
              className="dashboard-glass-panel border border-red-400/35 bg-red-950/30 px-6 py-5 text-center text-red-100 shadow-lg backdrop-blur-md"
              role="alert"
            >
            <p className="mb-4 text-base leading-relaxed">{loadError}</p>
            <button
              type="button"
              className="inline-flex min-h-[48px] min-w-[140px] items-center justify-center rounded-2xl border border-red-300/50 bg-white/10 px-6 text-base font-semibold text-red-50 shadow-sm transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
              onClick={() => load()}
            >
              {t("dashboard.tryAgain")}
            </button>
            </div>
          </div>
        )}

        {loading && !data && !loadError && (
          <div
            className="flex flex-col items-center justify-center gap-4 py-20 text-slate-300"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-12 w-12 animate-spin text-rose-300" strokeWidth={2} aria-hidden />
            <p className="text-xl font-medium">{t("dashboard.loading")}</p>
          </div>
        )}

        {data && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-x-visible overflow-y-visible">
            {/* Status pill - reference “Mode present” */}
            <div className="mb-2 flex shrink-0 justify-center">
              <div className="dashboard-glass-pill inline-flex items-center gap-3 px-5 py-2.5 text-sm font-medium shadow-md">
                <Sun className="h-5 w-5 shrink-0 text-rose-300" strokeWidth={2} aria-hidden />
                <span className="whitespace-nowrap">
                  {t("dashboard.modeDot")} {data.tenureLabel}
                </span>
                <span
                  className="hidden h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.9)] sm:inline"
                  aria-hidden
                />
              </div>
            </div>

            {/* Mobile / tablet: reveal stats after tapping the sand watch */}
            <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-2.5 pb-2 sm:px-3 lg:hidden">
              {!statsRevealed ? (
                <div className="flex w-full flex-col items-center gap-5 py-2">
                  <button
                    type="button"
                    onClick={() => setStatsRevealed(true)}
                    aria-label={t("dashboard.showStatsAria")}
                    className="cursor-pointer rounded-3xl border-0 bg-transparent p-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300"
                  >
                    <SandTimerGimbal compact className="transition-transform duration-200 hover:scale-[1.03] active:scale-[0.99]" />
                  </button>
                  <p className="max-w-sm px-4 text-center text-base leading-relaxed text-slate-300">
                    {t("dashboard.sandWatchHint")}
                  </p>
                </div>
              ) : (
                <div
                  className={cn(
                    "flex w-full origin-center flex-col items-center gap-6",
                    "transition-[opacity,transform] duration-700",
                    statsRevealEase,
                    "motion-reduce:scale-100 motion-reduce:opacity-100 motion-reduce:transition-none",
                    statsEnter
                      ? "scale-100 opacity-100"
                      : "pointer-events-none scale-[0.9] opacity-0",
                  )}
                >
                  <SandTimerGimbal compact />
                  <RoutineTabsCard className="w-full max-w-lg" />
              <GlassPanel className="w-full max-w-lg p-5">
                <div className="mb-4 flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-800/30 text-rose-300 shadow-inner ring-1 ring-white/15">
                    <Globe className="h-6 w-6" strokeWidth={2} aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-slate-100">{t("dashboard.favoriteSites")}</h3>
                    <p className="text-sm text-slate-400">
                      {t("dashboard.favoriteSitesSub").replace(
                        "{days}",
                        String(data.topSitesWindowDays ?? 30),
                      )}
                    </p>
                  </div>
                </div>
                {data.topSites.length === 0 ? (
                  <p className="text-sm text-slate-400">{t("dashboard.noTopSites")}</p>
                ) : (
                  <ol className="space-y-3">
                    {data.topSites.map((s, i) => (
                      <li
                        key={s.host}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm"
                      >
                        <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg bg-teal-400/15 text-xs font-bold text-rose-200 ring-1 ring-rose-300/30">
                          {i + 1}
                        </span>
                        <SiteFavicon host={s.host} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-100">{s.host}</p>
                          <p className="text-xs text-slate-400">
                            {s.visitCount}{" "}
                            {s.visitCount === 1 ? t("dashboard.visit") : t("dashboard.visits")}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </GlassPanel>

              <GlassPanel className="w-full max-w-lg p-5">
                <div className="mb-2 flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-800/30 text-teal-200 ring-1 ring-teal-300/20">
                    <Sparkles className="h-6 w-6" strokeWidth={2} aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-slate-100">{t("dashboard.browsingStyle")}</h3>
                    <p className="text-sm text-slate-400">
                      {t("dashboard.browsingStyleSub").replace(
                        "{days}",
                        String(data.topSitesWindowDays ?? 30),
                      )}
                    </p>
                  </div>
                </div>
                <p className="min-w-0 text-base leading-relaxed text-slate-200">{data.personality}</p>
              </GlassPanel>

              <div className="grid w-full max-w-lg gap-4 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-3">
                <StatGlass
                  icon={Clock}
                  label={t("dashboard.hoursInApp")}
                  value={data.hoursOnline}
                  hint={t("dashboard.hoursInAppHint")}
                />
                <StatGlass
                  icon={Timer}
                  label={t("dashboard.timeSaved")}
                  value={`${data.timeSavedHours} ${t("dashboard.timeSavedHrs")}`}
                  hint={
                    data.browserTasksCompleted === 1
                      ? t("dashboard.timeSavedHintOne")
                      : t("dashboard.timeSavedHintMany").replace(
                          "{n}",
                          String(data.browserTasksCompleted),
                        )
                  }
                />
                <StatGlass
                  icon={CalendarDays}
                  label={t("dashboard.journey")}
                  value={data.tenureLabel}
                  hint={
                    data.firstSeenAt
                      ? t("dashboard.since").replace("{date}", data.firstSeenAt.slice(0, 10))
                      : t("dashboard.gladHere")
                  }
                />
                <GlassPanel className="p-4 sm:col-span-2 sm:p-5">
                  <div className="flex items-center gap-2.5 text-slate-200">
                    <BarChart3 className="h-5 w-5 text-teal-300" strokeWidth={2} aria-hidden />
                    <span className="text-xs font-bold uppercase tracking-[0.14em]">
                      {t("dashboard.soundscape")}
                    </span>
                  </div>
                  <FlowSparkline subtitle={t("dashboard.flowSubtitleSession")} />
                </GlassPanel>
              </div>
                </div>
              )}
            </div>

            {/* Desktop: sand watch reveal, then two columns + centered timer */}
            {!statsRevealed ? (
              <div className="mx-auto hidden w-full max-w-2xl flex-col items-center gap-4 py-6 lg:flex">
                <button
                  type="button"
                  onClick={() => setStatsRevealed(true)}
                  aria-label={t("dashboard.showStatsAria")}
                  className="cursor-pointer rounded-3xl border-0 bg-transparent p-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-300"
                >
                  <SandTimerGimbal compact className="transition-transform duration-200 hover:scale-[1.03] active:scale-[0.99]" />
                </button>
                <p className="max-w-md px-4 text-center text-lg leading-relaxed text-slate-300">
                  {t("dashboard.sandWatchHint")}
                </p>
              </div>
            ) : (
            <>
            <div className="mx-auto hidden min-h-0 w-full max-w-[1200px] min-w-0 flex-1 gap-x-10 gap-y-4 px-2 sm:px-3 lg:grid lg:grid-cols-[minmax(0,1fr)_min(220px,24vw)_minmax(0,1fr)] lg:items-stretch xl:gap-x-14">
              <div
                className={cn(
                  "flex min-h-0 min-w-0 flex-col gap-4 overflow-visible transition-[opacity,transform] duration-700 delay-75",
                  statsRevealEase,
                  "motion-reduce:translate-x-0 motion-reduce:opacity-100 motion-reduce:transition-none",
                  statsEnter
                    ? "translate-x-0 opacity-100"
                    : "pointer-events-none translate-x-[min(42vw,13rem)] opacity-0",
                )}
              >
                <GlassPanel className="min-h-0 p-4">
                  <div className="mb-1 flex flex-col gap-0.5 text-slate-200">
                    <div className="flex items-center gap-2.5">
                      <Globe className="h-5 w-5 shrink-0 text-rose-300" strokeWidth={2} aria-hidden />
                      <span className="text-sm font-bold uppercase tracking-[0.12em]">
                        {t("dashboard.topSites")}
                      </span>
                    </div>
                    <p className="pl-7 text-[0.7rem] leading-snug text-slate-400">
                      {t("dashboard.topSitesSub").replace(
                        "{days}",
                        String(data.topSitesWindowDays ?? 30),
                      )}
                    </p>
                  </div>
                  {data.topSites.length === 0 ? (
                    <p className="text-sm leading-relaxed text-slate-400">{t("dashboard.noFavoritesWindow")}</p>
                  ) : (
                    <ul className="max-h-[min(28vh,240px)] space-y-2 overflow-y-auto pr-1 text-sm leading-snug text-slate-100">
                      {data.topSites.map((s, i) => (
                        <li
                          key={s.host}
                          className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5"
                        >
                          <span className="w-4 shrink-0 text-center text-xs font-bold text-rose-300">
                            {i + 1}
                          </span>
                          <SiteFavicon host={s.host} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-slate-100">{s.host}</p>
                            <p className="truncate text-[0.7rem] text-slate-400">
                              {s.visitCount}{" "}
                              {s.visitCount === 1 ? t("dashboard.visit") : t("dashboard.visits")}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </GlassPanel>

                <GlassPanel className="min-h-0 shrink-0 p-4">
                  <div className="flex items-center gap-2.5 text-slate-200">
                    <Clock className="h-5 w-5 shrink-0 text-rose-300" strokeWidth={2} aria-hidden />
                    <span className="text-sm font-bold uppercase tracking-[0.12em]">
                      {t("dashboard.hoursOnline")}
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight text-slate-50 sm:text-4xl">
                    {data.hoursOnline}
                  </p>
                  <FlowSparkline subtitle={t("dashboard.flowSubtitleMorning")} />
                </GlassPanel>

                <GlassPanel className="min-h-0 shrink-0 p-4">
                  <div className="flex items-center gap-2.5 text-slate-200">
                    <CalendarDays className="h-5 w-5 shrink-0 text-rose-300" strokeWidth={2} aria-hidden />
                    <span className="text-sm font-bold uppercase tracking-[0.12em]">{t("dashboard.journey")}</span>
                  </div>
                  <p className="mt-2 text-xl font-extrabold text-slate-50 sm:text-2xl">{data.tenureLabel}</p>
                  <p className="mt-1.5 text-sm text-slate-400">
                    {data.firstSeenAt
                      ? t("dashboard.since").replace("{date}", data.firstSeenAt.slice(0, 10))
                      : t("dashboard.welcomeAboard")}
                  </p>
                </GlassPanel>
              </div>

              <div
                className={cn(
                  "flex min-h-0 origin-center justify-center self-center px-1 transition-[opacity,transform] duration-700 delay-100",
                  statsRevealEase,
                  "motion-reduce:scale-100 motion-reduce:opacity-100 motion-reduce:transition-none",
                  statsEnter
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-[0.88] opacity-0",
                )}
              >
                <SandTimerGimbal compact />
              </div>

              <div
                className={cn(
                  "flex min-h-0 min-w-0 flex-col gap-4 overflow-visible transition-[opacity,transform] duration-700 delay-150",
                  statsRevealEase,
                  "motion-reduce:translate-x-0 motion-reduce:opacity-100 motion-reduce:transition-none",
                  statsEnter
                    ? "translate-x-0 opacity-100"
                    : "pointer-events-none -translate-x-[min(42vw,13rem)] opacity-0",
                )}
              >
                <RoutineTabsCard className="min-h-0 shrink-0" />
                <GlassPanel className="min-h-0 shrink-0 p-4">
                  <div className="flex items-center gap-2.5 text-slate-200">
                    <Timer className="h-5 w-5 shrink-0 text-rose-300" strokeWidth={2} aria-hidden />
                    <span className="text-sm font-bold uppercase tracking-[0.12em]">
                      {t("dashboard.timeSaved")}
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-extrabold tabular-nums text-slate-50 sm:text-4xl">
                    {data.timeSavedHours}
                    <span className="ml-1.5 text-xl font-bold text-slate-400 sm:text-2xl">
                      {t("dashboard.timeSavedHrs")}
                    </span>
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    {data.browserTasksCompleted === 1
                      ? t("dashboard.assistedTasksOne")
                      : t("dashboard.assistedTasksMany").replace(
                          "{n}",
                          String(data.browserTasksCompleted),
                        )}
                  </p>
                </GlassPanel>

                <GlassPanel className="flex min-h-0 flex-1 flex-col overflow-visible p-4">
                  <div className="mb-2 flex shrink-0 items-center gap-2.5 text-slate-200">
                    <Sparkles className="h-5 w-5 shrink-0 text-teal-300" strokeWidth={2} aria-hidden />
                    <span className="text-sm font-bold uppercase tracking-[0.12em]">{t("dashboard.yourStyle")}</span>
                  </div>
                  <p className="min-h-0 min-w-0 flex-1 overflow-y-auto text-base font-medium leading-relaxed text-slate-200 sm:text-[1.05rem]">
                    {data.personality}
                  </p>
                </GlassPanel>
              </div>
            </div>
            </>
            )}

            <div className="mt-auto flex shrink-0 justify-center border-t border-white/10 py-2">
              <button
                type="button"
                className="dashboard-glass-pill inline-flex min-h-[48px] min-w-[180px] cursor-pointer items-center justify-center gap-2 px-6 text-base font-semibold shadow-lg transition hover:bg-teal-800/30/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 md:text-lg"
                onClick={() => {
                  document.getElementById("app-scroll-root")?.scrollTo({
                    top: 0,
                    behavior: "smooth",
                  });
                }}
              >
                <ArrowUpToLine className="h-7 w-7 shrink-0" strokeWidth={2.5} aria-hidden />
                {t("dashboard.backToHome")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
