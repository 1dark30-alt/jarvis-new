'use client';

import { useEffect, useRef, useState } from 'react';
import { useConversation } from '@elevenlabs/react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { SettingsModal, JarvisSettings } from './SettingsModal';
import { FUNCTION_REGISTRY, getFunctionByName, JarvisFunction } from '../lib/functions';
import { loadDynamicFunctions, createGetFunctionByName, DynamicFunctionState } from '../lib/dynamic-functions';
import { XrayWidget } from './XrayWidget';
import { CameraWidget } from './CameraWidget';
import { ArcReactorVisualizer } from './visualizers/ArcReactorVisualizer';
import { SphereNodesVisualizer } from './visualizers/SphereNodesVisualizer';
import { QuarterRingsVisualizer } from './visualizers/QuarterRingsVisualizer';
import { OriginalVisualizer } from './visualizers/OriginalVisualizer';
import { PhotoWidget, PhotoEntry } from './PhotoWidget';
import { sfx } from '../lib/sfx';
import { installErrorInterceptors, emitError } from '../lib/errorBus';
import { BreezeSpeaker } from '../lib/breeze-speech';
import { LocalVoice } from '../lib/local-voice';
import { GeminiLive } from '../lib/geminiLive';
import { loadServerSettings, saveServerSettings } from '../lib/serverSettings';
import { ModelViewerWidget } from './ModelViewerWidget';
import { isInterfaceLocked } from './LockScreen';

// Tools that remain usable while the PIN lock screen is active
const LOCK_ALLOWED_FUNCTIONS = new Set(['get_time', 'get_date', 'jarvis_disconnect', 'lock_interface']);

const LOCKED_RESULT = {
  error: 'The interface is locked. Tell the user the interface is in lockdown and the PIN must be entered on screen to unlock it.',
};

function dispatchTranscript(role: 'user' | 'jarvis', text: string): void {
  if (!text?.trim()) return;
  window.dispatchEvent(new CustomEvent('jarvis:transcript', { detail: { role, text } }));
}

const FFT_BARS = 64;
const OPENAI_REALTIME_MODEL = 'gpt-realtime-2';
const DEFAULT_SETTINGS: JarvisSettings = {
  apiMode: 'openai',
  apiKey: '',
  localLlmProvider: 'ollama',
  localLlmUrl: 'http://127.0.0.1:11434',
  localLlmModel: '',
  elevenLabsAgentId: '',
  elevenLabsFirstMessage: '',
  voice: 'echo',
  initialPrompt: 'You are Jarvis, a helpful AI assistant. You are always helpful, polite, and concise. Subtle British accent. Robotic. Emotionally controlled. Witty and a little bit poking fun at the user.',
  enabledFunctions: [
    'desktop_mode', 'navigate_to_page', 'jarvis_disconnect',
    'lock_interface', 'set_timer', 'set_reminder', 'hud_layout', 'briefing', 'set_theme', 'ambient_mode',
    'routine_command', 'undo_command', 'build_guide', 'background_tasks',
    'memory_command', 'project_workspace',
    'screen_eyes', 'dev_command', 'health_command',
    'excel_writer', 'document_review', 'obsidian_vault', 'market_analyzer',
    'screen_agent', 'network_radar', 'notifications_command',
    'finance_command', 'scoresheet_command',
  ],
  wakeWordEnabled: false,
  wakeWordSensitivity: 0.5,
  theme: 'arc-reactor',
  grid: 'off',
  visualizer: 'frequency-ring',
  logo: 'logo',
  position: 'center',
  shellPathOverride: '',
  pythonPathOverride: '',
  disableIntroAnimation: false,
};

type DesktopPanelPosition = Exclude<JarvisSettings['position'], 'center'>;

function isDesktopPanelPosition(value: unknown): value is DesktopPanelPosition {
  return (
    value === 'top-left' ||
    value === 'top-right' ||
    value === 'bottom-left' ||
    value === 'bottom-right'
  );
}

