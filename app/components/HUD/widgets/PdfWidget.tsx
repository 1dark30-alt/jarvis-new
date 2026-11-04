'use client';

import { useMemo, useState } from 'react';
import { resolvePdfDisplayUrl } from '@/app/lib/resolve-pdf-src';

export function PdfWidget({ source }: { source: string }) {
  const [failed, setFailed] = useState(false);
  const { url, hint } = useMemo(() => resolvePdfDisplayUrl(source), [source]);

  if (!url) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center px-4 text-center text-sm text-cyan-400/55">
        {hint ?? 'No PDF source configured.'}
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-[#050a0c]">
      {/* Futuristic frame — inset glow + corners */}
      <div
        className="pointer-events-none absolute inset-0 z-10 opacity-90"
        style={{
          boxShadow: 'inset 0 0 0 1px rgba(34,211,238,0.12), inset 0 0 50px rgba(34,211,238,0.04)',
        }}
      />
      <div className="pointer-events-none absolute left-2 top-2 z-10 h-4 w-4 border-l border-t border-cyan-400/50" />
      <div className="pointer-events-none absolute right-2 top-2 z-10 h-4 w-4 border-r border-t border-cyan-400/50" />
      <div className="pointer-events-none absolute bottom-2 left-2 z-10 h-4 w-4 border-b border-l border-cyan-400/35" />
      <div className="pointer-events-none absolute bottom-2 right-2 z-10 h-4 w-4 border-b border-r border-cyan-400/35" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />

      {hint && !failed && (
        <p className="shrink-0 border-b border-cyan-500/15 bg-cyan-950/25 px-3 py-1.5 text-[10px] leading-snug tracking-wide text-cyan-200/45">
          {hint}
        </p>
      )}

      {failed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-sm text-white/70">Could not embed this PDF (host may block iframes).</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-cyan-300 transition-colors hover:border-cyan-400 hover:bg-cyan-500/20"
          >
            Open externally
          </a>
        </div>
      ) : (
        <>
          <iframe
            key={url}
            title="PDF document"
            src={url}
            className="min-h-0 w-full flex-1 border-0 bg-black/40"
            onError={() => setFailed(true)}
          />
          <div className="flex shrink-0 items-center justify-end border-t border-cyan-500/10 bg-black/30 px-2 py-1">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-medium uppercase tracking-wider text-cyan-400/55 transition-colors hover:text-cyan-300"
            >
              Open in browser
            </a>
          </div>
        </>
      )}
    </div>
  );
}
