import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type Sparkle = {
  id: number;
  x: number;
  y: number;
  size: number;
  rot: number;
  driftX: number;
  driftY: number;
  variant: 0 | 1 | 2;
};

const MAX_PARTICLES = 100;
const SPAWN_INTERVAL_MS = 26;
const SOUND_MIN_MS = 150;
const SOUND_CHANCE = 0.2;
const PARTICLE_LIFETIME_MS = 680;

/** Put your MP3 in `public/cursor-sparkle.mp3` (served at `/cursor-sparkle.mp3`). */
const CURSOR_SPARKLE_SOUND_URL = "/cursor-sparkle.mp3";

/** Linear gain applied to the decoded MP3 (1 = unity). Raise if the file is mastered quietly; may clip if too high. */
const CURSOR_SPARKLE_MP3_GAIN = 3.25;

function createAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  return new Ctx();
}

function playBufferSparkle(ctx: AudioContext, buffer: AudioBuffer) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 0.92 + Math.random() * 0.16;
  const g = ctx.createGain();
  const peak = CURSOR_SPARKLE_MP3_GAIN * (5 + Math.random() * 0.12);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.008);
  const playDur = buffer.duration / src.playbackRate.value;
  const end = t + Math.min(playDur, 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(g);
  g.connect(ctx.destination);
  src.start(t);
  src.stop(end);t
}

/** Fallback when the MP3 is missing or fails to load. */
function playTwinkle(ctx: AudioContext) {
  const t = ctx.currentTime;
  const freq = 920 + Math.random() * 1100;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.88, t + 0.14);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.028 + Math.random() * 0.022, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.24);

  const osc2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.value = freq * 2.04;
  g2.gain.setValueAtTime(0, t);
  g2.gain.linearRampToValueAtTime(0.012, t + 0.004);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  osc2.connect(g2);
  g2.connect(ctx.destination);
  osc2.start(t);
  osc2.stop(t + 0.16);

  const osc3 = ctx.createOscillator();
  const g3 = ctx.createGain();
  osc3.type = "triangle";
  osc3.frequency.value = freq * 0.5;
  g3.gain.setValueAtTime(0, t);
  g3.gain.linearRampToValueAtTime(0.008, t + 0.012);
  g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  osc3.connect(g3);
  g3.connect(ctx.destination);
  osc3.start(t);
  osc3.stop(t + 0.2);
}

/**
 * Silver-blue cursor sparkles + soft twinkling tones (Patronus-quiz style).
 * Full-screen overlay, pointer-events: none. Disabled when prefers-reduced-motion.
 */
export function CursorPatronusSparkles() {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const idRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const lastSoundRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const sparkleBufferRef = useRef<AudioBuffer | null>(null);
  const sparkleLoadStartedRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onMq = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  const unlockAudio = useCallback(() => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;
    if (!audioRef.current) audioRef.current = createAudioContext();
    const ctx = audioRef.current;
    if (ctx?.state === "suspended") void ctx.resume();
    if (ctx && !sparkleLoadStartedRef.current) {
      sparkleLoadStartedRef.current = true;
      void fetch(CURSOR_SPARKLE_SOUND_URL)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("not found"))))
        .then((ab) => ctx.decodeAudioData(ab.slice(0)))
        .then((buf) => {
          sparkleBufferRef.current = buf;
        })
        .catch(() => {
          /* keep using synthesized twinkle */
        });
    }
  }, []);

  const maybePlaySound = useCallback(() => {
    if (reducedMotion) return;
    const now = performance.now();
    if (now - lastSoundRef.current < SOUND_MIN_MS) return;
    if (Math.random() > SOUND_CHANCE) return;
    lastSoundRef.current = now;
    const ctx = audioRef.current;
    if (!ctx || ctx.state !== "running") return;
    try {
      const buf = sparkleBufferRef.current;
      if (buf) playBufferSparkle(ctx, buf);
      else playTwinkle(ctx);
    } catch {
      /* ignore */
    }
  }, [reducedMotion]);

  const spawnBurst = useCallback(
    (clientX: number, clientY: number) => {
      if (reducedMotion) return;
      const now = performance.now();
      if (now - lastSpawnRef.current < SPAWN_INTERVAL_MS) return;
      lastSpawnRef.current = now;

      const n = 2 + Math.floor(Math.random() * 4);
      const next: Sparkle[] = [];
      for (let i = 0; i < n; i++) {
        idRef.current += 1;
        const sp: Sparkle = {
          id: idRef.current,
          x: clientX + (Math.random() - 0.5) * 38,
          y: clientY + (Math.random() - 0.5) * 38,
          size: 4 + Math.random() * 11,
          rot: Math.random() * 360,
          driftX: (Math.random() - 0.5) * 30,
          driftY: -12 - Math.random() * 24,
          variant: (Math.floor(Math.random() * 3) % 3) as 0 | 1 | 2,
        };
        next.push(sp);
        window.setTimeout(() => {
          setSparkles((prev) => prev.filter((x) => x.id !== sp.id));
        }, PARTICLE_LIFETIME_MS);
      }

      setSparkles((prev) => [...prev, ...next].slice(-MAX_PARTICLES));
      maybePlaySound();
    },
    [maybePlaySound, reducedMotion],
  );

  useEffect(() => {
    if (reducedMotion) return;

    const onMove = (e: MouseEvent) => spawnBurst(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const t = e.touches[0];
      spawnBurst(t.clientX, t.clientY);
    };

    const onUnlock = () => unlockAudio();

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    document.addEventListener("pointerdown", onUnlock, { once: true });
    document.addEventListener("keydown", onUnlock, { once: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
      document.removeEventListener("pointerdown", onUnlock);
      document.removeEventListener("keydown", onUnlock);
    };
  }, [spawnBurst, unlockAudio, reducedMotion]);

  if (reducedMotion) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[36] overflow-hidden"
      aria-hidden
    >
      {sparkles.map((s) => {
        const bg =
          s.variant === 0
            ? "radial-gradient(circle, #ffffff 0%, rgba(191,219,254,0.95) 35%, rgba(96,165,250,0.4) 70%, transparent 100%)"
            : s.variant === 1
              ? "radial-gradient(circle at 30% 30%, #f8fbff 0%, #dbeafe 45%, rgba(59,130,246,0.35) 100%)"
              : "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(147,197,253,0.85) 50%, transparent 100%)";
        const style: CSSProperties & Record<string, string> = {
          left: s.x,
          top: s.y,
          width: s.size,
          height: s.size,
          ["--drift-x"]: `${s.driftX}px`,
          ["--drift-y"]: `${s.driftY}px`,
          ["--rot-start"]: `${s.rot}deg`,
          background: bg,
          boxShadow:
            "0 0 6px 2px rgba(255,255,255,0.9), 0 0 14px 4px rgba(147,197,253,0.65), 0 0 22px 6px rgba(59,130,246,0.25)",
          borderRadius: s.variant === 1 ? "2px" : "50%",
          opacity: s.variant === 0 ? 1 : 0.92,
        };
        return <div key={s.id} className="patronus-sparkle-particle absolute" style={style} />;
      })}
    </div>
  );
}
