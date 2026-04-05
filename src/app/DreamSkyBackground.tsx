import { useMemo, type CSSProperties } from "react";

/** Stars dense at top, sparse below (starry night → clear mist). */
function sparkleProps(i: number) {
  const x = ((i * 137.357) % 1000) / 10;
  let y: number;
  if (i < 72) {
    y = ((i * 173.21) % 480) / 10;
  } else {
    y = 44 + ((i * 241.891 + 17) % 560) / 10;
  }
  y = Math.min(99, y);
  const size = 2 + (i % 4);
  const delay = ((i * 0.23) % 5) + (i % 3) * 0.4;
  const duration = 2.2 + (i % 5) * 0.35;
  const dim = y > 52;
  return { x, y, size, delay, duration, dim };
}

type Puff = {
  w: number;
  h: number;
  left: number;
  top: number;
  bg: string;
};

type CloudBank = {
  className: string;
  delay: string;
  filterId: string;
  /** Bank region (viewport %) */
  region: CSSProperties;
  puffs: Puff[];
};

/** Stronger internal contrast so blobs read as volume, not flat fill. */
function puffBg(seed: number): string {
  const a = 0.45 + (seed % 5) * 0.06;
  const b = 0.22 + ((seed * 3) % 4) * 0.05;
  const c = 0.14 + ((seed * 7) % 3) * 0.04;
  return `
    radial-gradient(ellipse 70% 58% at 52% 42%, rgba(255,255,255,${a}), transparent 68%),
    radial-gradient(ellipse 55% 48% at 18% 62%, rgba(255,255,255,${b}), transparent 64%),
    radial-gradient(ellipse 48% 42% at 82% 58%, rgba(235,245,255,${c}), transparent 58%),
    radial-gradient(ellipse 35% 30% at 48% 78%, rgba(255,255,255,${b * 0.85}), transparent 52%),
    rgba(255,255,255,0.04)
  `;
}

const banks: CloudBank[] = [
  {
    className: "bg-cloud-slow",
    delay: "0s",
    filterId: "dream-cloud-texture-a",
    region: { width: "108%", height: "30%", left: "-20%", top: "54%" },
    puffs: [
      { w: 48, h: 42, left: 4, top: 18, bg: puffBg(1) },
      { w: 42, h: 38, left: 38, top: 8, bg: puffBg(2) },
      { w: 36, h: 34, left: 62, top: 28, bg: puffBg(3) },
      { w: 32, h: 30, left: 22, top: 48, bg: puffBg(4) },
      { w: 28, h: 26, left: 72, top: 52, bg: puffBg(5) },
    ],
  },
  {
    className: "bg-cloud-slow-alt",
    delay: "-14s",
    filterId: "dream-cloud-texture-b",
    region: { width: "92%", height: "26%", right: "-14%", top: "66%" },
    puffs: [
      { w: 44, h: 40, left: 8, top: 12, bg: puffBg(6) },
      { w: 40, h: 36, left: 42, top: 22, bg: puffBg(7) },
      { w: 34, h: 32, left: 68, top: 8, bg: puffBg(8) },
      { w: 30, h: 28, left: 28, top: 48, bg: puffBg(9) },
    ],
  },
  {
    className: "bg-cloud-slow-wide",
    delay: "-28s",
    filterId: "dream-cloud-texture-c",
    region: { width: "85%", height: "24%", left: "6%", bottom: "4%" },
    puffs: [
      { w: 46, h: 40, left: 6, top: 20, bg: puffBg(10) },
      { w: 40, h: 36, left: 38, top: 10, bg: puffBg(11) },
      { w: 36, h: 32, left: 64, top: 32, bg: puffBg(12) },
      { w: 32, h: 28, left: 18, top: 52, bg: puffBg(13) },
      { w: 28, h: 24, left: 78, top: 48, bg: puffBg(14) },
    ],
  },
];

/**
 * Pensieve-style sky: multi-lobe cloud banks + strong SVG displacement + grain.
 */
