// ── Who? side button — inject unconditionally, no async gating ───────────────
(function injectWhoBtn() {
  // After an extension reload, old DOM nodes can remain but their listeners are dead.
  // Never bail on "already exists" — replace so the button always works.
  document.getElementById("__boomer_who_btn")?.remove();
  document.getElementById("__boomer_who_overlay")?.remove();

  const btn = document.createElement("button");
  btn.id = "__boomer_who_btn";
  btn.type = "button";
  btn.textContent = "Who?";
  Object.assign(btn.style, {
    position: "fixed",
    right: "0",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: "2147483647",
    background: "linear-gradient(180deg, #0d2d3a 0%, #1a4a62 60%, #2a5f72 100%)",
    color: "#e8f0f2",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRight: "none",
    borderRadius: "10px 0 0 10px",
    padding: "16px 8px",
    fontSize: "13px",
    fontWeight: "700",
    fontFamily: "system-ui, sans-serif",
    letterSpacing: "0.05em",
    cursor: "pointer",
    writingMode: "vertical-rl",
    boxShadow: "-2px 0 16px rgba(5,20,30,0.4)",
  });

  function whoBtnIdleLook() {
    Object.assign(btn.style, {
      writingMode: "vertical-rl",
      maxWidth: "",
      padding: "16px 8px",
      fontSize: "13px",
      lineHeight: "",
      textAlign: "",
      wordBreak: "",
      letterSpacing: "0.05em",
    });
    btn.textContent = "Who?";
    btn.removeAttribute("title");
    btn.removeAttribute("aria-label");
  }

  function whoBtnResultLook() {
    Object.assign(btn.style, {
      writingMode: "horizontal-tb",
      maxWidth: "min(280px, 44vw)",
      padding: "10px 14px",
      fontSize: "12px",
      lineHeight: "1.35",
      textAlign: "center",
      wordBreak: "break-word",
      letterSpacing: "normal",
    });
  }

  function truncatePlain(s, max) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
  }

  /** After an extension reload, old tabs keep a zombie script: chrome.runtime.id is gone. */
  function extensionContextOk() {
    try {
      return typeof chrome !== "undefined" && !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function isStaleExtensionMessage(msg) {
    return /extension context invalidated|receiving end does not exist|could not establish connection/i.test(
      String(msg || ""),
    );
  }

  btn.onclick = async () => {
    whoBtnIdleLook();
    btn.textContent = "…";
    btn.disabled = true;

    if (!extensionContextOk()) {
      whoBtnResultLook();
      const full =
        "Extension reloaded — refresh this page (F5) so Who? can connect again.";
      btn.textContent = truncatePlain(full, 140);
      btn.title = full;
      btn.setAttribute("aria-label", full);
      btn.disabled = false;
      return;
    }

    try {
      const result = await new Promise((res, rej) => {
        chrome.runtime.sendMessage({ type: "boomer_who_press" }, (r) => {
          if (chrome.runtime.lastError) return rej(new Error(chrome.runtime.lastError.message));
          res(r);
        });
      });

      whoBtnResultLook();

      if (result && result.ok === false && result.error) {
        const full = `Couldn’t reach Boomer. ${result.error}`;
        btn.textContent = truncatePlain(full, 140);
        btn.title = full;
        btn.setAttribute("aria-label", full);
      } else if (result?.familyMatch) {
        const fm = result.familyMatch;
        const head = truncatePlain(fm.headline, 72);
        const sub = fm.message ? truncatePlain(fm.message, 100) : "";
        const display = sub ? `${head}\n${sub}` : head;
        const full = sub ? `${fm.headline}\n\n${fm.message}` : String(fm.headline || "");
        btn.textContent = display;
        btn.title = full.trim() || display;
        btn.setAttribute("aria-label", full.trim() || display);
      } else if (result?.nudge) {
        const nudge = String(result.nudge).trim();
        const tail = " Your press was still recorded.";
        const full = `No close match. ${nudge}${tail}`;
        btn.textContent = truncatePlain(full, 160);
        btn.title = full;
        btn.setAttribute("aria-label", full);
      } else {
        const full =
          "No family match found. No one from your family list was recognised. Your press was still recorded.";
        btn.textContent = truncatePlain(full, 140);
        btn.title = full;
        btn.setAttribute("aria-label", full);
      }
    } catch (err) {
      whoBtnResultLook();
      const raw = err instanceof Error ? err.message : "Extension message failed.";
      let full;
      if (isStaleExtensionMessage(raw)) {
        full =
          "Extension reloaded or this tab is stale — refresh the page (F5), then try Who? again.";
      } else {
        full = `${raw} If this persists, reload the extension and ensure npm run voice is running.`;
      }
      btn.textContent = truncatePlain(full, 140);
      btn.title = full;
      btn.setAttribute("aria-label", full);
    } finally {
      btn.disabled = false;
    }
  };

  // Respect the on/off toggle preference
  const STORAGE_WHO_BTN = "whoSideBtnEnabled";
  try {
    chrome.storage.local.get([STORAGE_WHO_BTN], (r) => {
      if (r[STORAGE_WHO_BTN] === false) btn.style.display = "none";
    });
  } catch { /* ignore */ }

  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === "boomer_who_btn_toggle") {
      btn.style.display = m.enabled ? "block" : "none";
    }
  });

  document.documentElement.appendChild(btn);
})();

// ── Guard: only run the rest once per tab ─────────────────────────────────────
if (!window.__boomerListening) {
  window.__boomerListening = true;

  // Wake word (Web Speech API — often blocked with error "not-allowed" on strict sites or without permission; harmless.)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let wakeWordStopped = false;
    rec.onend = () => {
      if (wakeWordStopped) return;
      try {
        rec.start();
      } catch {
        /* ignore */
      }
    };
    rec.onerror = (e) => {
      const code = e && "error" in e ? e.error : "";
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
        wakeWordStopped = true;
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
        console.info(
          "[Boomer] Wake word (mic) is off on this page:",
          code,
          "— say “Hi Boomer” from the main Boomer tab if you use voice there.",
        );
        return;
      }
      if (code !== "aborted" && code !== "no-speech") {
        console.warn("[Boomer] speech error:", code);
      }
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.toLowerCase();
        if (t.includes("hi boomer") || t.includes("hey boomer")) {
          chrome.runtime.sendMessage({ type: "wake_word_detected" });
          break;
        }
      }
    };
    try {
      rec.start();
    } catch {
      /* ignore */
    }
  }

  // Page text for popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "boomer_get_page_text") {
      try {
        const raw = document.body?.innerText || document.documentElement?.innerText || "";
        sendResponse({ text: raw.replace(/\s+/g, " ").trim().slice(0, 18000) });
      } catch (e) {
        sendResponse({ text: "", error: String(e?.message || e) });
      }
      return true;
    }
    return false;
  });
}
