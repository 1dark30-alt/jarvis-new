'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Disk Map — what is taking the space on a drive or folder, drawn as a live,
 * clickable treemap. Port of the JARVIS-system Disk Map panel.
 *
 * The scan streams from /api/disk-map (op=scan): every top-level folder lands
 * on the map the moment it is counted, and the space still to be read is shown
 * as one block that shrinks while the scan runs. Click a folder to zoom in,
 * right-click or Backspace to come back, a breadcrumb segment to jump up.
 * Nothing here deletes or moves a file.
 */

// Same categories/colours as the original.
const CATS: { name: string; rgb: [number, number, number] }[] = [
  { name: 'VIDEO', rgb: [255, 86, 120] },
  { name: 'IMAGES', rgb: [255, 166, 72] },
  { name: 'AUDIO', rgb: [186, 120, 255] },
  { name: 'ARCHIVES', rgb: [250, 214, 90] },
  { name: 'PROGRAMS', rgb: [64, 200, 255] },
  { name: 'DOCUMENTS', rgb: [96, 224, 150] },
  { name: 'CODE & DEV', rgb: [110, 140, 255] },
  { name: 'OTHER', rgb: [132, 150, 170] },
];
const REST_RGB: [number, number, number] = [70, 84, 100];
const SCAN_RGB: [number, number, number] = [104, 112, 124];

type Item = {
  kind: 'folder' | 'file';
  name: string;
  path: string;
  size: number;
  files: number;
  cat: number;
};

type Rect = { x: number; y: number; w: number; h: number };

function fmtSize(b: number): string {
  b = Math.max(0, b);
  for (const unit of ['B', 'KB', 'MB', 'GB', 'TB']) {
    if (b < 1024 || unit === 'TB') {
      if (unit === 'B') return `${Math.round(b)} B`;
      return b < 100 ? `${b.toFixed(1)} ${unit}` : `${Math.round(b)} ${unit}`;
    }
    b /= 1024;
  }
  return `${Math.round(b)} TB`;
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// ── squarified treemap (Bruls, Huizing & van Wijk) ──────────────────────────
function worst(row: number[], side: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  if (s <= 0 || side <= 0) return Infinity;
  return Math.max((side * side * Math.max(...row)) / (s * s), (s * s) / (side * side * Math.min(...row)));
}

function squarify(values: number[], r: Rect): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || r.w <= 1 || r.h <= 1) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const k = (r.w * r.h) / total;
  const areas = values.map((v) => v * k);
  const out: Rect[] = [];
  let { x, y, w, h } = r;
  let row: number[] = [];
  let i = 0;
  while (i < areas.length) {
    const q = Math.min(areas[i], r.w * r.h);
    if (q <= 0) { out.push({ x, y, w: 0, h: 0 }); i++; continue; }
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, q], side) <= worst(row, side)) {
      row.push(q);
      i++;
    } else {
      // place the row
      const s = row.reduce((a, b) => a + b, 0);
      if (w >= h) {
        const cw = s / h;
        let yy = y;
        for (const a of row) { const ah = a / cw; out.push({ x, y: yy, w: cw, h: ah }); yy += ah; }
        row = []; x += cw; w -= cw;
      } else {
        const rh = s / w;
        let xx = x;
        for (const a of row) { const aw = a / rh; out.push({ x: xx, y, w: aw, h: rh }); xx += aw; }
        row = []; y += rh; h -= rh;
      }
    }
  }
  if (row.length) {
    const s = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      const cw = s / h;
      let yy = y;
      for (const a of row) { const ah = a / cw; out.push({ x, y: yy, w: cw, h: ah }); yy += ah; }
    } else {
      const rh = s / w;
      let xx = x;
      for (const a of row) { const aw = a / rh; out.push({ x: xx, y, w: aw, h: rh }); xx += aw; }
    }
  }
  return out;
}

interface Props { onNavigateHome: () => void }

