/** Try both — Windows/Chrome sometimes resolve localhost vs 127.0.0.1 differently for extensions. */
const BACKEND_PRIMARY = "http://127.0.0.1:3001";
const BACKEND_FALLBACK = "http://localhost:3001";
const APP_URL = "http://127.0.0.1:5173";

/**
 * Fetch Boomer API with fallback host (fixes some extension + loopback cases).
 * @param {string} path - e.g. "/extension/ping"
 * @param {RequestInit} [init]
 */
async function backendFetch(path, init) {
  let lastErr;
  for (const base of [BACKEND_PRIMARY, BACKEND_FALLBACK]) {
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        credentials: "omit",
        mode: "cors",
      });
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetch failed");
}

/** Shown in UI (first preferred host). */
const BACKEND = BACKEND_PRIMARY;
const STORAGE_AUTO_SCRAPE = "autoPageScrapeEnabled";
const STORAGE_WHO_BTN = "whoSideBtnEnabled";

chrome.storage.local.get([STORAGE_AUTO_SCRAPE, STORAGE_WHO_BTN], (r) => {
  const autoEl = document.getElementById("autoScrape");
  if (autoEl) autoEl.checked = !!r[STORAGE_AUTO_SCRAPE];
  const whoEl = document.getElementById("whoSideBtn");
  if (whoEl) whoEl.checked = r[STORAGE_WHO_BTN] !== false; // default ON
});

document.getElementById("autoScrape").addEventListener("change", (e) => {
  chrome.storage.local.set({ [STORAGE_AUTO_SCRAPE]: e.target.checked });
});

document.getElementById("whoSideBtn").addEventListener("change", (e) => {
  chrome.storage.local.set({ [STORAGE_WHO_BTN]: e.target.checked });
  // Tell the active tab to show/hide immediately
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "boomer_who_btn_toggle",
        enabled: e.target.checked,
      }).catch(() => {});
    }
  });
});

/**
 * Fast path: main frame only. Full path: all frames (Gmail / Outlook often put the message in an iframe).
 */
async function getVisiblePageText(tabId) {
  try {
    const resp = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: "boomer_get_page_text" }, (r) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(r);
      });
    });
    if (resp && typeof resp.text === "string" && resp.text.length >= 80) {
      return resp.text;
    }
  } catch {
    /* fall through — e.g. no receiver yet */
  }

  const inj = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const raw = document.body?.innerText || document.documentElement?.innerText || "";
      return raw.replace(/\s+/g, " ").trim();
    },
  });
  const parts = (inj || []).map((x) => x.result).filter(Boolean);
  const merged = parts.join("\n\n").replace(/\s+/g, " ").trim().slice(0, 18000);
  return merged;
}

function setResult(html, className) {
  const el = document.getElementById("result");
  el.className = "show " + (className || "");
  el.innerHTML = html;
}

function setScanResult(html, isErr, familyFound) {
  const el = document.getElementById("scanResult");
  let cls = "show" + (isErr ? " uncertain" : "");
  if (familyFound) cls += " family-found";
  el.className = cls;
  el.innerHTML = html;
}

function escapeHtml(s) {
  const p = document.createElement("p");
  p.textContent = s;
  return p.innerHTML;
}

document.getElementById("open").addEventListener("click", () => {
  chrome.tabs.create({ url: APP_URL });
  window.close();
});