export function JarvisAssistant({ compact = false, roundDisplay = false }: { compact?: boolean; roundDisplay?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'listening' | 'active' | 'error'>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [localPhase, setLocalPhase] = useState('');
  const localVoiceRef = useRef<LocalVoice | null>(null);
  const geminiRef = useRef<GeminiLive | null>(null);
  useEffect(() => () => localVoiceRef.current?.stop(), []);
  const [micMuted, setMicMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [fftData, setFftData] = useState<number[]>(new Array(FFT_BARS).fill(0));
  const statusRef = useRef(status);
  const micMutedRef = useRef(false);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [ring1Rotation, setRing1Rotation] = useState(0);
  const [ring2Rotation, setRing2Rotation] = useState(0);
  const [centerWidget, setCenterWidget] = useState<{ type: 'model'; path: string; name: string } | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(Date.now());
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const elPollRef = useRef<number | null>(null);
  // When true, an unexpected WebRTC drop will schedule an auto-reconnect.
  // Set false during intentional disconnect so we don't loop.
  const autoReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp (ms) when the current session became active. Used to block
  // automatic navigate_to_page calls in the first few seconds after a
  // session auto-reconnects, which prevents the model from navigating the
  // user back to "home" as part of its unsolicited greeting.
  const sessionStartTimeRef = useRef<number>(0);

  // Dynamic function state — starts unloaded; gates auto-start.
  const [dynamicState, setDynamicState] = useState<DynamicFunctionState>({
    allFunctions: FUNCTION_REGISTRY,
    mcpFunctions: [],
    skillFunctions: [],
    loaded: false,
    loadError: null,
  });
  const dynamicGetFunctionByNameRef = useRef<(name: string) => JarvisFunction | undefined>(getFunctionByName);

  // Ref-based ElevenLabs clientTools so dynamic functions are included at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elClientToolsRef = useRef<Record<string, (params: any) => any>>(
    Object.fromEntries(
      FUNCTION_REGISTRY.map((fn) => [
        fn.name,
        async (params: Record<string, unknown>) => {
          if (isInterfaceLocked() && !LOCK_ALLOWED_FUNCTIONS.has(fn.name)) {
            return LOCKED_RESULT;
          }
          const result = await fn.handler(params);
          const r = result as Record<string, unknown> | null;
          if (typeof r?.error === 'string') {
            emitError('function', `${fn.name}(): ${r.error}`, 'error');
          }
          return result;
        },
      ]),
    ),
  );

  // ElevenLabs Conversational AI hook
  // NOTE: Do NOT pass micMuted here — changing it causes the SDK to reinitialize
  // the mic, which looks like a restart. Muting is handled imperatively via
  // elConversation.setMuted() in setMicrophoneMuted() instead.
  const elConversation = useConversation({
    clientTools: elClientToolsRef.current,
    onConnect: () => {
      console.log('ElevenLabs connected');
      setStatus('active');
    },
    onDisconnect: (details?: { reason?: string; code?: number; message?: string }) => {
      const reason = details?.message ?? details?.reason ?? (details?.code != null ? `code ${details.code}` : null);
      console.log('ElevenLabs disconnected', details ?? '');
      if (reason && statusRef.current !== 'idle') {
        setStatus('error');
        setLastError(`Disconnected: ${reason}`);
        emitError('elevenlabs', `Disconnected: ${reason}`);
      } else if (statusRef.current !== 'idle') {
        setStatus('idle');
      }
    },
    onError: (error) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = error as any;
      const msg = e instanceof Error ? e.message : (typeof e === 'string' ? e : JSON.stringify(e));
      console.error('ElevenLabs error:', error);
      setStatus('error');
      setLastError(msg);
      emitError('elevenlabs', msg);
    },
    onMessage: (message: { message?: string; source?: string }) => {
      // Feed the COMMS LOG transcript widget
      if (typeof message?.message === 'string') {
        dispatchTranscript(message.source === 'user' ? 'user' : 'jarvis', message.message);
      }
    },
  });

  // Photo context state
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const photosRef = useRef<PhotoEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<JarvisSettings>(DEFAULT_SETTINGS);
  const [restartTrigger, setRestartTrigger] = useState(0);
  const [mounted, setMounted] = useState(false);
  const desktopModeRef = useRef(false);
  const desktopPanelPositionRef = useRef<DesktopPanelPosition>('bottom-right');
  const normalPositionBeforeDesktopRef = useRef<JarvisSettings['position'] | null>(null);
  const settingsRef = useRef(settings);
  const breezeRef = useRef<BreezeSpeaker | null>(null);
  if (!breezeRef.current) breezeRef.current = new BreezeSpeaker();
  useEffect(() => () => breezeRef.current?.stop(), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Install global error interceptors once so all console.error calls,
  // uncaught JS errors, and unhandled rejections stream to TerminalWidget.
  useEffect(() => { installErrorInterceptors(); }, []);

  // Listen for open-model events — only show center widget when in round display mode
  useEffect(() => {
    const handler = (e: Event) => {
      if (!roundDisplay) return;
      const { path, name } = (e as CustomEvent<{ path: string; name: string }>).detail;
      setCenterWidget({ type: 'model', path, name });
    };
    window.addEventListener('jarvis:open-model', handler);
    return () => window.removeEventListener('jarvis:open-model', handler);
  }, [roundDisplay]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const unsubscribe = window.electron?.onDesktopOverlayClick?.(() => {
      sfx('click', 0.45);
      setMicrophoneMuted(!micMutedRef.current);
    });

    return () => unsubscribe?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wake word detection — listen for "Jarvis" from main process
  useEffect(() => {
    if (!window.electron?.onHeyJarvis) return;

    const unsubscribe = window.electron.onHeyJarvis(() => {
      console.log('[WakeWord] "Jarvis" detected in renderer');

      // Play the iconic boot sound
      sfx('intro_sfx', 0.7);

      // Don't re-trigger if already in a conversation
      if (statusRef.current === 'active' || statusRef.current === 'listening') {
        return;
      }

      if (micMutedRef.current) {
        setMicrophoneMuted(false);
      }

      void start(settingsRef.current);
    });

    return () => {
      unsubscribe?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wake word status updates
  useEffect(() => {
    if (!window.electron?.onHeyJarvisStatus) return;
    const unsub = window.electron.onHeyJarvisStatus((status) => {
      console.log('[WakeWord] Status:', status);
    });
    return () => unsub?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wake word error reporting
  useEffect(() => {
    if (!window.electron?.onHeyJarvisError) return;
    const unsub = window.electron.onHeyJarvisError((error) => {
      console.error('[WakeWord] Error:', error);
      setLastError(`Wake word: ${error}`);
    });
    return () => unsub?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep Electron wake word service aligned with saved settings.
  useEffect(() => {
    if (!window.electron) return;
    window.electron.setWakeWordSensitivity?.(settings.wakeWordSensitivity ?? 0.5);
    window.electron.setWakeWordEnabled?.(Boolean(settings.wakeWordEnabled));
  }, [settings.wakeWordEnabled, settings.wakeWordSensitivity]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        action?: 'enable' | 'disable' | 'move';
        position?: DesktopPanelPosition;
      }>).detail ?? {};
      const action = detail.action;
      const requestedPosition = isDesktopPanelPosition(detail.position)
        ? detail.position
        : undefined;

      if (!action) return;

      if (action === 'enable') {
        const position = requestedPosition ?? desktopPanelPositionRef.current;
        desktopPanelPositionRef.current = position;
        if (!desktopModeRef.current) {
          normalPositionBeforeDesktopRef.current = settings.position ?? 'center';
        }
        desktopModeRef.current = true;
        if (!window.electron?.isElectron) return;
        void window.electron.setDesktopMode({
          enabled: true,
          position,
          logo: settings.logo ?? 'logo',
          muted: micMutedRef.current,
        });
        return;
      }

      if (action === 'disable') {
        const savedNormalPosition = normalPositionBeforeDesktopRef.current;
        const restorePosition =
          savedNormalPosition && savedNormalPosition !== desktopPanelPositionRef.current
            ? savedNormalPosition
            : 'center';
        desktopModeRef.current = false;
        normalPositionBeforeDesktopRef.current = null;
        setSettings((prev) => {
          const updated = { ...prev, position: restorePosition };
          localStorage.setItem('jarvis_settings', JSON.stringify(updated));
          return updated;
        });
        if (!window.electron?.isElectron) return;
        void window.electron.setDesktopMode({ enabled: false });
        return;
      }

      const position = requestedPosition ?? desktopPanelPositionRef.current;
      desktopPanelPositionRef.current = position;
      if (!desktopModeRef.current) {
        setSettings((prev) => {
          const updated = { ...prev, position };
          localStorage.setItem('jarvis_settings', JSON.stringify(updated));
          return updated;
        });
      }
      if (!window.electron?.isElectron) return;
      void window.electron.moveDesktopPanel(position);
    };

    window.addEventListener('jarvis:desktop-mode', handler);
    return () => window.removeEventListener('jarvis:desktop-mode', handler);
  }, [settings.logo, settings.position]);

  // jarvis:self-disconnect — fired by jarvis_disconnect function tool
  useEffect(() => {
    const handler = () => {
      // Small delay so the function-call result can be sent over the data channel first
      setTimeout(() => disconnect(), 600);
    };
    window.addEventListener('jarvis:self-disconnect', handler);
    return () => window.removeEventListener('jarvis:self-disconnect', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status-change sound effects
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === status) return;

    if (status === 'error')     sfx('error', 0.8);
    if (status === 'idle' && prev !== 'idle') sfx('app_close', 0.6);
  }, [status]);

  // Keep photosRef in sync so the Realtime API injection always sees the latest list
  useEffect(() => {
    photosRef.current = photos;
    injectPhotosIntoSession(photos);

    // Expose current photo context so local tool handlers can reuse on-screen images.
    (window as Window & {
      __jarvisPhotoContext?: { latestDataUrl?: string; photos: string[] };
    }).__jarvisPhotoContext = {
      latestDataUrl: photos.length > 0 ? photos[photos.length - 1].dataUrl : undefined,
      photos: photos.map((p) => p.dataUrl),
    };
  }, [photos]);

  // Compress a dropped image file to a JPEG data URL (max 1024px)
  function compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (e) => {
        const img = document.createElement('img');
        img.onerror = reject;
        img.onload = () => {
          const MAX = 1024;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else       { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx2d = canvas.getContext('2d')!;
          ctx2d.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    files.forEach(async (file) => {
      try {
        const dataUrl = await compressImage(file);
        const entry: PhotoEntry = { id: crypto.randomUUID(), dataUrl, name: file.name };
        setPhotos(prev => [...prev, entry]);
      } catch (err) {
        console.error('Failed to load image', err);
      }
    });
  }

  function dismissPhoto(id: string) {
    setPhotos(prev => prev.filter(p => p.id !== id));
  }

  // Send current photos as a conversation item so Jarvis has them in context.
  // Called whenever the photo list changes (if session is live) and on session open.
  function injectPhotosIntoSession(currentPhotos: PhotoEntry[]) {
    if (currentPhotos.length === 0) return;

    // ElevenLabs path — send text-only contextual update (no vision support via client SDK)
    if (elConversation.status === 'connected') {
      Promise.resolve(
        elConversation.sendContextualUpdate(
          `The user currently has ${currentPhotos.length} image${currentPhotos.length > 1 ? 's' : ''} on screen for visual context.`,
        ),
      ).catch(() => {});
      return;
    }

    // OpenAI Realtime path
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') return;

    const content: unknown[] = [
      {
        type: 'input_text',
        text: `The user currently has ${currentPhotos.length} image${currentPhotos.length > 1 ? 's' : ''} on screen. Reference them if they are relevant to the conversation.`,
      },
      ...currentPhotos.map(p => ({
        type: 'input_image',
        image_url: p.dataUrl,
      })),
    ];

    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content },
    }));
  }

  /** Append plain text from a HUD paste into the realtime conversation so the model sees it. */
  function injectPastedHudTextIntoSession(rawText: string) {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    // ElevenLabs path
    if (elConversation.status === 'connected') {
      Promise.resolve(
        elConversation.sendContextualUpdate(
          'The user pasted the following text onto the HUD (it also appears in a TEXT NOTE widget). Treat it as context for what they want to discuss:\n\n' + trimmed,
        ),
      ).catch(() => {});
      return;
    }

    // OpenAI Realtime path
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') return;

    dc.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'The user pasted the following text onto the HUD (it also appears in a TEXT NOTE widget). Treat it as context for what they want to discuss:\n\n' +
                trimmed,
            },
          ],
        },
      })
    );
  }

  // Paste plain text outside inputs → open a TEXT NOTE and inject into realtime session
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;

      const text = e.clipboardData?.getData('text/plain');
      const trimmed = text?.trim();
      if (!trimmed) return;

      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent('jarvis:hud', {
          detail: { command: 'open', widget: 'text', text: trimmed },
        })
      );
      injectPastedHudTextIntoSession(trimmed);
    };

    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, []);

  // Apply theme + grid to <html> whenever settings change
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', settings.theme ?? 'arc-reactor');
    if (settings.grid && settings.grid !== 'off') {
      html.setAttribute('data-grid', settings.grid);
    } else {
      html.removeAttribute('data-grid');
    }

    // Custom theme: derive the CSS accent variables from the picked hex color
    const accentVars = ['--accent-rgb', '--accent-hex', '--accent-dim', '--accent-dark-rgb', '--accent-glow', '--accent-glow-strong', '--accent-glow-light', '--accent-bg'];
    if (settings.theme === 'custom') {
      const hex = /^#[0-9a-fA-F]{6}$/.test(settings.customAccent ?? '') ? settings.customAccent! : '#f59e0b';
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const dim = `rgb(${Math.round(r * 0.6)}, ${Math.round(g * 0.6)}, ${Math.round(b * 0.6)})`;
      html.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
      html.style.setProperty('--accent-hex', hex);
      html.style.setProperty('--accent-dim', dim);
      html.style.setProperty('--accent-dark-rgb', `${Math.round(r * 0.2)}, ${Math.round(g * 0.2)}, ${Math.round(b * 0.2)}`);
      html.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.3)`);
      html.style.setProperty('--accent-glow-strong', `rgba(${r}, ${g}, ${b}, 0.8)`);
      html.style.setProperty('--accent-glow-light', `rgba(${r}, ${g}, ${b}, 0.15)`);
      html.style.setProperty('--accent-bg', `rgba(${r}, ${g}, ${b}, 0.1)`);
    } else {
      accentVars.forEach((v) => html.style.removeProperty(v));
    }
  }, [settings.theme, settings.grid, settings.customAccent]);

  // Open settings from the radial nav / command palette
  useEffect(() => {
    const handler = () => setIsSettingsOpen(true);
    window.addEventListener('jarvis:open-settings', handler);
    return () => window.removeEventListener('jarvis:open-settings', handler);
  }, []);

  // UI-triggered announcements (e.g. armory BUILD button): feed the event text
  // into the live session so Jarvis speaks a response. No-op when disconnected.
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (!text) return;

      // ElevenLabs path — sendUserMessage triggers a spoken agent reply
      if (elConversation.status === 'connected') {
        Promise.resolve(elConversation.sendUserMessage(text)).catch(() => {});
        return;
      }

      // OpenAI Realtime path
      const dc = dataChannelRef.current;
      if (!dc || dc.readyState !== 'open') return;
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      }));
      dc.send(JSON.stringify({ type: 'response.create' }));
    };
    window.addEventListener('jarvis:announce', handler);
    return () => window.removeEventListener('jarvis:announce', handler);
  }, [elConversation]);

  // Theme change by voice (set_theme tool) — persist like a settings save
  useEffect(() => {
    const handler = (e: Event) => {
      const theme = (e as CustomEvent<{ theme?: JarvisSettings['theme'] }>).detail?.theme;
      if (!theme || !['arc-reactor', 'midnight', 'crimson', 'matrix', 'custom'].includes(theme)) return;
      setSettings((prev) => {
        const updated = { ...prev, theme };
        localStorage.setItem('jarvis_settings', JSON.stringify(updated));
        return updated;
      });
    };
    window.addEventListener('jarvis:set-theme', handler);
    return () => window.removeEventListener('jarvis:set-theme', handler);
  }, []);

  // Long-term memory — the prompt core block (identity + recent facts + an
  // index of everything else) rides in the session instructions. Refreshed on
  // mount and whenever a memory tool saves something.
  const memoryBlockRef = useRef('');
  useEffect(() => {
    const load = () => {
      fetch('/api/memory?op=core')
        .then((r) => r.json())
        .then((d: { block?: string }) => { memoryBlockRef.current = d.block ?? ''; })
        .catch(() => {});
    };
    load();
    window.addEventListener('jarvis:memory-updated', load);
    return () => window.removeEventListener('jarvis:memory-updated', load);
  }, []);

  // Broadcast voice state for proactive services (routine engine etc.)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('jarvis:voice-state', {
      detail: { connected: status === 'active' || status === 'listening' },
    }));
  }, [status]);

  // Load settings — server first (shared across all LAN clients), then localStorage fallback
  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadServerSettings().then((serverSettings) => {
        // Pick the "best" source: prefer server if it has credentials, otherwise localStorage
        const serverRaw   = serverSettings.jarvis_settings;
        const localRaw    = localStorage.getItem('jarvis_settings');

        const parseKey = (raw: string | null): string => {
          try { return (JSON.parse(raw ?? '{}') as Partial<JarvisSettings>).apiKey ?? ''; } catch { return ''; }
        };
        const serverHasKey = !!parseKey(serverRaw ?? null).trim();
        const localHasKey  = !!parseKey(localRaw).trim();

        // Choose the source that actually has credentials
        const raw = (serverHasKey ? serverRaw : null) ?? (localHasKey ? localRaw : null) ?? serverRaw ?? localRaw;

        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<JarvisSettings>;
            const enabledFunctions = Array.from(new Set([
              ...DEFAULT_SETTINGS.enabledFunctions,
              ...(parsed.enabledFunctions ?? []),
            ]));
            const nextSettings = { ...DEFAULT_SETTINGS, ...parsed, enabledFunctions };
            setSettings(nextSettings);

            // Back-fill localStorage so offline / Electron still works
            localStorage.setItem('jarvis_settings', JSON.stringify(nextSettings));

            // If localStorage has credentials but the server doesn't, push them up now.
            // This self-heals after a race-condition wipe.
            if (!serverHasKey && localHasKey) {
              saveServerSettings({ jarvis_settings: JSON.stringify(nextSettings) });
            }
          } catch (e) {
            console.error('Failed to parse settings', e);
          }
        } else {
          // Fallback to env var if available
          const envKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
          if (envKey) {
            setSettings(prev => ({ ...prev, apiKey: envKey }));
          }
        }
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Load dynamic functions (MCP + Skills) on mount — runs before auto-start.
  useEffect(() => {
    loadDynamicFunctions().then((state) => {
      setDynamicState(state);
      dynamicGetFunctionByNameRef.current = createGetFunctionByName(state.allFunctions);

      // Seed enabledFunctions with new MCP/Skill tool names
      if (state.mcpFunctions.length > 0 || state.skillFunctions.length > 0) {
        setSettings((prev) => {
          const existingEnabled = new Set(prev.enabledFunctions);
          const newTools = [...state.mcpFunctions, ...state.skillFunctions]
            .filter((f) => !existingEnabled.has(f.name))
            .map((f) => f.name);
          if (newTools.length === 0) return prev;
          const updated = {
            ...prev,
            enabledFunctions: [...prev.enabledFunctions, ...newTools],
          };
          const serialised = JSON.stringify(updated);
          localStorage.setItem('jarvis_settings', serialised);
          // Do NOT write to server here — settings may not have loaded from the
          // server yet (race condition) and would overwrite the real API key.
          // The server file is only updated when the user explicitly saves settings.
          return updated;
        });
      }
    });
  }, []);

  // Keep elClientToolsRef in sync with dynamic function state
  useEffect(() => {
    const fns = dynamicState.loaded ? dynamicState.allFunctions : FUNCTION_REGISTRY;
    elClientToolsRef.current = Object.fromEntries(
      fns.map((fn) => [
        fn.name,
        async (params: Record<string, unknown>) => {
          const result = await fn.handler(params);
          const r = result as Record<string, unknown> | null;
          if (typeof r?.error === 'string') {
            emitError('function', `${fn.name}(): ${r.error}`, 'error');
          }
          return result;
        },
      ]),
    );
  }, [dynamicState.loaded, dynamicState.allFunctions]);

  // Continuous rotation for rings
  useEffect(() => {
    const rotate = () => {
      const now = Date.now();
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      setRing1Rotation((prev) => (prev + 40 * delta) % 360);
      setRing2Rotation((prev) => (prev - 20 * delta) % 360);

      rotationFrameRef.current = requestAnimationFrame(rotate);
    };
    rotate();

    return () => {
      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
      }
    };
  }, []);

  // Audio level monitoring with FFT
  useEffect(() => {
    if (status !== 'active') {
      const resetTimer = window.setTimeout(() => {
        setAudioLevel(0);
        setFftData(new Array(FFT_BARS).fill(0));
      }, 0);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      return () => window.clearTimeout(resetTimer);
    }

    const checkStream = setInterval(() => {
      if (remoteStreamRef.current && statusRef.current === 'active') {
        clearInterval(checkStream);
        setupAudioAnalyzer();
      }
    }, 100);

    function setupAudioAnalyzer() {
      if (!remoteStreamRef.current) return;

      try {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        
        const source = audioContext.createMediaStreamSource(remoteStreamRef.current);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;
        
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateLevel = () => {
          if (analyserRef.current && statusRef.current === 'active') {
            analyserRef.current.getByteFrequencyData(dataArray);
            
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            
            let normalizedVolume = Math.min(average / 128, 1);
            normalizedVolume = Math.pow(normalizedVolume, 0.6) * 1.5;
            setAudioLevel(Math.min(normalizedVolume, 1));
            
            const barData: number[] = [];
            const usefulBins = Math.floor(dataArray.length / 2);
            const samplesPerBar = usefulBins / FFT_BARS;
            
            for (let i = 0; i < FFT_BARS; i++) {
              let barSum = 0;
              const startIdx = Math.floor(i * samplesPerBar);
              const endIdx = Math.floor((i + 1) * samplesPerBar);
              
              for (let j = startIdx; j < endIdx; j++) {
                barSum += dataArray[j];
              }
              const normalized = (barSum / (endIdx - startIdx)) / 255;
              const scaled = Math.pow(normalized, 0.5) * 1.8;
              barData.push(Math.min(scaled, 1));
            }
            setFftData(barData);
            
            animationFrameRef.current = requestAnimationFrame(updateLevel);
          }
        };

        updateLevel();
      } catch (error) {
        console.error('Failed to setup audio analyzer:', error);
      }
    }

    return () => {
      clearInterval(checkStream);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [status]);

  // ElevenLabs audio level polling (simulates FFT from output volume)
  useEffect(() => {
    if (status !== 'active' || elConversation.status !== 'connected') {
      if (elPollRef.current) {
        cancelAnimationFrame(elPollRef.current);
        elPollRef.current = null;
      }
      return;
    }

    const poll = () => {
      const vol = elConversation.getOutputVolume();
      setAudioLevel(vol);

      const t = Date.now() / 250;
      const fakeFft = Array.from({ length: FFT_BARS }, (_, i) => {
        const wave = Math.abs(Math.sin(t + i * 0.35)) * vol;
        const noise = Math.random() * 0.12 * vol;
        return Math.min(1, wave + noise);
      });
      setFftData(fakeFft);

      elPollRef.current = requestAnimationFrame(poll);
    };

    poll();

    return () => {
      if (elPollRef.current) {
        cancelAnimationFrame(elPollRef.current);
        elPollRef.current = null;
      }
    };
  }, [status, elConversation.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startRealtime(currentSettings = settings) {
    try {
      // Don't start if no API key
      if (!currentSettings.apiKey) {
        console.warn('No API key found, skipping connection');
        return;
      }

      console.log(
        `%c[Jarvis] startRealtime() called at ${new Date().toLocaleTimeString()} — model: ${currentSettings.realtimeModel ?? 'gpt-realtime-2'}`,
        'background:#0d2137;color:#4fc3f7;font-weight:bold;padding:2px 6px;border-radius:3px'
      );

      disconnect(); // Ensure clean slate
      setStatus('listening');
      setLastError(null);
      // Release the wake-word microphone before the realtime session opens it.
      window.electron?.setWakeWordMicInUse?.(true);
      
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false 
        }
      });
      localAudioStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !micMutedRef.current;
      });

      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;
      autoReconnectRef.current = false; // will be set true once data channel opens

      // When the WebRTC connection drops, just go idle — do NOT auto-reconnect.
      // Auto-reconnect created a loop: drop → restart → model calls navigate_to_page('home')
      // → page jumps → user has to deactivate Jarvis again, repeat.
      // Jarvis reconnects explicitly when: the app loads, settings are saved, or the
      // user clicks the logo when idle. The user is always in control.
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`%c[Jarvis] WebRTC connectionState → "${state}" at ${new Date().toLocaleTimeString()}`, 'color:#ffa726');
        if (state === 'failed' || state === 'closed') {
          autoReconnectRef.current = false;
          setStatus('idle');
        }
      };

      // Add local audio track
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      
      // Create data channel for events
      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;

      // Handle remote audio
      pc.ontrack = (ev) => {
        if (currentSettings.ttsProvider === 'olares') return;
        const [remoteStream] = ev.streams;
        remoteStreamRef.current = remoteStream;
        const audio = remoteAudioRef.current;
        if (audio) {
          audio.srcObject = remoteStream;
          audio.play().catch(e => console.error("Audio play failed", e));
        }
      };

      const allFunctions = dynamicState.loaded ? dynamicState.allFunctions : FUNCTION_REGISTRY;
      const enabledTools = allFunctions
        .filter((fn) => currentSettings.enabledFunctions.includes(fn.name))
        .map((fn) => fn.tool);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const model = currentSettings.realtimeModel ?? OPENAI_REALTIME_MODEL;

      const offerSdp = pc.localDescription?.sdp;
      if (!offerSdp) throw new Error('Failed to create realtime SDP offer.');

      const sessionConfig = {
        type: 'realtime',
        model,
        instructions: currentSettings.initialPrompt,
        ...(currentSettings.ttsProvider === 'olares' && { output_modalities: ['text'] }),
        audio: {
          output: {
            voice: currentSettings.voice ?? 'echo',
          },
        },
        ...(enabledTools.length > 0 && { tools: enabledTools }),
      };

      const body = new FormData();
      body.set('sdp', offerSdp);
      body.set('session', JSON.stringify(sessionConfig));
      const response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSettings.apiKey}`,
        },
        body,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to create realtime call: ${text}`);
      }

      const answerSdp = await response.text();
      const answer = { type: 'answer', sdp: answerSdp } as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(answer);

      dc.onopen = () => {
        console.log('WebRTC data channel open');
        autoReconnectRef.current = true; // session is live — enable auto-reconnect on drop

        const allFunctions = dynamicState.loaded ? dynamicState.allFunctions : FUNCTION_REGISTRY;
        const enabledTools = allFunctions
          .filter((fn) => currentSettings.enabledFunctions.includes(fn.name))
          .map((fn) => fn.tool);

        const sessionConfig = {
          type: 'session.update',
          session: {
            ...(currentSettings.ttsProvider === 'olares'
              ? { type: 'realtime', output_modalities: ['text'] }
              : { voice: currentSettings.voice }),
            instructions:
              currentSettings.initialPrompt +
              (memoryBlockRef.current || '') +
              '\n\nDo not call navigate_to_page as part of a greeting or on your own initiative — only call it when the user explicitly asks to go to a different page.',
            ...(enabledTools.length > 0 && { tools: enabledTools }),
          },
        };

        dc.send(JSON.stringify(sessionConfig));
        sessionStartTimeRef.current = Date.now();
        setStatus('active');

        // Inject any photos already on the HUD into the fresh session
        if (photosRef.current.length > 0) {
          injectPhotosIntoSession(photosRef.current);
        }
      };

      // Accumulate streamed function call arguments
      const pendingCalls: Record<string, { name: string; args: string }> = {};

      dc.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          if (currentSettings.ttsProvider === 'olares') {
            if (data.type === 'input_audio_buffer.speech_started') breezeRef.current?.stop();
            if (data.type === 'response.done' && data.response?.status === 'completed') {
              const text = (data.response.output ?? [])
                .filter((item: { type: string; role?: string }) => item.type === 'message' && item.role === 'assistant')
                .flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? [])
                .filter((part: { type: string }) => part.type === 'output_text')
                .map((part: { text?: string }) => part.text ?? '').join('\n');
              if (text) {
                dispatchTranscript('jarvis', text);
                void breezeRef.current?.speak(text, currentSettings).catch(error => emitError('app', `Breeze TTS: ${String(error)}`, 'error'));
              }
            }
          }

          if (data.type === 'error') {
            console.error('OpenAI Error:', data.error);
          }

          // Feed the COMMS LOG transcript widget with Jarvis's spoken replies
          if (data.type === 'response.audio_transcript.done' && typeof data.transcript === 'string') {
            dispatchTranscript('jarvis', data.transcript);
          }
          if (data.type === 'conversation.item.input_audio_transcription.completed' && typeof data.transcript === 'string') {
            dispatchTranscript('user', data.transcript);
          }

          // Accumulate argument deltas
          if (data.type === 'response.function_call_arguments.delta') {
            const id = data.call_id as string;
            if (!pendingCalls[id]) {
              pendingCalls[id] = { name: data.name ?? '', args: '' };
            }
            pendingCalls[id].args += data.delta ?? '';
          }

          // Execute when fully received
          if (data.type === 'response.function_call_arguments.done') {
            const id = data.call_id as string;
            const fnName = data.name as string;
            const rawArgs = data.arguments as string;

            const fn = dynamicGetFunctionByNameRef.current(fnName);
            if (!fn) return;

            let parsedArgs: Record<string, unknown> = {};
            try { parsedArgs = JSON.parse(rawArgs || '{}'); } catch { /* empty args */ }

            // Block unsolicited navigation calls in the first 6 seconds after
            // a session connects. This prevents the model from navigating to
            // "home" as part of its automatic reconnect greeting, which was
            // causing the app to jump back to the home page and reset.
            const msSinceSessionStart = Date.now() - sessionStartTimeRef.current;
            if (fnName === 'navigate_to_page' && msSinceSessionStart < 6000) {
              console.warn('[Jarvis] Blocked early navigate_to_page call (auto-reconnect guard). Args:', parsedArgs);
              dc.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: id,
                  output: JSON.stringify({ success: true, navigated_to: parsedArgs.page }),
                },
              }));
              dc.send(JSON.stringify({ type: 'response.create' }));
              delete pendingCalls[id];
              return;
            }

            const result = (isInterfaceLocked() && !LOCK_ALLOWED_FUNCTIONS.has(fnName))
              ? LOCKED_RESULT
              : await fn.handler(parsedArgs);

            // Surface function-level errors (e.g. ENOENT, missing API key, network failures)
            // to the Error Terminal widget so they're visible without opening devtools.
            const resultObj = result as Record<string, unknown> & { imageBase64?: string };
            if (typeof resultObj?.error === 'string') {
              emitError('function', `${fnName}(): ${resultObj.error}`, 'error');
            }

            // Extract imageBase64 if present so it's sent as a vision input, not raw text
            const { imageBase64, ...textResult } = resultObj;

            // Send function result back
            dc.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: id,
                output: JSON.stringify(textResult),
              },
            }));

            // If the function returned an image, inject it as a vision message so the model can see it
            if (imageBase64) {
              dc.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'user',
                  content: [
                    {
                      type: 'input_image',
                      image_url: `data:image/jpeg;base64,${imageBase64}`,
                    },
                  ],
                },
              }));
            }

            // Ask model to continue responding
            dc.send(JSON.stringify({ type: 'response.create' }));

            if (fnName !== 'control_hud' && fnName !== 'show_hud_text') sfx('notification', 0.6);
            delete pendingCalls[id];
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      };

      dc.onerror = () => {
        console.error("Data channel error");
        setStatus('error');
      };

    } catch (error) {
      console.error('Error starting realtime:', error);
      window.electron?.setWakeWordMicInUse?.(false);
      setStatus('error');
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }

  async function startElevenLabs(currentSettings = settings) {
    try {
      // Only tear down OpenAI WebRTC — do NOT call endSession() here because
      // the ElevenLabs SDK queues it and will fire it on the session we're about to open.
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (dataChannelRef.current) {
        dataChannelRef.current.close();
        dataChannelRef.current = null;
      }
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach(t => t.stop());
        remoteStreamRef.current = null;
      }
      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach(t => t.stop());
        localAudioStreamRef.current = null;
      }
      setStatus('listening');
      setLastError(null);
      // Release the wake-word microphone before ElevenLabs opens it.
      window.electron?.setWakeWordMicInUse?.(true);

      await navigator.mediaDevices.getUserMedia({ audio: true });

      const agentId = currentSettings.elevenLabsAgentId?.trim();
      if (!agentId) {
        console.warn('No ElevenLabs Agent ID configured — add one in Settings.');
        window.electron?.setWakeWordMicInUse?.(false);
        setStatus('idle');
        return;
      }

      const overrideAgent: Record<string, unknown> = {};
      if (currentSettings.initialPrompt) overrideAgent.prompt = { prompt: currentSettings.initialPrompt + (memoryBlockRef.current || '') };
      if (currentSettings.elevenLabsFirstMessage?.trim()) overrideAgent.firstMessage = currentSettings.elevenLabsFirstMessage.trim();
      const overrides = Object.keys(overrideAgent).length > 0 ? { agent: overrideAgent } : undefined;

      await elConversation.startSession({
        agentId,
        connectionType: 'websocket',
        ...(overrides && { overrides }),
      });
    } catch (error) {
      console.error('Error starting ElevenLabs session:', error);
      window.electron?.setWakeWordMicInUse?.(false);
      setStatus('error');
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }

  async function start(currentSettings = settings) {
    if (currentSettings.apiMode === 'local') {
      localVoiceRef.current?.stop();
      setLastError(null); setStatus('listening');
      if (!currentSettings.localLlmModel || !currentSettings.localLlmUrl) {
        setLastError('Configure your Local Model Service in Settings.'); setStatus('error'); return;
      }
      const voice = new LocalVoice(currentSettings, {
        phase: setLocalPhase, transcript: dispatchTranscript,
        error: message => { setLastError(message); emitError('app', message); },
        level: value => { setAudioLevel(value); setFftData(new Array(FFT_BARS).fill(value)); },
      });
      localVoiceRef.current = voice;
      window.electron?.setWakeWordMicInUse?.(true);
      try {
        await voice.start();
        if (localVoiceRef.current === voice) { setStatus('active'); setMicMuted(false); micMutedRef.current = false; }
      } catch (error) {
        if (localVoiceRef.current !== voice) return;
        voice.stop(); localVoiceRef.current = null;
        window.electron?.setWakeWordMicInUse?.(false);
        setLastError(String(error)); setStatus('error');
      }
    } else if ((currentSettings.apiMode ?? 'openai') === 'gemini') {
      await startGemini(currentSettings);
    } else if ((currentSettings.apiMode ?? 'openai') === 'elevenlabs') {
      await startElevenLabs(currentSettings);
    } else {
      await startRealtime(currentSettings);
    }
  }

  /** Gemini Live — Mark 58's voice engine, wired to all Jarvis tools. */
  async function startGemini(currentSettings = settings) {
    if (!currentSettings.geminiApiKey?.trim()) {
      setLastError('Add a Gemini API key in Settings to use the Gemini Live engine.');
      setStatus('error');
      return;
    }
    disconnect();
    setStatus('listening');
    setLastError(null);
    window.electron?.setWakeWordMicInUse?.(true);

    const allFunctions = dynamicState.loaded ? dynamicState.allFunctions : FUNCTION_REGISTRY;
    // Gemini rejects a whole tool set over one bad name — "3d_printing" (digit
    // first) or MCP names with dots would silently poison every connection.
    const validToolName = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
    const tools = allFunctions
      .filter((fn) => currentSettings.enabledFunctions.includes(fn.name) && validToolName.test(fn.tool.name))
      .map((fn) => ({ name: fn.tool.name, description: fn.tool.description, parameters: fn.tool.parameters }));

    const session = new GeminiLive(
      currentSettings.geminiApiKey.trim(),
      currentSettings.initialPrompt +
        (memoryBlockRef.current || '') +
        '\n\nDo not call navigate_to_page as part of a greeting or on your own initiative — only call it when the user explicitly asks to go to a different page.',
      tools,
      {
        onStatus: (s) => {
          if (s === 'active') {
            sessionStartTimeRef.current = Date.now();
            setStatus('active');
            setMicMuted(false);
            micMutedRef.current = false;
          } else if (s === 'connecting') {
            setStatus('listening');
          }
        },
        onTranscript: dispatchTranscript,
        onLevel: (value) => {
          setAudioLevel(value);
          setFftData(new Array(FFT_BARS).fill(value));
        },
        onError: (message) => { setLastError(message); emitError('app', message, 'error'); },
        onClosed: () => { setStatus('idle'); window.electron?.setWakeWordMicInUse?.(false); },
        callTool: async (name, args) => {
          const fn = dynamicGetFunctionByNameRef.current(name);
          if (!fn) return { result: { error: `Unknown tool: ${name}` } };
          const msSinceSessionStart = Date.now() - sessionStartTimeRef.current;
          if (name === 'navigate_to_page' && msSinceSessionStart < 6000) {
            console.warn('[Jarvis] Blocked early navigate_to_page call (auto-reconnect guard).');
            return { result: { success: true, navigated_to: args.page } };
          }
          const result = (isInterfaceLocked() && !LOCK_ALLOWED_FUNCTIONS.has(name))
            ? LOCKED_RESULT
            : await fn.handler(args);
          const resultObj = result as Record<string, unknown> & { imageBase64?: string };
          if (typeof resultObj?.error === 'string') {
            emitError('function', `${name}(): ${resultObj.error}`, 'error');
          }
          if (name !== 'control_hud' && name !== 'show_hud_text') sfx('notification', 0.6);
          const { imageBase64, ...textResult } = resultObj;
          return { result: textResult, imageBase64 };
        },
      },
    );
    geminiRef.current = session;
    try {
      await session.start();
    } catch (error) {
      if (geminiRef.current !== session) return;
      session.stop(); geminiRef.current = null;
      window.electron?.setWakeWordMicInUse?.(false);
      setLastError(String(error)); setStatus('error');
    }
  }

  function disconnect() {
    localVoiceRef.current?.stop(); localVoiceRef.current = null; setLocalPhase('');
    breezeRef.current?.stop();
    console.log(
      `%c[Jarvis] disconnect() called at ${new Date().toLocaleTimeString()} — stack: ${new Error().stack?.split('\n')[2]?.trim() ?? 'unknown'}`,
      'background:#2d0a0a;color:#ff6b6b;font-weight:bold;padding:2px 6px;border-radius:3px'
    );
    // Mark intentional — prevents auto-reconnect from firing on this close
    autoReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Gemini Live cleanup
    if (geminiRef.current) {
      geminiRef.current.stop();
      geminiRef.current = null;
    }
    // OpenAI WebRTC cleanup
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(t => t.stop());
      remoteStreamRef.current = null;
    }
    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getTracks().forEach(t => t.stop());
      localAudioStreamRef.current = null;
    }
    // ElevenLabs cleanup (fire-and-forget; may return undefined if not connected)
    try { elConversation.endSession(); } catch { /* no active session */ }
    // Signal wake word service that mic is available again
    window.electron?.setWakeWordMicInUse?.(false);
    setStatus('idle');
  }

  function setMicrophoneMuted(muted: boolean) {
    micMutedRef.current = muted;
    setMicMuted(muted);
    if (localVoiceRef.current) {
      localVoiceRef.current.setMuted(muted);
      if (desktopModeRef.current) window.electron?.setDesktopPanelMuted?.(muted);
      return;
    }

    localAudioStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    peerConnectionRef.current?.getSenders().forEach((sender) => {
      if (sender.track?.kind === 'audio') sender.track.enabled = !muted;
    });

    try { elConversation.setMuted(muted); } catch { /* ElevenLabs session may be inactive */ }
    if (desktopModeRef.current) {
      window.electron?.setDesktopPanelMuted?.(muted);
    }

    if (muted) {
      // User intentionally silenced Jarvis — disable auto-reconnect so that
      // OpenAI's idle-session timeout doesn't trigger a reconnect (and page
      // navigation) while Jarvis is muted.
      autoReconnectRef.current = false;
    } else {
      // User unmuted — if the session died while muted, revive it now.
      const sessionAlive =
        peerConnectionRef.current !== null &&
        (peerConnectionRef.current.connectionState === 'connected' ||
          peerConnectionRef.current.connectionState === 'connecting');
      if (!sessionAlive) {
        setRestartTrigger((t) => t + 1);
      } else {
        autoReconnectRef.current = true;
      }
    }
  }

  function handleLogoClick() {
    if (compact) {
      sfx('click', 0.45);
      if (status === 'active' || status === 'listening') {
        console.log(`%c[Jarvis] Logo clicked → DISCONNECTING (status was "${status}")`, 'color:#ef9a9a;font-weight:bold');
        // Fully end the WebRTC stream — no muting, no lingering session.
        // OpenAI cannot call any functions or navigate once disconnected.
        disconnect();
      } else {
        console.log(`%c[Jarvis] Logo clicked → RECONNECTING (status was "${status}")`, 'color:#a5d6a7;font-weight:bold');
        // Jarvis is idle/disconnected — reconnect the stream.
        setRestartTrigger((t) => t + 1);
      }
      return;
    }

    sfx('sfx_settings_open', 0.7);
    setIsSettingsOpen(true);
  }

  // Auto-start on mount / mode change / explicit restart
  // Gates on dynamicState.loaded to prevent race between tool loading and session start.
  useEffect(() => {
    if (!dynamicState.loaded) return;

    const mode = settings.apiMode ?? 'openai';
    const shouldStart =
      (mode === 'elevenlabs' && !!settings.elevenLabsAgentId?.trim()) ||
      (mode === 'openai' && !!settings.apiKey) ||
      (mode === 'gemini' && !!settings.geminiApiKey?.trim()) ||
      (mode === 'local' && !!settings.localLlmModel && !!settings.localLlmUrl);

    console.log(
      `%c[Jarvis] Auto-start effect fired at ${new Date().toLocaleTimeString()} — restartTrigger=${restartTrigger}, shouldStart=${shouldStart}, mode=${mode}`,
      'background:#1b2838;color:#66bb6a;font-weight:bold;padding:2px 6px;border-radius:3px'
    );

    const startTimer = shouldStart
      ? window.setTimeout(() => void start(settings), 0)
      : null;

    return () => {
      if (startTimer !== null) window.clearTimeout(startTimer);
      disconnect();
    };
  }, [settings.apiKey, settings.apiMode, restartTrigger, dynamicState.loaded]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleSaveSettings = (newSettings: JarvisSettings) => {
    setSettings(newSettings);
    const serialised = JSON.stringify(newSettings);
    localStorage.setItem('jarvis_settings', serialised);
    // Save credentials or an explicitly chosen local model to shared server
    // settings. A blank default save must not overwrite a good configuration.
    const hasCredentials =
      (newSettings.apiMode === 'openai'      && !!newSettings.apiKey?.trim()) ||
      (newSettings.apiMode === 'elevenlabs'  && !!newSettings.elevenLabsAgentId?.trim()) ||
      (newSettings.apiMode === 'gemini'      && !!newSettings.geminiApiKey?.trim()) ||
      !!newSettings.geminiApiKey?.trim() ||
      !!newSettings.geminiProviderUrl?.trim() ||
      !!newSettings.localLlmModel?.trim() ||
      (newSettings.localLlmProvider === 'olares' && !!newSettings.localLlmApiKey?.trim()) ||
      newSettings.localLlmProvider === 'olares-shared' ||
      (newSettings.ttsProvider === 'olares' && !!newSettings.ttsRouterApiKey?.trim());
    if (hasCredentials) {
      saveServerSettings({ jarvis_settings: serialised });
    }
    setIsSettingsOpen(false);
    // Increment trigger so the auto-start effect re-runs with the new settings.
    // This avoids the race where a manual setTimeout races against the effect.
    setRestartTrigger((t) => t + 1);
  };

  // In compact mode, show as greyed-out whenever the stream is not active.
  // Previously this was tied to micMuted, but now compact-click fully disconnects
  // the stream, so status === 'idle' is the correct indicator.
  const isCompactMuted = compact && status !== 'active' && status !== 'listening';
  const visualStatus = isCompactMuted ? 'idle' : status;
  const visualAudioLevel = isCompactMuted ? 0 : audioLevel;
  const visualFftData = isCompactMuted ? new Array(FFT_BARS).fill(0) : fftData;
  const ring1Scale = 1 + visualAudioLevel * 0.08;
  const ring2Scale = 1 + visualAudioLevel * 0.05;
  const logoScale = 1;
  const glowIntensity = 0;

  const gridSize = ({ small: '20px 20px', medium: '40px 40px', large: '80px 80px', off: undefined } as Record<string, string | undefined>)[settings.grid ?? 'off'];

  const pos = settings.position ?? 'center';
  const isCenter = pos === 'center';

  // Flex alignment classes for each position
  const positionClass: Record<string, string> = {
    'center':       'items-center justify-center',
    'top-left':     'items-start justify-start',
    'top-right':    'items-start justify-end',
    'bottom-left':  'items-end justify-start',
    'bottom-right': 'items-end justify-end',
  };
  // Padding so the widget doesn't hug the absolute edge
  const positionPadding: Record<string, string> = {
    'center':       '',
    'top-left':     'pt-12 pl-12',
    'top-right':    'pt-12 pr-12',
    'bottom-left':  'pb-12 pl-12',
    'bottom-right': 'pb-12 pr-12',
  };

  return (
    <div
      className="contents"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >
      {/* Drag-over overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', border: '2px dashed rgba(34,211,238,0.6)' }}>
          <span className="text-cyan-400 text-2xl font-semibold tracking-widest uppercase select-none">
            Drop image to add to context
          </span>
        </div>
      )}

      {/* Grid overlay */}
      {settings.grid && settings.grid !== 'off' && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: 1,
            backgroundImage: `
              linear-gradient(rgba(var(--accent-rgb), 0.06) 1px, transparent 1px),
              linear-gradient(90deg, rgba(var(--accent-rgb), 0.06) 1px, transparent 1px)
            `,
            backgroundSize: gridSize,
          }}
        />
      )}

      <div className={`fixed inset-0 flex overflow-hidden pointer-events-none select-none ${
        compact
          ? 'items-end justify-end pb-6 pr-6 z-[60]'
          : roundDisplay
          ? 'items-center justify-center z-[50]'
          : `${positionClass[pos]} ${positionPadding[pos]}`
      }`}>
        {/* Background with slight gradient — hidden in compact/round mode */}
        {!compact && !roundDisplay && (
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/20 pointer-events-none" />
        )}

        <motion.div
          layout
          transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
          className={`relative flex items-center justify-center aspect-square pointer-events-auto ${
            compact
              ? 'w-[160px]'
              : roundDisplay
              ? 'w-[min(100vw,100vh)]'
              : isCenter
              ? 'w-[80vw] max-w-[500px]'
              : 'w-[50vw] max-w-[340px]'
          }`}
        >

          {/* ── Frequency Ring visualizer (default) ── */}
          {settings.visualizer === 'frequency-ring' && (
            <>
              {/* Ring 2 - Outer */}
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{
                  transform: `rotate(${ring2Rotation}deg) scale(${ring2Scale})`,
                  opacity: visualStatus === 'active' ? 1 : 0.3,
                  transition: 'opacity 300ms'
                }}
              >
                <Image
                  src="/assets/ring2.png"
                  alt=""
                  width={700}
                  height={700}
                  className="w-full h-full object-contain"
                  style={{ filter: 'drop-shadow(0 0 20px rgba(var(--accent-rgb), 0.6))' }}
                  priority
                  draggable={false}
                />
              </div>

              {/* FFT Bars */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <svg className="w-2/3 h-2/3" viewBox="0 0 400 400" style={{ overflow: 'visible' }}>
                  {mounted && visualFftData.map((value, index) => {
                    const angle = (index / FFT_BARS) * Math.PI * 2;
                    const radius = 180;
                    const centerX = 200;
                    const centerY = 200;
                    const x = centerX + Math.cos(angle) * radius;
                    const y = centerY + Math.sin(angle) * radius;
                    const barWidth = 5;
                    const baseHeight = 6;
                    const barHeight = baseHeight + value * 25;
                    const opacity = visualStatus === 'active' ? 0.4 + value * 0.6 : 0.1;
                    const rotation = (angle * 180) / Math.PI + 90;
                    return (
                      <g key={index} transform={`translate(${x}, ${y}) rotate(${rotation})`}>
                        <rect
                          x={-barWidth / 2}
                          y={-barHeight / 2}
                          width={barWidth}
                          height={barHeight}
                          fill="var(--accent-hex)"
                          opacity={opacity}
                          rx={2.5}
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Ring 1 - Middle */}
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{
                  transform: `rotate(${ring1Rotation}deg) scale(${ring1Scale})`,
                  opacity: visualStatus === 'active' ? 1 : 0.5,
                  transition: 'opacity 200ms'
                }}
              >
                <Image
                  src="/assets/ring1.png"
                  alt=""
                  width={600}
                  height={600}
                  className="w-4/5 h-4/5 object-contain"
                  style={{ filter: 'drop-shadow(0 0 25px rgba(var(--accent-rgb), 0.8))' }}
                  priority
                  draggable={false}
                />
              </div>
            </>
          )}

          {/* ── Arc Reactor visualizer ── */}
          {settings.visualizer === 'arc-reactor' && (
            <div className="absolute inset-0 pointer-events-none">
              <ArcReactorVisualizer
                fftData={visualFftData}
                status={visualStatus}
              />
            </div>
          )}

          {/* ── 3D sphere + particle logo ── */}
          {settings.visualizer === 'sphere-nodes' && (
            <div className="absolute inset-0 z-[5] pointer-events-none">
              <SphereNodesVisualizer
                fftData={visualFftData}
                status={visualStatus}
                logoUrl={`/assets/${settings.logo ?? 'logo'}.png`}
              />
            </div>
          )}

          {/* ── Quarter rings visualizer ── */}
          {settings.visualizer === 'quarter-rings' && (
            <div className="absolute inset-0 pointer-events-none">
              <QuarterRingsVisualizer
                fftData={visualFftData}
                status={visualStatus}
              />
            </div>
          )}

          {/* ── Original HUD visualizer ── */}
          {settings.visualizer === 'original' && (
            <div className="absolute inset-0 pointer-events-none">
              <OriginalVisualizer
                fftData={visualFftData}
                status={visualStatus}
              />
            </div>
          )}

          {/* Center widget (model viewer etc.) — overlays logo when active */}
          <AnimatePresence>
            {centerWidget?.type === 'model' && (
              <ModelViewerWidget
                key="model-viewer"
                modelPath={centerWidget.path}
                modelName={centerWidget.name}
                onClose={() => setCenterWidget(null)}
              />
            )}
          </AnimatePresence>

          {/* Logo - Center (Clickable for Settings); hidden when a center widget is open; 3D mode uses particle logo instead */}
          {settings.visualizer !== 'sphere-nodes' && !centerWidget && (
            <div
              className={`relative z-10 w-[55%] h-[55%] cursor-pointer group ${isCompactMuted ? 'opacity-35 grayscale' : ''}`}
              role="button"
              aria-label={compact ? (micMuted ? 'Unmute microphone' : 'Mute microphone') : 'Open settings'}
              aria-pressed={compact ? micMuted : undefined}
              onClick={handleLogoClick}
              style={{
                transform: `scale(${logoScale})`,
                filter: isCompactMuted
                  ? 'drop-shadow(0 0 2px rgba(var(--accent-rgb), 0.25))'
                  : `drop-shadow(0 0 ${glowIntensity}px rgba(var(--accent-rgb), 0.9))`
              }}
            >
              <Image
                src={`/assets/${settings.logo ?? 'logo'}.png`}
                alt="Jarvis Logo"
                width={300}
                height={300}
                className="w-full h-full object-contain group-hover:drop-shadow-[0_0_15px_rgba(34,211,238,0.6)] transition-all"
                priority
                draggable={false}
              />
            </div>
          )}
          {settings.visualizer === 'sphere-nodes' && !centerWidget && (
            <button
              type="button"
              aria-label={compact ? (micMuted ? 'Unmute microphone' : 'Mute microphone') : 'Open settings'}
              aria-pressed={compact ? micMuted : undefined}
              className={`absolute z-10 w-[55%] h-[55%] max-w-[280px] max-h-[280px] cursor-pointer rounded-full bg-transparent border-0 p-0 pointer-events-auto group ${
                isCompactMuted ? 'opacity-35' : ''
              }`}
              onClick={handleLogoClick}
            />
          )}

          {/* Status Info — hidden in compact/round-display mode */}
          {!compact && !roundDisplay && (
            <div className="absolute bottom-[-100px] left-1/2 -translate-x-1/2 text-center space-y-4 w-full">
              <button 
                onClick={() => {
                  sfx('click', 0.6);
                  if (status === 'active' || status === 'listening') {
                    disconnect();
                  } else {
                    start();
                  }
                }}
                className="flex items-center justify-center gap-3 mx-auto hover:scale-105 transition-transform cursor-pointer group"
              >
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    status === 'idle'
                      ? 'bg-gray-500 group-hover:bg-cyan-400'
                      : status === 'listening'
                      ? 'bg-yellow-400 animate-pulse'
                      : status === 'active'
                      ? 'bg-cyan-400 animate-pulse'
                      : 'bg-red-500'
                  }`}
                />
                <span className="text-xl font-semibold text-cyan-400 uppercase tracking-wider group-hover:text-cyan-300 transition-colors">
                  {status === 'idle' ? 'OFFLINE' : status}
                </span>
              </button>

              <p className="text-sm text-white/60 max-w-md px-4 mx-auto">
                {status === 'listening' ? (
                  'Establishing connection...'
                ) : status === 'active' ? (
                  settings.apiMode === 'local' ? `${localPhase}${lastError ? ` · ${lastError}` : ''}` : 'J.A.R.V.I.S. is online. Click status to disconnect.'
                ) : status === 'error' ? (
                  <>
                    Connection error. Check Settings.
                    {lastError && (
                      <span className="block mt-1 text-xs text-red-400/80 font-mono break-all">
                        {lastError}
                      </span>
                    )}
                  </>
                ) : status === 'idle' ? (
                  'Click status to activate'
                ) : !settings.apiKey ? (
                  'Click logo to configure API Key'
                ) : null}
              </p>
              
              {status === 'error' && (
                <button 
                  onClick={() => start()}
                  className="px-4 py-2 bg-cyan-900/50 text-cyan-300 rounded hover:bg-cyan-900/80 transition-colors pointer-events-auto"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </motion.div>

        {/* Hidden Audio Element */}
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        {/* Round Display — back button */}
        {roundDisplay && (
          <button
            className="fixed top-4 left-4 z-[70] pointer-events-auto text-cyan-400/60 hover:text-cyan-300 transition-colors text-xs uppercase tracking-widest"
            onClick={() => window.dispatchEvent(new CustomEvent('jarvis:navigate', { detail: { page: 'home' } }))}
          >
            ← Back
          </button>
        )}
      </div>

      {/* X-Ray Widget */}
      <XrayWidget />

      {/* Camera Widget */}
      <CameraWidget />

      {/* Photo Widgets */}
      <AnimatePresence>
        {photos.map((photo, i) => (
          <PhotoWidget
            key={photo.id}
            photo={photo}
            index={i}
            onDismiss={dismissPhoto}
          />
        ))}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onSave={handleSaveSettings}
            initialSettings={settings}
            dynamicFunctions={dynamicState.mcpFunctions.length > 0 || dynamicState.skillFunctions.length > 0
              ? [...dynamicState.mcpFunctions, ...dynamicState.skillFunctions]
              : []}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
