/**
 * Resolve backend paths for Vite dev (/api proxy) vs production Electron (file:// → direct HTTP).
 * `path` is the backend path after the optional /api strip, e.g. "dashboard", "usage/ping", "memory/narrative".
 */
export function apiUrl(
  path: string,
  query?: Record<string, string | number | undefined | null>,
): string {
  const p = path.replace(/^\//, "");
  const explicit = import.meta.env.VITE_BACKEND_URL as string | undefined;
  let base: string;
  if (explicit?.trim()) {
    base = `${explicit.replace(/\/$/, "")}/${p}`;
  } else if (import.meta.env.DEV) {
    base = `/api/${p}`;
  } else {
    base = `http://127.0.0.1:3001/${p}`;
  }
  if (!query) return base;
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
