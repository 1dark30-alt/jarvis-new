'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type CameraState = 'idle' | 'capturing' | 'done' | 'error';

interface CameraEvent {
  state: CameraState;
  imageBase64?: string;
  error?: string;
}

const MIN_SIZE = 200;
const DEFAULT_SIZE = 320;

export function CameraWidget() {
  const [state, setState] = useState<CameraState>('idle');
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const constraintsRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const startRef = useRef({ x: 0, startSize: 0 });

  useEffect(() => {
    const handler = (e: Event) => {
      const { state: s, imageBase64, error: err } = (e as CustomEvent<CameraEvent>).detail;
      setState(s);
      if (imageBase64) setImage(imageBase64);
      if (err) setError(err);
      if (s === 'idle') {
        setImage(null);
        setError(null);
        setSize(DEFAULT_SIZE);
      }
    };
    window.addEventListener('jarvis:camera', handler);
    return () => window.removeEventListener('jarvis:camera', handler);
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;
    startRef.current = { x: e.clientX, startSize: size };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      setSize(Math.max(MIN_SIZE, startRef.current.startSize + (ev.clientX - startRef.current.x)));
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size]);

  const dismiss = () => {
    setState('idle');
    setImage(null);
    setError(null);
    setSize(DEFAULT_SIZE);
  };

  const statusLabel =
    state === 'capturing' ? 'Capturing...'
    : state === 'done'    ? 'Photo Captured'
    : 'Camera Error';

  return (
    <>
      <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-40" />

      <AnimatePresence>
        {state !== 'idle' && (
          <motion.div
            drag
            dragConstraints={constraintsRef}
            dragMomentum={false}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            style={{ width: size }}
            className="fixed bottom-8 left-8 z-50 rounded-lg overflow-hidden border border-cyan-500/50 shadow-[0_0_40px_rgba(34,211,238,0.2)] bg-black/90 select-none"
          >
            {/* Header */}
            <div className="px-4 py-2 bg-cyan-950/40 border-b border-cyan-500/20 flex items-center gap-2 cursor-grab active:cursor-grabbing">
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-widest">
                {statusLabel}
              </span>
              {(state === 'done' || state === 'error') && (
                <button
                  onClick={dismiss}
                  className="ml-auto text-cyan-600 hover:text-cyan-300 text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Body */}
            <div className="relative w-full bg-black" style={{ height: size }}>

              {/* Capturing flash overlay */}
              {state === 'capturing' && (
                <>
                  <div className="absolute inset-0 bg-white/10 animate-pulse" />
                  <div
                    className="absolute inset-0 opacity-10"
                    style={{
                      backgroundImage:
                        'linear-gradient(rgba(34,211,238,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.6) 1px, transparent 1px)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                  {['top-2 left-2 border-t border-l', 'top-2 right-2 border-t border-r', 'bottom-2 left-2 border-b border-l', 'bottom-2 right-2 border-b border-r'].map((cls, i) => (
                    <div key={i} className={`absolute w-5 h-5 border-cyan-400 ${cls}`} />
                  ))}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-cyan-400/70 text-xs uppercase tracking-widest animate-pulse">
                      Capturing...
                    </span>
                  </div>
                </>
              )}

              {/* Photo */}
              {state === 'done' && image && (
                <motion.img
                  key="photo"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  src={`data:image/jpeg;base64,${image}`}
                  alt="Captured"
                  className="w-full h-full object-cover"
                />
              )}

              {/* Error */}
              {state === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                  <span className="text-red-400 text-xs text-center">{error || 'Camera failed.'}</span>
                </div>
              )}

              {/* Corner accents */}
              {state === 'done' && (
                <>
                  {['top-2 left-2 border-t border-l', 'top-2 right-2 border-t border-r', 'bottom-2 left-2 border-b border-l', 'bottom-2 right-2 border-b border-r'].map((cls, i) => (
                    <div key={i} className={`absolute w-4 h-4 border-cyan-400/60 ${cls}`} />
                  ))}
                </>
              )}
            </div>

            {/* Resize handle */}
            <div
              onMouseDown={onResizeStart}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10 flex items-end justify-end pr-0.5 pb-0.5"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M7 1L1 7M7 4L4 7" stroke="rgba(34,211,238,0.5)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
