'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ConversationProvider } from '@elevenlabs/react';
import { JarvisAssistant } from "./components/JarvisAssistant";
import { HUDLayer } from "./components/HUD/HUDLayer";
import { IntroAnimation } from "./components/IntroAnimation";
import { NotificationLayer } from "./components/NotificationLayer";
import { RadialNav } from "./components/RadialNav";
import { CommandPalette } from "./components/CommandPalette";
import { AmbientMode } from "./components/AmbientMode";
import { LockController } from "./components/LockScreen";
import { RoutineAgent } from "./components/RoutineAgent";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { NewsPage } from "./components/pages/NewsPage";
import { CalendarPage } from "./components/pages/CalendarPage";
import { HomeAssistantPage } from "./components/pages/HomeAssistantPage";
import { PrinterPage } from "./components/pages/PrinterPage";
import { MusicPage } from "./components/pages/MusicPage";
import { AnimatePresence } from 'framer-motion';
import { loadServerSettings } from './lib/serverSettings';
import { playSfxAwait } from './lib/sfx';

function isIntroAnimationDisabled(): boolean {
  try {
    const raw = localStorage.getItem('jarvis_settings');
    if (!raw) return false;
    return !!(JSON.parse(raw) as { disableIntroAnimation?: boolean }).disableIntroAnimation;
  } catch {
    return false;
  }
}

// MapLibre GL JS accesses browser APIs on import — must be client-only (no SSR)
const MapPage = dynamic(
  () => import('./components/pages/MapPage').then((m) => ({ default: m.MapPage })),
  { ssr: false }
);

// Three.js suit gallery — client-only, keeps three out of the main bundle
const SpidermanPage = dynamic(
  () => import('./components/pages/SpidermanPage').then((m) => ({ default: m.SpidermanPage })),
  { ssr: false }
);

// Three.js fabrication bay — client-only for the same reason
const ManufacturingPage = dynamic(
  () => import('./components/pages/ManufacturingPage').then((m) => ({ default: m.ManufacturingPage })),
  { ssr: false }
);

// Three.js web-shooter designer — client-only for the same reason
const WebshooterPage = dynamic(
  () => import('./components/pages/WebshooterPage').then((m) => ({ default: m.WebshooterPage })),
  { ssr: false }
);

// Electron <webview> social dashboard — client-only
const SocialMediaPage = dynamic(
  () => import('./components/pages/SocialMediaPage').then((m) => ({ default: m.SocialMediaPage })),
  { ssr: false }
);

const AudioTestPage = dynamic(
  () => import('./components/pages/AudioTestPage').then((m) => ({ default: m.AudioTestPage })),
  { ssr: false }
);

// Local web apps ported from the JARVIS-system plugin collection
const BountyHunterPage = dynamic(
  () => import('./components/pages/BountyHunterPage').then((m) => ({ default: m.BountyHunterPage })),
  { ssr: false }
);

const WildcardDrawPage = dynamic(
  () => import('./components/pages/WildcardDrawPage').then((m) => ({ default: m.WildcardDrawPage })),
  { ssr: false }
);

// God's Eye — satellite intelligence console (own Vite service on port 4173)
const GodsEyePage = dynamic(
  () => import('./components/pages/GodsEyePage').then((m) => ({ default: m.GodsEyePage })),
  { ssr: false }
);

// Disk Map — live treemap of disk usage (scanner streams from /api/disk-map)
const DiskMapPage = dynamic(
  () => import('./components/pages/DiskMapPage').then((m) => ({ default: m.DiskMapPage })),
  { ssr: false }
);

// Build Guide — wiring diagrams drawn from a structured plan
const BuildGuidePage = dynamic(
  () => import('./components/pages/BuildGuidePage').then((m) => ({ default: m.BuildGuidePage })),
  { ssr: false }
);

// Missions — background agents working while the conversation goes on
const MissionsPage = dynamic(
  () => import('./components/pages/MissionsPage').then((m) => ({ default: m.MissionsPage })),
  { ssr: false }
);

// Memory — every stored fact, when it was learned, one-click delete
const MemoryPage = dynamic(
  () => import('./components/pages/MemoryPage').then((m) => ({ default: m.MemoryPage })),
  { ssr: false }
);

// Health — machine gauges + service checks, no model call needed
const HealthPage = dynamic(
  () => import('./components/pages/HealthPage').then((m) => ({ default: m.HealthPage })),
  { ssr: false }
);

