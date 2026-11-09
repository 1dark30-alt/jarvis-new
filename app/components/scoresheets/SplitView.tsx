'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolvePdfDisplayUrl } from '@/app/lib/resolve-pdf-src';

/**
 * Scoresheets split view — Nexus browser on the left, scoresheet PDF on the
 * right, with the live F9-helper row strip along the bottom.
 *
 * The browser pane is a real Electron <webview> guest (enabled in the main
 * window) with its own persistent partition, so Nexus logins survive app
 * restarts and the site behaves like it would in a normal browser — no iframe
 * X-Frame-Options restrictions.
 *
 * The PDF pane loads local files through the jarvis-pdf:// protocol via
 * resolvePdfDisplayUrl, rendered by Chromium's built-in PDF viewer.
 */

// Minimal structural types — ScoresheetsPage's NexusState is compatible.
export interface SplitNexusRow {
  match: number;
  seat: number;
  name: string;
  IN: string;
  DS: string;
  Wins: string;
  exceptions: string[];
  reconciled: boolean;
}

export interface SplitNexusState {
  running?: boolean;
  rows?: SplitNexusRow[];
  idx?: number;
  message?: string;
}

interface SplitViewProps {
  pdfList: { name: string; path: string; mtime: number }[];
  initialPdf: string;
  nexus: SplitNexusState | null;
}

interface ElectronWebviewElement extends HTMLElement {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

const DEFAULT_URL = 'https://nexus.apaleagues.com/';
const URL_KEY = 'jarvis_apa_browser_url';
const PDF_KEY = 'jarvis_apa_split_pdf';

function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electron?.isElectron === true;
}

