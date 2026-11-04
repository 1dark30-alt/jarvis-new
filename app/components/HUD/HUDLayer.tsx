'use client';

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useIsMobile } from '../../lib/useIsMobile';
import { sfx } from '../../lib/sfx';
import { HUDModule } from './HUDModule';
import { SystemStatusWidget } from './widgets/SystemStatusWidget';
import { NetworkGraphWidget } from './widgets/NetworkGraphWidget';
import { MapWidget } from './widgets/MapWidget';
import { ClockWidget } from './widgets/ClockWidget';
import { SuitWidget } from './widgets/SuitWidget';
import { MusicWidget } from './widgets/MusicWidget';
import { TextWidget } from './widgets/TextWidget';
import { PdfWidget } from './widgets/PdfWidget';
import { ImageWidget } from './widgets/ImageWidget';
import { TerminalWidget } from './widgets/TerminalWidget';
import { TVWidget } from './widgets/TVWidget';
import { PrinterWidget } from './widgets/PrinterWidget';
import { WeatherHomeWidget } from './widgets/WeatherHomeWidget';
import { HADeviceWidget } from './widgets/HADeviceWidget';
import { ModelHudWidget } from './widgets/ModelHudWidget';
import { AgendaWidget } from './widgets/AgendaWidget';
import { TodoWidget } from './widgets/TodoWidget';
import { StocksWidget } from './widgets/StocksWidget';
import { HeadlinesWidget } from './widgets/HeadlinesWidget';
import { TimerWidget } from './widgets/TimerWidget';
import { WeatherRadarWidget } from './widgets/WeatherRadarWidget';
import { CameraFeedWidget } from './widgets/CameraFeedWidget';
import { TranscriptWidget } from './widgets/TranscriptWidget';
import { UptimeWidget } from './widgets/UptimeWidget';
import { OrbitWidget } from './widgets/OrbitWidget';
import { CalculatorWidget } from './widgets/CalculatorWidget';
import { getCachedSetting, loadServerSettings } from '../../lib/serverSettings';
import { notify } from '../../lib/notify';

type WidgetType =
  | 'system' | 'network' | 'map' | 'clock' | 'suit' | 'music' | 'text' | 'pdf' | 'image'
  | 'terminal' | 'tv' | 'printer' | 'weather-home' | 'ha-device' | 'ha-toggle' | 'model-viewer'
  | 'agenda' | 'todo' | 'stocks' | 'headlines' | 'timer' | 'weather-radar' | 'camera-feed'
  | 'transcript' | 'uptime' | 'orbit' | 'calculator';

interface ModuleData {
  id: string;
  type: WidgetType;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Body copy for the text note widget */
  textContent?: string;
  /** URL or filesystem path for the PDF viewer */
  pdfSource?: string;
  /** PNG base64 from image generation */
  imageBase64?: string;
  imageLoading?: boolean;
  imageError?: string;
  /** Short prompt preview */
  imageCaption?: string;
  /** If set, x is recomputed as (windowWidth - rightOffset) on resize */
  rightOffset?: number;
  /** Extra config for dynamic widgets (tv, printer, ha-device) */
  widgetConfig?: Record<string, unknown>;
  /** Path for model-viewer widget */
  modelPath?: string;
}

