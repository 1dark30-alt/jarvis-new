'use client';

// Leaflet uses Canvas/SVG — no WebGL required, works everywhere including Electron.
// CartoDB dark tiles are free with no API key.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MapSidePanel, SidePanelData } from './MapSidePanel';

// Fix broken default icon URLs caused by webpack asset hashing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1/dist/images/marker-shadow.png',
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MapCommand {
  type:
    | 'fly_to'
    | 'fly_to_coordinates'
    | 'add_marker'
    | 'show_user_location'
    | 'draw_route'
    | 'clear_markers'
    | 'search_nearby';
  location?: string;
  lat?: number;
  lng?: number;
  zoom?: number;
  label?: string;
  description?: string;
  start?: string;
  end?: string;
  query?: string;
}

interface GeoResult {
  lat: string;
  lon: string;
  display_name: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onNavigateHome: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingCommand?: Record<string, any> | null;
  onPendingCommandConsumed?: () => void;
}

export function MapPage({ onNavigateHome, pendingCommand, onPendingCommandConsumed }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Layer[]>([]);
  const routeRef = useRef<L.Polyline | null>(null);

  const [ready, setReady] = useState(false);
  const [sidePanel, setSidePanel] = useState<SidePanelData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distanceMi: string; durationMin: number } | null>(null);

  // ── Map init ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [41.8781, -87.6298],
        zoom: 10,
        zoomControl: false,
      });

      // CartoDB Dark Matter — free, no API key, dark styled map
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 20,
        }
      ).addTo(map);

      const tilePane = map.getPane('tilePane');
      if (tilePane) {
        tilePane.style.filter = 'sepia(1) hue-rotate(185deg) saturate(2.5) brightness(1.6) contrast(1.15)';
      }

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      map.invalidateSize();
      mapRef.current = map;
      setReady(true);
    }, 750);

    return () => {
      clearTimeout(timer);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Execute pending command once map is ready, or when a new one arrives ──

  useEffect(() => {
    if (!ready) return;
    if (!pendingCommand) return;
    onPendingCommandConsumed?.();
    // Dispatch as a regular jarvis:map event so the existing handler runs it
    window.dispatchEvent(new CustomEvent('jarvis:map', { detail: pendingCommand }));
  }, [ready, pendingCommand]);

  // ── Geocode helper ─────────────────────────────────────────────────────────

  const geocode = useCallback(async (q: string): Promise<GeoResult | null> => {
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as GeoResult[];
      return data?.[0] ?? null;
    } catch {
      return null;
    }
  }, []);

  // ── Add marker helper ──────────────────────────────────────────────────────

  const addMarker = useCallback(
    (lat: number, lng: number, label: string, description?: string, isUser = false) => {
      const map = mapRef.current;
      if (!map) return;

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:14px;height:14px;
          background:${isUser ? '#22d3ee' : '#06b6d4'};
          border:2px solid ${isUser ? '#fff' : 'rgba(34,211,238,0.6)'};
          border-radius:50%;
          box-shadow:0 0 10px ${isUser ? '#22d3ee' : '#06b6d4'},0 0 20px ${isUser ? 'rgba(34,211,238,0.4)' : 'rgba(6,182,212,0.3)'};
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([lat, lng], { icon })
        .bindPopup(
          `<div style="font-family:monospace;font-size:11px;color:#fff;background:#0a0e1a;padding:6px 10px;border-radius:4px;min-width:120px;border:1px solid rgba(34,211,238,0.25)">
            <div style="color:#22d3ee;font-weight:bold;margin-bottom:2px">${label}</div>
            ${description ? `<div style="color:rgba(255,255,255,0.5);font-size:10px">${description}</div>` : ''}
          </div>`,
          { className: 'jarvis-popup' }
        )
        .addTo(map);

      marker.on('click', () => {
        setSidePanel({ label, fullAddress: description, lat, lng });
      });

      markersRef.current.push(marker);
    },
    []
  );

  // ── Fly to location ────────────────────────────────────────────────────────

  const flyTo = useCallback(
    async (locationName: string, zoom = 13) => {
      const map = mapRef.current;
      if (!map) return;
      setSearching(true);
      try {
        const place = await geocode(locationName);
        if (!place) return;
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lon);
        map.flyTo([lat, lng], zoom, { animate: true, duration: 1.4 });
        setSidePanel({
          label: place.display_name.split(',')[0],
          fullAddress: place.display_name,
          lat,
          lng,
        });
      } finally {
        setSearching(false);
      }
    },
    [geocode]
  );

  // ── Draw route ─────────────────────────────────────────────────────────────

  const drawRoute = useCallback(
    async (startName: string, endName: string) => {
      const map = mapRef.current;
      if (!map) return;

      const [startGeo, endGeo] = await Promise.all([geocode(startName), geocode(endName)]);
      if (!startGeo || !endGeo) return;

      const res = await fetch(
        `/api/osrm-route?slng=${startGeo.lon}&slat=${startGeo.lat}&elng=${endGeo.lon}&elat=${endGeo.lat}`
      );
      const data = (await res.json()) as {
        geometry?: { type: string; coordinates: [number, number][] };
        distanceMi?: string;
        durationMin?: number;
        error?: string;
      };

      if (!data.geometry) return;

      // Remove old route
      routeRef.current?.remove();

      const latlngs = data.geometry.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);

      // Glow layer
      L.polyline(latlngs, { color: '#22d3ee', weight: 10, opacity: 0.2 }).addTo(map);

      // Core line
      const route = L.polyline(latlngs, { color: '#22d3ee', weight: 3, opacity: 0.9 }).addTo(map);
      routeRef.current = route;

      if (data.distanceMi && data.durationMin) {
        setRouteInfo({ distanceMi: data.distanceMi, durationMin: data.durationMin });
      }

      map.fitBounds(route.getBounds(), { padding: [60, 60] });

      addMarker(parseFloat(startGeo.lat), parseFloat(startGeo.lon), startName.split(',')[0], 'Start');
      addMarker(parseFloat(endGeo.lat), parseFloat(endGeo.lon), endName.split(',')[0], 'End');
    },
    [geocode, addMarker]
  );

  // ── jarvis:map event handler ────────────────────────────────────────────────

  useEffect(() => {
    const handler = async (e: Event) => {
      const cmd = (e as CustomEvent<MapCommand>).detail;
      const map = mapRef.current;

      switch (cmd.type) {
        case 'fly_to':
          if (cmd.location) await flyTo(cmd.location, cmd.zoom);
          break;
        case 'fly_to_coordinates':
          if (cmd.lat != null && cmd.lng != null) {
            map?.flyTo([cmd.lat, cmd.lng], cmd.zoom ?? 13, { animate: true, duration: 1.4 });
          }
          break;
        case 'add_marker':
          if (cmd.lat != null && cmd.lng != null && cmd.label) {
            addMarker(cmd.lat, cmd.lng, cmd.label, cmd.description);
          }
          break;
        case 'show_user_location':
          navigator.geolocation.getCurrentPosition((pos) => {
            const { latitude: lat, longitude: lng } = pos.coords;
            addMarker(lat, lng, 'Your Location', undefined, true);
            map?.flyTo([lat, lng], 14, { animate: true, duration: 1.4 });
          });
          break;
        case 'draw_route':
          if (cmd.start && cmd.end) await drawRoute(cmd.start, cmd.end);
          break;
        case 'clear_markers':
          markersRef.current.forEach((m) => m.remove());
          markersRef.current = [];
          routeRef.current?.remove();
          routeRef.current = null;
          setRouteInfo(null);
          break;
        case 'search_nearby':
          if (cmd.location) await flyTo(cmd.location + (cmd.query ? ` ${cmd.query}` : ''));
          break;
      }
    };

    window.addEventListener('jarvis:map', handler);
    return () => window.removeEventListener('jarvis:map', handler);
  }, [flyTo, addMarker, drawRoute]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <motion.div
      key="map-page"
      className="fixed inset-0 bg-black z-[50] overflow-hidden"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Map container */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

      {/* HUD corner brackets */}
      {[
        'top-0 left-0 border-t-2 border-l-2',
        'top-0 right-0 border-t-2 border-r-2',
        'bottom-0 left-0 border-b-2 border-l-2',
      ].map((cls, i) => (
        <div key={i} className={`absolute w-8 h-8 ${cls} border-cyan-500/20 pointer-events-none z-[400] m-3`} />
      ))}

      {/* Top-left: label + search */}
      <div className="absolute top-4 left-4 z-[500] flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          {/* Title pill */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/80 border border-cyan-500/20 backdrop-blur-sm">
            <div className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-cyan-400 animate-pulse' : 'bg-white/20'}`} />
            <span className="text-[9px] font-mono text-cyan-400/70 uppercase tracking-widest">Jarvis · Map</span>
          </div>
          {/* Standardised home button */}
          <button
            onClick={onNavigateHome}
            className="h-8 px-3 flex items-center gap-2 rounded-lg bg-black/80 border border-cyan-500/20 text-white/35 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors text-[9px] font-mono uppercase tracking-widest backdrop-blur-sm"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3L5 8l5 5" />
            </svg>
            Home
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (searchQuery.trim()) await flyTo(searchQuery.trim());
          }}
          className="flex gap-1.5"
        >
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search any location…"
            className="w-64 h-9 px-3 bg-black/75 border border-cyan-500/20 rounded-lg text-[12px] text-white font-mono placeholder:text-white/25 focus:outline-none focus:border-cyan-500/50 backdrop-blur-sm transition-colors"
          />
          <button
            type="submit"
            disabled={searching}
            className="h-9 px-3 bg-cyan-500/15 border border-cyan-500/30 rounded-lg text-cyan-400 text-[10px] font-mono hover:bg-cyan-500/25 transition-colors disabled:opacity-40"
          >
            {searching ? '…' : '→'}
          </button>
        </form>
      </div>

      {/* Top-right: quick actions */}
      <div className="absolute top-4 right-4 z-[500] flex items-center gap-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('jarvis:map', { detail: { type: 'show_user_location' } }))}
          className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-black/75 border border-cyan-500/20 text-white/40 hover:text-cyan-400 hover:border-cyan-500/40 transition-all text-[9px] font-mono uppercase tracking-wider backdrop-blur-sm"
        >
          ◎ Me
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('jarvis:map', { detail: { type: 'clear_markers' } }))}
          className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-black/75 border border-white/8 text-white/30 hover:text-white/60 transition-all text-[9px] font-mono uppercase tracking-wider backdrop-blur-sm"
        >
          Clear
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-black/75 border border-white/8 text-white/30 hover:text-cyan-400 hover:border-cyan-500/30 transition-all backdrop-blur-sm"
        >
          ⚙
        </button>
      </div>

      {/* Route info badge */}
      <AnimatePresence>
        {routeInfo && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-4 px-5 py-2.5 rounded-xl bg-black/80 border border-cyan-500/25 backdrop-blur-sm"
          >
            <div className="text-center">
              <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Distance</div>
              <div className="text-[15px] font-mono font-bold text-cyan-400">{routeInfo.distanceMi} mi</div>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="text-center">
              <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Drive time</div>
              <div className="text-[15px] font-mono font-bold text-white">{routeInfo.durationMin} min</div>
            </div>
            <button onClick={() => setRouteInfo(null)} className="ml-2 text-white/20 hover:text-white/50 transition-colors text-xs">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Side panel */}
      <AnimatePresence>
        {sidePanel && (
          <MapSidePanel
            key={`${sidePanel.lat}-${sidePanel.lng}`}
            data={sidePanel}
            onClose={() => setSidePanel(null)}
            onRouteHere={(from) => drawRoute(from, sidePanel.label)}
            onSearchNearby={(q) => flyTo(`${sidePanel.label} ${q}`)}
          />
        )}
      </AnimatePresence>

      {/* Settings modal */}
      <AnimatePresence>
        {settingsOpen && (
          <div
            className="fixed inset-0 z-[600] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 16 }}
              transition={{ duration: 0.2 }}
              className="w-[420px] bg-[#0a0e1a] border border-cyan-500/25 rounded-xl p-7 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-cyan-400 font-mono text-xs font-bold uppercase tracking-widest">Map Settings</h2>
                <button onClick={() => setSettingsOpen(false)} className="text-white/25 hover:text-white/60 transition-colors">✕</button>
              </div>
              <p className="text-white/40 text-[11px] font-mono">
                Using CartoDB Dark Matter tiles — free, no API key required.
              </p>
              <div className="flex justify-end mt-7 pt-5 border-t border-white/5">
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="px-5 py-2 text-[10px] font-mono bg-cyan-500/15 text-cyan-400 border border-cyan-500/35 rounded hover:bg-cyan-500/25 transition-colors uppercase tracking-wider"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