document.getElementById("scanPage").addEventListener("click", async () => {
  const btn = document.getElementById("scanPage");
  const scanLabel = "Remember this page";
  const scanEl = document.getElementById("scanResult");
  scanEl.className = "";
  scanEl.innerHTML = "";
  btn.disabled = true;
  btn.textContent = "One moment…";
  setScanResult(
    '<p style="color:#64748b;font-size:0.82rem;">The first save can take up to a minute.</p>',
    false,
    false
  );
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setScanResult('<p class="err">Open a website tab first, then try again.</p>', true, false);
      return;
    }

    console.info("[Boomer scan] tab", tab.url, "titleLen", (tab.title || "").length);

    let pageText = "";
    try {
      pageText = await getVisiblePageText(tab.id);
    } catch (e) {
      const hint = (e && e.message) || String(e);
      const isRestricted =
        /chrome:\/\//i.test(tab.url || "") ||
        /^(edge|chrome|brave):\/\//i.test(tab.url || "") ||
        /chromewebstore\.google\.com/i.test(tab.url || "");
      setScanResult(
        "<p class=\"err\">" +
          (isRestricted
            ? "This kind of page can’t be read. Open a regular website and try again."
            : "We couldn’t read this tab. " + escapeHtml(hint.slice(0, 200))) +
          "</p>",
        true,
        false
      );
      return;
    }

    const tabTitle = (tab.title || "").trim();
    if ((!pageText || pageText.length < 12) && tabTitle.length < 14) {
      setScanResult(
        '<p class="err">There isn’t much to read here yet. Wait for the page to finish loading, then tap again.</p>',
        true,
        false
      );
      return;
    }

    const textPreview =
      pageText && pageText.length >= 12
        ? pageText
        : `${tabTitle}\n${pageText || ""}`.trim();

    let viewportCapture = null;
    try {
      viewportCapture = await chrome.tabs.captureVisibleTab(undefined, { format: "jpeg", quality: 50 });
      const maxCap = 900_000;
      if (viewportCapture && viewportCapture.length > maxCap) {
        console.warn("[Boomer scan] viewport capture too large for one request, omitting snapshot");
        viewportCapture = null;
      }
    } catch {
      /* restricted page or permission — face match skipped */
    }

    const payload = {
      url: tab.url || "(unknown)",
      title: tab.title || "",
      textPreview,
      mode: "manual",
      viewportCapture,
    };
    console.info("[Boomer scan] post textLen=", textPreview.length, "capture=", viewportCapture ? viewportCapture.length : 0);

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 120000);
    let res;
    try {
      res = await backendFetch("/extension/page-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(abortTimer);
      const name = e && e.name;
      const msg =
        name === "AbortError"
          ? "That took longer than two minutes. Open the Boomer program on your computer, or ask whoever set it up to start it."
          : (e && e.message) || String(e);
      console.error("[Boomer scan] fetch failed", e);
      setScanResult(
        '<p class="err">Couldn’t reach Boomer on your computer. ' +
          escapeHtml(msg) +
          '</p><p class="err" style="margin-top:8px;">Open the Boomer app or run it from the folder where it was installed. If it still fails, ask whoever helps you with the computer to check that Boomer is running and can talk to the browser.</p>',
        true,
        false
      );
      return;
    }
    clearTimeout(abortTimer);

    const rawText = await res.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      console.error("[Boomer scan] non-JSON response", rawText.slice(0, 500));
      setScanResult(
        '<p class="err">Something went wrong talking to Boomer. Try again in a moment. (Status ' +
          res.status +
          ")</p>",
        true,
        false
      );
      return;
    }
    if (!res.ok) {
      setScanResult(
        `<p class="err">${escapeHtml(data.error || res.statusText || "We couldn’t save this page.")}</p>`,
        true,
        false
      );
      return;
    }
    const n = data.savedChars ?? textPreview.length;
    const fm = data.familyMatch;
    const hasFamily = fm && typeof fm.message === "string" && fm.message.length > 0;

    if (hasFamily) {
      try {
        chrome.notifications.create(`boomer-family-${Date.now()}`, {
          type: "basic",
          title: "Boomer Browse",
          message: fm.message,
          priority: 2,
        });
      } catch (_) {
        /* notifications may be blocked or icon rejected — in-popup message still shows */
      }
    }

    let html = "";
    if (hasFamily) {
      html +=
        '<span class="tag family">Your family</span>' +
        `<div class="headline family-headline">${escapeHtml(fm.headline || "Family")}</div>` +
        `<p class="family-msg">${escapeHtml(fm.message)}</p>`;
    }
    html +=
      '<span class="tag">' + (hasFamily ? "Also saved" : "Saved") + "</span>" +
      '<div class="headline">This page is saved for Boomer</div>' +
      `<p style="color:#64748b;font-size:0.78rem;">` +
      (n > 0 ? `We stored about ${n} characters of text from this page.` : "We stored this page.") +
      `</p>`;
    if (hasFamily) {
      html +=
        '<p style="color:#92400e;font-size:0.75rem;margin-top:8px;">We compared the picture of this screen to the photos in your family list in the main app.</p>';
    } else if (data.familyMatchNudge) {
      html +=
        '<p style="color:#64748b;font-size:0.78rem;margin-top:10px;">' +
        escapeHtml(data.familyMatchNudge) +
        "</p>";
    }
    setScanResult(html, false, hasFamily);
  } catch (e) {
    setScanResult(
      '<p class="err">' +
        escapeHtml(e.message || "Something went wrong. Try again.") +
        "</p>",
      true,
      false
    );
  } finally {
    btn.disabled = false;
    btn.textContent = scanLabel;
  }
});

