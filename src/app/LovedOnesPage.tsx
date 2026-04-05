import React, { useState, useEffect, useRef, type MouseEvent, type ChangeEvent, type ReactNode } from "react";
import { apiUrl } from "../lib/apiUrl";
import { CameraModal } from "./CameraModal";

interface Person {
  id: string;
  name: string;
  relationship: string;
  customRelationship?: string;
  contactSite: string;
  contactURL?: string;
  picture: string | null;
  memories: string;
  parentIds: string[];
}

function normalizePerson(p: Record<string, unknown>): Person {
  const raw = p.parentIds;
  const parentIds = Array.isArray(raw)
    ? raw.map(String)
    : p.parentId != null && p.parentId !== ""
      ? [String(p.parentId)]
      : [];
  return { ...(p as unknown as Person), parentIds };
}

async function readJsonResponse(res: Response): Promise<
  | { ok: true; data: unknown }
  | { ok: false; error: string }
> {
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: "Server returned an invalid response." };
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status}).`;
    return { ok: false, error: msg };
  }
  return { ok: true, data };
}

interface Props { onBack: () => void; }

const RELATIONSHIPS = ["Child", "Grandchild", "Mom", "Dad", "Sibling", "Spouse", "Other"];
const YOU_ID = "you";
const NODE_R = 52;

/** Sunset tree — branches & accents readable on light gradient */
const BRANCH = "#9a5632";
const BRANCH_SPOUSE = "#c24157";
const SURFACE_TEXT = "#0f172a";
const SURFACE_MUTED = "#475569";
const LEAF_FILL = ["#0d9488", "#14b8a6", "#0f766e", "#2dd4bf"] as const;

const FONT_UI =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const GLASS_STRONG = "rgba(255,255,255,0.92)";
const GLASS_BORDER = "rgba(255,255,255,0.7)";
const INPUT_BG = "rgba(255,255,255,0.95)";

type Pt = { x: number; y: number };

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function branchGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bendKey: string,
): { d: string; p0: Pt; p1: Pt; p2: Pt; p3: Pt } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const p0: Pt = { x: x1 + ux * NODE_R, y: y1 + uy * NODE_R };
  const p3: Pt = { x: x2 - ux * NODE_R, y: y2 - uy * NODE_R };
  const h = simpleHash(bendKey);
  const sign = h % 2 === 0 ? 1 : -1;
  // Stronger perpendicular sweep → readable “branch” S-curves (not nearly straight chords).
  const perpMag = Math.min(len, 280) * (0.34 + (h % 5) * 0.04);
  const perp = perpMag * sign;
  const px = -uy * perp;
  const py = ux * perp;
  const lift = len * (0.22 * ((h % 23) / 23 - 0.45));
  const skew = len * 0.08 * (((h >> 3) % 7) / 3.5 - 1);
  const p1: Pt = {
    x: p0.x + (p3.x - p0.x) * 0.26 + px * 1.25 + ux * skew,
    y: p0.y + (p3.y - p0.y) * 0.26 + py * 1.25 + lift,
  };
  const p2: Pt = {
    x: p0.x + (p3.x - p0.x) * 0.74 + px * 0.72 - ux * skew * 0.6,
    y: p0.y + (p3.y - p0.y) * 0.74 + py * 0.72 - lift * 0.95,
  };
  const d = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`;
  return { d, p0, p1, p2, p3 };
}

