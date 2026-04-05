import humanPng from "../assets/human.png";
import { cn } from "./components/ui/utils";

/** Soft orange marker: radial glow — blended dot, no ring or icons. */
function Hotspot({
  className,
  onClick,
  label,
  title: titleText,
}: {
  className?: string;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "pointer-events-auto flex min-h-[44px] min-w-[44px] items-center justify-center border-0 bg-transparent p-0 outline-none",
        "motion-safe:transition-[opacity,transform] duration-200",
        "opacity-[0.92] hover:opacity-100 active:scale-95",
        "focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200",
        className,
      )}
      onClick={onClick}
      aria-label={label}
      title={titleText}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block h-6 w-6 shrink-0 sm:h-7 sm:w-7",
          "rounded-[999px]",
          "bg-[radial-gradient(ellipse_at_center,rgba(255,180,50,0.95)_0%,rgba(251,146,60,0.75)_28%,rgba(249,115,22,0.42)_52%,rgba(251,146,60,0.12)_72%,transparent_82%)]",
          "[filter:blur(1.75px)]",
        )}
      />
    </button>
  );
}

export function WellnessHumanSilhouette({
  className,
  onBrainClick,
  onHeartClick,
}: {
  className?: string;
  onBrainClick: () => void;
  onHeartClick: () => void;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full flex-1 flex-col items-center justify-center",
        className,
      )}
    >
      <p className="mb-1 max-w-md px-3 text-center text-sm font-normal leading-snug text-stone-600 sm:mb-2 sm:text-[0.95rem]">
        Tap the <span className="font-medium text-teal-300">head</span> or{" "}
        <span className="font-medium text-rose-300">chest</span> to open your charts
      </p>

      <div
        className="relative flex w-full max-w-[min(100vw,720px)] flex-1 min-h-[min(52dvh,520px)] items-center justify-center overflow-hidden px-0"
        role="img"
        aria-label="Figure of a person. Tap the head for mood and memory, or the chest for memory slip frequency."
      >


        {/* Scale figure + hotspots together; outer overflow crops excess padding around PNG */}
        <div
          className={cn(
            "relative mx-auto w-[min(92vw,560px)] max-w-full origin-[50%_44%]",
            /* Half of prior 3× zoom — cropped by overflow */
            "scale-[1.83] sm:scale-[1.98] md:scale-[2.07]",
          )}
        >
          <img
            src={humanPng}
            alt=""
            width={480}
            height={960}
            decoding="async"
            className="relative z-[1] mx-auto block h-auto max-h-[min(72dvh,820px)] w-full object-contain object-center [filter:drop-shadow(0_0_8px_rgba(192,87,74,0.7))_drop-shadow(0_0_22px_rgba(192,87,74,0.4))_drop-shadow(0_0_50px_rgba(15,80,90,0.3))]"
          />

          <Hotspot
            className="absolute left-1/2 top-[6%] z-[2] -translate-x-1/2"
            onClick={onBrainClick}
            label="Open mood and memory difficulty chart"
            title="Mood & memory difficulty"
          />
          <Hotspot
            className="absolute left-1/2 top-[21%] z-[2] -translate-x-1/2"
            onClick={onHeartClick}
            label="Open memory slip frequency chart"
            title="Memory slip — frequency over time"
          />
        </div>
      </div>
    </div>
  );
}
