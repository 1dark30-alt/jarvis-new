'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  GOOGLE_SERVICES,
  getGoogleServiceIds,
  getScopeText,
  type GoogleServiceId,
} from '@/app/lib/google-services';

interface GoogleCalendarWizardProps {
  onComplete: (connectedServices?: GoogleServiceId[]) => void;
  onSkip: () => void;
  onBack: () => void;
}

interface CredentialsJson {
  installed?: {
    client_id?: string;
    client_secret?: string;
    project_id?: string;
    auth_uri?: string;
    token_uri?: string;
    [key: string]: unknown;
  };
  web?: {
    client_id?: string;
    client_secret?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  data?: CredentialsJson;
}

interface GoogleServiceStatus {
  id: GoogleServiceId;
  label: string;
  shortLabel: string;
  serverName: string;
  configured: boolean;
  connected: boolean;
  tools: number;
  authenticated: boolean;
  tokenPath: string | null;
}

interface GoogleServicesStatusResponse {
  hasCredentials: boolean;
  credentialsPath: string;
  services: GoogleServiceStatus[];
  error?: string;
}

type AuthState =
  | 'queued'
  | 'skipped'
  | 'starting'
  | 'authenticating'
  | 'waiting'
  | 'restarting'
  | 'connected'
  | 'error';

interface AuthProgress {
  status: AuthState;
  message: string;
  error?: string;
  authUrl?: string;
  tools?: number;
}

const TOTAL_STEPS = 5;
const STEP_TITLES = ['Services', 'Cloud', 'Credentials', 'Auth', 'Done'];

function validateCredentialsFile(content: string): ValidationResult {
  let parsed: CredentialsJson;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { valid: false, error: 'Invalid JSON file. Upload the OAuth credentials JSON from Google Cloud.' };
  }

  if (parsed.installed?.client_id && parsed.installed?.client_secret) {
    return { valid: true, data: parsed };
  }

  if (parsed.web?.client_id && parsed.web?.client_secret) {
    return {
      valid: false,
      error: 'This is a Web application credentials file. Create a Desktop app OAuth client, or add the listed localhost callback URI before using Web credentials.',
    };
  }

  return {
    valid: false,
    error: 'Invalid credentials format. Expected a Desktop app OAuth JSON file with an "installed" object.',
  };
}

function truncateClientId(id: string): string {
  if (id.length <= 26) return id;
  return `${id.substring(0, 20)}...${id.slice(-4)}`;
}

function statusTone(status: AuthState) {
  if (status === 'connected' || status === 'skipped') return 'text-emerald-400 border-emerald-500/25 bg-emerald-500/[0.06]';
  if (status === 'error') return 'text-red-300 border-red-500/25 bg-red-500/[0.06]';
  if (status === 'queued') return 'text-white/35 border-white/[0.08] bg-white/[0.02]';
  return 'text-cyan-300 border-cyan-500/25 bg-cyan-500/[0.06]';
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 px-1">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div key={i} className="flex items-center gap-2 flex-1">
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-mono font-bold transition-all duration-300 ${
                i < current
                  ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                  : i === current
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/40 shadow-[0_0_8px_rgba(34,211,238,0.15)]'
                  : 'bg-white/[0.04] text-white/20 border border-white/[0.08]'
              }`}
            >
              {i < current ? '✓' : i + 1}
            </div>
            <span
              className={`text-[8px] font-mono uppercase tracking-widest hidden sm:block transition-colors duration-300 ${
                i === current ? 'text-cyan-400/80' : 'text-white/20'
              }`}
            >
              {STEP_TITLES[i]}
            </span>
          </div>
          {i < TOTAL_STEPS - 1 && (
            <div className={`h-[1px] flex-1 transition-all duration-500 ${i < current ? 'bg-cyan-500/40' : 'bg-white/[0.06]'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function ScanLines() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60] opacity-[0.03]"
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34, 211, 238, 0.08) 2px, rgba(34, 211, 238, 0.08) 3px)',
        backgroundSize: '100% 3px',
      }}
    />
  );
}

function HUDCorners() {
  return (
    <>
      {['top-0 left-0 border-t-2 border-l-2','top-0 right-0 border-t-2 border-r-2',
        'bottom-0 left-0 border-b-2 border-l-2','bottom-0 right-0 border-b-2 border-r-2'].map((cls,i) => (
        <div key={i} className={`absolute w-8 h-8 ${cls} border-cyan-500/20 pointer-events-none z-10 m-3`} />
      ))}
    </>
  );
}