// Developer — allowlisted engineering jobs with outputs
const DevModePage = dynamic(
  () => import('./components/pages/DevModePage').then((m) => ({ default: m.DevModePage })),
  { ssr: false }
);

// Market — candles + deterministic engine stats (Yahoo Finance)
const MarketPage = dynamic(
  () => import('./components/pages/MarketPage').then((m) => ({ default: m.MarketPage })),
  { ssr: false }
);

// Network Radar — devices + connection quality on a live radar
const NetworkRadarPage = dynamic(
  () => import('./components/pages/NetworkRadarPage').then((m) => ({ default: m.NetworkRadarPage })),
  { ssr: false }
);

type JarvisPage = 'home' | 'news' | 'map' | 'calendar' | 'home-assistant' | '3d-printers' | 'music' | 'round-display' | 'spiderman' | 'manufacturing' | 'webshooter' | 'social' | 'audio-test' | 'bounty-hunter' | 'wildcard-draw' | 'gods-eye' | 'disk-map' | 'build-guide' | 'missions' | 'memory' | 'health' | 'dev-mode' | 'market' | 'network-radar';

const VALID_PAGES: JarvisPage[] = ['home', 'news', 'map', 'calendar', 'home-assistant', '3d-printers', 'music', 'round-display', 'spiderman', 'manufacturing', 'webshooter', 'social', 'audio-test', 'bounty-hunter', 'wildcard-draw', 'gods-eye', 'disk-map', 'build-guide', 'missions', 'memory', 'health', 'dev-mode', 'market', 'network-radar'];

interface BuildModel { file: string; name: string; sub: string }

