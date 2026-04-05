import Vapi from "@vapi-ai/web";
import React, { useState, useEffect, useRef } from "react";

/** Vapi typings omit tool-call-result; runtime accepts it. */
function vapiSendToolResult(vapi: Vapi, payload: { toolCallId: string; result: string }) {
  (vapi as unknown as { send: (m: Record<string, unknown>) => void }).send({
    type: "tool-call-result",
    ...payload,
  });
}

/** Best-effort: open phone or web contact URL from automation result (popup blocker may block http(s) after async). */
function tryOpenFirstContactUrlFromBrowserResult(text: string) {
  const tel = text.match(/\btel:[+\d][^\s\])"'<>]*/i);
  if (tel?.[0]) {
    try {
      window.location.href = tel[0];
    } catch {
      /* ignore */
    }
    return;
  }
  const m = text.match(/https?:\/\/[^\s\])"'<>]+/);
  if (!m?.[0]) return;
  try {
    window.open(m[0], "_blank", "noopener,noreferrer");
  } catch {
    /* ignore */
  }
}
import { MemoryPanel } from "./MemoryPanel";
import { ContinuityGuardianPanel } from "./ContinuityGuardianPanel";
import { LovedOnesPage } from "./LovedOnesPage";
import { RemindersPanel } from "./RemindersPanel";
import { BoomerWave } from "./BoomerWave";
import { SettingsPanel } from "./SettingsPanel";
import { HomeDashboard } from "./HomeDashboard";
import { PhysicalActivityDashboard } from "./PhysicalActivityDashboard";
import { apiUrl } from "../lib/apiUrl";
import { CursorPatronusSparkles } from "./CursorPatronusSparkles";
import { ParallaxBackground } from "./ParallaxBackground";
import { DreamSkyBackground } from "./DreamSkyBackground";
import { fetchRoutinesAnalyzeForVoice } from "./RoutinesCaregiverCard";
import { openRoutineFlowInBrowser } from "../lib/routineFlowClient";
import { runBrowserAutomationStream } from "../lib/browserAutomationStream";
import { useTranslation } from "../i18n/LanguageContext";

const HERO_TAGLINE_STAGGER_S = 0.075;

function HeroTaglineWords({ text }: { text: string }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return (
    <p className="font-boomer-dashboard-ui hero-glow-tagline mx-auto mt-3 max-w-md text-lg font-bold leading-tight tracking-tight sm:mt-4 sm:max-w-lg sm:text-xl md:text-2xl">
      {words.map((word, i) => (
        <React.Fragment key={`${i}-${word}`}>
          <span
            className="hero-tagline-word"
            style={{ animationDelay: `${i * HERO_TAGLINE_STAGGER_S}s` }}
          >
            {word}
          </span>
          {i < words.length - 1 ? " " : null}
        </React.Fragment>
      ))}
    </p>
  );
}

