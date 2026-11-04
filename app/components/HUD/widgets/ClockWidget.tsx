'use client';

import { useEffect, useState } from 'react';

export function ClockWidget() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours().toString().padStart(2, '0');
  const minutes = time.getMinutes().toString().padStart(2, '0');
  const seconds = time.getSeconds().toString().padStart(2, '0');

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="flex items-baseline gap-2">
        <div className="text-5xl font-bold text-white font-mono tracking-wider drop-shadow-[0_0_12px_rgba(255,255,255,0.3)]">
          {hours}:{minutes}
        </div>
        <div className="text-2xl text-white/40 font-mono">
          {seconds}
        </div>
      </div>
      <div className="text-xs text-cyan-400/70 mt-4 tracking-[0.2em] uppercase">
        {time.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
    </div>
  );
}
