const BACKEND_PRIMARY = "http://127.0.0.1:3001";
const BACKEND_FALLBACK = "http://localhost:3001";
const APP_URL = "http://127.0.0.1:5173";

async function backendFetch(path, init) {
  let lastErr;
  for (const base of [BACKEND_PRIMARY, BACKEND_FALLBACK]) {
    try {
      return await fetch(`${base}${path}`, { ...init, credentials: "omit", mode: "cors" });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("backend fetch failed");
}

/** Throttle auto scrapes: same tab+URL within this window → skip */
const THROTTLE_MS = 45_000;
const lastAutoAt = new Map();

function isRestrictedUrl(url) {
  if (!url || typeof url !== "string") return true;
  const u = url.toLowerCase();
  return (
    u.startsWith("chrome://") ||
    u.startsWith("chrome-extension://") ||
    u.startsWith("edge://") ||
    u.startsWith("about:") ||
    u.startsWith("moz-extension://") ||
    u.startsWith("devtools:") ||
    u.includes("chromewebstore.google.com")
  );
}

/** Manifest content scripts do not re-run on already-open tabs when the extension reloads. */
async function reinjectContentScriptsIntoOpenTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (tab.id == null || !tab.url || isRestrictedUrl(tab.url)) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        files: ["content.js"],
      });
    } catch {
      /* Page may block injection (e.g. some PDF / chrome UI) */
    }
  }
}

function scheduleContentScriptReinject() {
  void reinjectContentScriptsIntoOpenTabs();
}

chrome.runtime.onInstalled.addListener(scheduleContentScriptReinject);

/** Unpacked reload / worker update: reinject so open tabs get a fresh Who? button (avoids “Extension context invalidated”). */
self.addEventListener("install", scheduleContentScriptReinject);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "wake_word_detected") {
    chrome.tabs.query({ url: `${APP_URL}/*` }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: APP_URL });
      }
    });
    return false;
  }
  if (msg.type === "boomer_ping") {
    void backendFetch("/extension/ping", { method: "GET" })
      .then((r) => sendResponse({ ok: r.ok, status: r.status }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
  if (msg.type === "boomer_who_press") {
    // Capture screenshot (only background can do this), then POST page-scan + who-press
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: "no tab" }); return false; }
    void (async () => {
      try {
        let viewportCapture = null;
        try {
          viewportCapture = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
            format: "jpeg",
            quality: 82,
          });
          if (viewportCapture && viewportCapture.length > 1_400_000) viewportCapture = null;
        } catch { /* restricted page */ }

        const tab = await chrome.tabs.get(tabId);
        const inj = await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          func: () => (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 8000),
        }).catch(() => []);
        const textPreview = (inj?.[0]?.result || "").trim();

        let scanRes;
        try {
          scanRes = await backendFetch("/extension/page-scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: tab.url, title: tab.title || "", textPreview, mode: "who", viewportCapture }),
          });
        } catch {
          sendResponse({
            ok: false,
            error:
              "Cannot reach the Boomer voice server (port 3001). In the Boomer Browse project folder run: npm run voice — or npm run dev:all — and keep that terminal open.",
          });
          return;
        }

        if (!scanRes.ok) {
          const errBody = await scanRes.text().catch(() => "");
          sendResponse({
            ok: false,
            error: `Boomer server returned ${scanRes.status}. ${errBody ? errBody.slice(0, 160) : "Check the voice server log."}`,
          });
          return;
        }

        const data = await scanRes.json().catch(() => ({}));
        let familyMatch = null;
        let nudge = null;
        if (data.familyMatch?.message) familyMatch = data.familyMatch;
        else if (typeof data.familyMatchNudge === "string" && data.familyMatchNudge.trim()) {
          nudge = data.familyMatchNudge.trim();
        }

        try {
          await backendFetch("/extension/who-press", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: tab.url || "", title: tab.title || "" }),
          });
        } catch {
          /* Who? press logging is best-effort */
        }

        sendResponse({ ok: true, familyMatch, nudge });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
    })();
    return true; // keep channel open for async response
  }
  return false;
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const url = details.url;
  if (!url || isRestrictedUrl(url)) return;

  try {
    const tab = await chrome.tabs.get(details.tabId);
    await backendFetch("/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title: tab.title || url,
        visitedAt: new Date().toISOString(),
      }),
    });
  } catch {
    /* backend down */
  }

  const { autoPageScrapeEnabled } = await chrome.storage.local.get(["autoPageScrapeEnabled"]);
  if (!autoPageScrapeEnabled) return;

  const key = `${details.tabId}|${url}`;
  const now = Date.now();
  const prev = lastAutoAt.get(key) || 0;
  if (now - prev < THROTTLE_MS) return;
  lastAutoAt.set(key, now);

  setTimeout(() => {
    void performAutoPageScrape(details.tabId, url);
  }, 2000);
});

async function performAutoPageScrape(tabId, expectedUrl) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url !== expectedUrl || isRestrictedUrl(tab.url)) return;

    const inj = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const raw = document.body?.innerText || document.documentElement?.innerText || "";
        return raw.replace(/\s+/g, " ").trim();
      },
    });
    const parts = (inj || []).map((x) => x.result).filter(Boolean);
    const textPreview = parts.join("\n\n").replace(/\s+/g, " ").trim().slice(0, 18000);
    if (textPreview.length < 30) return;

    await backendFetch("/extension/page-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: tab.url,
        title: tab.title || tab.url,
        textPreview,
        mode: "auto",
      }),
    });
  } catch {
    /* page closed, no access, or backend down */
  }
}