const WIDGET_META: Record<WidgetType, { title: string; width: number; height: number }> = {
  clock:        { title: 'LOCAL TIME',      width: 300, height: 180 },
  system:       { title: 'SYSTEM STATUS',   width: 300, height: 250 },
  network:      { title: 'NETWORK TRAFFIC', width: 300, height: 200 },
  map:          { title: 'GEO-LOCATION',    width: 400, height: 250 },
  suit:         { title: 'MK.2 ARMOR',      width: 240, height: 500 },
  music:        { title: 'NOW PLAYING',     width: 280, height: 340 },
  text:         { title: 'TEXT NOTE',       width: 380, height: 280 },
  pdf:          { title: 'DOCUMENT',        width: 440, height: 340 },
  image:        { title: 'IMAGE',           width: 400, height: 360 },
  terminal:     { title: 'ERROR TERMINAL',  width: 540, height: 380 },
  tv:           { title: 'TV CONTROL',      width: 320, height: 260 },
  printer:      { title: '3D PRINTER',      width: 300, height: 340 },
  'weather-home': { title: 'WEATHER',       width: 280, height: 140 },
  'ha-device':  { title: 'DEVICES',         width: 280, height: 260 },
  'ha-toggle':  { title: 'TOGGLE',          width: 80,  height: 80  },
  'model-viewer': { title: '3D MODEL',      width: 360, height: 360 },
  agenda:       { title: 'AGENDA',          width: 320, height: 260 },
  todo:         { title: 'TASKS',           width: 300, height: 280 },
  stocks:       { title: 'MARKETS',         width: 320, height: 240 },
  headlines:    { title: 'HEADLINES',       width: 320, height: 210 },
  timer:        { title: 'TIMERS',          width: 280, height: 240 },
  'weather-radar': { title: 'WEATHER RADAR', width: 340, height: 300 },
  'camera-feed': { title: 'CAMERA FEED',    width: 360, height: 280 },
  transcript:   { title: 'COMMS LOG',       width: 340, height: 300 },
  uptime:       { title: 'HOST MONITOR',    width: 300, height: 220 },
  orbit:        { title: 'ORBITAL TRACKER', width: 340, height: 290 },
  calculator:   { title: 'COMPUTE',         width: 280, height: 380 },
};

// ── HUD layout persistence ───────────────────────────────────────────────────
// The live layout (positions + sizes) is saved to localStorage so it survives
// reloads. Named presets ("workshop", "monitoring"…) are stored separately and
// can be saved/loaded via the jarvis:hud event (voice + command palette).

const LAYOUT_KEY = 'jarvis_hud_layout_current';
const PRESETS_KEY = 'jarvis_hud_layouts';

/** Widgets whose state can't meaningfully survive a reload (large base64
 *  payloads or one-shot content) are excluded from persistence. */
const NON_PERSISTED_TYPES: WidgetType[] = ['image'];

function sanitizeForStorage(modules: ModuleData[]): ModuleData[] {
  return modules
    .filter(m => !NON_PERSISTED_TYPES.includes(m.type))
    .map(m => {
      const copy = { ...m };
      delete copy.imageBase64;
      delete copy.imageLoading;
      delete copy.imageError;
      return copy;
    });
}

function loadSavedLayout(w: number): ModuleData[] | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModuleData[];
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(m => m && typeof m.id === 'string' && WIDGET_META[m.type])
      .map(m => m.rightOffset !== undefined ? { ...m, x: w - m.rightOffset } : m);
  } catch {
    return null;
  }
}

function loadPresets(): Record<string, ModuleData[]> {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ModuleData[]>) : {};
  } catch {
    return {};
  }
}

/** Scan the screen in a grid and return the first (x,y) where a rect of
 *  size (newW × newH) doesn't overlap any existing module (with padding). */
function findOpenSpot(
  newW: number,
  newH: number,
  existing: Array<{ x: number; y: number; width: number; height: number }>,
): { x: number; y: number } {
  const PAD = 24;
  const vw = typeof window !== 'undefined' ? window.innerWidth  : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const STEP = 40;
  const TOP_MARGIN = 72;  // avoid nav bar
  const LEFT_MARGIN = 60;

  for (let y = TOP_MARGIN; y + newH + PAD < vh; y += STEP) {
    for (let x = LEFT_MARGIN; x + newW + PAD < vw; x += STEP) {
      const overlaps = existing.some(
        m =>
          x < m.x + m.width  + PAD &&
          x + newW + PAD > m.x &&
          y < m.y + m.height + PAD &&
          y + newH + PAD > m.y,
      );
      if (!overlaps) return { x, y };
    }
  }
  // Last-resort centre
  return {
    x: Math.max(LEFT_MARGIN, Math.round((vw - newW) / 2)),
    y: Math.max(TOP_MARGIN,  Math.round((vh - newH) / 2)),
  };
}

function buildDefaultModules(w: number): ModuleData[] {
  return [
    { id: '1', type: 'clock',   ...WIDGET_META.clock,   x: 50,       y: 50  },
    { id: '2', type: 'system',  ...WIDGET_META.system,  x: 50,       y: 250 },
    { id: '3', type: 'network', ...WIDGET_META.network, x: 50,       y: 520 },
    { id: '4', type: 'map',     ...WIDGET_META.map,     x: w - 450,  y: 50,  rightOffset: 450 },
    { id: '5', type: 'suit',    ...WIDGET_META.suit,    x: w - 300,  y: 320, rightOffset: 300 },
  ];
}

