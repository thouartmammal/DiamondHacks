/** Human-readable site label from hostname */
export function siteDisplayName(host: string): string {
  const h = (host || "").trim().replace(/^www\./i, "");
  return h || "site";
}

/** Google favicon service (reliable fallback). */
export function siteFaviconUrl(host: string, size = 32): string {
  const h = (host || "").trim().replace(/^www\./i, "");
  if (!h) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=${size}`;
}

/** Direct /favicon.ico guess (may 404). */
export function siteDirectFaviconUrl(host: string): string {
  const h = (host || "").trim().replace(/^www\./i, "");
  if (!h) return "";
  return `https://${h}/favicon.ico`;
}
