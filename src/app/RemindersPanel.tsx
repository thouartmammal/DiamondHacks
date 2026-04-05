import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { apiUrl } from "../lib/apiUrl";
import filmstripUrl from "../assets/filmstrip.png";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "./components/ui/carousel";

const FILMSTRIP_STORAGE_KEY = "boomer-reminders-filmstrip-photos";
const FILMSTRIP_MAX_FILE_BYTES = 900_000;

type FilmstripPhoto = {
  id: string;
  caption: string;
  dataUrl: string;
};

function loadFilmstripPhotos(): FilmstripPhoto[] {
  try {
    const raw = localStorage.getItem(FILMSTRIP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is FilmstripPhoto =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as FilmstripPhoto).id === "string" &&
        typeof (x as FilmstripPhoto).dataUrl === "string" &&
        typeof (x as FilmstripPhoto).caption === "string",
    );
  } catch {
    return [];
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > FILMSTRIP_MAX_FILE_BYTES) {
      reject(new Error(`Image must be under ${Math.round(FILMSTRIP_MAX_FILE_BYTES / 1000)} KB.`));
      return;
    }
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

const P = {
  cream: "#f5efe0",
  agedWhite: "#faf6ee",
  sepia: "#c8a97e",
  olive: "#7a7a4a",
  warmBrown: "#5c3d2e",
  darkBrown: "#3a2a1a",
  amber: "#d4a853",
  fadedRed: "#8b3a2a",
} as const;

const serifHeading = 'Georgia, "Times New Roman", serif';
const sansBody =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

type Reminder = {
  id: string;
  title: string;
  note: string | null;
  dueAt: string | null;
  createdAt: string;
  source: "voice" | "chat" | "manual";
};