export function HUDLayer({ scanReady = true }: { scanReady?: boolean }) {
  const isMobile = useIsMobile();
  const [modules, setModules] = useState<ModuleData[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    // On mobile, start with no default widgets — keeps the UI clean
    if (isMobile) return;
    // Restore the persisted layout; fall back to defaults on first run
    const saved = loadSavedLayout(window.innerWidth);
    setModules(saved ?? buildDefaultModules(window.innerWidth));
    hydratedRef.current = true;

    const handleResize = () => {
      const w = window.innerWidth;
      setModules(prev => prev.map(m =>
        m.rightOffset !== undefined ? { ...m, x: w - m.rightOffset } : m
      ));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Persist the live layout so widgets survive reloads (debounced)
  useEffect(() => {
    if (!hydratedRef.current || isMobile) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(sanitizeForStorage(modules)));
      } catch { /* storage full — non-critical */ }
    }, 400);
    return () => window.clearTimeout(t);
  }, [modules, isMobile]);

  // Listen for Jarvis HUD control events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        command: string;
        widget?: string;
        text?: string;
        title?: string;
        pdf_source?: string;
        module_id?: string;
        image_loading?: boolean;
        image_base64?: string;
        image_caption?: string;
        image_error?: string;
        id?: string;
        widget_config?: Record<string, unknown>;
        layout_name?: string;
      }>).detail;

      const { command, widget, text, title, pdf_source, module_id, image_loading, image_base64, image_caption, widget_config, layout_name } =
        detail;

      // ── Named layout presets ──────────────────────────────────────────────
      if (command === 'save_layout') {
        const name = (layout_name ?? '').trim().toLowerCase();
        if (!name) return;
        setModules(prev => {
          const presets = loadPresets();
          presets[name] = sanitizeForStorage(prev);
          try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch { /* non-critical */ }
          notify('LAYOUT SAVED', `Preset "${name.toUpperCase()}" stored (${prev.length} widgets).`, 'success');
          return prev;
        });
        return;
      }

      if (command === 'load_layout') {
        const name = (layout_name ?? '').trim().toLowerCase();
        if (!name) return;
        const presets = loadPresets();
        const preset = presets[name];
        if (!preset) {
          notify('LAYOUT NOT FOUND', `No preset named "${name.toUpperCase()}".`, 'warn');
          return;
        }
        const w = window.innerWidth;
        setModules(preset
          .filter(m => WIDGET_META[m.type])
          .map(m => m.rightOffset !== undefined ? { ...m, x: w - m.rightOffset } : m));
        setExpandedId(null);
        notify('LAYOUT LOADED', `Preset "${name.toUpperCase()}" active.`, 'info');
        return;
      }

      if (command === 'delete_layout') {
        const name = (layout_name ?? '').trim().toLowerCase();
        if (!name) return;
        const presets = loadPresets();
        if (presets[name]) {
          delete presets[name];
          try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch { /* non-critical */ }
          notify('LAYOUT DELETED', `Preset "${name.toUpperCase()}" removed.`, 'info');
        }
        return;
      }

      if (command === 'set_image') {
        const targetId = detail.id;
        if (!targetId) return;
        setModules((prev) =>
          prev.map((m) =>
            m.id === targetId
              ? {
                  ...m,
                  imageBase64: detail.image_base64,
                  imageLoading: false,
                  imageError: detail.image_error,
                  ...(detail.title?.trim()
                    ? { title: detail.title.trim().toUpperCase() }
                    : {}),
                }
              : m
          )
        );
        return;
      }

      if (command === 'clear') {
        setModules([]);
        setExpandedId(null);
        return;
      }

      if (command === 'reset') {
        if (!isMobile) setModules(buildDefaultModules(window.innerWidth));
        setExpandedId(null);
        return;
      }

      const type = widget as WidgetType;
      if (!type || !WIDGET_META[type]) return;

      if (command === 'open') {
        if (type === 'pdf' && !(pdf_source ?? '').trim()) return;

        const newModuleId =
          type === 'image' && module_id?.trim() ? module_id.trim() : String(Date.now());
        setModules(prev => {
          const multiInstance = ['text', 'pdf', 'image', 'printer', 'ha-device', 'ha-toggle', 'stocks', 'uptime'].includes(type);
          if (!multiInstance && prev.some(m => m.type === type)) return prev;
          const meta = WIDGET_META[type];
          const { x: newX, y: newY } = findOpenSpot(meta.width, meta.height, prev);
          const moduleTitle = title?.trim()
            ? title.trim().toUpperCase()
            : meta.title;
          const textContent = type === 'text' ? (text ?? '') : undefined;
          const pdfSource = type === 'pdf' ? (pdf_source ?? '').trim() : undefined;
          if (type === 'pdf' && !pdfSource) return prev;

          const imageCaption =
            type === 'image' && typeof image_caption === 'string' ? image_caption : undefined;

          return [
            ...prev,
            {
              id: newModuleId,
              type,
              title: moduleTitle,
              width: meta.width,
              height: meta.height,
              textContent,
              pdfSource,
              widgetConfig: widget_config,
              ...(type === 'image'
                ? {
                    imageLoading: !!image_loading,
                    imageBase64: typeof image_base64 === 'string' ? image_base64 : undefined,
                    imageCaption,
                    imageError: undefined,
                  }
                : {}),
              x: newX,
              y: newY,
            },
          ];
        });
        if (type === 'pdf') setExpandedId(newModuleId);
      }

      if (command === 'close') {
        setModules(prev => {
          const targets = prev.filter(m => m.type === type);
          if (targets.length === 0) return prev;
          const closingExpanded = targets.some(m => m.id === expandedId);
          if (closingExpanded) setExpandedId(null);
          sfx('app_close', 0.6);
          return prev.filter(m => m.type !== type);
        });
      }
    };

    window.addEventListener('jarvis:hud', handler);
    return () => window.removeEventListener('jarvis:hud', handler);
  }, [expandedId]);

  // Listen for open-model events from function calls
  useEffect(() => {
    const handler = (e: Event) => {
      const { path, name } = (e as CustomEvent<{ path: string; name: string }>).detail;
      const meta = WIDGET_META['model-viewer'];
      const spot = findOpenSpot(meta.width, meta.height, modules);
      setModules(prev => [...prev, {
        id: `model-${Date.now()}`,
        type: 'model-viewer',
        title: name.toUpperCase(),
        x: spot.x,
        y: spot.y,
        width: meta.width,
        height: meta.height,
        modelPath: path,
      }]);
    };
    window.addEventListener('jarvis:open-model', handler);
    return () => window.removeEventListener('jarvis:open-model', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules]);

  const removeModule = (id: string) => {
    setModules(prev => prev.filter(m => m.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const handleResize = (id: string, width: number, height: number) => {
    setModules(prev => prev.map(m => 
      m.id === id ? { ...m, width, height } : m
    ));
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-10 overflow-hidden">
      {/* Backdrop when expanded - Blurs background */}
      <AnimatePresence>
        {expandedId && (
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-md pointer-events-auto z-40 transition-all duration-300"
            onClick={() => setExpandedId(null)}
          />
        )}
      </AnimatePresence>

      {/* Music floater — bare draggable, no HUDModule chrome */}
      {modules.filter(m => m.type === 'music').map(module => (
        <MusicFloater key={module.id} initialX={module.x} initialY={module.y} onClose={() => removeModule(module.id)} />
      ))}

      {/* HA power button floaters — bare draggable glowing icons */}
      {modules.filter(m => m.type === 'ha-toggle').map(module => (
        <HAPowerButtonFloater key={module.id} initialX={module.x} initialY={module.y} config={module.widgetConfig} onClose={() => removeModule(module.id)} />
      ))}

      {modules.filter(m => m.type !== 'music' && m.type !== 'ha-toggle').map(module => (
        <HUDModule
          key={module.id}
          id={module.id}
          title={module.title}
          initialX={module.x}
          initialY={module.y}
          width={module.width}
          height={module.height}
          onDelete={removeModule}
          isExpanded={expandedId === module.id}
          onToggleExpand={toggleExpand}
          onResize={handleResize}
          scanReady={scanReady}
          expandedSize={module.type === 'pdf' ? 'large' : 'standard'}
          embedContent={module.type === 'image' || module.type === 'model-viewer' || module.type === 'weather-radar' || module.type === 'camera-feed'}
        >
          {module.type === 'clock' && <ClockWidget />}
          {module.type === 'system' && <SystemStatusWidget />}
          {module.type === 'network' && <NetworkGraphWidget />}
          {module.type === 'map' && <MapWidget />}
          {module.type === 'suit' && <SuitWidget />}
          {module.type === 'text' && (
            <TextWidget content={module.textContent ?? ''} />
          )}
          {module.type === 'pdf' && (
            <PdfWidget source={module.pdfSource ?? ''} />
          )}
          {module.type === 'image' && (
            <ImageWidget
              imageBase64={module.imageBase64}
              loading={module.imageLoading ?? false}
              error={module.imageError}
              caption={module.imageCaption}
            />
          )}
          {module.type === 'terminal' && <TerminalWidget />}
          {module.type === 'tv' && <TVWidget />}
          {module.type === 'printer' && <PrinterWidget config={module.widgetConfig} />}
          {module.type === 'weather-home' && <WeatherHomeWidget />}
          {module.type === 'ha-device' && <HADeviceWidget config={module.widgetConfig} />}
          {module.type === 'model-viewer' && <ModelHudWidget modelPath={module.modelPath ?? ''} />}
          {module.type === 'agenda' && <AgendaWidget />}
          {module.type === 'todo' && <TodoWidget />}
          {module.type === 'stocks' && <StocksWidget config={module.widgetConfig} />}
          {module.type === 'headlines' && <HeadlinesWidget />}
          {module.type === 'timer' && <TimerWidget />}
          {module.type === 'weather-radar' && <WeatherRadarWidget />}
          {module.type === 'camera-feed' && <CameraFeedWidget />}
          {module.type === 'transcript' && <TranscriptWidget />}
          {module.type === 'uptime' && <UptimeWidget config={module.widgetConfig} />}
          {module.type === 'orbit' && <OrbitWidget />}
          {module.type === 'calculator' && <CalculatorWidget />}
        </HUDModule>
      ))}
    </div>
  );
}

// ── Bare draggable HA power-button floater ──────────────────────────────────
function HAPowerButtonFloater({
  initialX, initialY, config, onClose,
}: { initialX: number; initialY: number; config?: Record<string, unknown>; onClose: () => void }) {
  const [isOn, setIsOn]       = useState(false);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity]   = useState<{ id: string } | null>(null);
  // Store credentials in state so toggle is always reliable (not dependent on cache at click time)
  const [haUrl, setHaUrl]     = useState('');
  const [haToken, setHaToken] = useState('');
  const constraintsRef = useRef<HTMLDivElement>(null);

  const nameFilter = config?.name       as string | undefined;
  const entityIds  = config?.entity_ids as string[] | undefined;
  const domain     = config?.domain     as string | undefined;
  // Label: prefer explicit label > name_filter (what the user called it) > HA friendly_name fallback
  const configLabel = (config?.label as string | undefined) ?? nameFilter;
  const [displayName, setDisplayName] = useState(configLabel ?? '…');

  useEffect(() => {
    (async () => {
      // Always ensure server settings are loaded before reading credentials —
      // the cache may be cold if ElevenLabs added this widget before the page
      // finished its own loadServerSettings() call.
      let url   = getCachedSetting('jarvis_ha_url');
      let token = getCachedSetting('jarvis_ha_token');
      if (!url || !token) {
        const s = await loadServerSettings();
        url   = s.jarvis_ha_url   ?? '';
        token = s.jarvis_ha_token ?? '';
      }
      if (!url || !token) { setLoading(false); return; }
      setHaUrl(url);
      setHaToken(token);

      try {
        const r = await fetch(`/api/home-assistant?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}&path=/api/states`);
        const all = await r.json() as Array<{ entity_id: string; state: string; attributes: Record<string, unknown> }>;
        let found: typeof all[0] | null = null;
        if (entityIds?.length) {
          found = all.find(e => entityIds.includes(e.entity_id)) ?? null;
        } else if (nameFilter) {
          found = all.find(e =>
            (e.attributes.friendly_name as string ?? '').toLowerCase().includes(nameFilter.toLowerCase())
          ) ?? null;
          // Alias: "Light N" smart plugs may live in switch domain
          if (!found) {
            found = all.find(e =>
              e.entity_id.startsWith('switch.') &&
              (e.attributes.friendly_name as string ?? '').toLowerCase().includes(nameFilter.toLowerCase())
            ) ?? null;
          }
        } else if (domain) {
          found = all.find(e => e.entity_id.startsWith(domain + '.')) ?? null;
          if (!found && domain === 'light') {
            found = all.find(e =>
              e.entity_id.startsWith('switch.') &&
              (e.attributes.friendly_name as string ?? '').toLowerCase().includes('light')
            ) ?? null;
          }
        }
        if (found) {
          setEntity({ id: found.entity_id });
          setIsOn(['on', 'playing', 'open', 'unlocked'].includes(found.state));
          if (!configLabel) {
            setDisplayName((found.attributes.friendly_name as string) ?? found.entity_id);
          }
        }
      } catch { /* swallow — shows NOT FOUND */ }
      setLoading(false);
    })();
  }, [nameFilter, domain, entityIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    if (!entity || !haUrl || !haToken) return;
    const d    = entity.id.split('.')[0];
    const next = !isOn;
    setIsOn(next);
    const res = await fetch('/api/home-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: haUrl, token: haToken, domain: d, service: next ? 'turn_on' : 'turn_off', serviceData: { entity_id: entity.id } }),
    });
    // Roll back optimistic update if the call failed
    if (!res.ok) setIsOn(!next);
  };

  return (
    <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-20">
      <motion.div
        drag dragMomentum={false}
        initial={{ x: initialX, y: initialY, opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.7 }}
        transition={{ duration: 0.2 }}
        className="absolute pointer-events-auto group flex flex-col items-center gap-1.5"
        style={{ top: 0, left: 0, cursor: 'grab' }}
      >
        {/* Close on hover */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.2)' }}
        >
          <svg viewBox="0 0 10 10" width="6" height="6" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 2l6 6M8 2l-6 6"/>
          </svg>
        </button>

        {/* Power button */}
        <button
          onClick={toggle}
          disabled={loading || !entity}
          className="relative flex items-center justify-center rounded-full transition-all duration-300 active:scale-95"
          style={{
            width: 56, height: 56,
            background: isOn ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.04)',
            border: `2px solid ${isOn ? 'rgba(34,211,238,0.8)' : 'rgba(255,255,255,0.2)'}`,
            boxShadow: isOn ? '0 0 20px rgba(34,211,238,0.5), 0 0 40px rgba(34,211,238,0.2), inset 0 0 12px rgba(34,211,238,0.08)' : 'none',
          }}
        >
          {loading ? (
            <div className="w-4 h-4 rounded-full border border-white/30 border-t-white/70 animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" strokeLinecap="round" strokeLinejoin="round">
              {/* Power arc */}
              <path
                d="M6.34 6.34a8 8 0 1 0 11.32 0"
                stroke={isOn ? '#22d3ee' : 'rgba(255,255,255,0.35)'}
                strokeWidth="2"
                style={{ filter: isOn ? 'drop-shadow(0 0 4px #22d3ee)' : 'none' }}
              />
              {/* Power stem */}
              <line
                x1="12" y1="2" x2="12" y2="12"
                stroke={isOn ? '#22d3ee' : 'rgba(255,255,255,0.35)'}
                strokeWidth="2"
                style={{ filter: isOn ? 'drop-shadow(0 0 4px #22d3ee)' : 'none' }}
              />
            </svg>
          )}
        </button>

        {/* Label */}
        <span
          className="font-mono text-[9px] tracking-widest uppercase max-w-[80px] text-center truncate transition-colors duration-300"
          style={{ color: isOn ? 'rgba(34,211,238,0.9)' : 'rgba(255,255,255,0.3)' }}
        >
          {loading ? '…' : (!entity ? 'NOT FOUND' : displayName)}
        </span>
      </motion.div>
    </div>
  );
}

// ── Bare draggable music floater (no HUDModule chrome) ─────────────────────
function MusicFloater({ initialX, initialY, onClose }: { initialX: number; initialY: number; onClose: () => void }) {
  const constraintsRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-20">
      <motion.div
        drag
        dragMomentum={false}
        initial={{ x: initialX, y: initialY, opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.88 }}
        transition={{ duration: 0.25 }}
        className="absolute pointer-events-auto group"
        style={{ width: 280, top: 0, left: 0, cursor: 'grab' }}
      >
        {/* Close button — only visible on hover */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/15"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l6 6M8 2l-6 6"/>
          </svg>
        </button>
        <MusicWidget />
      </motion.div>
    </div>
  );
}
