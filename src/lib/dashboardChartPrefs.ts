const LS_DASHBOARD_RHYTHM_DAYS = "boomer-dashboard-rhythm-days";
const LS_DASHBOARD_TIME_ZONE = "boomer-dashboard-time-zone";

export type DashboardChartPrefs = {
  rhythmDays: number;
  timeZone: string;
};

export function readDashboardChartPrefs(): DashboardChartPrefs {
  let rhythmDays = 50;
  try {
    const r = localStorage.getItem(LS_DASHBOARD_RHYTHM_DAYS);
    if (r) {
      const n = parseInt(r, 10);
      if (Number.isFinite(n)) rhythmDays = Math.min(90, Math.max(7, n));
    }
  } catch {
    /* ignore */
  }
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let timeZone = deviceTz;
  try {
    const t = localStorage.getItem(LS_DASHBOARD_TIME_ZONE);
    if (t?.trim()) timeZone = t.trim();
  } catch {
    /* ignore */
  }
  return { rhythmDays, timeZone };
}

export function persistDashboardChartPrefs(p: DashboardChartPrefs) {
  try {
    localStorage.setItem(LS_DASHBOARD_RHYTHM_DAYS, String(p.rhythmDays));
    localStorage.setItem(LS_DASHBOARD_TIME_ZONE, p.timeZone);
  } catch {
    /* ignore */
  }
}