function formatWhen(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sourceLabel(s: Reminder["source"]) {
  switch (s) {
    case "voice":
      return "Voice";
    case "chat":
      return "Chat";
    default:
      return "Added here";
  }
}

interface ReminderCardProps {
  reminder: Reminder;
  index: number;
  onRemove: (id: string) => void;
}

function ReminderCard({ reminder: r, index, onRemove }: ReminderCardProps) {
  const when = formatWhen(r.dueAt);
  const added = formatWhen(r.createdAt);
  const rotation = index % 2 === 0 ? "-2.25deg" : "2deg";

  return (
    <li
      style={{
        listStyle: "none",
        transform: `rotate(${rotation})`,
        maxWidth: "min(100%, 22rem)",
        margin: "8px 6px 28px",
      }}
    >
      {/* Polaroid-style frame: white border + thick bottom “chin” */}
      <div
        style={{
          backgroundColor: "#fdfcf9",
          padding: "12px 12px 0",
          boxShadow:
            "0 14px 32px rgba(35, 22, 14, 0.28), 0 4px 10px rgba(35, 22, 14, 0.14), inset 0 0 0 1px rgba(255,255,255,0.85)",
          border: "1px solid rgba(200, 169, 126, 0.35)",
        }}
      >
        <div
          style={{
            backgroundColor: P.agedWhite,
            backgroundImage:
              "linear-gradient(165deg, rgba(255,255,255,0.5) 0%, transparent 48%), repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(92,61,46,0.03) 3px, rgba(92,61,46,0.03) 4px)",
            padding: "14px 14px 16px",
            border: "1px solid rgba(92, 61, 46, 0.12)",
            boxShadow: "inset 0 0 24px rgba(255, 255, 255, 0.35)",
          }}
        >
          <p
            style={{
              fontFamily: serifHeading,
              fontSize: "1.06rem",
              color: P.warmBrown,
              fontWeight: 600,
              margin: 0,
              lineHeight: 1.35,
            }}
          >
            {r.title}
          </p>
          {r.note && (
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ fontFamily: sansBody, color: P.warmBrown, opacity: 0.92 }}
            >
              {r.note}
            </p>
          )}
          <div
            className="mt-3 flex flex-wrap items-center gap-2 text-xs"
            style={{ fontFamily: sansBody, color: P.olive }}
          >
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                textTransform: "uppercase",
                border: "1px solid #c8a97e",
                backgroundColor: "transparent",
                color: P.olive,
                padding: "2px 8px",
                borderRadius: 3,
                fontSize: "0.62rem",
                letterSpacing: "0.06em",
              }}
            >
              {sourceLabel(r.source).toUpperCase()}
            </span>
            {when && (
              <span
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                }}
              >
                Due {when}
              </span>
            )}
            {added && (
              <span className="tabular-nums" style={{ fontFamily: sansBody }}>
                Added {added}
              </span>
            )}
          </div>
        </div>
        {/* Polaroid chin */}
        <div
          className="flex items-end justify-end"
          style={{
            padding: "14px 10px 12px",
            fontFamily: sansBody,
          }}
        >
          <button
            type="button"
            onClick={() => void onRemove(r.id)}
            style={{
              color: P.fadedRed,
              background: "none",
              border: "none",
              textDecoration: "underline",
              textUnderlineOffset: 3,
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 600,
              padding: 0,
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

const inputStyle: CSSProperties = {
  backgroundColor: P.agedWhite,
  borderColor: P.sepia,
  color: P.warmBrown,
  borderWidth: 2,
  borderStyle: "solid",
};

const primaryBtnStyle: CSSProperties = {
  backgroundColor: P.sepia,
  color: P.agedWhite,
  borderWidth: 2,
  borderStyle: "solid",
  borderColor: P.sepia,
};

const fileInputClass =
  "block w-full min-w-0 max-w-full text-sm text-[color:var(--bb-warm)] file:mr-2 file:cursor-pointer file:rounded-lg file:border-2 file:border-solid file:px-3 file:py-1.5 file:text-sm file:font-semibold file:bg-[#faf6ee]";

/** Photo reel + toolbar: controls sit on the paper band above the tiled filmstrip asset. */
function FilmstripBottomBar() {
  const [photos, setPhotos] = useState<FilmstripPhoto[]>(loadFilmstripPhotos);
  const [captionDraft, setCaptionDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  async function addPhoto(e: FormEvent) {
    e.preventDefault();
    if (!pendingFile || addBusy) return;
    setAddErr(null);
    setAddBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(pendingFile);
      const item: FilmstripPhoto = {
        id: crypto.randomUUID(),
        caption: captionDraft.trim(),
        dataUrl,
      };
      const updated = [...photos, item];
      try {
        localStorage.setItem(FILMSTRIP_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        setAddErr("Could not save (storage may be full). Try a smaller image.");
        return;
      }
      setPhotos(updated);
      setCaptionDraft("");
      setPendingFile(null);
    } catch (err) {
      setAddErr(err instanceof Error ? err.message : "Could not add image.");
    } finally {
      setAddBusy(false);
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const next = prev.filter((p) => p.id !== id);
      try {
        localStorage.setItem(FILMSTRIP_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <div className="mt-8 flex w-full shrink-0 flex-col [--bb-warm:#5c3d2e]">
      {/* Controls on parchment — not on the dark filmstrip */}
      <div
        className="border-t-2 px-5 py-4 sm:px-8"
        style={{
          borderColor: P.sepia,
          backgroundColor: "rgba(247, 244, 238, 0.98)",
          boxShadow: "0 -6px 18px rgba(40, 28, 18, 0.07)",
          fontFamily: sansBody,
        }}
      >
        <p
          className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.14em] sm:text-left"
          style={{ color: P.warmBrown, opacity: 0.85 }}
        >
          Your filmstrip
        </p>
        <form
          onSubmit={(e) => void addPhoto(e)}
          className="mx-auto flex w-full max-w-5xl flex-wrap items-end gap-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:min-w-[12rem] sm:flex-row sm:items-center">
            <span className="shrink-0 text-sm font-medium" style={{ color: P.warmBrown }}>
              Photo
            </span>
            <input
              type="file"
              accept="image/*"
              className={fileInputClass}
              style={{ borderColor: P.sepia, fontFamily: sansBody }}
              onChange={(e) => {
                setPendingFile(e.target.files?.[0] ?? null);
                setAddErr(null);
              }}
            />
          </div>
          <input
            type="text"
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            placeholder="Caption"
            className="min-w-[10rem] flex-1 rounded-xl px-3 py-2 text-base outline-none sm:max-w-xs"
            style={inputStyle}
            maxLength={200}
            aria-label="Photo caption"
          />
          <button
            type="submit"
            disabled={!pendingFile || addBusy}
            className="min-h-[44px] shrink-0 rounded-xl px-4 text-base font-semibold shadow-sm"
            style={{
              ...primaryBtnStyle,
              opacity: !pendingFile || addBusy ? 0.5 : 1,
              cursor: !pendingFile || addBusy ? "not-allowed" : "pointer",
            }}
          >
            {addBusy ? "Adding..." : "Add to reel"}
          </button>
          {addErr && (
            <p className="w-full text-sm" style={{ color: P.fadedRed }}>
              {addErr}
            </p>
          )}
        </form>
        {photos.length === 0 && (
          <p
            className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed"
            style={{ fontFamily: serifHeading, color: P.warmBrown, opacity: 0.92 }}
          >
            Nothing on the reel yet. Choose a photo, add an optional caption, then tap <strong>Add to reel</strong>.
          </p>
        )}
      </div>

      {/* Decorative film band + carousel only */}
      <div
        className="relative isolate flex w-full flex-col justify-center shadow-[0_-4px_20px_rgba(20,12,8,0.18)]"
        style={{
          minHeight: photos.length === 0 ? "clamp(56px, 10vh, 100px)" : "clamp(200px, 34vh, 400px)",
          padding: photos.length === 0 ? "8px 12px" : "12px 12px 18px",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage: `url(${filmstripUrl})`,
            backgroundRepeat: "repeat-x",
            backgroundPosition: "left center",
            backgroundSize: "auto 100%",
          }}
        />
        {photos.length > 0 && (
          <Carousel
            opts={{ loop: photos.length > 1, align: "center", skipSnaps: false }}
            className="relative z-10 mx-auto w-full max-w-5xl px-11 sm:px-14"
            aria-label="Your photo reel"
          >
            <CarouselContent className="-ml-2 sm:-ml-3">
              {photos.map(({ id, caption, dataUrl }) => (
                <CarouselItem
                  key={id}
                  className="basis-full pl-2 sm:basis-4/5 sm:pl-3 md:basis-3/5 lg:basis-1/2"
                >
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => removePhoto(id)}
                      className="absolute right-1 top-1 z-30 rounded-md border-2 px-2 py-0.5 text-xs font-semibold shadow-sm"
                      style={{
                        borderColor: P.sepia,
                        backgroundColor: "rgba(253, 252, 249, 0.95)",
                        color: P.fadedRed,
                        fontFamily: sansBody,
                      }}
                      aria-label="Remove photo"
                    >
                      Remove
                    </button>
                    <div
                      className={`group relative overflow-hidden rounded-md ${caption ? "cursor-default" : ""}`}
                      style={{
                        boxShadow:
                          "0 8px 24px rgba(20, 12, 8, 0.35), inset 0 0 0 2px rgba(255, 255, 255, 0.35)",
                      }}
                    >
                      <img
                        src={dataUrl}
                        alt={caption || "Your photo"}
                        title={caption || undefined}
                        className={`h-[clamp(130px,24vh,260px)] w-full object-cover transition-[filter] duration-200 ease-out ${
                          caption ? "group-hover:brightness-[0.45]" : ""
                        }`}
                        draggable={false}
                      />
                      {caption ? (
                        <div
                          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 px-3 transition-[background-color] duration-200 ease-out group-hover:bg-black/35"
                          aria-hidden
                        >
                          <p
                            className="max-h-full overflow-y-auto text-center text-sm leading-snug text-[#fdfcf9] opacity-0 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] transition-opacity duration-200 ease-out group-hover:opacity-100"
                            style={{ fontFamily: serifHeading }}
                          >
                            {caption}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious
              type="button"
              className="left-1 top-[42%] z-20 size-9 -translate-y-1/2 border-2 opacity-95 sm:left-2"
              style={{ borderColor: P.sepia, backgroundColor: "rgba(253, 252, 249, 0.92)", color: P.warmBrown }}
            />
            <CarouselNext
              type="button"
              className="right-1 top-[42%] z-20 size-9 -translate-y-1/2 border-2 opacity-95 sm:right-2"
              style={{ borderColor: P.sepia, backgroundColor: "rgba(253, 252, 249, 0.92)", color: P.warmBrown }}
            />
          </Carousel>
        )}
      </div>
    </div>
  );
}

type Props = { onClose: () => void };

export function RemindersPanel({ onClose }: Props) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDue, setManualDue] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(apiUrl("reminders"));
      const data = (await res.json()) as { reminders?: Reminder[]; error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText);
      setReminders(Array.isArray(data.reminders) ? data.reminders : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load reminders");
      setReminders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function addFromChat(e: FormEvent) {
    e.preventDefault();
    const text = chatText.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("reminders/from-chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText);
      setChatText("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save reminder");
    } finally {
      setChatBusy(false);
    }
  }

  async function addManual(e: FormEvent) {
    e.preventDefault();
    const title = manualTitle.trim();
    if (!title || manualBusy) return;
    setManualBusy(true);
    setErr(null);
    try {
      const dueAt = manualDue.trim() ? new Date(manualDue).toISOString() : undefined;
      if (manualDue.trim() && Number.isNaN(Date.parse(manualDue))) {
        throw new Error("Please use a valid date and time for \u201cDue\u201d.");
      }
      const res = await fetch(apiUrl("reminders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          dueAt: dueAt ?? null,
          source: "manual",
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText);
      setManualTitle("");
      setManualDue("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save reminder");
    } finally {
      setManualBusy(false);
    }
  }

  async function remove(id: string) {
    setErr(null);
    try {
      const res = await fetch(apiUrl(`reminders/${encodeURIComponent(id)}`), { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove reminder");
    }
  }

  const chatDisabled = chatBusy || !chatText.trim();
  const manualDisabled = manualBusy || !manualTitle.trim();

  return (
    <div
      className="fixed inset-0 z-[55] flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminders-heading"
    >
      {/* Outer shell has no transform; inner handles slide-in. Otherwise fixed/sub-layout breaks when the app scroll root moves. */}
      <div
        className="page-enter-right relative flex h-full min-h-0 w-full flex-col overflow-hidden"
        style={{
          backgroundColor: "#e8e0d4",
          backgroundImage: `
            radial-gradient(ellipse 120% 80% at 50% 20%, rgba(252, 248, 242, 0.95) 0%, transparent 55%),
            radial-gradient(ellipse 90% 60% at 80% 90%, rgba(200, 169, 126, 0.22) 0%, transparent 45%),
            linear-gradient(180deg, #efe8dd 0%, #e4dcd0 45%, #ddd4c8 100%)
          `,
        }}
      >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.5,
          mixBlendMode: "multiply",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.62' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='256' height='256' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.28,
          mixBlendMode: "soft-light",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.035' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='320' height='320' filter='url(%23g)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
        }}
      />
      <header
        className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-4 sm:px-8"
        style={{
          backgroundColor: "rgba(245, 239, 224, 0.92)",
          borderColor: P.sepia,
          fontFamily: sansBody,
          boxShadow: "0 2px 14px rgba(60, 42, 28, 0.08)",
        }}
      >
        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.2em] sm:text-xs"
            style={{ color: P.warmBrown, opacity: 0.85 }}
          >
            Daily reminders
          </p>
          <h1
            id="reminders-heading"
            className="mt-0 sm:text-[1.65rem]"
            style={{
              fontFamily: serifHeading,
              fontSize: "clamp(1.6rem, 4vw, 2rem)",
              color: P.warmBrown,
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            Your reminders
          </h1>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] rounded-xl border-2 px-5 text-base font-semibold transition"
          style={{
            borderColor: P.warmBrown,
            color: P.warmBrown,
            backgroundColor: "transparent",
            fontFamily: sansBody,
          }}
        >
          Back
        </button>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto scroll-pb-8 px-5 py-5 pb-8 sm:px-8 sm:py-6 sm:pb-10"
        style={{ fontFamily: sansBody }}
      >
        <p
          className="mx-auto mb-6 max-w-2xl text-center text-base leading-relaxed"
          style={{ color: P.warmBrown }}
        >
          Add reminders by typing below (Boomer figures out the time if you mention it). You can also say
          something like "remind me to call Sam tomorrow at three" while talking to Boomer, if voice tools are
          set up.
        </p>

        {err && (
          <div
            className="mb-6 rounded-xl border-2 px-4 py-3 text-base"
            style={{
              color: P.fadedRed,
              backgroundColor: "rgba(200, 100, 80, 0.15)",
              borderColor: "rgba(139, 58, 42, 0.4)",
            }}
            role="alert"
          >
            {err}
          </div>
        )}

        <div className="mx-auto grid max-w-3xl gap-8 lg:grid-cols-2">
          <section
            className="rounded-sm p-4 sm:p-5"
            style={{
              backgroundColor: "#f7f4ee",
              border: "1px solid rgba(200, 169, 126, 0.45)",
              boxShadow:
                "0 10px 28px rgba(40, 28, 18, 0.12), 0 2px 6px rgba(40, 28, 18, 0.08), inset 0 0 0 1px rgba(255,255,255,0.7)",
            }}
          >
            <h2
              className="mb-3"
              style={{
                fontFamily: serifHeading,
                fontSize: "clamp(1.1rem, 2.5vw, 1.25rem)",
                color: P.warmBrown,
                fontWeight: 600,
              }}
            >
              Chat-style reminder
            </h2>
            <form
              onSubmit={(e) => void addFromChat(e)}
              className="flex flex-col gap-3 rounded-sm p-4 sm:p-5"
              style={{
                backgroundColor: "rgba(250, 246, 238, 0.92)",
                border: `1px solid ${P.sepia}`,
                boxShadow: "inset 0 1px 12px rgba(255,255,255,0.5)",
              }}
            >
              <label htmlFor="reminder-chat" className="sr-only">
                Reminder in your own words
              </label>
              <textarea
                id="reminder-chat"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                rows={5}
                placeholder="e.g. Remind me to take my pills at 8pm, or call the dentist next Tuesday morning"
                className="w-full resize-y rounded-xl px-4 py-3 text-base outline-none"
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={chatDisabled}
                className="min-h-[48px] rounded-xl px-4 text-base font-semibold"
                style={{
                  ...primaryBtnStyle,
                  opacity: chatDisabled ? 0.5 : 1,
                  cursor: chatDisabled ? "not-allowed" : "pointer",
                }}
              >
                {chatBusy ? "Saving..." : "Add reminder"}
              </button>
            </form>
          </section>

          <section
            className="rounded-sm p-4 sm:p-5"
            style={{
              backgroundColor: "#f7f4ee",
              border: "1px solid rgba(200, 169, 126, 0.45)",
              boxShadow:
                "0 10px 28px rgba(40, 28, 18, 0.12), 0 2px 6px rgba(40, 28, 18, 0.08), inset 0 0 0 1px rgba(255,255,255,0.7)",
            }}
          >
            <h2
              className="mb-3"
              style={{
                fontFamily: serifHeading,
                fontSize: "clamp(1.1rem, 2.5vw, 1.25rem)",
                color: P.warmBrown,
                fontWeight: 600,
              }}
            >
              Quick add
            </h2>
            <form
              onSubmit={(e) => void addManual(e)}
              className="flex flex-col gap-3 rounded-sm p-4 sm:p-5"
              style={{
                backgroundColor: "rgba(250, 246, 238, 0.92)",
                border: `1px solid ${P.sepia}`,
                boxShadow: "inset 0 1px 12px rgba(255,255,255,0.5)",
              }}
            >
              <label htmlFor="reminder-title" className="text-sm font-medium" style={{ color: P.warmBrown }}>
                Title
              </label>
              <input
                id="reminder-title"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-base outline-none"
                style={inputStyle}
                placeholder="What to remember"
              />
              <label htmlFor="reminder-due" className="text-sm font-medium" style={{ color: P.warmBrown }}>
                Due (optional)
              </label>
              <input
                id="reminder-due"
                type="datetime-local"
                value={manualDue}
                onChange={(e) => setManualDue(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-base outline-none"
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={manualDisabled}
                className="min-h-[48px] rounded-xl px-4 text-base font-semibold"
                style={{
                  ...primaryBtnStyle,
                  opacity: manualDisabled ? 0.5 : 1,
                  cursor: manualDisabled ? "not-allowed" : "pointer",
                }}
              >
                {manualBusy ? "Saving..." : "Add"}
              </button>
            </form>
          </section>
        </div>

        <section className="mx-auto mt-10 max-w-4xl pb-4 sm:pb-6">
          <h2
            className="mb-6 text-center"
            style={{
              fontFamily: serifHeading,
              fontSize: "clamp(1.15rem, 2.8vw, 1.35rem)",
              color: P.warmBrown,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Your list
          </h2>
          {loading ? (
            <p style={{ color: P.warmBrown, opacity: 0.8 }}>Loading...</p>
          ) : reminders.length === 0 ? (
            <div
              className="mx-auto max-w-md border-2 border-dashed px-8 py-12 text-center text-base"
              style={{
                borderColor: P.sepia,
                fontFamily: serifHeading,
                fontStyle: "italic",
                color: P.warmBrown,
                backgroundColor: "rgba(253, 252, 249, 0.65)",
                boxShadow: "0 8px 22px rgba(40, 28, 18, 0.08)",
              }}
            >
              No reminders yet. Add one above or with your voice.
            </div>
          ) : (
            <ul
              className="flex flex-wrap justify-center gap-x-4 gap-y-2 pb-8"
              style={{ padding: 0, margin: 0, listStyle: "none" }}
            >
              {reminders.map((r, index) => (
                <ReminderCard key={r.id} reminder={r} index={index} onRemove={remove} />
              ))}
            </ul>
          )}
        </section>

        {/* End of page flow — scrolls with content, not pinned to the viewport */}
        <div className="-mx-5 mt-2 w-[calc(100%+2.5rem)] max-w-none sm:-mx-8 sm:mt-3 sm:w-[calc(100%+4rem)]">
          <FilmstripBottomBar />
        </div>
      </div>
      </div>
    </div>
  );
}
