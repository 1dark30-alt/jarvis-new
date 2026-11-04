'use client';

import { useEffect, useState } from 'react';

export function SystemStatusWidget() {
  const [cpu, setCpu] = useState(0);
  const [memory, setMemory] = useState(0);
  const [temp, setTemp] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCpu(Math.floor(Math.random() * 30) + 10);
      setMemory(Math.floor(Math.random() * 20) + 40);
      setTemp(Math.floor(Math.random() * 15) + 45);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="space-y-1">
        <div className="flex justify-between text-white/80">
          <span>CPU LOAD</span>
          <span className="text-white">{cpu}%</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${cpu}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-white/80">
          <span>MEMORY</span>
          <span className="text-white">{memory}%</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${memory}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-white/80">
          <span>CORE TEMP</span>
          <span className="text-white">{temp}°C</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${(temp / 100) * 100}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-4">
        <div className="bg-white/5 p-2 border border-cyan-500/20 text-center">
          <div className="text-[10px] text-cyan-400">UPTIME</div>
          <div className="text-white">14:02:33</div>
        </div>
        <div className="bg-white/5 p-2 border border-cyan-500/20 text-center">
          <div className="text-[10px] text-cyan-400">PROCESSES</div>
          <div className="text-white">142</div>
        </div>
      </div>
    </div>
  );
}
