/**
 * Linear gradient backdrop: deep blue-teal top-left → muted slate-blue mid → soft coral accent bottom-right.
 */
export function DashboardSkyBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, #0d2d3a 0%, #1a4a5e 25%, #2a5f72 45%, #3d6b72 60%, #7a8a8a 78%, #c4a89a 92%, #d4b8a8 100%)`,
        }}
      />

      {/* Subtle coral warmth pocket — bottom-right only */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 45% 40% at 88% 88%, rgba(192, 100, 80, 0.38), transparent 60%)`,
        }}
      />

      {/* Grainy film texture */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.28]" aria-hidden>
        <filter id="dsb-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.68" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#dsb-noise)" />
      </svg>
    </div>
  );
}
