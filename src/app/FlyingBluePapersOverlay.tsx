import { useEffect, useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type Props = {
  burstKey: number;
  onDone: () => void;
};

const PAPER_COUNT = 20;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

type TumbleStep = { rx: number; ry: number; sx: number; sy: number };

/** Narrower apparent width when the sheet is closer to edge-on (large |rotateY|). */
function scaleForTumble(ryDeg: number) {
  const t = Math.min(1, Math.abs(ryDeg) / 70);
  const narrow = 0.16 + rand(0, 0.12);
  const wide = 0.9 + rand(0, 0.18);
  return wide + (narrow - wide) * (t * t);
}

function tumbleStep(ry: number, rx: number): TumbleStep {
  const sx = scaleForTumble(ry);
  const sy = Math.max(0.72, Math.min(1.12, 0.94 + rand(-0.12, 0.12) - Math.abs(ry) / 200));
  return { rx, ry, sx, sy };
}

export function FlyingBluePapersOverlay({ burstKey, onDone }: Props) {
  const papers = useMemo(
    () =>
      Array.from({ length: PAPER_COUNT }, (_, i) => {
        const baseRot = rand(-58, 58);
        const twist = rand(18, 52) * (Math.random() > 0.5 ? 1 : -1);
        const edgeRy = rand(64, 86) * (Math.random() > 0.5 ? 1 : -1);

        const y1 = rand(-28, 28);
        const y2 = rand(-36, 36);
        const y3 = rand(-28, 28);
        const wobble1 = rand(-14, 14);
        const wobble2 = rand(-16, 16);
        const wobble3 = rand(-14, 14);

        const t0 = tumbleStep(rand(-40, 40), rand(-18, 18));
        const t1 = tumbleStep(rand(-70, 70), rand(-22, 22));
        const t2 = tumbleStep(edgeRy, rand(-16, 16));
        const t3 = tumbleStep(rand(-55, 55), rand(-20, 20));
        const t4 = tumbleStep(rand(-44, 44), rand(-18, 18));

        return {
          id: `${burstKey}-${i}`,
          topPct: rand(28, 72),
          width: rand(52, 98),
          height: rand(30, 54),
          rot: baseRot,
          twist,
          drift: rand(-36, 36),
          delay: rand(0, 0.28),
          duration: rand(1.45, 2.15),
          flip: Math.random() > 0.5,
          marginLeft: rand(28, 68),
          z: Math.floor(rand(0, 5)),
          y1,
          y2,
          y3,
          wobble1,
          wobble2,
          wobble3,
          t0,
          t1,
          t2,
          t3,
          t4,
        };
      }),
    [burstKey],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      onDone();
      return;
    }
    const t = window.setTimeout(onDone, 3800);
    return () => clearTimeout(t);
  }, [burstKey, onDone]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <style>
        {`
          @keyframes boomer-paper-fly-swirl {
            0% {
              transform: translate3d(0, 0, 0)
                rotateX(var(--t0-rx, 0deg)) rotateY(var(--t0-ry, 0deg))
                rotateZ(var(--paper-r, 0deg))
                scale3d(var(--t0-sx, 1), var(--t0-sy, 1), 1);
              opacity: 0;
            }
            5% {
              opacity: 0.95;
            }
            24% {
              transform: translate3d(calc(-26vw - 24px), var(--paper-y1, 0px), 0)
                rotateX(var(--t1-rx, 0deg)) rotateY(var(--t1-ry, 0deg))
                rotateZ(calc(var(--paper-r, 0deg) + var(--paper-wb1, 0deg)))
                scale3d(var(--t1-sx, 1), var(--t1-sy, 1), 1);
            }
            48% {
              transform: translate3d(calc(-52vw - 48px), var(--paper-y2, 0px), 0)
                rotateX(var(--t2-rx, 0deg)) rotateY(var(--t2-ry, 0deg))
                rotateZ(calc(var(--paper-r, 0deg) + var(--paper-wb2, 0deg)))
                scale3d(var(--t2-sx, 1), var(--t2-sy, 1), 1);
            }
            72% {
              transform: translate3d(calc(-78vw - 72px), var(--paper-y3, 0px), 0)
                rotateX(var(--t3-rx, 0deg)) rotateY(var(--t3-ry, 0deg))
                rotateZ(calc(var(--paper-r, 0deg) + var(--paper-wb3, 0deg)))
                scale3d(var(--t3-sx, 1), var(--t3-sy, 1), 1);
            }
            100% {
              transform: translate3d(calc(-122vw - 200px), var(--paper-drift, 0px), 0)
                rotateX(var(--t4-rx, 0deg)) rotateY(var(--t4-ry, 0deg))
                rotateZ(calc(var(--paper-r, 0deg) + var(--paper-twist, 0deg)))
                scale3d(var(--t4-sx, 1), var(--t4-sy, 1), 1);
              opacity: 0.8;
            }
          }
        `}
      </style>
      <div
        className="pointer-events-none fixed inset-0 z-[9998] overflow-hidden"
        style={{ perspective: "1100px" }}
        aria-hidden
      >
        {papers.map((p) => {
          const cssVars = {
            "--paper-r": `${p.rot}deg`,
            "--paper-drift": `${p.drift}px`,
            "--paper-twist": `${p.twist}deg`,
            "--paper-y1": `${p.y1}px`,
            "--paper-y2": `${p.y2}px`,
            "--paper-y3": `${p.y3}px`,
            "--paper-wb1": `${p.wobble1}deg`,
            "--paper-wb2": `${p.wobble2}deg`,
            "--paper-wb3": `${p.wobble3}deg`,
            "--t0-rx": `${p.t0.rx}deg`,
            "--t0-ry": `${p.t0.ry}deg`,
            "--t0-sx": String(p.t0.sx),
            "--t0-sy": String(p.t0.sy),
            "--t1-rx": `${p.t1.rx}deg`,
            "--t1-ry": `${p.t1.ry}deg`,
            "--t1-sx": String(p.t1.sx),
            "--t1-sy": String(p.t1.sy),
            "--t2-rx": `${p.t2.rx}deg`,
            "--t2-ry": `${p.t2.ry}deg`,
            "--t2-sx": String(p.t2.sx),
            "--t2-sy": String(p.t2.sy),
            "--t3-rx": `${p.t3.rx}deg`,
            "--t3-ry": `${p.t3.ry}deg`,
            "--t3-sx": String(p.t3.sx),
            "--t3-sy": String(p.t3.sy),
            "--t4-rx": `${p.t4.rx}deg`,
            "--t4-ry": `${p.t4.ry}deg`,
            "--t4-sx": String(p.t4.sx),
            "--t4-sy": String(p.t4.sy),
          } as CSSProperties;

          return (
            <div
              key={p.id}
              className="absolute"
              style={{
                ...cssVars,
                left: "100%",
                top: `${p.topPct}%`,
                width: p.width,
                height: p.height,
                marginLeft: p.marginLeft,
                zIndex: p.z,
                transformStyle: "preserve-3d",
                animation: `boomer-paper-fly-swirl ${p.duration}s linear forwards`,
                willChange: "transform",
                animationDelay: `${p.delay}s`,
                filter: "drop-shadow(0 2px 8px rgba(56, 189, 248, 0.35)) drop-shadow(0 0 1px rgba(165, 243, 252, 0.5))",
              }}
            >
              <div
                className="relative h-full w-full"
                style={{
                  transformStyle: "preserve-3d",
                  transform: p.flip ? "scaleX(-1)" : undefined,
                }}
              >
                <div
                  className="absolute inset-0 overflow-hidden border border-sky-200/50 bg-gradient-to-br from-white/92 via-sky-50/88 to-cyan-100/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_2px_6px_rgba(34,211,238,0.12)]"
                  style={{
                    borderRadius: "3px 3px 10px 3px",
                    boxShadow:
                      "inset 0 -12px 16px -12px rgba(6, 182, 212, 0.08), 0 3px 10px rgba(34, 211, 238, 0.18)",
                  }}
                >
                  <div
                    className="pointer-events-none absolute inset-0 opacity-[0.22]"
                    style={{
                      background:
                        "linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.65) 48%, transparent 52%)",
                    }}
                  />
                  <div className="relative flex h-full w-full flex-col justify-start gap-[3px] px-2 py-1.5">
                    <div
                      className="h-[1px] w-[78%] rounded-full"
                      style={{
                        background: "linear-gradient(90deg, rgba(8,145,178,0.35), rgba(8,145,178,0.12))",
                      }}
                    />
                    <div
                      className="h-[1px] w-[92%] rounded-full"
                      style={{
                        background: "linear-gradient(90deg, rgba(8,145,178,0.28), rgba(8,145,178,0.08))",
                      }}
                    />
                    <div
                      className="h-[1px] w-[58%] rounded-full"
                      style={{
                        background: "linear-gradient(90deg, rgba(8,145,178,0.3), rgba(8,145,178,0.1))",
                      }}
                    />
                    <div className="mt-auto flex justify-end" style={{ paddingRight: 2, paddingBottom: 2 }}>
                      <div
                        className="rounded-full border border-cyan-400/45"
                        style={{
                          width: 7,
                          height: 7,
                          background: "radial-gradient(circle at 35% 35%, #e0f2fe, #22d3ee)",
                          boxShadow: "0 0 0 1px rgba(103, 232, 249, 0.35)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