export default function App() {
  const { t, locale, setLocale } = useTranslation();
  const vapiRef = useRef<Vapi | null>(null);
  if (!vapiRef.current) {
    vapiRef.current = new Vapi(import.meta.env.VITE_VAPI_PUBLIC_KEY ?? "");
  }
  const vapi = vapiRef.current;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [lovedOnesOpen, setLovedOnesOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [continuityOpen, setContinuityOpen] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [browserBusy, setBrowserBusy] = useState(false);
  /** Single plain-language line (latest only) while a browser task runs. */
  const [browserProgressLine, setBrowserProgressLine] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    const electronAPI = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI;

    const onCallStart = () => {
      setIsConnected(true);
      setVoiceStarting(false);
      (electronAPI as { sessionStarted?: () => void })?.sessionStarted?.();
    };
    const onCallEnd = () => {
      setIsConnected(false);
      setIsSpeaking(false);
      (electronAPI as { sessionEnded?: () => void })?.sessionEnded?.();
    };
    const onSpeechStart = () => {
      setIsSpeaking(true);
      (electronAPI as { speakingState?: (v: boolean) => void })?.speakingState?.(true);
    };
    const onSpeechEnd = () => {
      setIsSpeaking(false);
      (electronAPI as { speakingState?: (v: boolean) => void })?.speakingState?.(false);
    };
    const onError = (e: unknown) => {
      console.error("Vapi error:", e);
      const err = e as { error?: { message?: string }; message?: string };
      const msg = err?.error?.message ?? err?.message ?? (e as { error?: string })?.error ?? JSON.stringify(e);
      setVoiceError(typeof msg === "string" ? msg : JSON.stringify(msg));
      setVoiceStarting(false);
      setIsConnected(false);
    };

    const onMessage = async (...args: unknown[]) => {
      const msg = args[0] as {
        type?: string;
        toolCallList?: Array<{ id: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }>;
      };
      if (msg.type === "tool-calls") {
        for (const call of msg.toolCallList ?? []) {
          if (call.function?.name === "run_browser_task") {
            setBrowserBusy(true);
            setBrowserProgressLine(null);
            try {
              const args =
                typeof call.function.arguments === "string"
                  ? JSON.parse(call.function.arguments)
                  : call.function.arguments;
              const task = (args as { task?: unknown })?.task ?? args;
              console.log("Browser task:", task);
              const out = await runBrowserAutomationStream(String(task ?? ""), (message) => {
                setBrowserProgressLine(message);
              });
              tryOpenFirstContactUrlFromBrowserResult(out);
              vapiSendToolResult(vapi, { toolCallId: call.id, result: out });
            } catch (e: unknown) {
              const msgErr = e instanceof Error ? e.message : String(e);
              vapiSendToolResult(vapi, { toolCallId: call.id, result: `Error: ${msgErr}` });
            } finally {
              setBrowserBusy(false);
              setBrowserProgressLine(null);
            }
          } else if (call.function?.name === "analyze_daily_routines") {
            try {
              const text = await fetchRoutinesAnalyzeForVoice();
              vapiSendToolResult(vapi, { toolCallId: call.id, result: text });
            } catch (e: unknown) {
              const msgErr = e instanceof Error ? e.message : String(e);
              vapiSendToolResult(vapi, { toolCallId: call.id, result: `Error: ${msgErr}` });
            }
          } else if (call.function?.name === "open_my_routine") {
            try {
              const { patternSummary, opened, lines } = await openRoutineFlowInBrowser();
              vapiSendToolResult(vapi, {
                toolCallId: call.id,
                result:
                  opened > 0
                    ? `${patternSummary}\n\nOpened ${opened} tab(s):\n${lines}`
                    : patternSummary || "No routine steps to open yet — browse more and try again.",
              });
            } catch (e: unknown) {
              const msgErr = e instanceof Error ? e.message : String(e);
              vapiSendToolResult(vapi, { toolCallId: call.id, result: `Error: ${msgErr}` });
            }
          } else if (call.function?.name === "add_reminder") {
            try {
              const argsRaw = call.function.arguments;
              const args =
                typeof argsRaw === "string"
                  ? (JSON.parse(argsRaw) as Record<string, unknown>)
                  : (argsRaw as Record<string, unknown> | undefined) ?? {};
              const title = String(args.title ?? "").trim();
              const note = args.note != null ? String(args.note).trim() : "";
              const dueRaw = args.dueAt ?? args.due_at;
              const dueAt =
                dueRaw != null && String(dueRaw).trim() ? String(dueRaw).trim() : undefined;
              if (!title) {
                vapiSendToolResult(vapi, {
                  toolCallId: call.id,
                  result: "Error: reminder title is required.",
                });
              } else {
                const res = await fetch(apiUrl("reminders"), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title,
                    note: note || undefined,
                    dueAt: dueAt ?? null,
                    source: "voice",
                  }),
                });
                const textBody = await res.text();
                let data: { error?: string } = {};
                try {
                  data = textBody ? (JSON.parse(textBody) as { error?: string }) : {};
                } catch {
                  /* non-JSON */
                }
                if (!res.ok) {
                  vapiSendToolResult(vapi, {
                    toolCallId: call.id,
                    result: `Error: ${data.error || res.statusText || "Could not save reminder"}`,
                  });
                } else {
                  const line = dueAt
                    ? `Saved reminder: ${title}, due ${dueAt}.`
                    : `Saved reminder: ${title}. Open Daily reminders in the menu to see your list.`;
                  vapiSendToolResult(vapi, { toolCallId: call.id, result: line });
                }
              }
            } catch (e: unknown) {
              const msgErr = e instanceof Error ? e.message : String(e);
              vapiSendToolResult(vapi, { toolCallId: call.id, result: `Error: ${msgErr}` });
            }
          }
        }
      }
    };

    const onEndSession = () => {
      vapi.stop();
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);
    vapi.on("message", onMessage);
    (electronAPI as { onEndSession?: (cb: () => void) => void })?.onEndSession?.(onEndSession);

    const vapiEmitter = vapi as unknown as {
      removeListener: (ev: string, fn: (...args: unknown[]) => void) => void;
    };

    return () => {
      vapiEmitter.removeListener("call-start", onCallStart);
      vapiEmitter.removeListener("call-end", onCallEnd);
      vapiEmitter.removeListener("speech-start", onSpeechStart);
      vapiEmitter.removeListener("speech-end", onSpeechEnd);
      vapiEmitter.removeListener("error", onError);
      vapiEmitter.removeListener("message", onMessage);
      (electronAPI as { offEndSession?: () => void })?.offEndSession?.();
    };
  }, [vapi]);

  // Wake word detection via Python backend polling
  const wakeRecogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeActiveRef = useRef(false);
  const startVoiceSessionRef = useRef<() => void>(() => {});

  useEffect(() => {
    const poll = setInterval(async () => {
      if (wakeActiveRef.current) return;
      try {
        const res = await fetch(apiUrl("wake-word-poll"));
        const data = await res.json();
        if (data.detected && !wakeActiveRef.current) {
          console.log("[Boomer] Wake word detected via Python!");
          wakeActiveRef.current = true;
          startVoiceSessionRef.current();
        }
      } catch {}
    }, 500);
    wakeRecogRef.current = poll;
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (isConnected) {
      wakeActiveRef.current = true;
    } else {
      const t = setTimeout(() => { wakeActiveRef.current = false; }, 1500);
      return () => clearTimeout(t);
    }
  }, [isConnected]);

  async function startVoiceSession() {
    setVoiceError(null);
    wakeActiveRef.current = true;
    setVoiceStarting(true);    try {
      const res = await fetch(apiUrl("vapi-config"));
      const text = await res.text();
      if (!text) throw new Error("Empty response from voice server — is it running?");
      const data = JSON.parse(text) as { assistantId?: string; error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (!data.assistantId) throw new Error("No assistant ID from server");
      console.log("Starting Vapi with assistant:", data.assistantId);
      await vapi.start(data.assistantId);
    } catch (e: any) {
      setVoiceError(e.message ?? "Could not start voice");
      setVoiceStarting(false);
    }
  }

  async function toggleVoiceAgent() {
    setVoiceError(null);
    if (isConnected) { vapi.stop(); return; }
    await startVoiceSession();
  }

  // Keep ref in sync so the wake word listener always calls the latest version
  startVoiceSessionRef.current = startVoiceSession;

  const [uiVisible, setUiVisible] = useState(false);
  /** Voice circle + task bar: hidden until swipe/scroll-up; stay visible during an active call. */
  const showVoiceChrome = uiVisible || isConnected;
  /** Until the user reveals chrome, lock vertical scroll so the first wheel/swipe only reveals UI. */
  const scrollLocked = !uiVisible && !isConnected;
  const scrollLockedRef = useRef(scrollLocked);
  scrollLockedRef.current = scrollLocked;
  const scrollRootRef = useRef<HTMLDivElement>(null);

  // Reveal voice UI on wheel / touch; while scrollLocked, prevent scrolling so content does not move.
  useEffect(() => {
    const el = scrollRootRef.current;
    if (!el) return;

    const reveal = () => setUiVisible(true);

    const onScroll = () => {
      if (scrollLockedRef.current) {
        if (el.scrollTop > 0) el.scrollTop = 0;
        return;
      }
      if (el.scrollTop > 12) reveal();
    };

    const onWheel = (e: WheelEvent) => {
      if (scrollLockedRef.current) {
        e.preventDefault();
        reveal();
        return;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (scrollLockedRef.current) e.preventDefault();
    };

    const touch = (() => {
      let startY = 0;
      return {
        start: (e: TouchEvent) => {
          startY = e.touches[0].clientY;
        },
        end: (e: TouchEvent) => {
          const dy = startY - e.changedTouches[0].clientY;
          if (scrollLockedRef.current) {
            if (Math.abs(dy) > 40) reveal();
          } else if (dy > 40) {
            reveal();
          }
        },
      };
    })();

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchstart", touch.start, { passive: true });
    el.addEventListener("touchend", touch.end, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchstart", touch.start);
      el.removeEventListener("touchend", touch.end);
    };
  }, []);

  // Track active time for dashboard (“hours online”)
  useEffect(() => {
    fetch(apiUrl("usage/ping"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deltaMs: 0 }),
    }).catch(() => {});

    const intervalMs = 30_000;
    let visible = document.visibilityState === "visible";
    const onVis = () => {
      visible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);
    const id = window.setInterval(() => {
      if (!visible) return;
      fetch(apiUrl("usage/ping"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deltaMs: intervalMs }),
      }).catch(() => {});
    }, intervalMs);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(id);
    };
  }, []);

  return (
    <>
      <ParallaxBackground scrollRootRef={scrollRootRef} lovedOnesOpen={lovedOnesOpen}>
        <DreamSkyBackground />
      </ParallaxBackground>
      <CursorPatronusSparkles />
      <div
        id="app-scroll-root"
        ref={scrollRootRef}
        className={`relative z-10 h-dvh max-h-dvh w-full min-h-0 snap-y snap-proximity overflow-x-hidden scroll-smooth px-2 sm:px-3 md:px-4 ${scrollLocked || remindersOpen ? "overflow-y-hidden" : "overflow-y-auto"}`}
      >
      {lovedOnesOpen && <div className="page-enter-right absolute inset-0 z-50"><LovedOnesPage onBack={() => setLovedOnesOpen(false)} /></div>}
      {remindersOpen && <RemindersPanel onClose={() => setRemindersOpen(false)} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {!lovedOnesOpen && (<>
      {sidebarOpen && (
        <div
          className="absolute inset-0 z-25"
          onClick={() => setSidebarOpen(false)}
          style={{ backgroundColor: "rgba(30, 58, 95, 0.25)" }}
        />
      )}

      {memoryOpen && <MemoryPanel onClose={() => setMemoryOpen(false)} />}
      {continuityOpen && (
        <ContinuityGuardianPanel onClose={() => setContinuityOpen(false)} />
      )}

      {/* Help + menu (left); language flags (top right) — same reveal as voice / browser task bar */}
      {uiVisible && (
      <>
      <div
        className="pointer-events-auto absolute z-20 flex overflow-hidden rounded-2xl border-[3px] transition-opacity duration-200"
        style={{
          top: "max(2rem, env(safe-area-inset-top, 0px))",
          right: "max(2rem, env(safe-area-inset-right, 0px))",
          borderColor: "rgba(147, 197, 253, 0.95)",
          backgroundColor: "rgba(248, 251, 255, 0.5)",
          backdropFilter: "blur(10px)",
          boxShadow: "0 4px 24px rgba(59, 130, 246, 0.15)",
        }}
        role="group"
        aria-label={t("lang.label")}
      >
        <button
          type="button"
          onClick={() => setLocale("en")}
          aria-pressed={locale === "en"}
          aria-label={t("lang.switchToEn")}
          title={t("lang.switchToEn")}
          className="transition-colors duration-200"
          style={{
            padding: "0.45rem 0.75rem",
            fontSize: "clamp(1.5rem, 4vw, 1.85rem)",
            lineHeight: 1,
            border: "none",
            cursor: "pointer",
            backgroundColor: locale === "en" ? "rgba(59, 130, 246, 0.38)" : "transparent",
          }}
        >
          🇺🇸
        </button>
        <button
          type="button"
          onClick={() => setLocale("vi")}
          aria-pressed={locale === "vi"}
          aria-label={t("lang.switchToVi")}
          title={t("lang.switchToVi")}
          className="transition-colors duration-200"
          style={{
            padding: "0.45rem 0.75rem",
            fontSize: "clamp(1.5rem, 4vw, 1.85rem)",
            lineHeight: 1,
            border: "none",
            borderLeft: "2px solid rgba(147, 197, 253, 0.55)",
            cursor: "pointer",
            backgroundColor: locale === "vi" ? "rgba(59, 130, 246, 0.38)" : "transparent",
          }}
        >
          🇻🇳
        </button>
      </div>
      <div
        className="pointer-events-auto absolute z-20 flex flex-col items-center rounded-full border border-white/20 bg-slate-950/60 px-2 py-2 shadow-[0_8px_42px_rgba(0,0,0,0.5)] backdrop-blur-xl"
        style={{
          top: "max(2rem, env(safe-area-inset-top, 0px))",
          left: "max(2rem, env(safe-area-inset-left, 0px))",
        }}
        role="toolbar"
        aria-label="Help and menu"
      >
        <button
          type="button"
          onMouseEnter={() => setShowHelp(true)}
          onMouseLeave={() => setShowHelp(false)}
          className="relative flex h-[52px] w-[52px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[1.65rem] font-bold leading-none text-sky-400 transition-[background-color,box-shadow] duration-200 hover:bg-white/10 hover:shadow-[0_0_22px_rgba(56,189,248,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400/80"
          aria-label={t("app.helpButtonAria")}
        >
          ?
          {showHelp && (
            <div
              className="absolute left-[calc(100%+0.75rem)] top-1/2 z-30 w-[min(380px,calc(100vw-5rem))] max-w-[85vw] -translate-y-1/2 rounded-xl p-4 text-left shadow-2xl"
              style={{
                border: "1px solid rgba(255,255,255,0.18)",
                backgroundColor: "rgba(15, 23, 42, 0.92)",
                color: "#e2e8f0",
                fontSize: "1.05rem",
                fontWeight: 500,
                backdropFilter: "blur(14px)",
              }}
            >
              {t("app.helpBlurb")}
            </div>
          )}
        </button>

        <div className="my-1 h-px w-9 shrink-0 bg-white/18" aria-hidden />

        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex h-[52px] w-[52px] shrink-0 cursor-pointer items-center justify-center rounded-2xl border-0 bg-transparent text-2xl leading-none text-sky-400 transition-[background-color,box-shadow] duration-200 hover:bg-white/10 hover:shadow-[0_0_22px_rgba(56,189,248,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400/80"
          aria-expanded={sidebarOpen}
          aria-label={t("app.menuButtonAria")}
        >
          ☰
        </button>
      </div>
      </>
      )}

      {/* Sidebar */}
      <div
        className="absolute top-0 left-0 h-full transition-transform duration-300 z-30"
        style={{
          width: "460px", backgroundColor: "rgba(248, 251, 255, 0.96)",
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          boxShadow: sidebarOpen ? "8px 0 32px rgba(59, 130, 246, 0.15)" : "none",
          backdropFilter: "blur(16px)",
          borderRight: "1px solid rgba(147, 197, 253, 0.5)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div className="pt-32 px-10 flex flex-col gap-8 flex-1">
          {(
            [
              { id: "lovedOnes" as const, labelKey: "app.lovedOnes" },
              { id: "reminders" as const, labelKey: "app.dailyReminders" },
            ] as const
          ).map(({ id, labelKey }) => (
            <button
              key={id}
              onClick={() => {
                if (id === "lovedOnes") {
                  setLovedOnesOpen(true);
                  setSidebarOpen(false);
                } else if (id === "reminders") {
                  setRemindersOpen(true);
                  setSidebarOpen(false);
                }
              }}
              className="overflow-hidden transition-all duration-200 w-full"
              style={{ border: "3px solid #93c5fd", borderRadius: "1rem", backgroundColor: "rgba(255,255,255,0.5)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#3b82f6"; const h3 = e.currentTarget.querySelector("h3"); if (h3) h3.style.color = "#f8fbff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.5)"; const h3 = e.currentTarget.querySelector("h3"); if (h3) h3.style.color = "#1e3a5f"; }}
            >
              <div className="p-6">
                <h3 className="mb-2" style={{ fontSize: "1.3rem", fontWeight: 600, color: "#1e3a5f" }}>
                  {t(labelKey)}
                </h3>
              </div>
            </button>
          ))}
        </div>
        <div className="p-8">
          <button
            onClick={() => setSidebarOpen(false)}
            className="overflow-hidden transition-all duration-200 w-full"
            style={{ border: "3px solid #3b82f6", borderRadius: "1rem", backgroundColor: "#3b82f6", padding: "1.5rem" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "transparent"; const s = e.currentTarget.querySelector("span"); if (s) s.style.color = "#2563eb"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#3b82f6"; const s = e.currentTarget.querySelector("span"); if (s) s.style.color = "#f8fbff"; }}
          >
            <span style={{ fontSize: "1.3rem", fontWeight: 600, color: "#f8fbff" }}>{t("app.closePanel")}</span>
          </button>
          <button
            onClick={() => { setSettingsOpen(true); setSidebarOpen(false); }}
            className="overflow-hidden transition-all duration-200 w-full mt-3"
            style={{ border: "3px solid #4a5f4b", borderRadius: "1rem", backgroundColor: "transparent", padding: "1rem" }}
          >
            <span style={{ fontSize: "1.3rem", fontWeight: 600, color: "#4a5f4b" }}>{t("app.settings")}</span>
          </button>
          <button
            onClick={() => { setContinuityOpen(true); setSidebarOpen(false); }}
            className="overflow-hidden transition-all duration-200 w-full mt-3"
            style={{ border: "3px solid #1d4ed8", borderRadius: "1rem", backgroundColor: "rgba(219, 234, 254, 0.6)", padding: "1rem" }}
          >
            <span style={{ fontSize: "1.25rem", fontWeight: 600, color: "#1e3a8a" }}>
              {t("app.continuityGuardian")}
            </span>
          </button>
        </div>
      </div>

      {/* Main Content — one full viewport snap panel (must snap-align like dashboards or mandatory snap pulls you back) */}
      <div className="relative mx-auto flex h-dvh max-h-dvh w-full shrink-0 snap-start snap-always flex-col justify-center overflow-x-hidden px-8 text-center sm:px-12">
        <div className="mx-auto flex max-w-6xl w-full flex-col justify-center">
        <header className="relative z-[1] -mt-6 mb-5 shrink-0 px-2 text-center sm:-mt-10 sm:mb-6 md:-mt-14">
          <h1 className="font-boomer-dashboard-ui hero-glow-title mb-1 text-2xl font-bold leading-tight tracking-tight sm:text-3xl md:text-4xl">
            {t("app.heroTitle")}
          </h1>
          <HeroTaglineWords key={locale} text={t("app.heroTagline")} />
        </header>

        {/* Swipe hint */}
        {!uiVisible && (
          <div style={{
            position: "absolute", bottom: "3rem", left: "50%", transform: "translateX(-50%)",
            color: "rgba(255,255,255,0.85)", fontSize: "1.6rem", fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
            animation: "fade-in 1s ease 1s both", whiteSpace: "nowrap",
            textShadow: "0 2px 12px rgba(0,0,0,0.6)",
          }}>
            <span style={{ fontSize: "3rem" }}>↑</span>
            <span>{t("app.swipeUp")}</span>
          </div>
        )}
        {uiVisible && (
          <div
            style={{
              position: "absolute",
              bottom: "6.5rem",
              left: "50%",
              transform: "translateX(-50%)",
              color: "rgba(248, 251, 255, 0.9)",
              fontSize: "0.9rem",
              textAlign: "center",
              pointerEvents: "none",
              maxWidth: "22rem",
              textShadow: "0 1px 14px rgba(37, 99, 235, 0.4)",
            }}
          >
            <span style={{ fontSize: "1.2rem", display: "block", marginBottom: "4px" }}>↓</span>
            {t("app.swipeDownDashboards")}
          </div>
        )}


        <div
          className="flex flex-col items-center gap-6"
          style={{
            transform: showVoiceChrome ? "translateY(0)" : "translateY(100vh)",
            opacity: showVoiceChrome ? 1 : 0,
            transition:
              "transform 1.05s cubic-bezier(0.33, 1, 0.32, 1), opacity 0.45s ease",
            pointerEvents: showVoiceChrome ? "auto" : "none",
          }}
          aria-hidden={!showVoiceChrome}
        >
          {/* Siri-style wave when active */}
          {isConnected && (
            <div className="flex flex-col items-center gap-3">
              <BoomerWave isListening={isConnected && !isSpeaking} isSpeaking={isSpeaking} />
              <p style={{ fontSize: "1.1rem", color: "#5b7a9e" }}>
                {isSpeaking ? t("app.boomerSpeaking") : t("app.listening")}
              </p>
              <button
                onClick={toggleVoiceAgent}
                style={{ padding: "0.6rem 1.5rem", borderRadius: "9999px", border: "2px solid #3b82f6", backgroundColor: "rgba(248,251,255,0.85)", color: "#2563eb", fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}
              >
                {t("app.end")}
              </button>
            </div>
          )}
          {!isConnected && <button
            type="button"
            disabled={voiceStarting}
            onClick={toggleVoiceAgent}
            className={`voice-btn transition-all duration-200 relative mx-auto flex items-center justify-center disabled:opacity-60 ${isConnected && !isSpeaking ? "animate-[pulse-ring_1.5s_ease-out_infinite]" : ""}`}
            style={{
              width: "380px", height: "380px",
              fontSize: "1.25rem", fontWeight: 600,
              backgroundImage: "linear-gradient(165deg, #bfdbfe 0%, #60a5fa 45%, #3b82f6 100%), url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='3' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.25'/%3E%3C/svg%3E\")",
              backgroundBlendMode: "overlay, normal",
              color: "#f8fbff", border: "none", borderRadius: "50%", padding: "2rem",
            }}
            onMouseEnter={(e) => { if (voiceStarting) return; e.currentTarget.style.backgroundImage = "none"; e.currentTarget.style.backgroundColor = "#f0f9ff"; e.currentTarget.style.color = "#2563eb"; }}
            onMouseLeave={(e) => { if (voiceStarting) return; e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.backgroundImage = "linear-gradient(165deg, #bfdbfe 0%, #60a5fa 45%, #3b82f6 100%), url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='3' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.25'/%3E%3C/svg%3E\")"; e.currentTarget.style.color = "#f8fbff"; }}
          >
            <span className="text-center leading-snug px-4 flex flex-col items-center gap-3">
              {voiceStarting ? (
                <>
                  <svg className="animate-spin" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  <span>{t("app.starting")}</span>
                </>
              ) : t("app.tapToTalk")}
            </span>
          </button>}

          {(browserProgressLine || browserBusy) && (
            <div
              className="mx-auto w-full max-w-xl rounded-2xl border-2 px-6 py-5 text-center shadow-lg backdrop-blur-sm"
              style={{
                borderColor: "#93c5fd",
                backgroundColor: "rgba(248, 251, 255, 0.94)",
              }}
              role="status"
              aria-live="polite"
              aria-label={t("app.browserProgressAria")}
            >
              <p
                className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em]"
                style={{ color: "#5b7a9e" }}
              >
                {t("app.whatBoomerDoing")}
              </p>
              {browserProgressLine ? (
                <p
                  className="mb-0 mt-1 leading-relaxed"
                  style={{ fontSize: "1.2rem", fontWeight: 600, color: "#1e3a5f" }}
                >
                  {browserProgressLine}
                </p>
              ) : browserBusy ? (
                <p className="mb-0 mt-1 leading-relaxed" style={{ fontSize: "1.15rem", color: "#475569" }}>
                  {t("app.gettingReady")}
                </p>
              ) : null}
              {browserBusy && browserProgressLine ? (
                <p className="mb-0 mt-3 text-base" style={{ color: "#64748b" }}>
                  {t("app.pleaseWait")}
                </p>
              ) : null}
            </div>
          )}

          {voiceError && (
            <p className="max-w-xl text-red-800 text-base" role="alert">{voiceError}</p>
          )}
        </div>
        </div>

        {/* Browser task bar: bottom of hero panel only — scrolls up with the page (not position:fixed). */}
        {showVoiceChrome && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem("task") as HTMLInputElement);
              const task = input.value.trim();
              if (!task || browserBusy) return;
              setBrowserBusy(true);
              setBrowserProgressLine(null);
              try {
                const out = await runBrowserAutomationStream(task, (message) => {
                  setBrowserProgressLine(message);
                });
                tryOpenFirstContactUrlFromBrowserResult(out);
                input.value = "";
              } catch (err: unknown) {
                setVoiceError(err instanceof Error ? err.message : t("app.browserTaskFailed"));
              } finally {
                setBrowserBusy(false);
                setBrowserProgressLine(null);
              }
            }}
            className="pointer-events-auto z-[35]"
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              bottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
              display: "flex",
              gap: "0.75rem",
              width: "min(640px, calc(100% - 2rem))",
              maxWidth: "min(640px, calc(100vw - 2rem))",
              boxSizing: "border-box",
            }}
          >
            <input
              name="task"
              type="text"
              placeholder={t("app.browserTaskPlaceholder")}
              disabled={browserBusy}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "1rem 1.25rem",
                borderRadius: "0.75rem",
                border: "2px solid rgba(255,255,255,0.75)",
                backgroundColor: "rgba(15, 40, 80, 0.38)",
                color: "#f8fbff",
                backdropFilter: "blur(10px)",
                fontSize: "1.1rem",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={browserBusy}
              style={{
                flexShrink: 0,
                padding: "1rem 1.5rem",
                borderRadius: "0.75rem",
                border: "2px solid rgba(255,255,255,0.75)",
                backgroundColor: "rgba(59,130,246,0.92)",
                color: "#f8fbff",
                backdropFilter: "blur(8px)",
                fontSize: "1.1rem",
                fontWeight: 600,
                cursor: browserBusy ? "not-allowed" : "pointer",
                opacity: browserBusy ? 0.6 : 1,
              }}
            >
              {t("app.go")}
            </button>
          </form>
        )}
      </div>

      <HomeDashboard />

      <PhysicalActivityDashboard />

      {/* Translucent overlay */}
      {activitiesOpen && (
        <div
          className="absolute inset-0 z-40"
          style={{ backgroundColor: "rgba(15, 40, 80, 0.72)" }}
          onClick={() => setActivitiesOpen(false)}
        />
      )}

      {/* Two rounded buttons sliding in from the right, right edge clipped */}
      <div
        className="absolute inset-0 z-50 pointer-events-none overflow-hidden"
      >
        <div
          className="absolute flex flex-col gap-6 transition-transform duration-500"
          style={{
            right: 0,
            top: "50%",
            transform: activitiesOpen ? "translate(0, -50%)" : "translate(100%, -50%)",
            width: "55%",
            pointerEvents: activitiesOpen ? "auto" : "none",
          }}
        >
          <button
            style={{
              width: "calc(100% + 120px)",
              padding: "4rem 3.5rem",
              borderRadius: "9999px",
              border: "none",
              backgroundImage: "linear-gradient(to right, #93c5fd, #2563eb)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: "1.6rem",
              color: "#1e3a5f",
              boxShadow: "0 8px 32px rgba(59, 130, 246, 0.35)",
            }}
          >
            {t("app.digitalActivitiesPrefix")}{" "}
            <span style={{ color: "#f8fbff", fontWeight: 700 }}>{t("app.digitalActivitiesAccent")}</span>
          </button>
        </div>
      </div>
      </>)}
    </div>
    </>
  );
}
