import { useEffect, useId, useState } from "react";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}

/** Single continuous path: smooth top bulb → neck → bottom bulb */
const HOURGLASS_D = `
M 86 82
Q 110 74 134 82
Q 142 96 132 110
L 118 122
L 118 128
L 132 144
Q 142 158 134 172
Q 110 180 86 172
Q 78 158 88 144
L 102 128
L 102 122
L 88 110
Q 78 96 86 82
Z
`;

/**
 * Silver gimbal hourglass — smooth glass, metallic rings, soft sand.
 */
export function SandTimerGimbal({
  className = "",
  decorative = true,
  compact = false,
}: {
  className?: string;
  /** When false, the graphic is exposed to assistive tech (e.g. inside a labeled button). */
  decorative?: boolean;
  /** Smaller footprint for single-screen dashboard layouts. */
  compact?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const spin = !reduced;
  const uid = useId().replace(/:/g, "");

  const silver = `${uid}-silver`;
  const silverDark = `${uid}-silver-dark`;
  const silverStroke = `${uid}-silver-stroke`;
  const chrome = `${uid}-chrome`;
  const glassFill = `${uid}-glass-fill`;
  const glassEdge = `${uid}-glass-edge`;
  const sandGrad = `${uid}-sand`;
  const shadowF = `${uid}-drop`;
  const softF = `${uid}-soft`;

  const cx = 110;
  const cy = 128;

  return (
    <div
      className={`dashboard-hourglass-wrap relative mx-auto flex items-center justify-center ${className}`}
      {...(decorative ? { "aria-hidden": true as const } : {})}
    >
      <svg
        viewBox="0 0 220 260"
        className={
          compact
            ? "h-44 w-36 max-w-[min(72vw,220px)] md:h-52 md:w-44"
            : "h-64 w-52 max-w-[min(78vw,300px)] md:h-[23rem] md:w-64"
        }
        role="img"
        aria-label="Rotating sand timer"
      >
        <title>Sand timer in gimbal</title>
        <defs>
          <radialGradient id={silver} cx="38%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="35%" stopColor="#e2e8f0" />
            <stop offset="72%" stopColor="#94a3b8" />
            <stop offset="100%" stopColor="#475569" />
          </radialGradient>
          <linearGradient id={silverDark} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#64748b" />
            <stop offset="100%" stopColor="#1e293b" />
          </linearGradient>
          <linearGradient id={silverStroke} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f1f5f9" />
            <stop offset="28%" stopColor="#cbd5e1" />
            <stop offset="55%" stopColor="#94a3b8" />
            <stop offset="82%" stopColor="#5b6470" />
            <stop offset="100%" stopColor="#334155" />
          </linearGradient>
          <radialGradient id={chrome} cx="32%" cy="28%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="45%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#64748b" />
          </radialGradient>
          <linearGradient id={glassFill} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
            <stop offset="50%" stopColor="rgba(220,235,255,0.18)" />
            <stop offset="100%" stopColor="rgba(160,190,230,0.1)" />
          </linearGradient>
          <linearGradient id={glassEdge} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
            <stop offset="50%" stopColor="rgba(148,163,184,0.75)" />
            <stop offset="100%" stopColor="rgba(71,85,105,0.55)" />
          </linearGradient>
          <linearGradient id={sandGrad} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fffef5" />
            <stop offset="100%" stopColor="#c9c4b5" />
          </linearGradient>
          <filter id={shadowF} x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.2" />
          </filter>
          <filter id={softF} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <ellipse cx={cx} cy="248" rx="74" ry="14" fill="rgba(15,23,42,0.12)" />

        <g filter={`url(#${shadowF})`}>
          <ellipse cx={cx} cy="236" rx="62" ry="10" fill={`url(#${silver})`} />
          <ellipse cx={cx} cy="226" rx="52" ry="8" fill={`url(#${silver})`} />
          <ellipse cx={cx} cy="218" rx="42" ry="6" fill={`url(#${silverDark})`} />
          <ellipse cx={cx} cy="233" rx="54" ry="2.5" fill="rgba(255,255,255,0.35)" />
        </g>

        <circle cx={cx} cy="208" r="12" fill={`url(#${chrome})`} filter={`url(#${softF})`} />
        <ellipse cx={cx - 4} cy="203" rx="2.5" ry="2" fill="rgba(255,255,255,0.78)" />

        <path
          d="M 42 208 C 42 175 42 158 48 150 C 54 140 62 134 72 130"
          fill="none"
          stroke={`url(#${silverStroke})`}
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 178 208 C 178 175 178 158 172 150 C 166 140 158 134 148 130"
          fill="none"
          stroke={`url(#${silverStroke})`}
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <g>
          {spin && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from={`0 ${cx} ${cy}`}
              to={`360 ${cx} ${cy}`}
              dur="26s"
              repeatCount="indefinite"
            />
          )}
          <circle cx={cx} cy={cy} r="84" fill="none" stroke="rgba(15,23,42,0.35)" strokeWidth="5" />
          <circle
            cx={cx}
            cy={cy}
            r="84"
            fill="none"
            stroke={`url(#${silverStroke})`}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <circle cx="42" cy="150" r="4" fill={`url(#${silver})`} stroke="#334155" strokeWidth="0.6" />
          <circle cx="178" cy="150" r="4" fill={`url(#${silver})`} stroke="#334155" strokeWidth="0.6" />
        </g>

        <g>
          {spin && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from={`360 ${cx} ${cy}`}
              to={`0 ${cx} ${cy}`}
              dur="17s"
              repeatCount="indefinite"
            />
          )}
          <circle cx={cx} cy={cy} r="68" fill="none" stroke="rgba(15,23,42,0.28)" strokeWidth="4" />
          <circle cx={cx} cy={cy} r="68" fill="none" stroke={`url(#${silverStroke})`} strokeWidth="2.4" />
        </g>

        <g>
          {spin && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from={`0 ${cx} ${cy}`}
              to={`360 ${cx} ${cy}`}
              dur="21s"
              repeatCount="indefinite"
            />
          )}
          <circle cx={cx} cy={cy} r="52" fill="none" stroke="rgba(15,23,42,0.24)" strokeWidth="3.5" />
          <circle cx={cx} cy={cy} r="52" fill="none" stroke={`url(#${silverStroke})`} strokeWidth="2" />
        </g>

        <g filter={`url(#${softF})`}>
          <path
            d={HOURGLASS_D}
            fill={`url(#${glassFill})`}
            stroke={`url(#${glassEdge})`}
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
          <path
            d={HOURGLASS_D}
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="0.65"
            opacity="0.85"
          />

          <ellipse cx={cx} cy="98" rx="15" ry="17" fill={`url(#${sandGrad})`} opacity="0.93" />
          <ellipse cx={cx} cy="158" rx="17" ry="20" fill={`url(#${sandGrad})`} opacity="0.96" />
          <line
            x1={cx}
            y1="124"
            x2={cx}
            y2="152"
            stroke={`url(#${sandGrad})`}
            strokeWidth="2.6"
            strokeLinecap="round"
            opacity="0.88"
          />
          {spin && (
            <circle cx={cx} cy="136" r="2" fill="#fffef8" opacity="0.95">
              <animate attributeName="cy" values="124;152;124" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;1;0.4" dur="2.2s" repeatCount="indefinite" />
            </circle>
          )}
        </g>
      </svg>
    </div>
  );
}
