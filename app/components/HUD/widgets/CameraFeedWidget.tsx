'use client';

import { useEffect, useRef, useState } from 'react';

/** Live webcam feed with a security-cam style HUD overlay. The stream is
 *  released the moment the widget is closed. */
export function CameraFeedWidget() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [clock, setClock] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (e) {
        if (alive) setError(String(e instanceof Error ? e.message : e));
      }
    })();

    const t = window.setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => {
      alive = false;
      window.clearInterval(t);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1">
        <p className="font-mono text-[10px] text-red-400/80 uppercase tracking-widest">Camera unavailable</p>
        <p className="font-mono text-[9px] text-white/25 text-center px-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <video ref={videoRef} muted playsInline className="w-full h-full object-cover opacity-90" />

      {/* HUD overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1.5 left-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" style={{ boxShadow: '0 0 6px #ef4444' }} />
          <span className="font-mono text-[9px] font-bold text-red-400 tracking-widest">LIVE</span>
        </div>
        <div className="absolute top-1.5 right-2 font-mono text-[9px] text-white/60 tracking-wider">{clock}</div>
        <div className="absolute bottom-1.5 left-2 font-mono text-[8px] text-white/40 uppercase tracking-widest">CAM 01 · LOCAL</div>
        {/* Corner brackets */}
        <div className="absolute top-1 left-1 w-3 h-3 border-t border-l" style={{ borderColor: 'rgba(var(--accent-rgb, 34, 211, 238), 0.6)' }} />
        <div className="absolute top-1 right-1 w-3 h-3 border-t border-r" style={{ borderColor: 'rgba(var(--accent-rgb, 34, 211, 238), 0.6)' }} />
        <div className="absolute bottom-1 left-1 w-3 h-3 border-b border-l" style={{ borderColor: 'rgba(var(--accent-rgb, 34, 211, 238), 0.6)' }} />
        <div className="absolute bottom-1 right-1 w-3 h-3 border-b border-r" style={{ borderColor: 'rgba(var(--accent-rgb, 34, 211, 238), 0.6)' }} />
      </div>
    </div>
  );
}
