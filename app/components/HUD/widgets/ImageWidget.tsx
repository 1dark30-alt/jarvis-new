'use client';

export function ImageWidget({
  imageBase64,
  loading,
  error,
  caption,
}: {
  imageBase64?: string;
  loading: boolean;
  error?: string;
  caption?: string;
}) {
  const downloadHref = imageBase64 ? `data:image/png;base64,${imageBase64}` : '';
  const downloadName = `jarvis-image-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-[#050a0c]">
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

      {caption && !error && (
        <p className="shrink-0 border-b border-cyan-500/15 bg-cyan-950/25 px-3 py-1.5 text-[10px] leading-snug tracking-wide text-cyan-200/55 line-clamp-2">
          {caption}
        </p>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-black/40">
        {loading && (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 px-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400/25 border-t-cyan-400" />
            <span className="text-xs uppercase tracking-widest text-cyan-400/60">Generating…</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm text-red-400/90">
            {error}
          </div>
        )}

        {!loading && !error && imageBase64 && (
          <>
            <img
              src={downloadHref}
              alt="Generated"
              className="h-full w-full object-contain"
            />
            <a
              href={downloadHref}
              download={downloadName}
              className="absolute bottom-2 right-2 z-20 rounded border border-cyan-400/40 bg-black/70 px-2 py-1 text-[10px] uppercase tracking-wider text-cyan-300 transition-colors hover:border-cyan-300 hover:text-cyan-200"
            >
              Download
            </a>
          </>
        )}

        {!loading && !error && !imageBase64 && (
          <div className="flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm text-cyan-400/45">
            No image yet.
          </div>
        )}
      </div>
    </div>
  );
}
