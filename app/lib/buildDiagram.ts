/**
 * Build-diagram layout — TypeScript port of the JARVIS-system
 * `_build_diagram.py` layout (pure math, no drawing).
 *
 * Same principle as the original: the model only DESCRIBES the build — parts,
 * the pins as printed on them, and which pin goes to which. This layout turns
 * that description into geometry; nothing on the picture is invented here.
 *
 * Plan shape (what the model supplies):
 *   {
 *     title: string,
 *     components: [{ id, name, detail?, pins: [{ id, label }] }],
 *     connections: [{ a: [componentId, pinId], b: [componentId, pinId],
 *                     kind?: 'power'|'ground'|'signal'|'data'|'analog'|'mechanical'|'other',
 *                     n?: number }],
 *     legend?: Record<kind, word>   // optional words in the user's language
 *   }
 *
 * Layout rules (unchanged from the original):
 *   The part with the most connections sits in the middle. Everything else
 *   stacks in a column either side, balanced by wire count. Pins face the
 *   wire they carry:
 *     side ↔ centre   straight across when their rows line up, otherwise
 *                     down a lane in the gap
 *     side ↔ same side  out along the outer edge
 *     left ↔ right      down a channel under everything
 *     part ↔ itself     a short loop on its free edge
 */

export const MARGIN = 36;
export const TITLE_H = 56;
export const HEADER = 48;
export const ROW = 30;
export const BOX_PAD = 12;
export const VGAP = 34;
export const LANE = 13;
export const GAP_MIN = 110;
export const BOX_MIN_W = 150;
export const BOX_MAX_W = 320;
export const BADGE_R = 10;
export const LEGEND_H = 44;

export const COLORS = {
  bg: '#0a0f14',
  grid: '#101922',
  boxFill: '#111b24',
  boxEdge: '#2a3a48',
  text: '#eaf2f7',
  textDim: '#8ba3b5',
  pinText: '#d4e1ea',
  power: '#ff4d4d',
  ground: '#a7b1b8',
  mechanical: '#c9b38f',
  signals: ['#ffd23f', '#3fd0ff', '#7dff6a', '#ff9f40', '#c58bff', '#ff6ad5', '#40ffc8', '#f5f57a', '#8fb4ff'],
};

export const KINDS = ['power', 'ground', 'signal', 'data', 'analog', 'mechanical', 'other'] as const;
export type WireKind = (typeof KINDS)[number];
const SIGNAL_KINDS: string[] = ['signal', 'data', 'analog', 'other'];

export function kindColor(kind: string, index: number): string {
  if (kind === 'power') return COLORS.power;
  if (kind === 'ground') return COLORS.ground;
  if (kind === 'mechanical') return COLORS.mechanical;
  return COLORS.signals[index % COLORS.signals.length];
}

export interface DiagramPlan {
  title?: string;
  components?: { id: string; name?: string; detail?: string; pins?: { id: string; label?: string }[] }[];
  connections?: { a: [string, string]; b: [string, string]; kind?: string; n?: number }[];
  legend?: Record<string, string>;
  steps?: string[];
}

type Side = 'L' | 'R' | 'C';
type End = [string, string, Side]; // [componentId, pinId, side]
type Route = { w: PlanConn; a: End; b: End; kind: 'direct' | 'outer' | 'bottom' | 'loop' };
type PlanConn = NonNullable<DiagramPlan['connections']>[number];

export interface Geometry {
  empty: boolean;
  canvasW: number;
  canvasH: number;
  boxes: Record<string, { x: number; y: number; w: number; h: number }>;
  pinY: Record<string, number>;          // `${cid}|${pid}|${side}` -> y
  wires: { id: string; n: number; kind: string; color: string; pts: { x: number; y: number }[] }[];
  legendY: number;
}