export default function Home() {
  const [showIntro, setShowIntro]         = useState(false);
  const [contentReady, setContentReady]   = useState(false);
  // Always start on 'home' so server and client render the same HTML (no
  // hydration mismatch). The saved page is restored in a useEffect after
  // hydration — this avoids the typeof window SSR/client branch error.
  const [currentPage, setCurrentPage]     = useState<JarvisPage>('home');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pendingMapCmd, setPendingMapCmd] = useState<Record<string, any> | null>(null);
  // Model handed to the manufacturing page by the armory BUILD button
  const [pendingBuildModel, setPendingBuildModel] = useState<BuildModel | null>(null);

  // Persist current page so it survives full tab reloads (iOS Safari jettisoning,
  // Next.js HMR reconnects, etc.)
  useEffect(() => {
    localStorage.setItem('jarvis_current_page', currentPage);
  }, [currentPage]);

  useEffect(() => {
    // Log the reason for this page mount — critical for diagnosing unexpected reloads.
    const nav = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined);
    const navType = nav?.type ?? 'unknown'; // 'navigate' | 'reload' | 'back_forward' | 'prerender'
    const restored = localStorage.getItem('jarvis_current_page');
    console.log(
      `%c[Jarvis Page] MOUNTED — nav type: "${navType}" | restored page: "${restored ?? 'none'}" | timestamp: ${new Date().toLocaleTimeString()}`,
      'background:#1a1a2e;color:#00d4ff;font-weight:bold;padding:2px 6px;border-radius:3px'
    );
    if (navType === 'reload') {
      console.warn('[Jarvis Page] ⚠️  This was a hard browser reload (F5 or programmatic window.location.reload).');
    } else if (navType === 'navigate') {
      console.warn('[Jarvis Page] ⚠️  This was a fresh navigation — likely Next.js HMR reconnect or iOS/Android tab jettison (browser killed the tab due to memory pressure).');
    }
  }, []);

  useEffect(() => {
    // Pre-warm the server settings cache so all child components can read
    // getCachedSetting() synchronously before their own effects run.
    loadServerSettings();

    // Defer state restoration out of the effect body (react-hooks/set-state-in-effect)
    const timer = window.setTimeout(() => {
      // Restore the last page the user was on after hydration completes.
      const saved = localStorage.getItem('jarvis_current_page') as JarvisPage | null;
      if (saved && VALID_PAGES.includes(saved) && saved !== 'home') {
        setCurrentPage(saved);
      }

      const seen = sessionStorage.getItem('jarvis_intro_done');
      if (!seen && !isIntroAnimationDisabled()) {
        setShowIntro(true);
      } else {
        sessionStorage.setItem('jarvis_intro_done', '1');
        setContentReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Play pre-recorded Jarvis intro voice as soon as the boot sequence starts
  useEffect(() => {
    if (!showIntro) return;
    void playSfxAwait('jarvis_intro_preferences', 1);
  }, [showIntro]);

  // Listen for navigate events dispatched by Jarvis functions
  useEffect(() => {
    const handler = (e: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (e as CustomEvent<any>).detail ?? {};
      const page: JarvisPage = detail.page;
      if (VALID_PAGES.includes(page)) {
        setCurrentPage(page);
        if (page === 'map' && detail.mapCommand) {
          setPendingMapCmd(detail.mapCommand);
        }
        if (page === 'manufacturing') {
          setPendingBuildModel(detail.buildModel ?? null);
        }
      }
    };
    window.addEventListener('jarvis:navigate', handler);
    return () => window.removeEventListener('jarvis:navigate', handler);
  }, []);

  const handleIntroComplete = () => {
    sessionStorage.setItem('jarvis_intro_done', '1');
    setShowIntro(false);
  };

  return (
    <main className="min-h-screen bg-black text-white overflow-hidden relative">
      {/* Home layer — always mounted so audio/AI session persists across pages.
          JarvisAssistant becomes a compact corner visualizer when on other pages. */}
      <div style={{ opacity: contentReady ? 1 : 0, transition: 'none' }}>
        <ConversationProvider>
          <JarvisAssistant
            compact={currentPage !== 'home' && currentPage !== 'round-display'}
            roundDisplay={currentPage === 'round-display'}
          />
        </ConversationProvider>
      </div>

      {/* HUD widgets — sit behind page overlays, hidden on round display */}
      {currentPage !== 'round-display' && <HUDLayer scanReady={contentReady} />}

      {/* Page overlays — slide in over the home layer */}
      <AnimatePresence mode="wait">
        {currentPage === 'news' && (
          <NewsPage key="news" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'map' && (
          <MapPage
            key="map"
            onNavigateHome={() => setCurrentPage('home')}
            pendingCommand={pendingMapCmd}
            onPendingCommandConsumed={() => setPendingMapCmd(null)}
          />
        )}
        {currentPage === 'calendar' && (
          <CalendarPage key="calendar" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'home-assistant' && (
          <HomeAssistantPage key="home-assistant" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === '3d-printers' && (
          <PrinterPage key="3d-printers" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'music' && (
          <MusicPage key="music" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'spiderman' && (
          <SpidermanPage key="spiderman" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'manufacturing' && (
          <ManufacturingPage
            key="manufacturing"
            onNavigateHome={() => setCurrentPage('home')}
            initialModel={pendingBuildModel}
          />
        )}
        {currentPage === 'webshooter' && (
          <WebshooterPage key="webshooter" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'social' && (
          <SocialMediaPage key="social" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'audio-test' && (
          <AudioTestPage key="audio-test" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'bounty-hunter' && (
          <BountyHunterPage key="bounty-hunter" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'wildcard-draw' && (
          <WildcardDrawPage key="wildcard-draw" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'gods-eye' && (
          <GodsEyePage key="gods-eye" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'disk-map' && (
          <DiskMapPage key="disk-map" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'build-guide' && (
          <BuildGuidePage key="build-guide" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'missions' && (
          <MissionsPage key="missions" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'memory' && (
          <MemoryPage key="memory" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'health' && (
          <HealthPage key="health" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'dev-mode' && (
          <DevModePage key="dev-mode" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'market' && (
          <MarketPage key="market" onNavigateHome={() => setCurrentPage('home')} />
        )}
        {currentPage === 'network-radar' && (
          <NetworkRadarPage key="network-radar" onNavigateHome={() => setCurrentPage('home')} />
        )}
      </AnimatePresence>

      {/* Global chrome — radial nav, palette, toasts, ambient, lock */}
      {contentReady && (
        <>
          <RadialNav currentPage={currentPage} />
          <CommandPalette />
          <NotificationLayer />
          <RoutineAgent />
          <AmbientMode />
          <OnboardingWizard />
          <LockController />
        </>
      )}

      {/* Intro overlay */}
      <AnimatePresence>
        {showIntro && (
          <IntroAnimation
            onComplete={handleIntroComplete}
            onFadeStart={() => setContentReady(true)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
