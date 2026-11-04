'use client';

import { motion, useDragControls } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../lib/sfx';

const SCAN_DURATION = 0.7;
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface HUDModuleProps {
  id: string;
  title?: string;
  initialX?: number;
  initialY?: number;
  width?: number | string;
  height?: number | string;
  children: React.ReactNode;
  onDelete?: (id: string) => void;
  className?: string;
  isExpanded?: boolean;
  onToggleExpand?: (id: string) => void;
  onResize?: (id: string, width: number, height: number) => void;
  /** When false the widget stays hidden; scan fires the moment this becomes true */
  scanReady?: boolean;
  /** Full-bleed content (e.g. PDF iframe) without inner padding or scroll */
  embedContent?: boolean;
  /** Larger panel when expanded (for document viewing) */
  expandedSize?: 'standard' | 'large';
}

export function HUDModule({
  id,
  title,
  initialX = 0,
  initialY = 0,
  width = 300,
  height = 200,
  children,
  onDelete,
  className,
  isExpanded = false,
  onToggleExpand,
  onResize,
  scanReady = true,
  embedContent = false,
  expandedSize = 'standard',
}: HUDModuleProps) {
  const dragControls = useDragControls();
  const [isHovered, setIsHovered] = useState(false);
  const [scanActive, setScanActive] = useState(scanReady);
  const [scanned, setScanned]     = useState(scanReady); // skip scan if already ready on mount
  const isDraggingRef = useRef(false);
  const resizeRef = useRef({ startX: 0, startY: 0, startWidth: 0, startHeight: 0 });
  // Small per-widget offset so multiple widgets don't scan in perfect lockstep
  const scanDelay = useRef(Math.random() * 0.25);

  // Fire scan the moment scanReady flips true
  useEffect(() => {
    if (scanReady && !scanActive) {
      setScanActive(true);
      setScanned(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanReady]);

  // Animation variants
  const variants = {
    minimized: {
      x: initialX,
      y: initialY,
      width: width,
      height: height,
      zIndex: isHovered ? 10 : 1,
      scale: 1,
      opacity: 1
    },
    expanded: {
      x: '50vw',
      y: '50vh',
      translateX: '-50%',
      translateY: '-50%',
      width: expandedSize === 'large' ? 'min(960px, 90vw)' : '60vw',
      height: expandedSize === 'large' ? 'min(88vh, 1200px)' : '60vh',
      zIndex: 50,
      scale: 1,
      opacity: 1
    },
    exit: {
      opacity: 0,
      scale: 0.9,
      transition: { duration: 0.2 }
    }
  };

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only allow resizing if width/height are numbers
    if (typeof width !== 'number' || typeof height !== 'number') return;

    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: width,
      startHeight: height
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!onResize) return;
      const deltaX = moveEvent.clientX - resizeRef.current.startX;
      const deltaY = moveEvent.clientY - resizeRef.current.startY;
      
      const newWidth = Math.max(200, resizeRef.current.startWidth + deltaX);
      const newHeight = Math.max(150, resizeRef.current.startHeight + deltaY);
      
      onResize(id, newWidth, newHeight);
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <motion.div
      drag={!isExpanded} // Disable drag when expanded
      dragControls={dragControls}
      dragMomentum={false}
      dragListener={false} // Only drag via controls
      initial={{ x: initialX, y: initialY, opacity: 1, scale: 1 }}
      animate={isExpanded ? "expanded" : "minimized"}
      variants={variants}
      exit="exit"
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onDragStart={() => { isDraggingRef.current = true; }}
      onDragEnd={() => { 
        // Small timeout to prevent click from firing immediately after drag
        setTimeout(() => { isDraggingRef.current = false; }, 100); 
      }}
      onClick={() => {
        if (!isDraggingRef.current && !isExpanded && onToggleExpand) {
          onToggleExpand(id);
        }
      }}
      className={cn(
        "absolute flex flex-col pointer-events-auto",
        !isExpanded && "cursor-pointer", // Show pointer when minimized to indicate clickability
        className
      )}
    >
      {/* Main Container with Clipped Corners */}
      <div 
        className={cn(
          "relative w-full h-full bg-black/80 backdrop-blur-md border border-cyan-500/30 overflow-hidden group transition-colors duration-300",
          isExpanded && "expanded"
        )}
        style={{
          clipPath: 'polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 20px 100%, 0 calc(100% - 20px))',
          boxShadow: isExpanded
            ? '0 0 50px rgba(var(--accent-rgb), 0.3)'
            : '0 0 15px rgba(var(--accent-rgb), 0.15)'
        }}
      >
        {/* ── Scan-reveal: hidden until scanReady, then sweeps top-to-bottom ── */}
        <motion.div
          className="absolute inset-0 z-10"
          animate={{ clipPath: scanActive ? 'inset(0 0 0% 0)' : 'inset(0 0 100% 0)' }}
          transition={scanActive && !scanned
            ? { duration: SCAN_DURATION, ease: 'linear', delay: scanDelay.current }
            : { duration: 0 }}
          onAnimationComplete={() => { if (scanActive) setScanned(true); }}
        >
          {/* Decorative Corner Lines */}
          <div className="absolute top-0 right-0 w-[20px] h-[1px] bg-cyan-400/80 origin-right rotate-45 translate-y-[10px] translate-x-[-4px]" />
          <div className="absolute bottom-0 left-0 w-[20px] h-[1px] bg-cyan-400/80 origin-left rotate-45 translate-y-[-10px] translate-x-[4px]" />

          {/* Header / Drag Handle */}
          <div 
            onPointerDown={(e) => { if (!isExpanded) dragControls.start(e); }}
            className={cn(
              "h-8 bg-cyan-950/30 border-b border-cyan-500/20 flex items-center justify-between px-4 select-none transition-colors",
              !isExpanded ? "cursor-grab active:cursor-grabbing" : "cursor-default"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-xs font-bold tracking-widest text-white/80 uppercase truncate flex items-center gap-2">
              {title || 'MODULE'}
              {isExpanded && <span className="text-[10px] text-cyan-400/60">EXPANDED VIEW</span>}
            </span>
            <div className="flex items-center gap-3">
              {isExpanded && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleExpand && onToggleExpand(id); }}
                  className="text-cyan-500 hover:text-cyan-300 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                  </svg>
                </button>
              )}
              {onDelete && !isExpanded && (
                <button
                  onClick={(e) => { e.stopPropagation(); sfx('app_close', 0.6); onDelete(id); }}
                  className="text-cyan-500/50 hover:text-red-400 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Content Area */}
          <div
            className={cn(
              embedContent
                ? 'h-[calc(100%-2rem)] min-h-0 overflow-hidden p-0'
                : 'h-[calc(100%-2rem)] overflow-y-auto overflow-x-hidden p-4 text-white/80 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent'
            )}
          >
            {children}
          </div>

          {/* Corner Accents */}
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-cyan-400" />

          {/* Resize Handle */}
          {!isExpanded && onResize && (
            <div
              className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-20 flex items-end justify-end p-1"
              onPointerDown={handleResizeStart}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-2 h-2 border-r-2 border-b-2 border-cyan-500/50 hover:border-cyan-400 transition-colors" />
            </div>
          )}
        </motion.div>

        {/* ── Scan line — rides the leading edge of the reveal ── */}
        {scanActive && !scanned && (
          <motion.div
            className="absolute inset-x-0 pointer-events-none z-20"
            style={{
              height: 2,
              background: 'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.5) 15%, rgba(34,211,238,1) 50%, rgba(34,211,238,0.5) 85%, transparent 100%)',
              boxShadow: '0 0 12px 5px rgba(34,211,238,0.35)',
            }}
            initial={{ top: 0 }}
            animate={{ top: '100%' }}
            transition={{ duration: SCAN_DURATION, ease: 'linear', delay: scanDelay.current }}
          />
        )}
      </div>
      
      {/* Outer Glow / Border visual fix for clip-path */}
      <div
        className="absolute inset-[-1px] -z-10 pointer-events-none opacity-50"
        style={{
          backgroundColor: 'rgba(var(--accent-rgb), 0.3)',
          clipPath: 'polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 20px 100%, 0 calc(100% - 20px))',
        }}
      />
    </motion.div>
  );
}