function PulsingDot({ className = '' }: { className?: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full animate-pulse ${className}`} />;
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="shrink-0 px-3 py-1.5 rounded-lg text-[8px] font-mono text-white/35 hover:text-cyan-300 hover:bg-cyan-500/10 border border-white/[0.07] hover:border-cyan-500/25 transition-all uppercase tracking-wider"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

function UploadArea({
  onFile,
  disabled,
}: {
  onFile: (file: File, content: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const loadFile = useCallback((file: File) => {
    if (!file.name.endsWith('.json')) return;
    const reader = new FileReader();
    reader.onload = () => onFile(file, reader.result as string);
    reader.readAsText(file);
  }, [onFile]);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }, [disabled, loadFile]);

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click();
      }}
      aria-label="Upload Google OAuth credentials JSON"
      className={`relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all duration-300 ${
        dragging
          ? 'border-cyan-400 bg-cyan-500/[0.08]'
          : 'border-white/[0.12] bg-white/[0.02] hover:border-white/[0.25] hover:bg-white/[0.04]'
      } ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadFile(file);
        }}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] flex items-center justify-center text-[10px] font-mono text-cyan-300">
          JSON
        </div>
        <div>
          <div className="text-[11px] font-mono text-white/60">Drop credentials.json here</div>
          <div className="text-[9px] font-mono text-white/25 mt-1">or click to browse</div>
        </div>
      </div>
    </div>
  );
}

const stepVariants = {
  initial: { opacity: 0, y: 20, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -20, filter: 'blur(4px)' },
};