document.getElementById("continuity").addEventListener("click", async () => {
  const btn = document.getElementById("continuity");
  const continuityLabel = "Double-check this page";
  const resultEl = document.getElementById("result");
  resultEl.className = "";
  resultEl.innerHTML = "";
  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setResult('<p class="err">Open a website tab first, then try again.</p>', "uncertain");
      return;
    }

    let pageText = "";
    try {
      pageText = await getVisiblePageText(tab.id);
    } catch (e) {
      const hint = (e && e.message) || String(e);
      const isRestricted =
        /chrome:\/\//i.test(tab.url || "") ||
        /^(edge|chrome|brave):\/\//i.test(tab.url || "") ||
        /chromewebstore\.google\.com/i.test(tab.url || "");
      setResult(
        "<p class=\"err\">" +
          (isRestricted
            ? "This kind of page can’t be read. Open your email or site on a regular tab and try again."
            : "We couldn’t read this tab. Try refreshing the page, then open this window again. " +
              escapeHtml(hint.slice(0, 200))) +
          "</p>",
        "uncertain"
      );
      return;
    }

    if (!pageText || pageText.length < 20) {
      setResult(
        "<p class=\"err\">There isn’t much text here. Open the full page, or paste text in the Boomer app.</p>",
        "uncertain"
      );
      return;
    }

    const pageUrl = tab.url || "";

    const res = await backendFetch("/continuity/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: pageText, pageUrl: pageUrl || null }),
    });

    const textBody = await res.text();
    let data;
    try {
      data = textBody ? JSON.parse(textBody) : {};
    } catch {
      setResult("<p class=\"err\">Something went wrong. Try again in a moment.</p>", "uncertain");
      return;
    }

    if (!res.ok) {
      setResult(`<p class="err">${escapeHtml(data.error || res.statusText)}</p>`, "uncertain");
      return;
    }

    const status = data.status || "uncertain";
    const source =
      data.source === "memory-anchor"
        ? "Your saved notes"
        : data.source === "fetch-ai"
          ? "Smart check"
          : "On this computer";
    let html = `<span class="tag">${escapeHtml(source)}</span>`;
    html += `<div class="headline">${escapeHtml(data.headline || "")}</div>`;
    if (data.pitch) {
      html += `<p style="color:#64748b;font-size:0.78rem;margin-bottom:8px;">${escapeHtml(data.pitch)}</p>`;
    }
    if (Array.isArray(data.conflicts) && data.conflicts.length) {
      html += "<strong>Worth a look:</strong><ul>";
      for (const c of data.conflicts) {
        html += "<li><strong>" + escapeHtml(c.title || "") + "</strong> " + escapeHtml(c.detail || "") + "</li>";
      }
      html += "</ul>";
    }
    if (Array.isArray(data.reminders) && data.reminders.length) {
      html += "<strong>Ideas:</strong><ul>";
      for (const r of data.reminders) {
        html += "<li>" + escapeHtml(r) + "</li>";
      }
      html += "</ul>";
    }
    setResult(html, status);
  } catch (e) {
    setResult(
      '<p class="err">' +
        escapeHtml(e.message || "Couldn’t reach Boomer. Open the app on your computer or try again.") +
        "</p>",
      "uncertain"
    );
  } finally {
    btn.disabled = false;
    btn.textContent = continuityLabel;
  }
});
