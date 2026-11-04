'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HeadlineTicker } from './HeadlineTicker';
import { MarketIndicesBar } from './MarketIndicesBar';
import { StocksColumn } from './StocksColumn';
import { TopStories } from './TopStories';
import { NewsSettingsModal, NewsSettings } from './NewsSettingsModal';
import { saveServerSettings, getCachedSetting } from '../../lib/serverSettings';
import { PageHeader } from '../PageHeader';

const DEFAULT_NEWS_SETTINGS: NewsSettings = {
  streamUrl: 'https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg',
  stockSymbols: 'AAPL,TSLA,NVDA,MSFT,AMZN,META,GOOGL',
};

function toEmbedUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return DEFAULT_NEWS_SETTINGS.streamUrl;
  if (url.includes('youtube.com/embed')) {
    return url.includes('autoplay') ? url : `${url}${url.includes('?') ? '&' : '?'}autoplay=1`;
  }
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}?autoplay=1`;
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}?autoplay=1`;
  const liveMatch = url.match(/youtube\.com\/live\/([a-zA-Z0-9_-]{11})/);
  if (liveMatch) return `https://www.youtube.com/embed/${liveMatch[1]}?autoplay=1`;
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return `https://www.youtube.com/embed/${url}?autoplay=1`;
  return url;
}

function loadNewsSettings(): NewsSettings {
  if (typeof window === 'undefined') return DEFAULT_NEWS_SETTINGS;
  try {
    // Check server cache first, then localStorage
    const s = getCachedSetting('jarvis_news_settings') || localStorage.getItem('jarvis_news_settings');
    if (s) return { ...DEFAULT_NEWS_SETTINGS, ...JSON.parse(s) };
  } catch { /* fall through */ }
  return DEFAULT_NEWS_SETTINGS;
}

interface Props {
  onNavigateHome: () => void;
}

export function NewsPage({ onNavigateHome }: Props) {
  const [settings, setSettings] = useState<NewsSettings>(loadNewsSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const embedUrl = toEmbedUrl(settings.streamUrl);

  const saveSettings = (s: NewsSettings) => {
    setSettings(s);
    const serialised = JSON.stringify(s);
    localStorage.setItem('jarvis_news_settings', serialised);
    saveServerSettings({ jarvis_news_settings: serialised });
  };

  return (
    <motion.div
      key="news-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* ── Row 1: Standard nav header ── */}
      <PageHeader
        title="News"
        onNavigateHome={onNavigateHome}
        accent="green"
        right={
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="w-7 h-7 flex items-center justify-center rounded bg-white/[0.04] border border-white/[0.08] text-white/35 hover:text-cyan-400 hover:border-cyan-500/30 transition-all text-xs"
          >
            ⚙
          </button>
        }
      />

      {/* ── Row 2: Horizontal headline ticker ── */}
      <HeadlineTicker />

      {/* ── Row 3: Global market indices bar ── */}
      <MarketIndicesBar />

      {/* ── Row 4: Main content ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* LEFT: stream + top stories below */}
        <div className="flex-1 flex flex-col p-3 pr-2 gap-2 min-w-0 overflow-hidden">

          {/* Stream label row */}
          <div className="flex items-center justify-between shrink-0 px-0.5">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">Live Feed</span>
            </div>
          </div>

          {/* Stream iframe — takes up most of the left column */}
          <div className="relative rounded overflow-hidden border border-cyan-500/10 bg-black min-h-0" style={{ flex: '1 1 0' }}>
            <iframe
              key={embedUrl}
              src={embedUrl}
              className="w-full h-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              style={{ border: 'none', display: 'block' }}
            />
            {/* HUD corner brackets */}
            <div className="absolute top-0 left-0 w-8 h-8 pointer-events-none border-t-2 border-l-2 border-cyan-500/20 rounded-tl" />
            <div className="absolute top-0 right-0 w-8 h-8 pointer-events-none border-t-2 border-r-2 border-cyan-500/20 rounded-tr" />
            <div className="absolute bottom-0 left-0 w-8 h-8 pointer-events-none border-b-2 border-l-2 border-cyan-500/20 rounded-bl" />
            <div className="absolute bottom-0 right-0 w-8 h-8 pointer-events-none border-b-2 border-r-2 border-cyan-500/20 rounded-br" />
          </div>

          {/* TOP STORIES — vertical scrolling bar below the stream */}
          <div className="flex shrink-0 h-[88px] rounded border border-cyan-500/10 bg-black/50 overflow-hidden">
            {/* Left label */}
            <div className="w-24 shrink-0 flex flex-col items-center justify-center gap-1.5 border-r border-cyan-500/10 bg-cyan-500/[0.04]">
              <div className="w-1 h-1 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-[8px] font-mono text-cyan-400/60 uppercase tracking-widest text-center leading-relaxed">
                Top<br />Stories
              </span>
            </div>
            {/* Scrolling stories */}
            <div className="flex-1 px-3 py-1 min-w-0">
              <TopStories />
            </div>
          </div>
        </div>

        {/* RIGHT: controls header + stocks */}
        <div className="w-[320px] shrink-0 flex flex-col border-l border-cyan-500/10 bg-black/40 overflow-hidden">

          {/* Panel header */}
          <div className="flex items-center px-3 py-2.5 border-b border-cyan-500/10 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="ml-2 text-[9px] font-mono text-cyan-400/60 uppercase tracking-widest">Markets</span>
          </div>

          {/* Stocks — scrollable */}
          <div className="flex-1 overflow-y-auto px-3 pt-3 pb-2 min-h-0">
            <StocksColumn symbols={settings.stockSymbols} />
          </div>

          {/* Bottom spacer so compact Jarvis (z-60, bottom-right) doesn't overlap stocks */}
          <div className="h-44 shrink-0" />
        </div>
      </div>

      {/* Settings modal */}
      <AnimatePresence>
        {settingsOpen && (
          <NewsSettingsModal
            key="news-settings"
            settings={settings}
            onClose={() => setSettingsOpen(false)}
            onSave={saveSettings}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