export function GoogleCalendarWizard({ onComplete, onSkip, onBack }: GoogleCalendarWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedIds, setSelectedIds] = useState<GoogleServiceId[]>(['calendar']);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [serviceStatuses, setServiceStatuses] = useState<Record<GoogleServiceId, GoogleServiceStatus | undefined>>({
    calendar: undefined,
    gmail: undefined,
  });
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [credentialsPath, setCredentialsPath] = useState<string | null>(null);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [validatedData, setValidatedData] = useState<CredentialsJson | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);

  const [authProgress, setAuthProgress] = useState<Record<GoogleServiceId, AuthProgress | undefined>>({
    calendar: undefined,
    gmail: undefined,
  });
  const [authRunning, setAuthRunning] = useState(false);

  const selectedServices = useMemo(
    () => GOOGLE_SERVICES.filter((service) => selectedIds.includes(service.id)),
    [selectedIds],
  );
  const selectedScopeText = useMemo(() => getScopeText(selectedIds), [selectedIds]);
  const connectedServiceIds = useMemo(
    () => GOOGLE_SERVICES
      .filter((service) => serviceStatuses[service.id]?.connected || serviceStatuses[service.id]?.authenticated)
      .map((service) => service.id),
    [serviceStatuses],
  );

  const fetchGoogleStatus = useCallback(async (updateSelection = false): Promise<GoogleServicesStatusResponse> => {
    const res = await fetch('/api/mcp/google-services');
    const data = await res.json() as GoogleServicesStatusResponse;
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Could not load Google service status.');
    }

    setHasCredentials(data.hasCredentials);
    setCredentialsPath(data.credentialsPath);
    setServiceStatuses(Object.fromEntries(data.services.map((service) => [service.id, service])) as Record<GoogleServiceId, GoogleServiceStatus>);

    if (updateSelection && !selectionTouched) {
      const pending = data.services
        .filter((service) => !service.connected && !service.authenticated)
        .map((service) => service.id);
      setSelectedIds(getGoogleServiceIds(pending.length > 0 ? pending : ['calendar']));
    }

    return data;
  }, [selectionTouched]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setStatusLoading(true);
      setStatusError(null);
      try {
        await fetchGoogleStatus(true);
      } catch (err) {
        if (alive) setStatusError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setStatusLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [fetchGoogleStatus]);

  useEffect(() => {
    return () => {
      fetch('/api/mcp/trigger-auth', { method: 'DELETE' }).catch(() => { /* ignore */ });
    };
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  const prevStep = useCallback(() => {
    if (currentStep === 0) {
      onBack();
      return;
    }
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, [currentStep, onBack]);

  const toggleService = useCallback((id: GoogleServiceId) => {
    setSelectionTouched(true);
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
  }, []);

  const handleFileSelected = useCallback(async (file: File, content: string) => {
    setUploadedFile(file);
    setValidationError(null);
    setUploadError(null);
    setUploadSuccess(false);

    const result = validateCredentialsFile(content);
    if (!result.valid) {
      setValidationError(result.error ?? 'Invalid file');
      setValidatedData(null);
      return;
    }

    setValidatedData(result.data!);
    setIsUploading(true);
    try {
      const res = await fetch('/api/mcp/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json() as { error?: string; projectId?: string };

      if (!res.ok) {
        setUploadError(data.error || 'Failed to save credentials.');
        return;
      }

      setUploadSuccess(true);
      setSavedProjectId(data.projectId || null);
      await fetchGoogleStatus(false);
    } catch {
      setUploadError('Network error. Could not reach the local setup API.');
    } finally {
      setIsUploading(false);
    }
  }, [fetchGoogleStatus]);

  const updateProgress = useCallback((id: GoogleServiceId, patch: Partial<AuthProgress>) => {
    setAuthProgress((current) => ({
      ...current,
      [id]: {
        status: 'queued',
        message: 'Queued',
        ...(current[id] ?? {}),
        ...patch,
      },
    }));
  }, []);

  const startService = useCallback(async (id: GoogleServiceId) => {
    const res = await fetch('/api/mcp/google-services/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: id }),
    });
    const data = await res.json() as { error?: string; tools?: number };
    if (!res.ok || data.error) {
      throw new Error(data.error || `Could not start ${id} MCP server.`);
    }
    return data.tools ?? 0;
  }, []);

  const restartService = useCallback(async (id: GoogleServiceId) => {
    await fetch(`/api/mcp/google-services/start?serviceId=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => { /* ignore */ });
    return startService(id);
  }, [startService]);

  const pollForAuth = useCallback(async (id: GoogleServiceId) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      await delay(2000);
      const res = await fetch(`/api/mcp/auth-status?service=${encodeURIComponent(id)}`);
      const data = await res.json() as { authenticated?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `Could not check ${id} auth status.`);
      if (data.authenticated) return;
    }
    throw new Error('Authentication timed out. Complete Google sign-in in the browser, then retry this service.');
  }, []);

  const runAuthForServices = useCallback(async (idsToRun: GoogleServiceId[]) => {
    if (idsToRun.length === 0) return;

    setAuthRunning(true);
    let hadError = false;

    for (const id of idsToRun) {
      const service = GOOGLE_SERVICES.find((item) => item.id === id);
      if (!service) continue;

      try {
        const snapshot = await fetchGoogleStatus(false);
        const latest = snapshot.services.find((item) => item.id === id);

        if (latest?.connected) {
          updateProgress(id, {
            status: 'skipped',
            message: `${service.shortLabel} already connected. Skipped.`,
            tools: latest.tools,
            error: undefined,
            authUrl: undefined,
          });
          continue;
        }

        if (latest?.authenticated) {
          updateProgress(id, {
            status: 'starting',
            message: `${service.shortLabel} token found. Starting MCP server.`,
            error: undefined,
            authUrl: undefined,
          });
          const tools = await startService(id);
          updateProgress(id, {
            status: 'connected',
            message: `${service.shortLabel} connected with ${tools} tools.`,
            tools,
          });
          continue;
        }

        if (service.startBeforeAuth) {
          updateProgress(id, {
            status: 'starting',
            message: `Starting ${service.shortLabel} MCP server.`,
            error: undefined,
            authUrl: undefined,
          });
          await startService(id);
        }

        updateProgress(id, {
          status: 'authenticating',
          message: `Opening Google sign-in for ${service.shortLabel}.`,
          error: undefined,
          authUrl: undefined,
        });

        const triggerRes = await fetch('/api/mcp/trigger-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceId: id }),
        });
        const triggerData = await triggerRes.json() as { authUrl?: string; error?: string; output?: string };
        if (!triggerRes.ok || triggerData.error) {
          throw new Error(triggerData.error || `Could not start ${service.shortLabel} authentication.`);
        }

        if (triggerData.authUrl) {
          updateProgress(id, {
            status: 'waiting',
            message: `Waiting for ${service.shortLabel} Google consent.`,
            authUrl: triggerData.authUrl,
          });
          fetch('/api/open-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: triggerData.authUrl }),
          }).catch(() => { /* best effort */ });
        } else {
          updateProgress(id, {
            status: 'waiting',
            message: `Waiting for ${service.shortLabel} Google consent. Check terminal if browser did not open.`,
            authUrl: '',
          });
        }

        await pollForAuth(id);

        updateProgress(id, {
          status: 'restarting',
          message: `Restarting ${service.shortLabel} MCP server with fresh token.`,
          authUrl: undefined,
        });
        const tools = await restartService(id);

        updateProgress(id, {
          status: 'connected',
          message: `${service.shortLabel} connected with ${tools} tools.`,
          tools,
        });
      } catch (err) {
        hadError = true;
        await fetch('/api/mcp/trigger-auth', { method: 'DELETE' }).catch(() => { /* ignore */ });
        updateProgress(id, {
          status: 'error',
          message: `${service?.shortLabel ?? id} failed.`,
          error: err instanceof Error ? err.message : String(err),
          authUrl: undefined,
        });
      }
    }

    setAuthRunning(false);
    const latest = await fetchGoogleStatus(false).catch(() => null);
    if (!hadError && latest) {
      const done = selectedIds.every((id) => {
        const status = latest.services.find((service) => service.id === id);
        return status?.connected || status?.authenticated;
      });
      if (done) setCurrentStep(4);
    }
  }, [fetchGoogleStatus, pollForAuth, restartService, selectedIds, startService, updateProgress]);

  const beginAuth = useCallback(() => {
    const initial = Object.fromEntries(
      selectedIds.map((id) => {
        const service = GOOGLE_SERVICES.find((item) => item.id === id)!;
        const status = serviceStatuses[id];
        const alreadyDone = status?.connected || status?.authenticated;
        return [
          id,
          {
            status: alreadyDone ? 'skipped' : 'queued',
            message: alreadyDone ? `${service.shortLabel} already set up. Skipped.` : `${service.shortLabel} queued.`,
            tools: status?.tools ?? 0,
          } satisfies AuthProgress,
        ];
      }),
    ) as Record<GoogleServiceId, AuthProgress>;

    setAuthProgress((current) => ({ ...current, ...initial }));
    runAuthForServices(selectedIds);
  }, [runAuthForServices, selectedIds, serviceStatuses]);

  const canContinueFromCredentials = hasCredentials || uploadSuccess;
  const hasAuthErrors = selectedIds.some((id) => authProgress[id]?.status === 'error');
  const hasAuthSuccess = selectedIds.some((id) => {
    const status = authProgress[id]?.status;
    return status === 'connected' || status === 'skipped';
  });

  return (
    <motion.div
      key="google-services-wizard"
      className="fixed inset-0 bg-[#050810] z-[50] overflow-hidden flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <HUDCorners />
      <ScanLines />

      <div className="flex items-center justify-between px-8 py-4 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-3">
          <PulsingDot className="bg-cyan-400" />
          <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-widest">
            Google Services Setup
          </span>
        </div>
        <div className="flex-1 max-w-md mx-8 hidden md:block">
          <StepIndicator current={currentStep} />
        </div>
        <div className="text-[9px] font-mono text-white/20">
          Step {currentStep + 1} of {TOTAL_STEPS}
        </div>
      </div>

      <div className="md:hidden px-8 py-3 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} className={`flex-1 h-1 rounded-full transition-all duration-500 ${i <= currentStep ? 'bg-cyan-500/50' : 'bg-white/[0.06]'}`} />
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-10 md:py-14">
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div
                key="step-services"
                variants={stepVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.4 }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-2xl md:text-3xl font-mono font-bold text-white tracking-tight">
                    Choose Google <span className="text-cyan-400">Services</span>
                  </h1>
                  <p className="text-[12px] font-mono text-white/40 leading-relaxed max-w-xl mx-auto">
                    You must connect your Google account in order to use Google-based services. Pick what Jarvis should connect. Existing services are detected and skipped during auth.
                  </p>
                </div>

                {statusError && (
                  <div className="p-4 rounded-xl bg-red-500/[0.06] border border-red-500/20 text-[10px] font-mono text-red-300/70">
                    {statusError}
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-3">
                  {GOOGLE_SERVICES.map((service) => {
                    const selected = selectedIds.includes(service.id);
                    const status = serviceStatuses[service.id];
                    const done = status?.connected || status?.authenticated;

                    return (
                      <button
                        key={service.id}
                        onClick={() => toggleService(service.id)}
                        className={`text-left p-5 rounded-xl border transition-all ${
                          selected
                            ? 'bg-cyan-500/[0.08] border-cyan-500/35 shadow-[0_0_24px_rgba(34,211,238,0.06)]'
                            : 'bg-white/[0.025] border-white/[0.07] hover:bg-white/[0.04] hover:border-white/[0.14]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-4">
                            <div className={`w-11 h-11 rounded-xl border flex items-center justify-center text-[9px] font-mono ${
                              selected ? 'border-cyan-500/35 bg-cyan-500/[0.1] text-cyan-300' : 'border-white/[0.08] bg-white/[0.03] text-white/30'
                            }`}>
                              {service.icon}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <div className="text-[13px] font-mono text-white/80 font-semibold">{service.label}</div>
                                {done && (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/[0.08] border border-emerald-500/20 text-[8px] font-mono text-emerald-400 uppercase tracking-wider">
                                    Ready
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-white/35 leading-relaxed mt-1">{service.description}</div>
                              {status?.connected && (
                                <div className="text-[9px] font-mono text-emerald-400/60 mt-2">{status.tools} MCP tools online</div>
                              )}
                            </div>
                          </div>
                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                            selected ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300' : 'border-white/10 text-transparent'
                          }`}>
                            <span className="text-[11px]">✓</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setSelectionTouched(true); setSelectedIds(GOOGLE_SERVICES.map((service) => service.id)); }}
                      className="px-3 py-2 rounded-lg border border-white/[0.08] text-[9px] font-mono text-white/35 hover:text-cyan-300 hover:border-cyan-500/25 transition-all uppercase tracking-wider"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => { setSelectionTouched(true); setSelectedIds([]); }}
                      className="px-3 py-2 rounded-lg border border-white/[0.08] text-[9px] font-mono text-white/25 hover:text-white/50 transition-all uppercase tracking-wider"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={onSkip} className="px-4 py-2 text-[10px] font-mono text-white/25 hover:text-white/50 transition-colors uppercase tracking-wider">
                      Skip
                    </button>
                    <button
                      onClick={nextStep}
                      disabled={selectedIds.length === 0 || statusLoading}
                      className="px-8 py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 text-[10px] font-mono uppercase tracking-widest hover:bg-cyan-500/25 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 1 && (
              <motion.div
                key="step-cloud"
                variants={stepVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.4 }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-2xl md:text-3xl font-mono font-bold text-white tracking-tight">
                    Prepare Google <span className="text-cyan-400">Cloud</span>
                  </h1>
                  <p className="text-[12px] font-mono text-white/40 leading-relaxed max-w-xl mx-auto">
                    Use one Google Cloud project and one Desktop OAuth client for all selected services.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  {selectedServices.map((service) => (
                    <div key={service.id} className="p-4 rounded-xl bg-white/[0.025] border border-white/[0.07] space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-mono text-white/75 font-semibold">{service.apiName}</div>
                          <div className="text-[9px] font-mono text-white/25 mt-0.5">{service.packageName}</div>
                        </div>
                        <a
                          href={service.apiUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-cyan-500/[0.08] border border-cyan-500/25 text-[8px] font-mono text-cyan-300 hover:bg-cyan-500/[0.14] transition-all uppercase tracking-wider"
                        >
                          Enable
                        </a>
                      </div>
                      <div className="space-y-1.5">
                        {service.setupNotes.map((note) => (
                          <div key={note} className="flex items-start gap-2 text-[10px] font-mono text-white/38 leading-relaxed">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/35 mt-1.5 shrink-0" />
                            <span>{note}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[10px] font-mono text-white/55 uppercase tracking-widest font-semibold">OAuth Scopes</div>
                      <div className="text-[9px] font-mono text-white/25 mt-1">
                        Add these to OAuth consent screen if Google asks for scopes.
                      </div>
                    </div>
                    <CopyButton text={selectedScopeText} label="Copy scopes" />
                  </div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/25 border border-white/[0.06] p-3 text-[9px] font-mono text-cyan-200/70 leading-relaxed">
                    {selectedScopeText}
                  </pre>
                </div>

                <div className="p-4 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
                  <div className="text-[10px] font-mono text-amber-300/75 leading-relaxed">
                    Create credentials at APIs & Services - Credentials - Create Credentials - OAuth client ID - Desktop app. Download the JSON file.
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button onClick={prevStep} className="px-6 py-2.5 text-[10px] font-mono text-white/30 hover:text-white/50 transition-colors uppercase tracking-wider">
                    Back
                  </button>
                  <button
                    onClick={nextStep}
                    className="px-8 py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 text-[10px] font-mono uppercase tracking-widest hover:bg-cyan-500/25 transition-all"
                  >
                    Credentials ready
                  </button>
                </div>
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div
                key="step-credentials"
                variants={stepVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.4 }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-2xl md:text-3xl font-mono font-bold text-white tracking-tight">
                    Shared <span className="text-cyan-400">Credentials</span>
                  </h1>
                  <p className="text-[12px] font-mono text-white/40 leading-relaxed max-w-xl mx-auto">
                    Calendar, Gmail, and future Google services use the same OAuth client file.
                  </p>
                </div>

                {hasCredentials && (
                  <div className="p-4 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[11px] font-mono text-emerald-400 font-semibold">Shared credentials found</div>
                        <div className="text-[9px] font-mono text-emerald-300/45 break-all mt-1">{credentialsPath}</div>
                      </div>
                      <span className="text-[9px] font-mono text-emerald-400/70 uppercase tracking-wider">Ready</span>
                    </div>
                  </div>
                )}

                <UploadArea onFile={handleFileSelected} disabled={isUploading} />

                {isUploading && (
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
                    <span className="text-[10px] font-mono text-cyan-400/70">Saving shared credentials...</span>
                  </div>
                )}

                {validationError && (
                  <div className="p-4 rounded-xl bg-red-500/[0.06] border border-red-500/20 text-[10px] font-mono text-red-300/70 leading-relaxed">
                    {validationError}
                  </div>
                )}

                {uploadError && (
                  <div className="p-4 rounded-xl bg-red-500/[0.06] border border-red-500/20">
                    <div className="text-[10px] font-mono text-red-300/70 leading-relaxed">{uploadError}</div>
                    <button
                      onClick={() => { setUploadError(null); setUploadedFile(null); setValidatedData(null); }}
                      className="mt-3 text-[9px] font-mono text-red-400/60 hover:text-red-300 transition-colors uppercase tracking-wider"
                    >
                      Try another file
                    </button>
                  </div>
                )}

                {uploadSuccess && validatedData?.installed && (
                  <div className="p-5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 space-y-3">
                    <div className="text-[11px] font-mono text-emerald-400 font-semibold">Credentials saved</div>
                    <div className="grid md:grid-cols-3 gap-3 pt-2 border-t border-emerald-500/10">
                      <div>
                        <div className="text-[8px] font-mono text-white/30 uppercase tracking-widest mb-1">File</div>
                        <div className="text-[10px] font-mono text-white/60 truncate">{uploadedFile?.name}</div>
                      </div>
                      <div>
                        <div className="text-[8px] font-mono text-white/30 uppercase tracking-widest mb-1">Client ID</div>
                        <div className="text-[10px] font-mono text-white/60 truncate" title={validatedData.installed.client_id}>
                          {truncateClientId(validatedData.installed.client_id || '-')}
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] font-mono text-white/30 uppercase tracking-widest mb-1">Project</div>
                        <div className="text-[10px] font-mono text-white/60 truncate">{savedProjectId || validatedData.installed.project_id || '-'}</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button onClick={prevStep} className="px-6 py-2.5 text-[10px] font-mono text-white/30 hover:text-white/50 transition-colors uppercase tracking-wider">
                    Back
                  </button>
                  <button
                    onClick={nextStep}
                    disabled={!canContinueFromCredentials}
                    className="px-8 py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 text-[10px] font-mono uppercase tracking-widest hover:bg-cyan-500/25 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}

            {currentStep === 3 && (
              <motion.div
                key="step-auth"
                variants={stepVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.4 }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-2xl md:text-3xl font-mono font-bold text-white tracking-tight">
                    Authenticate <span className="text-cyan-400">One By One</span>
                  </h1>
                  <p className="text-[12px] font-mono text-white/40 leading-relaxed max-w-xl mx-auto">
                    Jarvis runs each selected OAuth flow separately. Failed services can be retried alone.
                  </p>
                </div>

                <div className="space-y-3">
                  {selectedServices.map((service) => {
                    const progress = authProgress[service.id] ?? {
                      status: 'queued',
                      message: `${service.shortLabel} queued.`,
                    } satisfies AuthProgress;

                    return (
                      <div key={service.id} className={`rounded-xl border p-4 transition-all ${statusTone(progress.status)}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-mono font-semibold text-white/80">{service.label}</span>
                              <span className="text-[8px] font-mono uppercase tracking-wider opacity-70">{progress.status}</span>
                            </div>
                            <div className="text-[10px] font-mono opacity-80 mt-1 leading-relaxed">{progress.message}</div>
                            {progress.error && (
                              <div className="mt-2 text-[10px] font-mono text-red-200/80 leading-relaxed">{progress.error}</div>
                            )}
                          </div>
                          {progress.status === 'error' && (
                            <button
                              onClick={() => runAuthForServices([service.id])}
                              disabled={authRunning}
                              className="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/[0.08] border border-red-500/25 text-[8px] font-mono text-red-200 hover:bg-red-500/[0.14] disabled:opacity-30 transition-all uppercase tracking-wider"
                            >
                              Retry
                            </button>
                          )}
                        </div>

                        {progress.authUrl && (
                          <div className="mt-4 space-y-2">
                            <a
                              href={progress.authUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center w-full py-2.5 rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-200 text-[10px] font-mono font-semibold uppercase tracking-widest hover:bg-cyan-500/25 transition-all"
                            >
                              Open Google sign-in
                            </a>
                            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-black/20 border border-white/[0.07]">
                              <span className="flex-1 text-[8px] font-mono text-white/35 break-all leading-relaxed select-all">{progress.authUrl}</span>
                              <CopyButton text={progress.authUrl} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={prevStep}
                    disabled={authRunning}
                    className="px-6 py-2.5 text-[10px] font-mono text-white/30 hover:text-white/50 transition-colors uppercase tracking-wider disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    Back
                  </button>
                  <div className="flex items-center gap-3">
                    {hasAuthErrors && hasAuthSuccess && !authRunning && (
                      <button
                        onClick={() => setCurrentStep(4)}
                        className="px-5 py-2.5 text-[10px] font-mono text-white/35 hover:text-white/60 transition-colors uppercase tracking-wider"
                      >
                        Finish partial setup
                      </button>
                    )}
                    <button
                      onClick={beginAuth}
                      disabled={authRunning}
                      className="px-8 py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 text-[10px] font-mono uppercase tracking-widest hover:bg-cyan-500/25 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                    >
                      {authRunning ? 'Running...' : 'Start authentication'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 4 && (
              <motion.div
                key="step-done"
                variants={stepVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.4 }}
                className="space-y-8"
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/[0.08] border-2 border-emerald-500/25 flex items-center justify-center shadow-[0_0_40px_rgba(34,197,94,0.08)]">
                    <span className="text-3xl text-emerald-400">✓</span>
                  </div>
                  <div className="text-center">
                    <h1 className="text-2xl md:text-3xl font-mono font-bold text-white tracking-tight">
                      Google <span className="text-emerald-400">Ready</span>
                    </h1>
                    <p className="text-[12px] font-mono text-white/40 leading-relaxed mt-2">
                      Connected services are ready for Jarvis MCP tools.
                    </p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  {GOOGLE_SERVICES.map((service) => {
                    const progress = authProgress[service.id];
                    const status = serviceStatuses[service.id];
                    const selected = selectedIds.includes(service.id);
                    const done = progress?.status === 'connected' || progress?.status === 'skipped' || status?.connected || status?.authenticated;

                    return (
                      <div key={service.id} className={`p-4 rounded-xl border ${
                        done
                          ? 'bg-emerald-500/[0.06] border-emerald-500/20'
                          : selected
                          ? 'bg-red-500/[0.05] border-red-500/20'
                          : 'bg-white/[0.02] border-white/[0.06]'
                      }`}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-mono text-white/70 font-semibold">{service.label}</div>
                            <div className="text-[9px] font-mono text-white/30 mt-1">
                              {done ? `${progress?.tools ?? status?.tools ?? 0} tools available` : selected ? 'Not connected' : 'Not selected'}
                            </div>
                          </div>
                          <span className={`text-[9px] font-mono uppercase tracking-wider ${done ? 'text-emerald-400' : 'text-white/25'}`}>
                            {done ? 'Ready' : 'Off'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-center pt-2">
                  <button
                    onClick={() => onComplete(connectedServiceIds)}
                    className="px-10 py-3 rounded-xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 text-[11px] font-mono uppercase tracking-widest hover:bg-cyan-500/25 transition-all duration-300"
                  >
                    Done
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