export function DreamSkyBackground() {
  const sparkles = useMemo(
    () => Array.from({ length: 100 }, (_, i) => sparkleProps(i)),
    [],
  );

  return (
    <div className="absolute inset-0 z-0 h-full w-full overflow-hidden pointer-events-none">
      <svg className="absolute h-0 w-0" aria-hidden focusable="false">
        <defs>
          <filter
            id="dream-cloud-texture-a"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.011"
              numOctaves="5"
              seed="3"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="48"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            <feGaussianBlur in="displaced" stdDeviation="10" />
          </filter>
          <filter
            id="dream-cloud-texture-b"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.014"
              numOctaves="4"
              seed="17"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="42"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            <feGaussianBlur in="displaced" stdDeviation="9" />
          </filter>
          <filter
            id="dream-cloud-texture-c"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.009"
              numOctaves="6"
              seed="29"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="52"
              xChannelSelector="R"
              yChannelSelector="G"
              result="displaced"
            />
            <feGaussianBlur in="displaced" stdDeviation="11" />
          </filter>
        </defs>
      </svg>

      <div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(180deg,
              #071525 0%,
              #0f2844 8%,
              #1a4570 18%,
              #2a6798 30%,
              #3782ad 42%,
              #4598bf 52%,
              #4fa8ca 58%,
              #64b5d3 66%,
              #8bc4dc 76%,
              #b8d8e8 86%,
              #dbe8f2 94%,
              #eef4f8 100%
            )
          `,
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 88% 48% at 50% 36%, rgba(105, 165, 205, 0.34), transparent 58%),
            radial-gradient(ellipse 100% 60% at 50% -6%, rgba(255, 255, 255, 0.13), transparent 42%),
            radial-gradient(ellipse 85% 45% at 14% 28%, rgba(30, 50, 80, 0.18), transparent 48%),
            linear-gradient(180deg,
              transparent 0%,
              transparent 58%,
              rgba(255, 255, 255, 0.085) 72%,
              rgba(195, 218, 232, 0.24) 84%,
              rgba(165, 195, 212, 0.28) 100%
            )
          `,
        }}
      />

      {/* Multi-lobe banks: reads as cloud mass, not a single gradient oval */}
      {banks.map((bank, bi) => (
        <div
          key={bi}
          className={`${bank.className} absolute z-[2]`}
          style={{
            ...bank.region,
            animationDelay: bank.delay,
            opacity: bi === 0 ? 0.54 : bi === 1 ? 0.5 : 0.48,
          }}
        >
          {bank.puffs.map((p, pi) => (
            <div
              key={pi}
              className="absolute rounded-[50%]"
              style={{
                width: `${p.w}%`,
                height: `${p.h}%`,
                left: `${p.left}%`,
                top: `${p.top}%`,
                background: p.bg,
                filter: `url(#${bank.filterId}) blur(22px)`,
              }}
            />
          ))}
        </div>
      ))}

      <div
        className="dream-sky-cloud-grain pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[62%] mix-blend-soft-light opacity-[0.18]"
        aria-hidden
      />
      <div
        className="dream-sky-cloud-grain-fine pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[55%] mix-blend-overlay opacity-[0.12]"
        aria-hidden
      />

      <div className="absolute inset-0 z-[3]">
        {sparkles.map((s, i) => (
          <span
            key={i}
            className={`absolute rounded-full bg-white ${
              s.dim ? "ambient-sparkle-dot-dim" : "ambient-sparkle-dot"
            }`}
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.duration}s`,
            }}
          />
        ))}
      </div>

      <div
        className="absolute inset-0 z-[4]"
        style={{
          background: `
            radial-gradient(ellipse 100% 55% at 50% -10%, rgba(255, 255, 255, 0.12), transparent 48%),
            linear-gradient(180deg,
              transparent 0%,
              transparent 82%,
              rgba(75, 115, 145, 0.11) 100%
            )
          `,
        }}
      />
    </div>
  );
}
