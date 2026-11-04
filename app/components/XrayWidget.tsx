'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type XrayState = 'idle' | 'scanning' | 'done' | 'error';

export interface XrayEvent {
  state: XrayState;
  capturedBase64?: string;
  imageBase64?: string;
  error?: string;
}

export const XRAY_EVENT = 'jarvis:xray';

const MIN_SIZE = 200;
const DEFAULT_SIZE = 288; // w-72

export function XrayWidget() {
  const [state, setState] = useState<XrayState>('idle');
  const [captured, setCaptured] = useState<string | null>(null);
  const [xrayImage, setXrayImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showingXray, setShowingXray] = useState(true);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const constraintsRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const startRef = useRef({ x: 0, startSize: 0 });

  const toggleView = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowingXray((v) => !v);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { state: s, capturedBase64, imageBase64, error: err } = (e as CustomEvent<XrayEvent>).detail;
      setState(s);
      if (capturedBase64) setCaptured(capturedBase64);
      if (imageBase64) setXrayImage(imageBase64);
      if (err) setError(err);
      if (s === 'idle') {
        setCaptured(null);
        setXrayImage(null);
        setError(null);
        setSize(DEFAULT_SIZE);
      }
    };
    window.addEventListener(XRAY_EVENT, handler);
    return () => window.removeEventListener(XRAY_EVENT, handler);
  }, []);

  // Resize drag handlers
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;
    startRef.current = { x: e.clientX, startSize: size };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - startRef.current.x;
      setSize(Math.max(MIN_SIZE, startRef.current.startSize + delta));
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
    setCaptured(null);
    setXrayImage(null);
    setError(null);
    setSize(DEFAULT_SIZE);
  };

  return (
    <>
      <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-40" />

      <AnimatePresence>
        {state !== 'idle' && (
          <motion.div
            drag
            dragConstraints={constraintsRef}
            dragMomentum={false}
            // Don't let framer-motion drag interfere with resize handle
            dragListener={!resizingRef.current}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            style={{ width: size }}
            className="fixed bottom-8 right-8 z-50 rounded-lg overflow-hidden border border-cyan-500/50 shadow-[0_0_40px_rgba(34,211,238,0.25)] bg-black/90 select-none"
          >
            {/* Header — drag handle */}
            <div className="px-4 py-2 bg-cyan-950/40 border-b border-cyan-500/20 flex items-center gap-2 cursor-grab active:cursor-grabbing">
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-widest">
                {state === 'scanning' ? 'X-Ray Scan' : state === 'done' ? 'Scan Complete' : 'Scan Error'}
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

            {/* Body — square based on current width */}
            <div className="relative w-full bg-black" style={{ height: size }}>

              {/* Camera capture base layer during scanning */}
              {state === 'scanning' && captured && (
                <img
                  src={`data:image/jpeg;base64,${captured}`}
                  alt="Camera capture"
                  className="absolute inset-0 w-full h-full object-cover opacity-80"
                  style={{ filter: 'brightness(0.85)' }}
                />
              )}

              {/* Scan overlay */}
              {state === 'scanning' && (
                <>
                  <div
                    className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage:
                        'linear-gradient(rgba(34,211,238,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.6) 1px, transparent 1px)',
                      backgroundSize: '24px 24px',
                    }}
                  />
                  {['top-2 left-2 border-t border-l', 'top-2 right-2 border-t border-r', 'bottom-2 left-2 border-b border-l', 'bottom-2 right-2 border-b border-r'].map((cls, i) => (
                    <div key={i} className={`absolute w-5 h-5 border-cyan-400 ${cls}`} />
                  ))}
                  <div className="absolute inset-x-0 h-0.5 bg-cyan-400/90 shadow-[0_0_12px_6px_rgba(34,211,238,0.5)] animate-xray-sweep" />
                  <div className="absolute bottom-3 inset-x-0 flex justify-center">
                    <span className="text-cyan-400/70 text-xs uppercase tracking-widest animate-pulse">Generating...</span>
                  </div>
                </>
              )}

              {/* Done — toggle between original and X-ray */}
              {state === 'done' && (
                <>
                  <AnimatePresence mode="wait">
                    {showingXray && xrayImage ? (
                      <motion.img key="xray" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                        src={`data:image/png;base64,${xrayImage}`} alt="X-Ray" className="w-full h-full object-cover" />
                    ) : (
                      <motion.img key="original" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                        src={`data:image/jpeg;base64,${captured}`} alt="Original" className="w-full h-full object-cover" />
                    )}
                  </AnimatePresence>
                  <button onClick={toggleView}
                    className="absolute bottom-2 right-2 px-2 py-1 text-xs rounded bg-black/70 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-950/60 hover:border-cyan-400 transition-all uppercase tracking-wider">
                    {showingXray ? 'Original' : 'X-Ray'}
                  </button>
                </>
              )}

              {/* Error */}
              {state === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                  <span className="text-red-400 text-xs text-center">{error || 'Scan failed.'}</span>
                </div>
              )}
            </div>

            {/* Resize handle — bottom-right corner */}
            <div
              onMouseDown={onResizeStart}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10 flex items-end justify-end pr-0.5 pb-0.5"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M7 1L1 7M7 4L4 7" stroke="rgba(34,211,238,0.5)" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
