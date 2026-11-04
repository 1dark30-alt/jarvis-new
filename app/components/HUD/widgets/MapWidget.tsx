'use client';

import Image from 'next/image';
import worldMap from '@/elements/world_map.png';

export function MapWidget() {
  return (
    <div className="relative w-full h-full overflow-hidden border border-cyan-500/20 bg-cyan-950/20 flex items-center justify-center group">
      {/* World Map Background - Placed first (bottom layer) */}
      <div className="absolute inset-0 flex items-center justify-center opacity-40 mix-blend-screen transition-opacity duration-500 group-hover:opacity-60 overflow-hidden">
        <div className="relative w-full h-full scale-125">
          <Image
            src={worldMap}
            alt="World Map"
            fill
            className="object-contain drop-shadow-[0_0_4px_rgba(34,211,238,0.3)]"
            priority
          />
          
          {/* Markers - Positioned relative to the map container */}
          {/* Note: Positions are approximate since object-contain might letterbox the image */}
          <div className="absolute top-[42%] left-[25%] z-10">
            <div className="relative">
              <div className="absolute -top-1 -left-1 w-2 h-2 bg-cyan-400 rounded-full animate-ping" />
              <div className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_10px_#22d3ee]" />
            </div>
          </div>
        </div>
      </div>

      {/* Grid Lines - Placed after map (overlay) */}
      <div className="absolute inset-0 z-10 pointer-events-none" 
        style={{ 
          backgroundImage: 'linear-gradient(rgba(6,182,212,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }} 
      />

      {/* Scanning Line - Scans the entire widget */}
      <div className="absolute inset-0 z-20 w-full h-[20%] animate-[scan_4s_linear_infinite] bg-gradient-to-b from-transparent via-cyan-400/20 to-transparent pointer-events-none" />
      
      {/* Coordinates */}
      <div className="absolute bottom-2 left-2 z-30 font-mono text-[10px] text-cyan-400 flex flex-col gap-0.5 bg-black/40 p-1 backdrop-blur-[2px] rounded border border-cyan-900/50">
        <div className="flex justify-between w-24"><span>LAT:</span> <span>34.0522 N</span></div>
        <div className="flex justify-between w-24"><span>LNG:</span> <span>118.2437 W</span></div>
        <div className="flex justify-between w-24 text-cyan-500/60"><span>LOC:</span> <span>SECURE</span></div>
      </div>
      
      <style jsx>{`
        @keyframes scan {
          0% { top: -20%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