export function DiskMapPage({ onNavigateHome }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drives, setDrives] = useState<{ path: string; total: number; free: number; used: number }[]>([]);
  const [cwd, setCwd] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [disk, setDisk] = useState<{ used: number; total: number; free: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [hover, setHover] = useState<{ item: Item; rect: Rect } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const layoutRef = useRef<{ item: Item; rect: Rect }[]>([]);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  // ── drives ──
  useEffect(() => {
    fetch('/api/disk-map?op=drives')
      .then((r) => r.json())
      .then((d) => setDrives(d.drives ?? []))
      .catch(() => {});
  }, []);

  // ── progressive scan of a root ──
  const startScan = useCallback((p: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCwd(p); setSelected(null); setItems([]); setProgress({ done: 0, of: 0 }); setHover(null);
    setDisk(null);
    (async () => {
      try {
        const res = await fetch(`/api/disk-map?op=scan&path=${encodeURIComponent(p)}`, { signal: ac.signal });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        const collected: Item[] = [];
        let diskLocal: { used: number; total: number; free: number } | null = null;
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => { flushTimer = null; setItems([...collected]); };
        const schedule = () => { if (!flushTimer) flushTimer = setTimeout(flush, 200); };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!line.startsWith('data: ')) continue;
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'start') { diskLocal = evt.disk; setDisk(evt.disk); }
            else if (evt.type === 'item') {
              collected.push(evt as Item);
              if (evt.of) setProgress({ done: evt.done, of: evt.of });
              schedule();
            } else if (evt.type === 'done') {
              if (diskLocal && evt.scanned < diskLocal.used * 0.999) {
                collected.push({
                  kind: 'folder', name: 'SYSTEM & HIDDEN', path: p,
                  size: Math.max(0, diskLocal.used - evt.scanned), files: 0, cat: -1,
                });
              }
              setProgress(null);
            }
          }
        }
        if (flushTimer) clearTimeout(flushTimer);
        setItems([...collected]);
        setProgress(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setProgress(null);
      }
    })();
  }, []);

  // ── zoom into a folder ──
  const enter = useCallback(async (p: string) => {
    setSelected(null); setHover(null); setProgress({ done: 0, of: 0 });
    try {
      const res = await fetch(`/api/disk-map?op=expand&path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (data.error) { setProgress(null); return; }
      setCwd(data.path);
      setDisk(data.disk);
      setItems(data.items as Item[]);
    } finally {
      setProgress(null);
    }
  }, []);

  const goUp = useCallback(() => {
    if (!cwd) return;
    const sep = cwd.includes('\\') ? '\\' : '/';
    const parent = cwd.slice(0, cwd.length - (cwd.endsWith(sep) ? 1 : 0));
    const cut = parent.lastIndexOf(sep);
    if (cut <= 0) { if (isRoot(parent)) startScan(parent); return; }
    const up = parent.slice(0, cut + 1);
    if (isRoot(up)) startScan(up); else void enter(up);
  }, [cwd, enter, startScan]);

  function isRoot(p: string): boolean {
    return /^[a-zA-Z]:\\?$/.test(p) || p === '/';
  }

  // ── draw ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: cw, clientHeight: ch } = canvas;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const area: Rect = { x: 8, y: 8, w: cw - 16, h: ch - 16 };
      const list = [...itemsRef.current].filter((i) => i.size > 0).sort((a, b) => b.size - a.size);

      // Lump the smaller items of this folder into one REST block.
      const total = list.reduce((a, b) => a + b.size, 0);
      const big: Item[] = [];
      let restSize = 0; let restFiles = 0;
      for (const it of list) {
        if (it.size / Math.max(total, 1) < 0.004 && big.length >= 8) restSize += it.size, restFiles += it.files;
        else big.push(it);
      }
      const blocks: { item: Item | null; size: number }[] = [
        ...big.map((i) => ({ item: i as Item | null, size: i.size })),
        ...(restSize > 0 ? [{ item: null, size: restSize }] : []),
        ...(progress ? [{ item: null, size: Math.max(1, (disk?.total ?? 0) - list.reduce((a, b) => a + b.size, 0)) }] : []),
      ];
      const rects = squarify(blocks.map((b) => b.size), area);
      layoutRef.current = [];
      const GAP = 2;

      rects.forEach((r, i) => {
        const b = blocks[i];
        if (r.w <= 0 || r.h <= 0) return;
        const x = r.x + GAP / 2, y = r.y + GAP / 2, w = Math.max(0, r.w - GAP), h = Math.max(0, r.h - GAP);
        if (b.item) layoutRef.current.push({ item: b.item, rect: { x, y, w, h } });

        if (!b.item) {
          // REST (smaller items) or still-scanning block.
          const scanning = !!progress && i === blocks.length - 1 && !restSize;
          const col = scanning ? SCAN_RGB : REST_RGB;
          ctx.fillStyle = rgba(col, 0.35);
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = rgba(col, 0.6);
          ctx.strokeRect(x, y, w, h);
          if (scanning) {
            ctx.strokeStyle = 'rgba(150,160,175,0.35)';
            ctx.lineWidth = 1;
            for (let d = -h; d < w; d += 8) {
              ctx.beginPath(); ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); ctx.stroke();
            }
            if (w > 90 && h > 26) {
              ctx.fillStyle = 'rgba(220,228,238,0.85)';
              ctx.font = '11px ui-monospace, monospace';
              ctx.fillText(progress ? `SCANNING… ${progress.done}/${progress.of}` : 'SCANNING…', x + 8, y + 16);
            }
          } else if (w > 70 && h > 22) {
            ctx.fillStyle = 'rgba(200,210,222,0.75)';
            ctx.font = '10px ui-monospace, monospace';
            ctx.fillText('SMALLER FILES', x + 6, y + 14);
            if (h > 38) ctx.fillText(fmtSize(restSize), x + 6, y + 28);
          }
          return;
        }

        const it = b.item;
        const col = it.cat >= 0 ? CATS[it.cat].rgb : REST_RGB;
        if (it.kind === 'file') {
          ctx.fillStyle = rgba(col, 0.55);
          ctx.fillRect(x, y, w, h);
        } else {
          ctx.fillStyle = rgba(col, 0.16);
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = rgba(col, 0.75);
          ctx.lineWidth = 1.4;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        }
        if (hover && hover.item === it) {
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(x, y, w, h);
        }
        if (selected === it) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        }
        // Label
        if (w > 60 && h > 30) {
          ctx.fillStyle = 'rgba(234,242,247,0.95)';
          ctx.font = 'bold 12px ui-monospace, monospace';
          const name = it.name.length > 24 ? it.name.slice(0, 23) + '…' : it.name;
          ctx.fillText(name, x + 6, y + 16);
          ctx.fillStyle = 'rgba(139,163,181,0.9)';
          ctx.font = '10px ui-monospace, monospace';
          ctx.fillText(fmtSize(it.size), x + 6, y + 30);
        } else if (w > 30 && h > 14) {
          ctx.fillStyle = 'rgba(234,242,247,0.8)';
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(it.name.slice(0, Math.floor(w / 7)), x + 3, y + 11);
        }
      });
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [items, progress, hover, selected, disk]);

  // ── interactions ──
  const pick = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = layoutRef.current.find(
      (l) => mx >= l.rect.x && mx <= l.rect.x + l.rect.w && my >= l.rect.y && my <= l.rect.y + l.rect.h
    );
    if (!hit) { setSelected(null); return; }
    if (e.type === 'contextmenu') {
      e.preventDefault();
      goUp();
      return;
    }
    if (hit.item.kind === 'folder' && hit.item.name !== 'SYSTEM & HIDDEN') void enter(hit.item.path);
    else setSelected(hit.item);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Escape') goUp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goUp]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const crumbs = cwd
    ? cwd.split(/[\\/]/).filter(Boolean).map((seg, i, arr) => {
        const p = (cwd.includes('\\') ? '' : '/')
          + arr.slice(0, i + 1).join(cwd.includes('\\') ? '\\' : '/') + (cwd.includes('\\') ? '\\' : '');
        return { seg, p: isRoot(p) ? p : p };
      })
    : [];

  return (
    <motion.div
      key="disk-map-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Disk Map"
        onNavigateHome={onNavigateHome}
        accent="cyan"
        right={
          <div className="flex items-center gap-2">
            {drives.map((d) => (
              <button
                key={d.path}
                onClick={() => startScan(d.path)}
                className={`px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-widest border transition-all ${
                  cwd === d.path
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/45 hover:text-cyan-300 hover:border-cyan-500/30'
                }`}
                title={d.total ? `${fmtSize(d.used)} used of ${fmtSize(d.total)}` : d.path}
              >
                {d.path.replace('\\', '')}
              </button>
            ))}
          </div>
        }
      />

      {/* breadcrumb */}
      <div className="px-6 py-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-white/40 shrink-0 overflow-x-auto">
        {cwd ? (
          <>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-white/20">›</span>}
                <button
                  className="hover:text-cyan-300 transition-colors whitespace-nowrap"
                  onClick={() => { const p = c.p; if (isRoot(p)) startScan(p); else void enter(p); }}
                >
                  {c.seg}
                </button>
              </span>
            ))}
            {progress && (
              <span className="ml-3 text-cyan-400/80 animate-pulse">
                scanning {progress.done}/{progress.of}
              </span>
            )}
          </>
        ) : (
          <span>Select a drive to scan</span>
        )}
      </div>

      {/* treemap */}
      <div className="flex-1 min-h-0 px-6 pb-4">
        <canvas
          ref={canvasRef}
          onClick={pick}
          onContextMenu={pick}
          className="w-full h-full rounded-lg cursor-pointer"
          style={{ background: 'rgba(10,15,20,0.6)', border: '1px solid rgba(34,211,238,0.12)' }}
        />
      </div>

      {/* status bar */}
      <div className="px-6 pb-4 shrink-0 flex items-center gap-4 font-mono text-[10px] uppercase tracking-widest">
        {selected ? (
          <>
            <span className="text-white/85 truncate">{selected.name}</span>
            <span className="text-cyan-300">{fmtSize(selected.size)}</span>
            {selected.kind === 'file' && selected.cat >= 0 && (
              <span className="text-white/40">{CATS[selected.cat].name}</span>
            )}
            {selected.kind === 'folder' && selected.files > 0 && (
              <span className="text-white/40">{selected.files.toLocaleString()} files</span>
            )}
            <button
              onClick={() => fetch(`/api/disk-map?op=reveal&path=${encodeURIComponent(selected.path)}`)}
              className="px-2.5 py-1 rounded bg-white/[0.04] border border-white/[0.08] text-white/45 hover:text-cyan-300 hover:border-cyan-500/30 transition-all"
            >
              Reveal in Explorer
            </button>
          </>
        ) : disk ? (
          <>
            <span className="text-white/50">{fmtSize(disk.used)} used</span>
            <span className="text-white/30">{fmtSize(disk.free)} free of {fmtSize(disk.total)}</span>
            <span className="text-white/20">click a folder to zoom · right-click / Backspace to go up</span>
          </>
        ) : (
          <span className="text-white/25">Nothing scanned yet</span>
        )}
      </div>

      {/* legend */}
      <div className="px-6 pb-3 shrink-0 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] tracking-widest text-white/35">
        {CATS.map((c) => (
          <span key={c.name} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: rgba(c.rgb, 0.8) }} />
            {c.name}
          </span>
        ))}
      </div>
    </motion.div>
  );
}