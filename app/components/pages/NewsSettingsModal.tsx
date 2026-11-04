'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

export interface NewsSettings {
  streamUrl: string;
  stockSymbols: string;
}

interface Props {
  settings: NewsSettings;
  onClose: () => void;
  onSave: (s: NewsSettings) => void;
}

export function NewsSettingsModal({ settings, onClose, onSave }: Props) {
  const [form, setForm] = useState<NewsSettings>(settings);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 16 }}
        transition={{ duration: 0.2 }}
        className="w-[500px] bg-black border border-cyan-500/25 rounded-lg p-7 shadow-2xl shadow-cyan-500/10"
      >
        <div className="flex items-center justify-between mb-7">
          <div>
            <h2 className="text-cyan-400 font-mono text-xs font-bold uppercase tracking-widest">
              News Feed Settings
            </h2>
            <p className="text-white/30 text-[10px] font-mono mt-1">Configure stream and market data</p>
          </div>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/70 transition-colors text-base w-7 h-7 flex items-center justify-center rounded hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        <div className="space-y-6">
          {/* Stream URL */}
          <div>
            <label className="block text-[10px] text-white/50 font-mono uppercase tracking-widest mb-2">
              Live Stream URL
            </label>
            <input
              type="text"
              value={form.streamUrl}
              onChange={(e) => setForm((f) => ({ ...f, streamUrl: e.target.value }))}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-white/20"
            />
            <p className="mt-1.5 text-[10px] text-white/25 font-mono">
              YouTube URL (watch/live/shorts), direct embed URL, or any HLS-compatible stream
            </p>
          </div>

          {/* Stock symbols */}
          <div>
            <label className="block text-[10px] text-white/50 font-mono uppercase tracking-widest mb-2">
              Stock Symbols
            </label>
            <input
              type="text"
              value={form.stockSymbols}
              onChange={(e) => setForm((f) => ({ ...f, stockSymbols: e.target.value }))}
              placeholder="AAPL,TSLA,NVDA,MSFT,AMZN"
              className="w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-white/20"
            />
            <p className="mt-1.5 text-[10px] text-white/25 font-mono">
              Comma-separated ticker symbols (up to 12) — powered by Yahoo Finance
            </p>
          </div>

          {/* Preset channels */}
          <div>
            <label className="block text-[10px] text-white/50 font-mono uppercase tracking-widest mb-2">
              Quick Presets
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Al Jazeera', url: 'https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg' },
                { label: 'BBC News', url: 'https://www.youtube.com/embed/live_stream?channel=UC16niRr50-MSBwiO3YDb3RA' },
                { label: 'DW News', url: 'https://www.youtube.com/embed/live_stream?channel=UCknLrEdhRCp1aegoMqRaCZg' },
                { label: 'Bloomberg', url: 'https://www.youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setForm((f) => ({ ...f, streamUrl: preset.url }))}
                  className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors uppercase tracking-wider ${
                    form.streamUrl === preset.url
                      ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-400'
                      : 'border-white/10 bg-white/[0.02] text-white/40 hover:text-white/70 hover:border-white/20'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8 pt-5 border-t border-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors uppercase tracking-wider"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(form); onClose(); }}
            className="px-5 py-2 text-[10px] font-mono bg-cyan-500/15 text-cyan-400 border border-cyan-500/35 rounded hover:bg-cyan-500/25 transition-colors uppercase tracking-wider"
          >
            Save Settings
          </button>
        </div>
      </motion.div>
    </div>
  );
}