export function layout(plan: DiagramPlan, measure: (text: string, role: string) => number): Geometry {
  const comps = (plan.components ?? []).filter((c) => c && c.id);
  const byId = new Map(comps.map((c) => [c.id, c]));
  const conns = (plan.connections ?? []).filter(
    (w) => w && Array.isArray(w.a) && Array.isArray(w.b) && byId.has(w.a[0]) && byId.has(w.b[0])
  );

  const emptyGeo: Geometry = { empty: true, canvasW: 0, canvasH: 0, boxes: {}, pinY: {}, wires: [], legendY: 0 };

  // Only parts that carry a wire are drawn.
  const degree = new Map<string, number>();
  for (const w of conns) {
    degree.set(w.a[0], (degree.get(w.a[0]) ?? 0) + 1);
    if (w.b[0] !== w.a[0]) degree.set(w.b[0], (degree.get(w.b[0]) ?? 0) + 1);
  }
  const drawn = comps.filter((c) => degree.has(c.id));
  if (!drawn.length) return emptyGeo;

  const order = new Map(comps.map((c, i) => [c.id, i]));
  const hub = [...drawn].sort(
    (a, b) => (degree.get(b.id)! - degree.get(a.id)!) || (order.get(a.id)! - order.get(b.id)!)
  )[0].id;

  // Balance the others by wire count; ties go to the side with fewer parts.
  const col = new Map<string, Side>([[hub, 'C']]);
  const load = { L: 0, R: 0 };
  const count = { L: 0, R: 0 };
  for (const c of drawn
    .filter((c) => c.id !== hub)
    .sort((a, b) => (degree.get(b.id)! - degree.get(a.id)!) || (order.get(a.id)! - order.get(b.id)!))) {
    const side: Side = load.L < load.R || (load.L === load.R && count.L <= count.R) ? 'L' : 'R';
    col.set(c.id, side);
    load[side] += degree.get(c.id)!;
    count[side]++;
  }

  const inner = (cid: string): Side => (col.get(cid) === 'L' ? 'R' : 'L');
  const outer = (cid: string): Side => (col.get(cid) === 'L' ? 'L' : 'R');

  // ── which edge each endpoint sits on, and how the wire travels ───────────
  const routes: Route[] = [];
  for (const w of conns) {
    let [ua, pa] = w.a;
    let [ub, pb] = w.b;
    if (ua === ub) {
      const s: Side = col.get(ua) === 'C' ? 'R' : outer(ua);
      routes.push({ w, a: [ua, pa, s], b: [ub, pb, s], kind: 'loop' });
    } else if (col.get(ua) === 'C' || col.get(ub) === 'C') {
      if (col.get(ua) === 'C') { [ua, pa, ub, pb] = [ub, pb, ua, pa]; }
      routes.push({ w, a: [ua, pa, inner(ua)], b: [ub, pb, col.get(ua)!], kind: 'direct' });
    } else if (col.get(ua) === col.get(ub)) {
      routes.push({ w, a: [ua, pa, outer(ua)], b: [ub, pb, outer(ub)], kind: 'outer' });
    } else {
      if (col.get(ua) === 'R') { [ua, pa, ub, pb] = [ub, pb, ua, pa]; }
      routes.push({ w, a: [ua, pa, inner(ua)], b: [ub, pb, inner(ub)], kind: 'bottom' });
    }
  }

  const pinIndex = (cid: string, pid: string): number => {
    const pins = byId.get(cid)?.pins ?? [];
    const i = pins.findIndex((p) => p.id === pid);
    return i === -1 ? 999 : i;
  };

  // ── pin rows per edge, ordered to keep wires from crossing ───────────────
  const edgeKeys = new Map<string, Map<string, number>>(); // `${cid}|${side}` -> pid -> key
  const want = (cid: string, pid: string, side: Side, key: number) => {
    const k = `${cid}|${side}`;
    if (!edgeKeys.has(k)) edgeKeys.set(k, new Map());
    const m = edgeKeys.get(k)!;
    m.set(pid, Math.min(m.get(pid) ?? Infinity, key));
  };
  for (const { a, b, kind } of routes) {
    if (kind === 'direct') {
      want(a[0], a[1], a[2], pinIndex(b[0], b[1]));
      want(b[0], b[1], b[2], pinIndex(b[0], b[1]));
    } else if (kind === 'bottom') {
      want(a[0], a[1], a[2], 10_000 + pinIndex(a[0], a[1]));
      want(b[0], b[1], b[2], 10_000 + pinIndex(b[0], b[1]));
    } else {
      want(a[0], a[1], a[2], pinIndex(a[0], a[1]));
      want(b[0], b[1], b[2], pinIndex(b[0], b[1]));
    }
  }

  const edgePins = (cid: string, side: Side): string[] => {
    const keys = edgeKeys.get(`${cid}|${side}`);
    if (!keys) return [];
    return [...keys.keys()].sort((p1, p2) => (keys.get(p1)! - keys.get(p2)!) || (pinIndex(cid, p1) - pinIndex(cid, p2)));
  };

  const label = (cid: string, pid: string): string => {
    const p = (byId.get(cid)?.pins ?? []).find((p) => p.id === pid);
    return p?.label || pid;
  };

  // ── box widths ───────────────────────────────────────────────────────────
  const width = new Map<string, number>();
  for (const c of drawn) {
    const cid = c.id;
    const left = Math.max(0, ...edgePins(cid, 'L').map((p) => measure(label(cid, p), 'pin')));
    const right = Math.max(0, ...edgePins(cid, 'R').map((p) => measure(label(cid, p), 'pin')));
    const pinsW = left + right + (left && right ? 56 : 34);
    const headW = Math.max(measure(c.name ?? '', 'name'), measure(c.detail ?? '', 'detail')) + 30;
    width.set(cid, Math.max(BOX_MIN_W, Math.min(BOX_MAX_W, Math.max(pinsW, headW))));
  }

  // ── vertical: side columns stack, the centre follows its wires ───────────
  const top0 = MARGIN + TITLE_H;
  const box = new Map<string, { x: number; y: number; w: number; h: number }>();
  const pinY = new Map<string, number>(); // `${cid}|${pid}|${side}`
  const pinKey = (cid: string, pid: string, side: Side) => `${cid}|${pid}|${side}`;

  for (const side of ['L', 'R'] as const) {
    let y = top0;
    for (const c of drawn.filter((c) => col.get(c.id) === side)) {
      const cid = c.id;
      const rows = Math.max(edgePins(cid, 'L').length, edgePins(cid, 'R').length, 1);
      const h = HEADER + rows * ROW + BOX_PAD;
      box.set(cid, { x: 0, y, w: width.get(cid)!, h });
      for (const s of ['L', 'R'] as const) {
        for (const [k, pid] of edgePins(cid, s).entries()) {
          pinY.set(pinKey(cid, pid, s), y + HEADER + ROW * (k + 0.5));
        }
      }
      y += h + VGAP;
    }
  }

  for (const s of ['L', 'R'] as const) {
    const desired = new Map<string, number[]>();
    for (const { a, b, kind } of routes) {
      if (kind === 'direct' && b[2] === s) {
        if (!desired.has(b[1])) desired.set(b[1], []);
        desired.get(b[1])!.push(pinY.get(pinKey(a[0], a[1], a[2])) ?? 0);
      }
    }
    const fallback = top0 + HEADER + ROW * 0.5;
    const placed = edgePins(hub, s).map((pid) => {
      const ys = desired.get(pid);
      return { d: ys ? ys.reduce((x, v) => x + v, 0) / ys.length : Infinity, i: pinIndex(hub, pid), pid };
    }).sort((p, q) => p.d - q.d || p.i - q.i);
    let last: number | null = null;
    for (const { d, pid } of placed) {
      let dd = d;
      if (dd === Infinity) dd = last !== null ? last + ROW : fallback;
      const y = Math.max(dd, fallback, last !== null ? last + ROW : fallback);
      pinY.set(pinKey(hub, pid, s), y);
      last = y;
    }
  }

  const hubPinYs = [...pinY.entries()].filter(([k]) => k.startsWith(`${hub}|`)).map(([, y]) => y);
  const hubBottom = hubPinYs.length
    ? Math.max(...hubPinYs) + ROW * 0.5 + BOX_PAD
    : top0 + HEADER + ROW + BOX_PAD;
  box.set(hub, { x: 0, y: top0, w: width.get(hub)!, h: hubBottom - top0 });

  const contentBottom = Math.max(...[...box.values()].map((b) => b.y + b.h));

  // ── lanes ────────────────────────────────────────────────────────────────
  const lanes: Record<string, number[]> = { outer_L: [], gap_L: [], gap_R: [], outer_R: [], bottom: [] };
  routes.forEach(({ a, kind }, i) => {
    if (kind === 'direct') {
      const ya = pinY.get(pinKey(a[0], a[1], a[2])) ?? 0;
      const yb = pinY.get(pinKey(routes[i].b[0], routes[i].b[1], routes[i].b[2])) ?? 0;
      if (Math.abs(ya - yb) > 0.5) lanes['gap_' + col.get(a[0])].push(i);
    } else if (kind === 'outer') {
      lanes['outer_' + col.get(a[0])].push(i);
    } else if (kind === 'bottom') {
      lanes.gap_L.push(i); lanes.gap_R.push(i); lanes.bottom.push(i);
    } else if (kind === 'loop') {
      const key = col.get(a[0]) === 'C' ? 'gap_R' : 'outer_' + col.get(a[0]);
      lanes[key].push(i);
    }
  });

  const hasL = [...col.values()].includes('L');
  const hasR = [...col.values()].includes('R');
  const wl = Math.max(0, ...[...col].filter(([, v]) => v === 'L').map(([cid]) => width.get(cid)!));
  const wr = Math.max(0, ...[...col].filter(([, v]) => v === 'R').map(([cid]) => width.get(cid)!));

  const laneSpan = (n: number) => (n ? (n + 1) * LANE : 0);
  const x = MARGIN + laneSpan(lanes.outer_L.length);
  const xlInner = x + wl;
  const gapL = hasL ? Math.max(GAP_MIN, laneSpan(lanes.gap_L.length) + 60) : 0;
  const hubX = hasL ? xlInner + gapL : x;
  const hubBox = box.get(hub)!;
  hubBox.x = hubX;
  const hubRight = hubX + hubBox.w;
  const gapR = hasR || lanes.gap_R.length ? Math.max(GAP_MIN, laneSpan(lanes.gap_R.length) + 60) : 0;
  const xr = hubRight + gapR;
  for (const [cid, v] of col) {
    if (v === 'L') box.get(cid)!.x = xlInner - width.get(cid)!;
    else if (v === 'R') box.get(cid)!.x = xr;
  }
  const rightEdge = hasR ? xr + wr : hubRight + gapR;
  const canvasW = rightEdge + laneSpan(lanes.outer_R.length) + MARGIN;

  const laneX = (key: string, i: number): number => {
    const members = lanes[key];
    const k = members.indexOf(i);
    const n = members.length;
    if (key === 'outer_L') return x - LANE * (k + 1);
    if (key === 'outer_R') return rightEdge + LANE * (k + 1);
    const mid = key === 'gap_L' ? xlInner + gapL / 2 : hubRight + gapR / 2;
    return mid + (k - (n - 1) / 2) * LANE;
  };

  const pinPoint = (end: End): { x: number; y: number } => {
    const b = box.get(end[0])!;
    return { x: end[2] === 'L' ? b.x : b.x + b.w, y: pinY.get(pinKey(end[0], end[1], end[2])) ?? 0 };
  };

  // ── wire polylines ───────────────────────────────────────────────────────
  const wires: Geometry['wires'] = [];
  let signalI = 0;
  routes.forEach(({ w, a, b, kind }, i) => {
    const pa = pinPoint(a);
    const pb = pinPoint(b);
    let pts: { x: number; y: number }[];
    if (kind === 'direct') {
      if (lanes['gap_' + col.get(a[0])].includes(i)) {
        const lx = laneX('gap_' + col.get(a[0]), i);
        pts = [pa, { x: lx, y: pa.y }, { x: lx, y: pb.y }, pb];
      } else pts = [pa, pb];
    } else if (kind === 'outer') {
      const lx = laneX('outer_' + col.get(a[0]), i);
      pts = [pa, { x: lx, y: pa.y }, { x: lx, y: pb.y }, pb];
    } else if (kind === 'loop') {
      const key = col.get(a[0]) === 'C' ? 'gap_R' : 'outer_' + col.get(a[0]);
      const lx = laneX(key, i);
      pts = [pa, { x: lx, y: pa.y }, { x: lx, y: pb.y }, pb];
    } else {
      const k = lanes.bottom.indexOf(i);
      const by = contentBottom + 22 + k * LANE;
      const l1 = laneX('gap_L', i);
      const l2 = laneX('gap_R', i);
      pts = [pa, { x: l1, y: pa.y }, { x: l1, y: by }, { x: l2, y: by }, { x: l2, y: pb.y }, pb];
    }
    const kindName = w.kind || 'signal';
    let color = kindColor(kindName, signalI);
    if (SIGNAL_KINDS.includes(kindName)) signalI++;
    wires.push({ id: w.n !== undefined ? String(w.n) : String(i + 1), n: w.n ?? i + 1, kind: kindName, color, pts });
  });

  const bottomLanesBottom = contentBottom + 22 + lanes.bottom.length * LANE;
  const canvasH = bottomLanesBottom + 26 + LEGEND_H + MARGIN;

  return {
    empty: false,
    canvasW,
    canvasH,
    boxes: Object.fromEntries([...box.entries()].map(([k, v]) => [k, v])),
    pinY: Object.fromEntries(pinY.entries()),
    wires,
    legendY: bottomLanesBottom + 26,
  };
}