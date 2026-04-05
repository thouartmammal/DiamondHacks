import {
  useEffect,
  useRef,
  type RefObject,
  type ReactNode,
} from "react";

const MAX_PX = 34;
const LERP = 0.09;
/** Parallax fades to 0 by this scroll distance (px) on the main scroll root. */
const SCROLL_FADE_PX = 420;
const ROT_DEG = 2.6;

type Props = {
  scrollRootRef: RefObject<HTMLElement | null>;
  lovedOnesOpen: boolean;
  children: ReactNode;
};

/**
 * Patronus-quiz style: background pans / tilts slightly with the pointer (smooth lerp).
 * Fades out as the user scrolls down; disabled when prefers-reduced-motion or loved-ones full screen.
 */
export function ParallaxBackground({
  scrollRootRef,
  lovedOnesOpen,
  children,
}: Props) {
  const innerRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef({ x: 0, y: 0, rx: 0, ry: 0 });
  const currentRef = useRef({ x: 0, y: 0, rx: 0, ry: 0 });
  const scrollFadeRef = useRef(1);
  const lovedRef = useRef(lovedOnesOpen);
  lovedRef.current = lovedOnesOpen;
  const reducedRef = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => {
      reducedRef.current = mq.matches;
    };
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  useEffect(() => {
    const syncScroll = () => {
      const el = scrollRootRef.current;
      if (!el) return;
      if (lovedRef.current) {
        scrollFadeRef.current = 0;
        return;
      }
      const t = el.scrollTop;
      scrollFadeRef.current = Math.max(0, 1 - Math.min(1, t / SCROLL_FADE_PX));
    };

    syncScroll();
    const el = scrollRootRef.current;
    if (!el) return;
    el.addEventListener("scroll", syncScroll, { passive: true });
    return () => el.removeEventListener("scroll", syncScroll);
  }, [scrollRootRef, lovedOnesOpen]);

  useEffect(() => {
    if (reducedRef.current) return;

    const onMove = (e: MouseEvent) => {
      const fade = scrollFadeRef.current;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const nx = (e.clientX / w - 0.5) * 2;
      const ny = (e.clientY / h - 0.5) * 2;
      targetRef.current.x = nx * MAX_PX * fade;
      targetRef.current.y = ny * MAX_PX * fade;
      targetRef.current.ry = nx * ROT_DEG * fade;
      targetRef.current.rx = -ny * ROT_DEG * 0.78 * fade;
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    if (reducedRef.current) return;

    let rafId = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const inner = innerRef.current;
      const cur = currentRef.current;
      const tgt = targetRef.current;
      cur.x += (tgt.x - cur.x) * LERP;
      cur.y += (tgt.y - cur.y) * LERP;
      cur.rx += (tgt.rx - cur.rx) * LERP;
      cur.ry += (tgt.ry - cur.ry) * LERP;
      if (inner) {
        inner.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0) rotateX(${cur.rx}deg) rotateY(${cur.ry}deg)`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  const staticReduced = reducedRef.current;

  return (
    <div
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
      style={{ perspective: staticReduced ? undefined : "min(1400px, 120vw)" }}
      aria-hidden
    >
      <div
        ref={innerRef}
        className="absolute will-change-transform"
        style={{
          width: staticReduced ? "100%" : "114%",
          height: staticReduced ? "100%" : "114%",
          left: staticReduced ? 0 : "-7%",
          top: staticReduced ? 0 : "-7%",
          transform: staticReduced ? undefined : "translate3d(0,0,0)",
          transformStyle: "preserve-3d",
          backfaceVisibility: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