export function SplitView({ pdfList, initialPdf, nexus }: SplitViewProps) {
  const electron = isElectron();

  // ── Browser pane ─────────────────────────────────────────────────────────
  const webviewHostRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const [url, setUrl] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_URL;
    return localStorage.getItem(URL_KEY) || DEFAULT_URL;
  });
  const [title, setTitle] = useState('');
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);

  const syncNav = useCallback((el: ElectronWebviewElement) => {
    setUrl(el.src);
    setCanBack(el.canGoBack());
    setCanFwd(el.canGoForward());
    try { localStorage.setItem(URL_KEY, el.src); } catch { /* ignore */ }
  }, []);

  // Create the <webview> through the DOM (React has no intrinsic JSX for it).
  useEffect(() => {
    if (!electron) return;
    const host = webviewHostRef.current;
    if (!host) return;

    const existing = host.querySelector('webview');
    if (existing) return;

    const el = document.createElement('webview') as ElectronWebviewElement;
    el.setAttribute('partition', 'persist:apa-nexus');
    el.setAttribute('allowpopups', '');
    el.setAttribute('autosize', 'on');
    el.src = url;
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.display = 'block';
    el.style.background = '#fff';
    webviewRef.current = el;

    const onNavigate = () => syncNav(el);
    const onTitle = (e: Event) => setTitle((e as CustomEvent).detail ?? '');
    el.addEventListener('dom-ready', onNavigate);
    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', onNavigate);
    el.addEventListener('page-title-updated', onTitle);

    host.appendChild(el);
    return () => {
      el.removeEventListener('dom-ready', onNavigate);
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', onNavigate);
      el.removeEventListener('page-title-updated', onTitle);
      el.remove();
      webviewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electron]);

  const navigate = useCallback((target?: string) => {
    const el = webviewRef.current;
    const next = (target ?? url).trim();
    if (!el || !next) return;
    const full = /^https?:\/\//i.test(next) || next.startsWith('about:') ? next : `https://${next}`;
    el.src = full;
    setUrl(full);
  }, [url]);

  // ── PDF pane ─────────────────────────────────────────────────────────────
  const [pdf, setPdf] = useState(() => {
    if (typeof window === 'undefined') return initialPdf;
    return localStorage.getItem(PDF_KEY) || initialPdf;
  });
  const [pdfInput, setPdfInput] = useState(pdf);
  useEffect(() => { setPdfInput(pdf); }, [pdf]);
  useEffect(() => {
    if (!pdf && initialPdf) setPdf(initialPdf);
  }, [initialPdf, pdf]);
  useEffect(() => {
    try { localStorage.setItem(PDF_KEY, pdf); } catch { /* ignore */ }
  }, [pdf]);

  const resolved = useMemo(() => resolvePdfDisplayUrl(pdf), [pdf]);
  const openPdf = useCallback((path: string) => {
    setPdf(path);
    setPdfInput(path);
  }, []);

  // ── Draggable divider ────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftPct, setLeftPct] = useState(50);
  const [dragging, setDragging] = useState(false);
  const onDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const parent = containerRef.current;
      if (!parent) return;
      const r = parent.getBoundingClientRect();
      const pct = ((e.clientX - r.left) / r.width) * 100;
      setLeftPct(Math.min(78, Math.max(22, pct)));
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging]);

  // ── Helper strip ──────────────────────────────────────────────────────────
  const rows = nexus?.rows ?? [];
  const idx = nexus?.idx ?? 0;
  const current = rows[idx];
  const next = rows[idx + 1];

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 gap-2">
      <div ref={containerRef} className="flex-1 min-h-0 flex gap-0 select-none">
        {/* LEFT — Nexus browser */}
        <div
          className="flex flex-col min-h-0 rounded-lg overflow-hidden"
          style={{ width: `${leftPct}%`, background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(250,204,21,0.15)' }}
        >
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-amber-500/15 shrink-0">
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70 shrink-0">Nexus</span>
            <button onClick={() => webviewRef.current?.goBack()} disabled={!canBack}
              className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-white/[0.05] border border-white/[0.08] text-white/60 hover:bg-white/[0.1] disabled:opacity-30">←</button>
            <button onClick={() => webviewRef.current?.goForward()} disabled={!canFwd}
              className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-white/[0.05] border border-white/[0.08] text-white/60 hover:bg-white/[0.1] disabled:opacity-30">→</button>
            <button onClick={() => webviewRef.current?.reload()}
              className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-white/[0.05] border border-white/[0.08] text-white/60 hover:bg-white/[0.1]">⟳</button>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(); }}
              placeholder="https://nexus.apaleagues.com/"
              className="flex-1 min-w-0 bg-black/40 border border-amber-500/25 rounded px-2 py-1 text-white/80 font-mono text-[10px]"
            />
            <button onClick={() => navigate()}
              className="px-2 py-1 rounded font-mono text-[9px] uppercase tracking-widest bg-amber-500/10 border border-amber-500/40 text-amber-300 hover:bg-amber-500/20 shrink-0">Go</button>
          </div>
          <div className="flex-1 min-h-0 relative">
            {electron ? (
              <div ref={webviewHostRef} className="absolute inset-0" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <p className="text-xs text-white/40 font-mono max-w-sm">
                  The embedded browser only works inside the Jarvis desktop app.
                  The PDF pane works everywhere.
                </p>
              </div>
            )}
          </div>
          {title && (
            <div className="px-2 py-1 border-t border-amber-500/10 font-mono text-[9px] text-white/30 truncate shrink-0">{title}</div>
          )}
        </div>

        {/* divider */}
        <div
          onMouseDown={onDividerDown}
          className={`w-1.5 shrink-0 cursor-col-resize flex items-center justify-center ${dragging ? 'bg-cyan-400/40' : 'bg-cyan-400/0 hover:bg-cyan-400/25'} transition-colors`}
          style={{ margin: '0 2px' }}
        >
          <div className="w-0.5 h-8 rounded bg-white/25" />
        </div>

        {/* RIGHT — scoresheet PDF */}
        <div
          className="flex flex-col min-h-0 flex-1 rounded-lg overflow-hidden"
          style={{ background: 'rgba(10,15,20,0.7)', border: '1px solid rgba(34,211,238,0.12)' }}
        >
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-cyan-500/15 shrink-0">
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-cyan-400/70 shrink-0">Scoresheet</span>
            <select
              value={pdfList.some((p) => p.path === pdf) ? pdf : ''}
              onChange={(e) => { if (e.target.value) openPdf(e.target.value); }}
              className="flex-1 min-w-0 bg-black/40 border border-cyan-500/25 rounded px-1.5 py-1 text-cyan-100 font-mono text-[10px]"
            >
              <option value="">Pick a PDF…</option>
              {pdfList.map((p) => (
                <option key={p.path} value={p.path}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-cyan-500/10 shrink-0">
            <input
              value={pdfInput}
              onChange={(e) => setPdfInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') openPdf(pdfInput.trim()); }}
              placeholder="…or paste a full PDF path"
              className="flex-1 min-w-0 bg-black/40 border border-cyan-500/25 rounded px-2 py-1 text-cyan-100 font-mono text-[10px]"
            />
            <button onClick={() => openPdf(pdfInput.trim())}
              className="px-2 py-1 rounded font-mono text-[9px] uppercase tracking-widest bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20 shrink-0">Open</button>
          </div>
          <div className="flex-1 min-h-0 relative">
            {resolved.url ? (
              <iframe
                key={resolved.url}
                src={resolved.url}
                title="Scoresheet PDF"
                className="absolute inset-0 w-full h-full bg-white"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-xs text-white/35 font-mono">No PDF selected — pick one above or paste a path.</p>
              </div>
            )}
          </div>
          {resolved.hint && (
            <div className="px-2 py-1 border-t border-cyan-500/10 font-mono text-[9px] text-amber-300/70 shrink-0">{resolved.hint}</div>
          )}
        </div>
      </div>

      {/* F9 helper strip — the row you are typing right now */}
      {nexus?.running && rows.length > 0 && (
        <div
          className="shrink-0 rounded-lg px-3 py-2 font-mono text-[11px] flex items-center gap-4"
          style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(250,204,21,0.25)' }}
        >
          <span className="text-amber-400/80 uppercase tracking-widest text-[9px] shrink-0">
            F9 · row {idx + 1}/{rows.length}
          </span>
          {current ? (
            <span className="text-amber-200 truncate">
              ▶ M{current.match} seat {current.seat} · {current.name} · IN {String(current.IN).padStart(3)} · DS {String(current.DS).padStart(3)} · W {String(current.Wins).padStart(2)}
              {current.exceptions.length > 0 && (
                <span className="text-red-400"> ⚠ {current.exceptions.join(', ')}</span>
              )}
            </span>
          ) : (
            <span className="text-white/50">all rows typed — Ctrl+F12 to quit</span>
          )}
          {current?.exceptions.length === 0 && current?.reconciled && (
            <span className="text-amber-500/60 shrink-0">*reconciled</span>
          )}
          {next && (
            <span className="text-white/35 truncate shrink-0 hidden md:inline">
              next: M{next.match} {next.name.slice(0, 14)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}