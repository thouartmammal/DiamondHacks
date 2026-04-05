import { useEffect, useRef } from "react";

interface Props {
  isListening: boolean;
  isSpeaking: boolean;
}

const BARS = 40;
const COLORS = ["#3b82f6", "#60a5fa", "#7dd3fc", "#93c5fd", "#2563eb"];

function fillBar(ctx: CanvasRenderingContext2D, x: number, y: number, bw: number, barH: number, radius: number) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, bw, barH, radius);
    ctx.fill();
    return;
  }
  ctx.fillRect(x, y, bw, barH);
}

export function BoomerWave({ isListening, isSpeaking }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const heightsRef = useRef<number[]>(Array.from({ length: BARS }, () => 4));
  const targetsRef = useRef<number[]>(Array.from({ length: BARS }, () => 4));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const active = isListening || isSpeaking;

    function setNewTargets() {
      targetsRef.current = Array.from({ length: BARS }, (_, i) => {
        if (!active) return 4;
        const center = BARS / 2;
        const dist = Math.abs(i - center) / center;
        const base = isSpeaking ? 80 : 50;
        const spread = 1 - dist * 0.6;
        return Math.random() * base * spread + 4;
      });
    }

    let tick = 0;
    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (tick % 6 === 0) setNewTargets();
      tick++;

      const barW = w / BARS;
      heightsRef.current = heightsRef.current.map((cur, i) => {
        const target = targetsRef.current[i];
        return cur + (target - cur) * 0.15;
      });

      heightsRef.current.forEach((barH, i) => {
        const x = i * barW + barW * 0.15;
        const bw = barW * 0.7;
        const y = (h - barH) / 2;
        const color = COLORS[i % COLORS.length];
        const radius = bw / 2;

        ctx.fillStyle = color;
        ctx.globalAlpha = active ? 0.85 : 0.3;
        fillBar(ctx, x, y, bw, barH, radius);
      });

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [isListening, isSpeaking]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={120}
      style={{ width: "400px", height: "120px" }}
    />
  );
}