function bezierPoint(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

function bezierTangent(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt {
  const u = 1 - t;
  return {
    x:
      3 * u * u * (p1.x - p0.x)
      + 6 * u * t * (p2.x - p1.x)
      + 3 * t * t * (p3.x - p2.x),
    y:
      3 * u * u * (p1.y - p0.y)
      + 6 * u * t * (p2.y - p1.y)
      + 3 * t * t * (p3.y - p2.y),
  };
}

/** Deciduous-style leaf in local coords: tip at top (negative Y), stem at bottom. */
function leafBladePath(s: number): string {
  const tip = -11.2 * s;
  const stem = 10 * s;
  return [
    `M 0 ${tip}`,
    `C ${-2.8 * s} ${tip + 2.8 * s} ${-9.5 * s} ${-1.5 * s} ${-10.2 * s} ${4.2 * s}`,
    `C ${-10.8 * s} ${8 * s} ${-4.2 * s} ${stem - 0.8 * s} 0 ${stem}`,
    `C ${4.2 * s} ${stem - 0.8 * s} ${10.8 * s} ${8 * s} ${10.2 * s} ${4.2 * s}`,
    `C ${9.5 * s} ${-1.5 * s} ${2.8 * s} ${tip + 2.8 * s} 0 ${tip}`,
    "Z",
  ].join(" ");
}

function LeafGlyph({
  fill,
  stroke,
  scale,
  flip,
}: {
  fill: string;
  stroke: string;
  scale: number;
  flip: boolean;
}) {
  const s = scale;
  const tip = -11.2 * s;
  const stem = 10 * s;
  const midrib = `M 0 ${tip + 1.2 * s} Q ${0.35 * s} ${(tip + stem) / 2} 0 ${stem - 0.5 * s}`;
  const veinsL = [
    `M ${-0.8 * s} ${-5 * s} L ${-5.5 * s} ${-1 * s}`,
    `M ${-0.6 * s} ${0.5 * s} L ${-6.2 * s} ${3.5 * s}`,
    `M ${-0.4 * s} ${5 * s} L ${-5 * s} ${7.8 * s}`,
  ];
  const veinsR = [
    `M ${0.8 * s} ${-5 * s} L ${5.5 * s} ${-1 * s}`,
    `M ${0.6 * s} ${0.5 * s} L ${6.2 * s} ${3.5 * s}`,
    `M ${0.4 * s} ${5 * s} L ${5 * s} ${7.8 * s}`,
  ];

  return (
    <g transform={flip ? "scale(-1,1)" : undefined}>
      <path
        d={leafBladePath(s)}
        fill={fill}
        fillOpacity={0.94}
        stroke={stroke}
        strokeWidth={Math.max(0.55, 0.7 * s)}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d={midrib} fill="none" stroke={stroke} strokeWidth={Math.max(0.4, 0.5 * s)} strokeLinecap="round" opacity={0.72} />
      {veinsL.map((d, i) => (
        <path key={`vl-${i}`} d={d} fill="none" stroke={stroke} strokeWidth={Math.max(0.3, 0.38 * s)} strokeLinecap="round" opacity={0.48} />
      ))}
      {veinsR.map((d, i) => (
        <path key={`vr-${i}`} d={d} fill="none" stroke={stroke} strokeWidth={Math.max(0.3, 0.38 * s)} strokeLinecap="round" opacity={0.48} />
      ))}
    </g>
  );
}

const PETIOLE_STROKE = "#78716c";

function leavesAlongBranch(p0: Pt, p1: Pt, p2: Pt, p3: Pt, key: string): ReactNode {
  const slots = [0.14, 0.34, 0.52, 0.68, 0.86];
  return slots.map((t, i) => {
    const A = bezierPoint(t, p0, p1, p2, p3);
    const tan = bezierTangent(t, p0, p1, p2, p3);
    const tlen = Math.hypot(tan.x, tan.y) || 1;
    const tx = tan.x / tlen;
    const ty = tan.y / tlen;
    const lx = -ty;
    const ly = tx;
    const side = simpleHash(`${key}-side-${i}`) % 2 === 0 ? 1 : -1;
    const Nx = lx * side;
    const Ny = ly * side;

    const fill = LEAF_FILL[(simpleHash(key) + i) % LEAF_FILL.length];
    const stroke = i % 2 === 0 ? "#0f766e" : "#115e59";
    const scale = 0.78 + ((simpleHash(`${key}z${i}`) % 28) / 100);
    const flip = (simpleHash(`${key}f${i}`) % 2) === 1;
    const petioleLen = 11 + (simpleHash(`${key}p${i}`) % 8);
    const B = { x: A.x + Nx * petioleLen, y: A.y + Ny * petioleLen };

    // Leaf tip points along N; stem meets petiole end at B (see translate(0, -10*scale) below).
    const angDeg = (Math.atan2(Nx, -Ny) * 180) / Math.PI;
    const stemOffset = 10 * scale;

    return (
      <g key={`${key}-leaf-${i}`}>
        <line
          x1={A.x}
          y1={A.y}
          x2={B.x}
          y2={B.y}
          stroke={PETIOLE_STROKE}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.92}
        />
        <g transform={`translate(${B.x},${B.y}) rotate(${angDeg}) translate(0, ${-stemOffset})`} filter="url(#lovedOnesLeafFilm)">
          <LeafGlyph fill={fill} stroke={stroke} scale={scale} flip={flip} />
        </g>
      </g>
    );
  });
}

const GEN: Record<string, number> = {
  "Grandchild": 2, "Child": 1, "Sibling": 0, "Spouse": 0, "Dad": -1, "Mom": -1, "Other": 0,
  "Son": 1, "Daughter": 1, "Grandson": 2, "Granddaughter": 2,
  "Father": -1, "Mother": -1, "Brother": 0, "Sister": 0,
  "Spouse / Partner": 0, "Friend": 0, "Carer": 0,
  "Grandfather": -2, "Grandmother": -2, "Grandma": -2, "Grandpa": -2,
};

function autoLayout(people: Person[], w: number, h: number): Map<string, { x: number; y: number }> {
  const byGen = new Map<number, string[]>();
  byGen.set(0, [YOU_ID]);
  for (const p of people) {
    const gen = GEN[p.relationship] ?? 0;
    if (!byGen.has(gen)) byGen.set(gen, []);
    byGen.get(gen)!.push(p.id);
  }
  const gens = [...byGen.keys()].sort((a, b) => a - b);
  const positions = new Map<string, { x: number; y: number }>();
  const genGap = h / (gens.length + 1);
  gens.forEach((gen, gi) => {
    const ids = byGen.get(gen)!;
    const y = genGap * (gi + 1);
    const xGap = w / (ids.length + 1);
    ids.forEach((id, xi) => positions.set(id, { x: xGap * (xi + 1), y }));
  });
  return positions;
}

const EMPTY = {
  name: "", relationship: RELATIONSHIPS[0], customRelationship: "",
  contactSite: "", contactURL: "",
  picture: null as string | null, memories: "", parentIds: [] as string[],
};

function personToForm(p: Person) {
  const inList = RELATIONSHIPS.includes(p.relationship);
  return {
    name: p.name,
    relationship: inList ? p.relationship : "Other",
    customRelationship: inList ? (p.customRelationship ?? "") : (p.customRelationship || p.relationship || ""),
    contactSite: p.contactSite,
    contactURL: p.contactURL ?? "",
    picture: p.picture,
    memories: p.memories,
    parentIds: p.parentIds,
  };
}

function PencilButton({ onClick, label, compact }: { onClick: () => void; label: string; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        background: compact ? GLASS_STRONG : "rgba(255,255,255,0.55)",
        border: `1px solid ${GLASS_BORDER}`,
        borderRadius: compact ? "999px" : "12px",
        padding: compact ? "8px" : "8px 12px",
        cursor: "pointer",
        color: SURFACE_TEXT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 0,
        boxShadow: "0 4px 14px rgba(15,23,42,0.08)",
        ...(compact
          ? {
              width: "36px",
              height: "36px",
              padding: 0,
            }
          : {}),
      }}
    >
      <svg width={compact ? 15 : 18} height={compact ? 15 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  );
}

