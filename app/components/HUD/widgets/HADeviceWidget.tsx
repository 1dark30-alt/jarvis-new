'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getCachedSetting } from '../../../lib/serverSettings';

interface HAEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

function loadHA() {
  if (typeof window === 'undefined') return { url: '', token: '' };
  return {
    url:   getCachedSetting('jarvis_ha_url'),
    token: getCachedSetting('jarvis_ha_token'),
  };
}

export function HADeviceWidget({ config }: { config?: Record<string, unknown> }) {
  const [entities, setEntities] = useState<HAEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // config.entity_ids: string[] or config.domain: string
  const entityIds  = config?.entity_ids as string[] | undefined;
  const domain     = config?.domain     as string   | undefined;
  const friendlyFilter = config?.name as string | undefined;

  const fetchEntities = useCallback(async () => {
    const { url, token } = loadHA();
    if (!url || !token) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/home-assistant?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}&path=/api/states`);
      if (!res.ok) return;
      const all = await res.json() as HAEntity[];
      let filtered = all;
      if (entityIds?.length) {
        filtered = all.filter((e) => entityIds.includes(e.entity_id));
      } else if (domain) {
        filtered = all.filter((e) => e.entity_id.startsWith(domain + '.'));
        // Alias: "Light 1-4" smart plugs live in the switch domain.
        // When domain=light yields nothing, also include switch entities
        // whose friendly name contains "light".
        if (domain === 'light' && filtered.length === 0) {
          filtered = all.filter(
            (e) =>
              e.entity_id.startsWith('switch.') &&
              (e.attributes.friendly_name as string ?? '')
                .toLowerCase()
                .includes('light'),
          );
        }
      } else if (friendlyFilter) {
        filtered = all.filter((e) => (e.attributes.friendly_name as string ?? '').toLowerCase().includes(friendlyFilter.toLowerCase()));
      }
      setEntities(filtered.slice(0, 6));
    } catch {}
    finally { setLoading(false); }
  }, [entityIds, domain, friendlyFilter]);

  useEffect(() => { fetchEntities(); pollRef.current = setInterval(fetchEntities, 5000); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [fetchEntities]);

  const toggle = async (entity: HAEntity) => {
    const { url, token } = loadHA();
    const d = entity.entity_id.split('.')[0];
    const isOn = ['on','playing','idle','open','unlocked'].includes(entity.state);
    await fetch('/api/home-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, token, domain: d, service: isOn ? 'turn_off' : 'turn_on', serviceData: { entity_id: entity.entity_id } }) });
    setEntities((prev) => prev.map((e) => e.entity_id === entity.entity_id ? { ...e, state: isOn ? 'off' : 'on' } : e));
    setTimeout(fetchEntities, 800);
  };

  const setBrightness = async (entity: HAEntity, pct: number) => {
    const { url, token } = loadHA();
    await fetch('/api/home-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, token, domain: 'light', service: 'turn_on', entity_id: entity.entity_id, brightness: Math.round(pct * 2.55) }) });
  };

  if (loading) return <div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin" /></div>;
  if (!entities.length) return <div className="flex-1 flex items-center justify-center"><p className="font-mono text-[10px] text-white/25">No devices found</p></div>;

  return (
    <div className="flex flex-col gap-2">
      {entities.map((entity) => {
        const isOn  = ['on','playing','idle','open','unlocked'].includes(entity.state);
        const name  = (entity.attributes.friendly_name as string) ?? entity.entity_id.replace(/^[^.]+\./, '').replace(/_/g, ' ');
        const bPct  = entity.attributes.brightness != null ? Math.round((entity.attributes.brightness as number / 255) * 100) : null;
        const d     = entity.entity_id.split('.')[0];
        const canToggle = ['light','switch','fan','lock','media_player','cover'].includes(d);

        return (
          <div key={entity.entity_id} className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg"
            style={{ background: isOn ? 'rgba(34,211,238,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isOn ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.1)'}` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold truncate" style={{ color: isOn ? '#fff' : 'rgba(255,255,255,0.5)' }}>{name}</span>
              {canToggle && (
                <button onClick={() => toggle(entity)}
                  className="relative w-9 h-4 rounded-full shrink-0 transition-all"
                  style={{ background: isOn ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.1)', border: `1px solid ${isOn ? 'rgba(34,211,238,0.7)' : 'rgba(255,255,255,0.2)'}` }}>
                  <span className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-200"
                    style={{ left: isOn ? '20px' : '2px', background: isOn ? '#22d3ee' : 'rgba(255,255,255,0.5)', boxShadow: isOn ? '0 0 6px #22d3ee' : 'none' }} />
                </button>
              )}
              {!canToggle && (
                <span className="font-mono text-[10px]" style={{ color: isOn ? '#22d3ee' : 'rgba(255,255,255,0.3)' }}>{entity.state}</span>
              )}
            </div>
            {d === 'light' && bPct !== null && isOn && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded-full" style={{ width: `${bPct}%`, background: '#22d3ee' }} />
                </div>
                <span className="font-mono text-[9px] text-white/30 w-6 text-right">{bPct}%</span>
                <input type="range" min="0" max="100" value={bPct} className="sr-only" onChange={(e) => setBrightness(entity, parseInt(e.target.value) / 100)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
