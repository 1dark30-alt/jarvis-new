'use client';

import { useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';

export interface PhotoEntry {
  id: string;
  dataUrl: string;
  name: string;
}

interface Props {
  photo: PhotoEntry;
  index: number;
  onDismiss: (id: string) => void;
}

const MIN_SIZE = 160;
const DEFAULT_SIZE = 240;

export function PhotoWidget({ photo, index, onDismiss }: Props) {
  const constraintsRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const resizingRef = useRef(false);
  const startRef = useRef({ x: 0, startSize: 0 });

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

  return (
    <>
      <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-40" />
      <motion.div
        drag
        dragConstraints={constraintsRef}
        dragMomentum={false}
        dragListener={!resizingRef.current}
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ duration: 0.25 }}
        style={{
          width: size,
          // Offset each card so they don't stack on top of each other
          bottom: `${2 + index * 1.5}rem`,
          left: `${2 + index * 2}rem`,
        }}
        className="fixed z-50 rounded-lg overflow-hidden border border-cyan-500/40 shadow-[0_0_30px_rgba(34,211,238,0.2)] bg-black/90 select-none"
      >
        {/* Header */}
        <div className="px-3 py-1.5 bg-cyan-950/40 border-b border-cyan-500/20 flex items-center gap-2 cursor-grab active:cursor-grabbing">
          <span className="text-xs font-bold text-cyan-400 uppercase tracking-widest truncate flex-1">
            {photo.name || `Image ${index + 1}`}
          </span>
          <span className="text-[10px] text-cyan-600 font-mono flex-shrink-0">#{index + 1}</span>
          <button
            onClick={() => onDismiss(photo.id)}
            className="ml-1 text-cyan-600 hover:text-cyan-300 text-xs cursor-pointer flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Image */}
        <div className="relative w-full bg-black/60" style={{ height: size }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.dataUrl}
            alt={photo.name}
            className="w-full h-full object-contain"
            draggable={false}
          />
          {/* Jarvis-context badge */}
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/30 text-[9px] text-cyan-400/80 uppercase tracking-widest font-mono">
            in context
          </div>
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10 flex items-end justify-end pr-0.5 pb-0.5"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M7 1L1 7M7 4L4 7" stroke="rgba(34,211,238,0.4)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </motion.div>
    </>
  );
}