export function LovedOnesPage({ onBack }: Props) {
  const [people, setPeople] = useState<Person[]>([]);
  const [youParentIds, setYouParentIds] = useState<string[]>([]);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [showForm, setShowForm] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ mx: 0, my: 0, nx: 0, ny: 0 });
  const [dims, setDims] = useState({ w: 900, h: 650 });

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      setDims({ w: containerRef.current.offsetWidth, h: containerRef.current.offsetHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const delays = [0, 300, 600, 1200, 2000, 3500];
      for (const ms of delays) {
        if (ms) await new Promise(r => setTimeout(r, ms));
        if (cancelled) return;
        try {
          const r = await fetch(apiUrl("loved-ones"));
          if (!r.ok) continue;
          const d = await r.json();
          const loaded: Person[] = (d.people ?? []).map((p: Record<string, unknown>) => normalizePerson(p));
          if (cancelled) return;
          setPeople(loaded);
          setYouParentIds(
            loaded.filter(p => p.relationship === "Mom" || p.relationship === "Dad").map(p => p.id),
          );
          return;
        } catch {
          /* retry */
        }
      }
      if (!cancelled) setPeople([]);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (dims.w > 0 && dims.h > 0) setPositions(autoLayout(people, dims.w, dims.h));
  }, [people, dims]);

  function startDrag(id: string, e: MouseEvent) {
    e.preventDefault();
    setDragging(id);
    setSelected(null);
    const pos = positions.get(id)!;
    dragStart.current = { mx: e.clientX, my: e.clientY, nx: pos.x, ny: pos.y };
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return;
    setPositions(prev => new Map(prev).set(dragging, {
      x: dragStart.current.nx + e.clientX - dragStart.current.mx,
      y: dragStart.current.ny + e.clientY - dragStart.current.my,
    }));
  }

  function onMouseUp(e: MouseEvent) {
    if (!dragging) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let droppedOn: string | null = null;
    for (const [id, pos] of positions) {
      if (id === dragging) continue;
      const dx = mx - pos.x, dy = my - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < NODE_R * 1.5) { droppedOn = id; break; }
    }
    if (droppedOn) {
      if (dragging === YOU_ID) {
        setYouParentIds(prev => prev.includes(droppedOn!) ? prev : [...prev, droppedOn!]);
      } else {
        addParent(dragging, droppedOn);
      }
    }
    setDragging(null);
  }

  async function addParent(childId: string, newParentId: string) {
    const updated = people.map(p => {
      if (p.id !== childId) return p;
      const ids = p.parentIds.includes(newParentId) ? p.parentIds : [...p.parentIds, newParentId];
      return { ...p, parentIds: ids };
    });
    setPeople(updated);
    const person = updated.find(p => p.id === childId)!;
    await fetch(apiUrl(`loved-ones/${childId}`), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentIds: person.parentIds }),
    });
  }

  async function save() {
    setSaveError(null);
    const rel = form.relationship;
    try {
      if (editingId) {
        const existing = people.find(p => String(p.id) === String(editingId));
        if (!existing) {
          setSaveError("Could not find that person to update.");
          return;
        }
        const wasParent = existing.relationship === "Mom" || existing.relationship === "Dad";
        const isParent = rel === "Mom" || rel === "Dad";
        const parentIds = Array.isArray(existing.parentIds) ? existing.parentIds : [];
        const res = await fetch(apiUrl(`loved-ones/${encodeURIComponent(editingId)}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            relationship: form.relationship,
            customRelationship: form.customRelationship || undefined,
            contactSite: form.contactSite,
            contactURL: form.contactURL || undefined,
            picture: form.picture,
            memories: form.memories,
            parentIds,
          }),
        });
        const parsed = await readJsonResponse(res);
        if (!parsed.ok) {
          setSaveError(parsed.error);
          return;
        }
        const person = normalizePerson(parsed.data as Record<string, unknown>);
        setYouParentIds(prev => {
          if (wasParent && !isParent) return prev.filter(id => String(id) !== String(editingId));
          if (!wasParent && isParent) {
            return prev.some(id => String(id) === String(editingId)) ? prev : [...prev, editingId];
          }
          return prev;
        });
        setPeople(p => p.map(x => (String(x.id) === String(editingId) ? person : x)));
        setForm({ ...EMPTY });
        setEditingId(null);
        setShowForm(false);
        return;
      }
      const parentIds = (rel === "Child" || rel === "Grandchild") ? [YOU_ID] : [];
      const res = await fetch(apiUrl("loved-ones"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, parentIds }),
      });
      const parsed = await readJsonResponse(res);
      if (!parsed.ok) {
        setSaveError(parsed.error);
        return;
      }
      const person = normalizePerson(parsed.data as Record<string, unknown>);
      if (rel === "Mom" || rel === "Dad") setYouParentIds(prev => [...prev, person.id]);
      setPeople(p => [...p, person]);
      setForm({ ...EMPTY });
      setShowForm(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Network error — is the voice server running on port 3001?");
    }
  }

  async function remove(id: string) {
    setPeople(people.filter(p => p.id !== id).map(p => ({
      ...p, parentIds: p.parentIds.filter(pid => pid !== id)
    })));
    setYouParentIds(prev => prev.filter(pid => pid !== id));
    setSelected(null);
    await fetch(apiUrl(`loved-ones/${id}`), { method: "DELETE" });
  }

  function handlePicture(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(f => ({ ...f, picture: reader.result as string }));
    reader.readAsDataURL(file);
  }

  type Edge = { x1: number; y1: number; x2: number; y2: number; key: string; isSpouse: boolean };
  const edges: Edge[] = [];
  const gp = (id: string) => positions.get(id);

  for (const parentId of youParentIds) {
    const from = gp(parentId), to = gp(YOU_ID);
    if (from && to) edges.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, key: `you-p-${parentId}`, isSpouse: false });
  }
  for (const p of people) {
    for (const pid of p.parentIds) {
      const from = gp(pid), to = gp(p.id);
      if (from && to) edges.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, key: `e-${p.id}-${pid}`, isSpouse: false });
    }
    if (p.relationship === "Spouse" || p.relationship === "Spouse / Partner") {
      const a = gp(p.id), b = gp(YOU_ID);
      if (a && b) edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, key: `sp-${p.id}`, isSpouse: true });
    }
    if (["Sibling","Brother","Sister"].includes(p.relationship)) {
      const a = gp(p.id), b = gp(YOU_ID);
      if (a && b) edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, key: `sib-${p.id}`, isSpouse: false });
    }
  }

  const selectedPerson = selected ? people.find(p => p.id === selected) ?? null : null;

  return (
    <div
      className="relative flex size-full flex-col overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #9ec9ea 0%, #c9dff5 14%, #eef4fb 32%, #faf0e0 54%, #fcd9b8 76%, #f29b72 92%, #e06b52 100%)",
        fontFamily: FONT_UI,
      }}
    >
      {/* Film grain on sunset — coarse + fine layers */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-multiply"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.62' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.1] mix-blend-soft-light"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='2.1' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)'/%3E%3C/svg%3E")`,
        }}
      />

      <div
        className="relative z-20 shrink-0 border-b px-5 py-3.5 backdrop-blur-md sm:px-8"
        style={{
          borderColor: "rgba(255,255,255,0.45)",
          background: "rgba(255,255,255,0.35)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.6) inset",
        }}
      >
        <p
          className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] sm:text-xs"
          style={{ color: SURFACE_MUTED }}
        >
          Your circle · people who matter
        </p>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-4 pb-3 pt-3 sm:px-6">
        <div className="mb-3 flex flex-wrap items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full px-1 py-1 text-[0.9375rem] font-semibold transition hover:bg-white/40"
            style={{
              background: "transparent",
              border: "none",
              color: SURFACE_TEXT,
              cursor: "pointer",
              fontFamily: FONT_UI,
            }}
          >
            ← Back
          </button>
          <span className="text-xs leading-snug sm:text-[0.8125rem]" style={{ color: SURFACE_MUTED }}>
            Older generations toward the top · drag nodes · drop on family to link a parent
          </span>
        </div>

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-hidden rounded-2xl backdrop-blur-md sm:rounded-3xl"
          style={{
            cursor: dragging ? "grabbing" : "default",
            border: `1px solid ${GLASS_BORDER}`,
            boxShadow: "0 8px 32px rgba(15,23,42,0.08), inset 0 0 0 1px rgba(255,255,255,0.5)",
            background:
              "linear-gradient(145deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.22) 50%, rgba(255,255,255,0.35) 100%)",
          }}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <svg className="absolute inset-0 size-full pointer-events-none" style={{ zIndex: 1 }} aria-hidden>
            <defs>
              <filter id="branchGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {/* Blur + masked grain (grain clipped to leaf alpha — avoids full-filter-region “boxes”) */}
              <filter id="lovedOnesLeafFilm" x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="dispNoise" />
                <feGaussianBlur in="SourceGraphic" stdDeviation="0.95" result="blur" />
                <feDisplacementMap in="blur" in2="dispNoise" scale="0.45" xChannelSelector="R" yChannelSelector="G" result="body" />
                <feTurbulence type="fractalNoise" baseFrequency="1.35" numOctaves="1" stitchTiles="stitch" result="fineNoise" />
                <feColorMatrix
                  in="fineNoise"
                  type="matrix"
                  values="0 0 0 0 0.52
                          0 0 0 0 0.5
                          0 0 0 0 0.46
                          0 0 0 0.16 0"
                  result="grainFull"
                />
                <feComposite in="grainFull" in2="body" operator="in" result="grainOnLeaf" />
                <feBlend in="body" in2="grainOnLeaf" mode="soft-light" result="out" />
              </filter>
            </defs>
            {edges.map(e => {
              const { d, p0, p1, p2, p3 } = branchGeometry(e.x1, e.y1, e.x2, e.y2, e.key);
              const stroke = e.isSpouse ? BRANCH_SPOUSE : BRANCH;
              const mid = bezierPoint(0.5, p0, p1, p2, p3);
              return (
                <g key={e.key}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={e.isSpouse ? 3.2 : 4.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.88}
                    filter="url(#branchGlow)"
                  />
                  {leavesAlongBranch(p0, p1, p2, p3, e.key)}
                  {e.isSpouse && (
                    <text
                      x={mid.x}
                      y={mid.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#be123c"
                      fontSize={14}
                      opacity={0.92}
                      style={{ fontFamily: FONT_UI }}
                    >
                      ♥
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {gp(YOU_ID) && (() => {
            const pos = gp(YOU_ID)!;
            return (
              <>
                <div
                  onMouseDown={e => startDrag(YOU_ID, e)}
                  style={{
                    position: "absolute",
                    left: pos.x - NODE_R,
                    top: pos.y - NODE_R,
                    width: NODE_R * 2,
                    height: NODE_R * 2,
                    borderRadius: "50%",
                    background: "linear-gradient(145deg, #1e293b 0%, #334155 45%, #0f172a 100%)",
                    border: "3px solid rgba(255,255,255,0.95)",
                    outline: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "grab",
                    zIndex: dragging === YOU_ID ? 30 : 10,
                    opacity: dragging === YOU_ID ? 0.75 : 1,
                    boxShadow:
                      "0 4px 24px rgba(15,23,42,0.25), 0 0 0 4px rgba(224,107,82,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
                    userSelect: "none",
                  }}
                >
                  <span
                    style={{
                      color: "#f8fafc",
                      fontWeight: 700,
                      fontSize: "0.875rem",
                      pointerEvents: "none",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    you
                  </span>
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: pos.x,
                    top: pos.y + NODE_R + 10,
                    transform: "translateX(-50%)",
                    textAlign: "center",
                    zIndex: 10,
                    pointerEvents: "none",
                    minWidth: "100px",
                  }}
                >
                  <div
                    style={{
                      background: GLASS_STRONG,
                      border: `1px solid ${GLASS_BORDER}`,
                      borderRadius: "999px",
                      boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
                      padding: "5px 14px 6px",
                    }}
                  >
                    <p style={{ fontSize: "0.7rem", fontWeight: 600, color: SURFACE_TEXT, margin: 0, letterSpacing: "0.06em" }}>
                      You
                    </p>
                  </div>
                </div>
              </>
            );
          })()}

          {people.map(p => {
            const pos = gp(p.id);
            if (!pos) return null;
            const isSelected = selected === p.id;
            const isDragging = dragging === p.id;
            const label = p.relationship === "Other" ? (p.customRelationship || "Other") : p.relationship;
            return (
              <div key={p.id}>
                <div
                  style={{
                    position: "absolute",
                    left: pos.x - NODE_R,
                    top: pos.y - NODE_R,
                    width: NODE_R * 2,
                    height: NODE_R * 2,
                    zIndex: dragging === p.id ? 30 : 11,
                  }}
                >
                  <div
                    onMouseDown={e => startDrag(p.id, e)}
                    onClick={() => !isDragging && setSelected(isSelected ? null : p.id)}
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      border: isSelected ? "3px solid #e06b52" : `3px solid ${GLASS_BORDER}`,
                      outline: "none",
                      backgroundColor: "rgba(255,255,255,0.65)",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "grab",
                      opacity: isDragging ? 0.55 : 1,
                      boxShadow: isSelected
                        ? "0 0 0 3px rgba(224,107,82,0.45), 0 10px 28px rgba(15,23,42,0.15)"
                        : "0 6px 20px rgba(15,23,42,0.12)",
                      userSelect: "none",
                    }}
                  >
                    {p.picture
                      ? (
                        <img
                          src={p.picture}
                          alt={p.name}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            pointerEvents: "none",
                          }}
                        />
                      )
                      : (
                        <span style={{ fontSize: "1.25rem", pointerEvents: "none", color: SURFACE_MUTED, opacity: 0.5 }}>
                          +
                        </span>
                      )}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      top: "-6px",
                      right: "-6px",
                      zIndex: 25,
                    }}
                  >
                    <PencilButton
                      compact
                      label={`Edit ${p.name}`}
                      onClick={() => {
                        setSaveError(null);
                        setForm(personToForm(p));
                        setEditingId(p.id);
                        setSelected(p.id);
                        setShowForm(true);
                      }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: pos.x,
                    top: pos.y + NODE_R + 10,
                    transform: "translateX(-50%)",
                    textAlign: "center",
                    zIndex: 10,
                    pointerEvents: "none",
                    minWidth: "120px",
                  }}
                >
                  <div
                    style={{
                      background: GLASS_STRONG,
                      border: `1px solid ${GLASS_BORDER}`,
                      borderRadius: "14px",
                      boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
                      padding: "6px 12px 7px",
                    }}
                  >
                    <p style={{ fontSize: "0.8rem", fontWeight: 600, color: SURFACE_TEXT, whiteSpace: "nowrap", margin: 0, letterSpacing: "0.02em" }}>
                      {p.name}
                    </p>
                    <p style={{ fontSize: "0.7rem", color: SURFACE_MUTED, whiteSpace: "nowrap", margin: 0, marginTop: "2px" }}>
                      {label}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="pointer-events-none relative z-20 shrink-0 border-t py-2 backdrop-blur-sm"
        style={{
          borderColor: "rgba(255,255,255,0.35)",
          background: "rgba(255,255,255,0.2)",
        }}
      >
        <p className="text-center text-[10px] font-medium tracking-wide sm:text-[11px]" style={{ color: SURFACE_MUTED }}>
          Tap someone to see how you reach them
        </p>
      </div>

      {selectedPerson && (
        <div
          style={{
            position: "absolute",
            bottom: "6rem",
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(400px, 92vw)",
            background: GLASS_STRONG,
            border: `1px solid ${GLASS_BORDER}`,
            borderRadius: "20px",
            padding: "1.35rem 1.5rem",
            boxShadow: "0 20px 50px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
            zIndex: 20,
            fontFamily: FONT_UI,
            pointerEvents: "auto",
            backdropFilter: "blur(12px)",
          }}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "1.25rem", fontWeight: 700, color: SURFACE_TEXT }}>{selectedPerson.name}</p>
              <p style={{ fontSize: "0.9rem", color: SURFACE_MUTED }}>
                {selectedPerson.relationship === "Other" ? selectedPerson.customRelationship : selectedPerson.relationship}
              </p>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              <PencilButton
                label="Edit profile"
                onClick={() => {
                  setSaveError(null);
                  setForm(personToForm(selectedPerson));
                  setEditingId(selectedPerson.id);
                  setShowForm(true);
                }}
              />
              <button
                type="button"
                aria-label="Remove from tree"
                onMouseDown={e => e.stopPropagation()}
                onClick={() => remove(selectedPerson.id)}
                style={{
                  background: "rgba(224,107,82,0.12)",
                  border: "none",
                  borderRadius: "10px",
                  color: "#c2410c",
                  fontSize: "1.35rem",
                  cursor: "pointer",
                  padding: "4px 10px",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          </div>
          {selectedPerson.contactSite && (
            <p style={{ fontSize: "0.9rem", color: "#0369a1", marginBottom: "6px" }}>via {selectedPerson.contactSite}</p>
          )}
          {selectedPerson.contactURL && (
            <p style={{ fontSize: "0.85rem", marginBottom: "6px", wordBreak: "break-all" }}>
              <a href={selectedPerson.contactURL} target="_blank" rel="noopener noreferrer" style={{ color: "#0369a1", fontWeight: 500 }}>
                {selectedPerson.contactURL}
              </a>
            </p>
          )}
          {selectedPerson.memories && (
            <p style={{ fontSize: "0.9rem", color: SURFACE_MUTED, fontStyle: "italic", lineHeight: 1.5 }}>
              &ldquo;{selectedPerson.memories}&rdquo;
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setSaveError(null);
          setEditingId(null);
          setForm({ ...EMPTY });
          setShowForm(true);
        }}
        style={{
          position: "absolute",
          bottom: "2rem",
          right: "2rem",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "linear-gradient(145deg, #fb923c 0%, #e06b52 45%, #c2410c 100%)",
          border: "2px solid rgba(255,255,255,0.9)",
          color: "#fffefb",
          fontSize: "1.75rem",
          fontWeight: 300,
          cursor: "pointer",
          boxShadow: "0 10px 30px rgba(224,107,82,0.45)",
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT_UI,
        }}
      >
        +
      </button>
      {showForm && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(15,23,42,0.35)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowForm(false)}
        >
          <div
            role="dialog"
            aria-labelledby="add-loved-title"
            onClick={e => e.stopPropagation()}
            style={{
              background: GLASS_STRONG,
              border: `1px solid ${GLASS_BORDER}`,
              borderRadius: "24px",
              padding: "1.75rem",
              width: "440px",
              maxWidth: "92vw",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              boxShadow: "0 24px 60px rgba(15,23,42,0.18)",
              fontFamily: FONT_UI,
            }}
          >
            <h2 id="add-loved-title" style={{ fontSize: "1.35rem", fontWeight: 700, color: SURFACE_TEXT, margin: 0 }}>
              {editingId ? "Edit profile" : "Add someone"}
            </h2>
            <div className="flex items-center gap-4" style={{ position: "relative" }}>
              {showPhotoOptions && (
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 40 }}
                    onClick={() => setShowPhotoOptions(false)}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "80px",
                      left: 0,
                      background: "rgba(255,255,255,0.97)",
                      border: `1px solid ${GLASS_BORDER}`,
                      borderRadius: "14px",
                      boxShadow: "0 8px 24px rgba(15,23,42,0.14)",
                      padding: "8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      minWidth: "140px",
                      zIndex: 41,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => { fileRef.current?.click(); setShowPhotoOptions(false); }}
                      style={{
                        background: "none",
                        border: "none",
                        borderRadius: "8px",
                        padding: "8px 12px",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: "0.875rem",
                        color: SURFACE_TEXT,
                        fontFamily: FONT_UI,
                      }}
                    >
                      Upload photo
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowCamera(true); setShowPhotoOptions(false); }}
                      style={{
                        background: "none",
                        border: "none",
                        borderRadius: "8px",
                        padding: "8px 12px",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: "0.875rem",
                        color: SURFACE_TEXT,
                        fontFamily: FONT_UI,
                      }}
                    >
                      Take photo
                    </button>
                  </div>
                </>
              )}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setShowPhotoOptions(true)}
                onKeyDown={e => (e.key === "Enter" || e.key === " ") && setShowPhotoOptions(true)}
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "50%",
                  border: "2px dashed rgba(224,107,82,0.55)",
                  overflow: "hidden",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.6)",
                  flexShrink: 0,
                }}
              >
                {form.picture
                  ? <img src={form.picture} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: "1.5rem", color: SURFACE_MUTED, opacity: 0.45 }}>+</span>}
              </div>
              <span style={{ fontSize: "0.875rem", color: SURFACE_MUTED }}>Tap to add photo</span>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePicture} />
            </div>
            <input
              placeholder="Name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              style={{
                padding: "0.85rem 1rem",
                borderRadius: "12px",
                border: `1px solid ${GLASS_BORDER}`,
                backgroundColor: INPUT_BG,
                fontSize: "1rem",
                color: SURFACE_TEXT,
                outline: "none",
                fontFamily: FONT_UI,
              }}
            />
            <select
              value={form.relationship}
              onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))}
              style={{
                padding: "0.85rem 1rem",
                borderRadius: "12px",
                border: `1px solid ${GLASS_BORDER}`,
                backgroundColor: INPUT_BG,
                fontSize: "1rem",
                color: SURFACE_TEXT,
                outline: "none",
                cursor: "pointer",
                fontFamily: FONT_UI,
              }}
            >
              {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {form.relationship === "Other" && (
              <input
                placeholder="specify relationship"
                value={form.customRelationship ?? ""}
                onChange={e => setForm(f => ({ ...f, customRelationship: e.target.value }))}
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "12px",
                  border: `1px solid ${GLASS_BORDER}`,
                  backgroundColor: INPUT_BG,
                  fontSize: "1rem",
                  color: SURFACE_TEXT,
                  outline: "none",
                  fontFamily: FONT_UI,
                }}
              />
            )}
            <input
              placeholder="Contact through (e.g. WhatsApp)"
              value={form.contactSite}
              onChange={e => setForm(f => ({ ...f, contactSite: e.target.value }))}
              style={{
                padding: "0.85rem 1rem",
                borderRadius: "12px",
                border: `1px solid ${GLASS_BORDER}`,
                backgroundColor: INPUT_BG,
                fontSize: "1rem",
                color: SURFACE_TEXT,
                outline: "none",
                fontFamily: FONT_UI,
              }}
            />
            <input
              placeholder="Link (e.g. https://meet.google.com/…)"
              value={form.contactURL ?? ""}
              onChange={e => setForm(f => ({ ...f, contactURL: e.target.value }))}
              style={{
                padding: "0.85rem 1rem",
                borderRadius: "12px",
                border: `1px solid ${GLASS_BORDER}`,
                backgroundColor: INPUT_BG,
                fontSize: "1rem",
                color: SURFACE_TEXT,
                outline: "none",
                fontFamily: FONT_UI,
              }}
            />
            <textarea
              placeholder="Memories (optional)"
              value={form.memories}
              onChange={e => setForm(f => ({ ...f, memories: e.target.value }))}
              rows={3}
              style={{
                padding: "0.85rem 1rem",
                borderRadius: "12px",
                border: `1px solid ${GLASS_BORDER}`,
                backgroundColor: INPUT_BG,
                fontSize: "1rem",
                color: SURFACE_TEXT,
                outline: "none",
                resize: "none",
                fontFamily: FONT_UI,
              }}
            />
            {saveError && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  fontSize: "0.9rem",
                  color: "#fca5a5",
                  lineHeight: 1.4,
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {saveError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setForm({ ...EMPTY });
                  setSaveError(null);
                }}
                style={{
                  flex: 1,
                  padding: "0.85rem",
                  borderRadius: "12px",
                  border: `1px solid ${GLASS_BORDER}`,
                  backgroundColor: "rgba(255,255,255,0.5)",
                  color: SURFACE_TEXT,
                  fontSize: "1rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT_UI,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!form.name}
                style={{
                  flex: 1,
                  padding: "0.85rem",
                  borderRadius: "12px",
                  background: "linear-gradient(145deg, #fb923c 0%, #e06b52 55%, #c2410c 100%)",
                  border: "1px solid rgba(255,255,255,0.5)",
                  color: "#fffefb",
                  fontSize: "1rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: form.name ? 1 : 0.5,
                  fontFamily: FONT_UI,
                }}
              >
                {editingId ? "Save changes" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCamera && (
        <CameraModal
          onCapture={(dataUrl) => { setForm(f => ({ ...f, picture: dataUrl })); setShowCamera(false); }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}


