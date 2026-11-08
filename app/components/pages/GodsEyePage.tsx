'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * God's Eye — live spatial intelligence console (photorealistic 3D globe with
 * live aircraft, ships, satellites, earthquakes and CCTV). The viewer is an
 * independent Vite service in services/gods-eye-view, started on demand via
 * /api/gods-eye/start and framed here in embed mode.
 */
const VIEWER_URL = 'http://127.0.0.1:4173/?embed=1';

export function GodsEyePage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting');
  const [message, setMessage] = useState('Starting the God\u2019s Eye service\u2026');
  const [reloadKey, setReloadKey] = useState(0);
  const startingRef = useRef(false);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStatus('starting');
    setMessage('Starting the God\u2019s Eye service\u2026');
    try {
      const res = await fetch('/api/gods-eye/start', { method: 'POST' });
      const data = await res.json();
      if (data.ready) {
        setStatus('ready');
      } else {
        setStatus('error');
        setMessage(data.error || 'Could not start the God\u2019s Eye service.');
      }
    } catch {
      setStatus('error');
      setMessage('Could not reach the God\u2019s Eye launcher.');
    } finally {
      startingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  return (
    <motion.div
      key="gods-eye-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="God's Eye"
        onNavigateHome={onNavigateHome}
        accent="cyan"
        right={
          <div className="flex items-center gap-2">
            <a
              href={VIEWER_URL}
              target="_blank"
              rel="noreferrer"
              title="Open in browser"
              className="w-7 h-7 flex items-center justify-center rounded bg-white/[0.04] border border-white/[0.08] text-white/35 hover:text-cyan-400 hover:border-cyan-500/30 transition-all text-xs"
            >
              ↗
            </a>
            <button
              onClick={() => { setReloadKey((k) => k + 1); void start(); }}
              title="Reload"
              className="w-7 h-7 flex items-center justify-center rounded bg-white/[0.04] border border-white/[0.08] text-white/35 hover:text-cyan-400 hover:border-cyan-500/30 transition-all text-xs"
            >
              ⟳
            </button>
          </div>
        }
      />

      <div className="flex-1 min-h-0 relative">
        {status === 'ready' ? (
          <iframe
            key={reloadKey}
            src={VIEWER_URL}
            title="God's Eye View"
            className="absolute inset-0 w-full h-full border-0 bg-black"
            allow="fullscreen"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="max-w-md text-center px-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-400/70 mb-4">
                {status === 'starting' ? '◉ Activating satellite uplink' : '▲ Uplink error'}
              </div>
              <p className="text-white/60 text-sm leading-relaxed">{message}</p>
              {status === 'error' && (
                <button
                  onClick={() => void start()}
                  className="mt-6 px-4 py-2 rounded border border-cyan-500/30 text-cyan-300 text-xs font-mono uppercase tracking-widest hover:bg-cyan-500/10 transition-colors"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}