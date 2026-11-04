import { getCachedSetting, loadServerSettings } from './serverSettings';
import {
  addTimer, cancelTimer, getTimers,
  addReminder, cancelReminder, getReminders,
} from './timers';

/** Paths from Settings → System — sent with shell / computer-use API calls. */
export function readToolkitOverrides(): {
  shellPathOverride?: string;
  pythonPathOverride?: string;
} {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('jarvis_settings');
    if (!raw) return {};
    const s = JSON.parse(raw) as Record<string, unknown>;
    const shell =
      typeof s.shellPathOverride === 'string' && s.shellPathOverride.trim()
        ? s.shellPathOverride.trim()
        : undefined;
    const py =
      typeof s.pythonPathOverride === 'string' && s.pythonPathOverride.trim()
        ? s.pythonPathOverride.trim()
        : undefined;
    const out: { shellPathOverride?: string; pythonPathOverride?: string } = {};
    if (shell) out.shellPathOverride = shell;
    if (py) out.pythonPathOverride = py;
    return out;
  } catch {
    return {};
  }
}

export interface JarvisFunction {
  name: string;
  label: string;
  description: string;
  tool: {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

type DesktopPanelPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function normalizeDesktopPanelPosition(value: unknown): DesktopPanelPosition | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.toLowerCase().replace(/[\s_]+/g, '-');
  if (
    compact === 'top-left' ||
    compact === 'top-right' ||
    compact === 'bottom-left' ||
    compact === 'bottom-right'
  ) {
    return compact;
  }
  return undefined;
}

// ── Calendar event fetching ───────────────────────────────────────────────────
// Tries MCP (real event titles via OAuth) first, falls back to iCal feed.

interface CalendarEventSummary {
  title: string;
  start: string;
  allDay: boolean;
}

async function fetchUpcomingCalendarEvents(): Promise<CalendarEventSummary[]> {
  // 1. Try MCP — check if it's connected, then fetch real events
  try {
    const statusRes = await fetch('/api/mcp/dynamic');
    const status = await statusRes.json() as { connected?: boolean };
    if (status.connected) {
      const now     = new Date();
      // Start from midnight today so events earlier in the day are included
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const timeMin = startOfToday.toISOString();
      // Fetch through end of next month (covers 'this week', 'this month', etc.)
      const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).toISOString();
      const res  = await fetch(`/api/mcp/calendar-events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=100`);
      const data = await res.json() as { events?: CalendarEventSummary[] };
      if (res.ok && Array.isArray(data.events)) {
        return data.events;
      }
    }
  } catch { /* fall through to iCal */ }

  // 2. Fall back to iCal feed
  try {
    const icalUrl = typeof window !== 'undefined' ? localStorage.getItem('jarvis_ical_url') : null;
    if (icalUrl) {
      const res  = await fetch(`/api/ical?url=${encodeURIComponent(icalUrl)}`);
      const data = await res.json() as { events?: CalendarEventSummary[] };
      return data.events ?? [];
    }
  } catch { /* ignore */ }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────

export const FUNCTION_REGISTRY: JarvisFunction[] = [
  {
    name: 'get_date',
    label: 'Get Date',
    description: 'Tell Jarvis the current date when asked',
    tool: {
      type: 'function',
      name: 'get_date',
      description: 'Get the current date',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: () => ({
      date: new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    }),
  },
  {
    name: 'get_time',
    label: 'Get Time',
    description: 'Tell Jarvis the current time when asked',
    tool: {
      type: 'function',
      name: 'get_time',
      description: 'Get the current local time',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: () => ({
      time: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    }),
  },
  {
    name: 'get_location',
    label: 'Get Location',
    description: "Tell Jarvis the user's current GPS location when asked",
    tool: {
      type: 'function',
      name: 'get_location',
      description: "Get the user's current geographic location (latitude and longitude)",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: () =>
      new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve({ error: 'Geolocation is not supported by this browser.' });
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy_meters: Math.round(pos.coords.accuracy),
            }),
          (err) => resolve({ error: err.message }),
          { timeout: 8000 }
        );
      }),
  },
  {
    name: 'get_battery_level',
    label: 'Get Battery Level',
    description: "Tell Jarvis the user's current device battery level when asked",
    tool: {
      type: 'function',
      name: 'get_battery_level',
      description: "Get the user's current device battery level and charging status",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async () => {
      if (!('getBattery' in navigator)) {
        return { error: 'Battery API is not supported on this device or browser.' };
      }
      try {
        const battery = await (navigator as Navigator & {
          getBattery: () => Promise<{ level: number; charging: boolean }>;
        }).getBattery();
        return {
          level_percent: Math.round(battery.level * 100),
          charging: battery.charging,
        };
      } catch {
        return { error: 'Could not read battery status.' };
      }
    },
  },
  {
    name: 'computer_use',
    label: 'Computer Use',
    description: "Let Jarvis control your computer to complete tasks (e.g. 'Open Discord')",
    tool: {
      type: 'function',
      name: 'computer_use',
      description:
        'Control the user\'s computer to complete a task. Use this when the user asks you to open an app, click something, type something, or perform any action on their screen.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'A clear description of what to do on the computer, e.g. "Open Discord"',
          },
        },
        required: ['task'],
      },
    },
    handler: async (args) => {
      const task = args.task as string;
      if (!task) return { error: 'No task provided.' };

      // Platform context so the computer-use AI knows the exact OS
      const platform = typeof navigator !== 'undefined' ? navigator.platform : 'unknown';
      const platformHint = `[Platform: ${platform}] `;
      const enrichedTask = platformHint + task;

      const stored = localStorage.getItem('jarvis_settings');
      const apiKey = stored ? JSON.parse(stored).apiKey : '';
      if (!apiKey) return { error: 'No API key found in settings.' };

      try {
        const res = await fetch('/api/computer-use', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: enrichedTask, apiKey, ...readToolkitOverrides() }),
        });
        return await res.json();
      } catch (err) {
        return { error: String(err) };
      }
    },
  },
  {
    name: 'xray',
    label: 'X-Ray',
    description: "Let Jarvis capture your camera and generate an X-ray scan of what it sees",
    tool: {
      type: 'function',
      name: 'xray',
      description: "Capture the user's camera and generate an X-ray image showing what's inside the object they're pointing at.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async () => {
      const XRAY_EVENT = 'jarvis:xray';

      const dispatch = (detail: object) =>
        window.dispatchEvent(new CustomEvent(XRAY_EVENT, { detail }));

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });

        // Grab a single frame via an offscreen canvas
        const video = document.createElement('video');
        video.srcObject = stream;
        await new Promise<void>((res) => { video.onloadedmetadata = () => res(); });
        await video.play();

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0);
        const imageBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

        // Stop camera immediately after capture
        stream.getTracks().forEach((t) => t.stop());
        stream = null;

        // Show scanning widget with the captured camera image underneath
        dispatch({ state: 'scanning', capturedBase64: imageBase64 });

        const stored = localStorage.getItem('jarvis_settings');
        const apiKey = stored ? JSON.parse(stored).apiKey : '';
        if (!apiKey) {
          dispatch({ state: 'error', error: 'No API key found in settings.' });
          return { error: 'No API key.' };
        }

        const res = await fetch('/api/xray', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64, apiKey }),
        });

        const data = await res.json();

        if (data.error) {
          dispatch({ state: 'error', error: data.error });
          return { error: data.error };
        }

        dispatch({ state: 'done', imageBase64: data.imageBase64 });
        return { result: 'X-ray scan complete. Image displayed.' };
      } catch (err) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        const msg = String(err);
        dispatch({ state: 'error', error: msg });
        return { error: msg };
      }
    },
  },
  {
    name: 'image_generation',
    label: 'Image Generation',
    description:
      'Generate an image from a text prompt with GPT Image (gpt-image-2) and show it in an HUD widget',
    tool: {
      type: 'function',
      name: 'image_generation',
      description:
        "Generate an image from the user's description using OpenAI GPT Image (gpt-image-2). This first improves the prompt with GPT-5.5 for better image quality, then renders the image. If the user has added images on the home screen, you can use the latest one as visual reference context. Opens an IMAGE widget on the HUD while generating and shows the result when ready.",
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the image to generate.',
          },
          size: {
            type: 'string',
            enum: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
            description: 'Output dimensions. Omit for 1024×1024.',
          },
          quality: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'auto'],
            description: 'Rendering quality. Omit for automatic.',
          },
          enhance_prompt: {
            type: 'boolean',
            description:
              'When true (default), improve the image prompt with GPT-5.5 before generating.',
          },
          use_latest_home_image: {
            type: 'boolean',
            description:
              'When true (default), use the most recent image shown on the home screen as reference context if available.',
          },
          reference_image_base64: {
            type: 'string',
            description:
              'Optional explicit reference image as base64 (or full data URL). If provided, this is used instead of latest home image.',
          },
        },
        required: ['prompt'],
      },
    },
    handler: async (args) => {
      const prompt = String(args.prompt ?? '').trim();
      if (!prompt) return { error: 'No prompt provided.' };

      const stored = localStorage.getItem('jarvis_settings');
      const apiKey = stored ? JSON.parse(stored).apiKey : '';
      if (!apiKey) return { error: 'No API key found in settings.' };

      const moduleId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `img-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

      const caption = prompt.length > 280 ? `${prompt.slice(0, 280)}…` : prompt;
      const photoContext = (
        window as Window & {
          __jarvisPhotoContext?: { latestDataUrl?: string; photos: string[] };
        }
      ).__jarvisPhotoContext;
      const explicitRef = typeof args.reference_image_base64 === 'string' ? args.reference_image_base64.trim() : '';
      const useLatest = args.use_latest_home_image !== false;
      const fallbackRef = useLatest ? photoContext?.latestDataUrl : undefined;
      const referenceImageBase64 = explicitRef || fallbackRef;

      window.dispatchEvent(
        new CustomEvent('jarvis:hud', {
          detail: {
            command: 'open',
            widget: 'image',
            module_id: moduleId,
            image_loading: true,
            title: 'GENERATING…',
            image_caption: caption,
          },
        })
      );

      try {
        const res = await fetch('/api/image-generation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            apiKey,
            size: args.size,
            quality: args.quality,
            referenceImageBase64,
            enhancePrompt: args.enhance_prompt !== false,
          }),
        });

        const data = (await res.json()) as {
          error?: string;
          imageBase64?: string;
          optimizedPrompt?: string;
          optimizedTitle?: string | null;
          optimizerModel?: string | null;
        };

        if (data.error) {
          window.dispatchEvent(
            new CustomEvent('jarvis:hud', {
              detail: {
                command: 'set_image',
                id: moduleId,
                image_error: data.error,
              },
            })
          );
          return { error: data.error };
        }

        if (!data.imageBase64) {
          const fallback = 'No image data returned.';
          window.dispatchEvent(
            new CustomEvent('jarvis:hud', {
              detail: {
                command: 'set_image',
                id: moduleId,
                image_error: fallback,
              },
            })
          );
          return { error: fallback };
        }

        const headerSource = data.optimizedTitle?.trim() || prompt;
        const header = headerSource.length > 36 ? `${headerSource.slice(0, 36)}…` : headerSource;

        window.dispatchEvent(
          new CustomEvent('jarvis:hud', {
            detail: {
              command: 'set_image',
              id: moduleId,
              image_base64: data.imageBase64,
              title: header.toUpperCase(),
            },
          })
        );

        return {
          success: true,
          used_reference_image: !!referenceImageBase64,
          prompt_enhanced: args.enhance_prompt !== false,
          optimized_prompt: data.optimizedPrompt,
          optimizer_model: data.optimizerModel,
          message: referenceImageBase64
            ? 'Image generated using reference image context and displayed in the IMAGE widget on the HUD.'
            : 'Image generated and displayed in the IMAGE widget on the HUD.',
        };
      } catch (err) {
        const msg = String(err);
        window.dispatchEvent(
          new CustomEvent('jarvis:hud', {
            detail: {
              command: 'set_image',
              id: moduleId,
              image_error: msg,
            },
          })
        );
        return { error: msg };
      }
    },
  },
  {
    name: '3d_printing',
    label: '3D Printing',
    description: 'Let Jarvis find a model and send a 3D print job via Bambu Studio',
    tool: {
      type: 'function',
      name: '3d_printing',
      description: "Start a 3D print job. Use this when the user asks to print something. The user just needs to describe what they want to print.",
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'What the user wants to print, e.g. "a command strip" or "a Batman costume"',
          },
        },
        required: ['description'],
      },
    },
    handler: async (args) => {
      const description = args.description as string;
      if (!description) return { error: 'No print description provided.' };

      const stored = localStorage.getItem('jarvis_settings');
      const apiKey = stored ? JSON.parse(stored).apiKey : '';
      if (!apiKey) return { error: 'No API key found in settings.' };

      const task = `${description}. Open Bambu Studio, go to the online models tab. Find a model matching the user's description. Pick a relevant one. Load the model. Check the available printers using the device tab at the top. Find one not in use. Set the printer. Slice the file, and send it to the correct printer. If you get stuck with an incompatible printer error, then select the drop down and choose the printer you selected. Do not ask follow-up questions unless the file is missing or there are zero available printers. Make reasonable choices and complete the print job. If there are multiple idle printers, choose the first idle one. Stop only after the print job has been successfully sent, or if the file cannot be found, no printer is available, or Bambu Studio blocks the job with an error that cannot be resolved.`;

      try {
        const res = await fetch('/api/computer-use', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task, apiKey, ...readToolkitOverrides() }),
        });
        return await res.json();
      } catch (err) {
        return { error: String(err) };
      }
    },
  },
  {
    name: 'run_shell_command',
    label: 'Shell / Terminal',
    description: 'Let Jarvis run terminal commands to open apps, manage files, and control the system',
    tool: {
      type: 'function',
      name: 'run_shell_command',
      description:
        "Execute one or more shell commands on the user's computer. " +
        "Use this to open applications, manage files, run scripts, get system info, or perform any task that can be done in a terminal. " +
        "On macOS use zsh syntax (e.g. 'open -a Discord'). On Windows use cmd/PowerShell syntax. " +
        "For multi-step tasks, chain commands with && or call this function multiple times. " +
        "Prefer this over computer_use for anything that can be done via command line — it is faster and more reliable. ",
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              "The shell command to run. Examples: " +
              "'open -a \"Google Chrome\"' to open Chrome on Mac, " +
              "'open -a \"Visual Studio Code\" /path/to/folder' to open a folder in VS Code, " +
              "'say \"Hello\"' to speak text on Mac, " +
              "'ls ~/Desktop' to list files, " +
              "'mkdir ~/Desktop/NewFolder' to create a folder, " +
              "'osascript -e \\'set volume output volume 50\\'' to set volume on Mac, " +
              "'osascript -e \\'tell application \"System Events\" to key code 103 using {command down, option down}\\'' to minimize all windows (show desktop) on macOS, " +
              "'powershell -command \"(New-Object -ComObject Shell.Application).MinimizeAll()\"' to minimize all windows (show desktop) on Windows, " +
              "'wmctrl -k on' to show the desktop on Linux (requires wmctrl installed).",
          },
        },
        required: ['command'],
      },
    },
    handler: async (args) => {
      const command = args.command as string;
      if (!command) return { error: 'No command provided.' };

      try {
        const res = await fetch('/api/shell', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, ...readToolkitOverrides() }),
        });
        return await res.json();
      } catch (err) {
        return { error: String(err) };
      }
    },
  },
  {
    name: 'web_search',
    label: 'Web Search',
    description: 'Let Jarvis search the web and return real-time results',
    tool: {
      type: 'function',
      name: 'web_search',
      description:
        'Search the web for current information, news, facts, or anything the user wants to look up. Returns a list of results with title, url, and snippet fields. Summarize the most relevant results in your response.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query, e.g. "latest iPhone release date"',
          },
        },
        required: ['query'],
      },
    },
    handler: async (args) => {
      const query = args.query as string;
      if (!query) return { error: 'No query provided.' };
      try {
        const res = await fetch('/api/web-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });
        return await res.json();
      } catch (err) {
        return { error: String(err) };
      }
    },
  },
  {
    name: 'take_photo',
    label: 'Camera',
    description: "Let Jarvis take a photo with your camera and display it on screen",
    tool: {
      type: 'function',
      name: 'take_photo',
      description:
        "Take a photo using the user's camera and display it on screen. Use this when the user asks you to look at something, take a picture, capture something, or see what's in front of them. Do NOT use this for X-ray scans — use the xray function for that.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async () => {
      const dispatch = (detail: object) =>
        window.dispatchEvent(new CustomEvent('jarvis:camera', { detail }));

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });

        const video = document.createElement('video');
        video.srcObject = stream;
        await new Promise<void>((res) => { video.onloadedmetadata = () => res(); });
        await video.play();

        // Brief flash to indicate capture
        dispatch({ state: 'capturing' });
        await new Promise((res) => setTimeout(res, 600));

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0);
        const imageBase64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];

        stream.getTracks().forEach((t) => t.stop());
        stream = null;

        dispatch({ state: 'done', imageBase64 });
        return { result: 'Photo captured. Describe what you see in the image.', imageBase64 };
      } catch (err) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        const msg = String(err);
        dispatch({ state: 'error', error: msg });
        return { error: msg };
      }
    },
  },
  {
    name: 'control_music',
    label: 'Music Control',
    description: 'Let Jarvis control music playback (play, pause, skip, volume)',
    tool: {
      type: 'function',
      name: 'control_music',
      description:
        "Control music playback. Works with Spotify and Apple Music on macOS. On Windows 10/11 uses the system media session (Spotify, Groove, Microsoft Edge tabs, etc.). Commands: 'playpause', 'play', 'pause', 'next', 'previous', 'volume_up', 'volume_down', 'volume' (0-100; on Windows, volume keys adjust system volume).",
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['playpause', 'play', 'pause', 'next', 'previous', 'volume_up', 'volume_down', 'volume'],
            description: 'The playback command to execute.',
          },
          value: {
            type: 'number',
            description: 'Volume level 0-100. Only required for the "volume" command.',
          },
        },
        required: ['command'],
      },
    },
    handler: async (args) => {
      try {
        const res = await fetch('/api/music', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        const data = await res.json();
        if (data.error) return { error: data.error };
        // After any control action, fire an update so the widget refreshes
        window.dispatchEvent(new CustomEvent('jarvis:music:refresh'));
        return { success: true, command: args.command };
      } catch (err) {
        return { error: String(err) };
      }
    },
  },
  {
    name: 'get_now_playing',
    label: 'Now Playing',
    description: "Let Jarvis check and display what's currently playing",
    tool: {
      type: 'function',
      name: 'get_now_playing',
      description:
        "Get the currently playing track (title, artist, album). On macOS: Spotify / Apple Music / system Now Playing. On Windows: whatever app owns the system media session (e.g. Spotify, Edge).",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async () => {
      try {
        const res = await fetch('/api/music');
        const data = await res.json();
        if (data.error) return { error: data.error };
        // Open the music widget and pass it the track data
        window.dispatchEvent(new CustomEvent('jarvis:music:update', { detail: data }));
        return {
          title:     data.title,
          artist:    data.artist,
          album:     data.album,
          isPlaying: data.isPlaying,
          app:       data.app,
        };
      } catch (err) {
        return { error: String(err) };
      }
    },
  },
  {
    name: 'show_hud_text',
    label: 'HUD Text Note',
    description: 'Let Jarvis show chosen text in a TEXT NOTE widget on the HUD',
    tool: {
      type: 'function',
      name: 'show_hud_text',
      description:
        "Display a TEXT NOTE widget on the user's HUD with specific content. Use when the user asks you to write something on screen, pin notes, show a reminder, or display text visibly alongside the interface.",
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The full text body to show in the widget.',
          },
          title: {
            type: 'string',
            description:
              "Optional short title shown in the widget header (e.g. 'REMINDER'). If omitted, the default TEXT NOTE title is used.",
          },
        },
        required: ['content'],
      },
    },
    handler: (args) => {
      const content = args.content as string;
      if (content === undefined || content === null || String(content).trim() === '') {
        return { error: 'Provide non-empty content.' };
      }
      window.dispatchEvent(
        new CustomEvent('jarvis:hud', {
          detail: {
            command: 'open',
            widget: 'text',
            text: String(content),
            title: args.title as string | undefined,
          },
        })
      );
      return { success: true };
    },
  },
  {
    name: 'control_hud',
    label: 'HUD Control',
    description: 'Let Jarvis open, close, or reset widgets on the home screen',
    tool: {
      type: 'function',
      name: 'control_hud',
      description:
        "Control the HUD widgets displayed on the home screen. Use this when the user asks to open, close, show, hide, or manage widgets. " +
        "Commands: 'open' adds a widget, 'close' removes a widget, 'clear' removes all widgets, 'reset' restores the default layout. " +
        "Widget names: 'clock', 'system', 'network', 'map', 'suit', 'music', 'text', 'pdf', 'image', 'terminal', " +
        "'agenda' (upcoming calendar events), 'todo' (today's task list), 'stocks' (market ticker), 'headlines' (rotating news), " +
        "'timer' (countdowns and reminders), 'weather-radar' (animated precipitation map), 'camera-feed' (live webcam), " +
        "'transcript' (conversation log), 'uptime' (host reachability monitor), 'orbit' (ISS tracker + sun/moon), " +
        "'calculator' (futuristic compute / arithmetic pad). " +
        "IMPORTANT: The 'map' widget here is a small HUD minimap overlay — it is NOT the full Jarvis Map page. " +
        "If the user asks to 'open the map', 'go to the map page', 'show the map', 'navigate on a map', or wants to fly to a location/draw a route, use map_command instead. " +
        "When opening the 'text' widget, optionally supply text_content and title. " +
        "When opening the 'pdf' widget, supply pdf_source (https URL, site path like /file.pdf, or absolute filesystem path in the desktop app).",
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['open', 'close', 'clear', 'reset'],
            description: "The action to perform: 'open' a widget, 'close' a widget, 'clear' all widgets, or 'reset' to default layout.",
          },
          widget: {
            type: 'string',
            enum: [
              'clock', 'system', 'network', 'map', 'suit', 'music', 'text', 'pdf', 'image', 'terminal',
              'agenda', 'todo', 'stocks', 'headlines', 'timer', 'weather-radar', 'camera-feed', 'transcript', 'uptime', 'orbit', 'calculator',
            ],
            description: "The widget to open or close. Required for 'open' and 'close' commands. Ignored for 'clear' and 'reset'. Use 'terminal' to show the error terminal.",
          },
          text_content: {
            type: 'string',
            description:
              "When command is 'open' and widget is 'text', the body text to display. Omit for an empty note or when opening other widgets.",
          },
          pdf_source: {
            type: 'string',
            description:
              "When command is 'open' and widget is 'pdf', the document location: https URL, path under public (e.g. /brochure.pdf), or absolute file path (desktop app).",
          },
          title: {
            type: 'string',
            description:
              "When opening the 'text' widget, optional header title. Ignored for other widget types.",
          },
        },
        required: ['command'],
      },
    },
    handler: (args) => {
      const command = args.command as string;
      const widget = args.widget as string | undefined;
      const text_content = args.text_content as string | undefined;
      const title = args.title as string | undefined;
      const pdf_source = args.pdf_source as string | undefined;

      if ((command === 'open' || command === 'close') && !widget) {
        return { error: 'A widget name is required for open/close commands.' };
      }

      if (command === 'open' && widget === 'pdf' && !(pdf_source ?? '').trim()) {
        return { error: 'Opening the PDF widget requires pdf_source (URL or file path).' };
      }

      window.dispatchEvent(
        new CustomEvent('jarvis:hud', {
          detail: { command, widget, text: text_content, title, pdf_source },
        })
      );
      return { success: true, command, widget };
    },
  },
  {
    name: 'open_url',
    label: 'Open URL',
    description: 'Let Jarvis open a website or URL in a new browser tab',
    tool: {
      type: 'function',
      name: 'open_url',
      description: 'Open a URL in a new browser tab',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to open, e.g. https://example.com',
          },
        },
        required: ['url'],
      },
    },
    handler: (args) => {
      const url = args.url as string;
      if (!url) return { error: 'No URL provided.' };
      window.open(url, '_blank', 'noopener,noreferrer');
      return { opened: url };
    },
  },
  {
    name: 'open_pdf',
    label: 'Open PDF',
    description: 'Show a PDF in the HUD document viewer (expandable); accepts a URL or file path',
    tool: {
      type: 'function',
      name: 'open_pdf',
      description:
        'Open a PDF in the on-screen HUD viewer. Use when the user wants to view, show, or display a PDF. ' +
        'source may be a full https URL, a site path served from public (e.g. /manual.pdf), or an absolute filesystem path when running the Jarvis desktop app.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description:
              'PDF location: https://… URL, /path/from/public folder, or absolute file path (e.g. /Users/me/doc.pdf or C:\\Users\\me\\doc.pdf)',
          },
          title: {
            type: 'string',
            description: 'Optional short title shown in the widget header (defaults to DOCUMENT).',
          },
        },
        required: ['source'],
      },
    },
    handler: (args) => {
      const source = args.source as string;
      if (!source?.trim()) return { error: 'No PDF source provided.' };
      window.dispatchEvent(
        new CustomEvent('jarvis:hud', {
          detail: {
            command: 'open',
            widget: 'pdf',
            pdf_source: source.trim(),
            title: args.title as string | undefined,
          },
        })
      );
      return { success: true };
    },
  },
  {
    name: 'find_datasheet',
    label: 'Find datasheet',
    description:
      'Search the web for an official manufacturer PDF datasheet and open it in the HUD viewer (no distributor API keys)',
    tool: {
      type: 'function',
      name: 'find_datasheet',
      description:
        'Find and display a component / board datasheet as a PDF. Uses public web search (DuckDuckGo HTML), ' +
        'prefers direct .pdf links on manufacturer sites (e.g. raspberrypi.com, espressif.com, ti.com, st.com, arduino.cc, revrobotics.com) ' +
        'and deprioritizes scraper mirrors. Use when the user asks for a datasheet, product brief, reference manual, or pinout PDF for a named part or dev board. ' +
        'Pass the clearest part or product string they gave (e.g. "Raspberry Pi 5", "ESP32-S3-WROOM-1").',
      parameters: {
        type: 'object',
        properties: {
          part_name: {
            type: 'string',
            description:
              'Part number, module name, or product name to look up (e.g. "Raspberry Pi 5", "Arduino Uno R4", "STM32F407").',
          },
          title: {
            type: 'string',
            description: 'Optional HUD panel title override; otherwise a default "DATASHEET — …" header is used.',
          },
        },
        required: ['part_name'],
      },
    },
    handler: async (args) => {
      const part_name = args.part_name as string;
      if (!part_name?.trim()) return { error: 'No part_name provided.' };

      try {
        const res = await fetch('/api/datasheet-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ part_name: part_name.trim() }),
        });
        const data = (await res.json()) as {
          error?: string;
          best_url?: string | null;
          best_title?: string | null;
          best_score?: number | null;
          queries_run?: string[];
          alternatives?: { url: string; title: string; score: number }[];
        };

        if (!res.ok) {
          return {
            error: typeof data.error === 'string' ? data.error : `Datasheet search failed (HTTP ${res.status}).`,
          };
        }

        if (!data.best_url) {
          return {
            error: 'No direct PDF URL found in search results.',
            hint:
              'Try a more specific part number, or use web_search for HTML documentation pages and then open_pdf if you get a PDF link.',
            queries_run: data.queries_run,
            alternatives: data.alternatives?.slice(0, 5),
          };
        }

        const customTitle = (args.title as string | undefined)?.trim();
        const headerTitle = customTitle
          ? customTitle.toUpperCase()
          : `DATASHEET — ${part_name.trim().toUpperCase()}`;

        window.dispatchEvent(
          new CustomEvent('jarvis:hud', {
            detail: {
              command: 'open',
              widget: 'pdf',
              pdf_source: data.best_url,
              title: headerTitle,
            },
          })
        );

        return {
          success: true,
          opened_url: data.best_url,
          title: data.best_title,
          score: data.best_score,
          alternatives: data.alternatives?.slice(0, 4),
        };
      } catch (err) {
        return { error: String(err) };
      }
    },
  },
  {
    name: 'desktop_mode',
    label: 'Desktop Mode',
    description: 'Turn Jarvis into a floating transparent desktop logo, move it between screen corners, or restore the full app',
    tool: {
      type: 'function',
      name: 'desktop_mode',
      description:
        'Control Jarvis desktop / hover / transparent / floating panel mode. ' +
        'Use this when the user says "desktop mode", "transparent mode", "hover mode", "floating panel", "stay on top", "move to the top right corner", or "go back to full app". ' +
        'In desktop mode only the Jarvis logo remains visible, stays above other apps, and clicking it toggles mute. ' +
        'For corner-only requests, set action="move" and position to the requested corner.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['enable', 'disable', 'move'],
            description: 'enable = enter transparent desktop mode. disable = restore full Jarvis app. move = move Jarvis logo to another corner.',
          },
          position: {
            type: 'string',
            enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
            description: 'Target corner for the Jarvis logo. Defaults to bottom-right when enabling desktop mode.',
          },
        },
        required: ['action'],
      },
    },
    handler: (args) => {
      const action = args.action as string;
      const position = normalizeDesktopPanelPosition(args.position) ?? 'bottom-right';

      if (!['enable', 'disable', 'move'].includes(action)) {
        return { error: 'Invalid desktop mode action.' };
      }

      window.dispatchEvent(
        new CustomEvent('jarvis:desktop-mode', {
          detail: {
            action,
            position,
          },
        })
      );

      if (action === 'disable') {
        window.dispatchEvent(new CustomEvent('jarvis:navigate', { detail: { page: 'home' } }));
      }

      const messages: Record<string, string> = {
        enable: `Desktop mode enabled. Jarvis is floating in the ${position} corner.`,
        disable: 'Desktop mode disabled. Restored full Jarvis app.',
        move: `Jarvis panel moved to the ${position} corner.`,
      };

      return { success: true, action, position, message: messages[action] };
    },
  },
  {
    name: 'jarvis_disconnect',
    label: 'Disconnect / Mute',
    description: 'End the current Jarvis session (equivalent to clicking the logo / pressing disconnect)',
    tool: {
      type: 'function',
      name: 'jarvis_disconnect',
      description:
        'Immediately end the current Jarvis voice session and go silent. ' +
        'Call this when the user says anything like "mute", "stop listening", "end call", "go to sleep", "disconnect", "shut up", "be quiet", "that\'s enough", or similar. ' +
        'Do NOT call navigate_to_page first — just call this.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async () => {
      // Dispatch the disconnect event — JarvisAssistant will call disconnect()
      // after a short delay so this result can be sent back first.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('jarvis:self-disconnect'));
      }
      return { success: true, message: 'Disconnecting…' };
    },
  },
  {
    name: 'navigate_to_page',
    label: 'Navigate to Page',
    description: 'Switch Jarvis to a different view — e.g. open the live news feed and stock ticker',
    tool: {
      type: 'function',
      name: 'navigate_to_page',
      description:
        'Navigate Jarvis to a different page. Use for "home", "news", "calendar", "home-assistant", "3d-printers", "music", "spiderman", "manufacturing", "webshooter", "social", "audio-test", or "round-display". ' +
        '"news" opens the live news feed with streaming video and market data. ' +
        '"calendar" opens the calendar and task planner. ' +
        '"home-assistant" opens the smart home control panel for lights, switches, climate, and more. ' +
        '"3d-printers" opens the 3D printer dashboard to monitor and control Bambu Lab printers. ' +
        '"music" opens the full-screen music player with the spinning record visualization. ' +
        '"spiderman" opens the Spider-Man suit armory — a 3D holographic carousel of Spider-Man suits the user can browse and inspect. Use when the user mentions Spider-Man, suits, or the armory. ' +
        '"manufacturing" opens the fabrication bay where the user drags a 3D component onto a printer, laser, or CNC machine to build it. Use when the user mentions manufacturing, fabrication, or building a part. ' +
        '"webshooter" opens the web-shooter designer lab — a holographic web-shooter base where the user designs taser web, web fluid, web grenade, and acid web cartridges and loads them onto the shooter. Use when the user mentions web shooters, web fluid, cartridges, or the web lab. ' +
        '"social" opens the Social Command dashboard — four embedded browsers (Instagram, TikTok, Facebook, YouTube) plus an AI comment-reply engine. Use when the user mentions social media, comment replies, Instagram, TikTok, Facebook, or YouTube dashboard. ' +
        '"audio-test" opens the Audio Lab — type text for Jarvis to speak and save it as an MP3, switching between OpenAI and ElevenLabs. Use when the user wants to test voice, generate speech, or export audio. ' +
        '"round-display" switches to a full-screen circular Jarvis visualizer optimised for round displays. ' +
        '"home" returns to the main Jarvis home screen. ' +
        'NEVER use this for map or location requests — use map_command instead.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['home', 'news', 'calendar', 'home-assistant', '3d-printers', 'music', 'spiderman', 'manufacturing', 'webshooter', 'social', 'audio-test', 'round-display'],
            description: '"home" = main Jarvis view. "news" = live news + stocks feed. "calendar" = calendar and daily task planner. "home-assistant" = smart home control panel. "3d-printers" = Bambu Lab 3D printer dashboard. "music" = full-screen music player. "spiderman" = Spider-Man suit armory with a 3D holographic suit carousel. "manufacturing" = fabrication bay for building 3D components on printers/lasers/CNC. "webshooter" = web-shooter designer lab for building taser web / web fluid / web grenade / acid web cartridges. "social" = Social Command dashboard with Instagram/TikTok/Facebook/YouTube browsers and AI comment replies. "audio-test" = Audio Lab for typing speech scripts, previewing, and saving MP3s via OpenAI or ElevenLabs. "round-display" = full-screen circular visualizer for round displays.',
          },
        },
        required: ['page'],
      },
    },
    handler: async (args) => {
      const page = args.page as string;
      if (!page) return { error: 'No page specified.' };
      window.dispatchEvent(new CustomEvent('jarvis:navigate', { detail: { page: page } }));

      if (page === 'news') {
        try {
          const res = await fetch('/api/news-headlines');
          const data = (await res.json()) as { items?: { title: string }[] };
          const headlines = (data.items ?? []).slice(0, 8).map((h) => h.title);
          return {
            success: true,
            navigated_to: page,
            top_headlines: headlines,
            instruction:
              'The news page is now open. Briefly summarize these top headlines to the user in 2–3 concise sentences. Do not list them individually — give a fluid summary of what is happening in the world right now.',
          };
        } catch {
          return {
            success: true,
            navigated_to: page,
            instruction: 'The news page is open. Let the user know you have opened the news feed.',
          };
        }
      }

      if (page === 'calendar') {
        try {
          const localTasksRaw = typeof window !== 'undefined' ? localStorage.getItem('jarvis_calendar_tasks') : null;
          const localTasks = localTasksRaw ? JSON.parse(localTasksRaw) as Record<string, { text: string; time?: string; done: boolean }[]> : {};

          // Collect upcoming 7 days of local tasks
          const upcoming: string[] = [];
          for (let i = 0; i < 7; i++) {
            const d = new Date(); d.setDate(d.getDate() + i);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            const dayTasks = (localTasks[key] ?? []).filter(t => !t.done);
            if (dayTasks.length > 0) {
              upcoming.push(`${dayLabel}: ${dayTasks.map(t => (t.time ? `${t.time} ${t.text}` : t.text)).join(', ')}`);
            }
          }

          // Try MCP first for real Google Calendar events, fall back to iCal
          const gcalEvents = await fetchUpcomingCalendarEvents();
          const now = new Date();
          const weekLater = new Date(); weekLater.setDate(weekLater.getDate() + 7);
          const gcalUpcoming = gcalEvents
            .filter(ev => { const d = new Date(ev.start); return d >= now && d <= weekLater; })
            .slice(0, 10)
            .map(ev => {
              const d = new Date(ev.start);
              const label = ev.allDay
                ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              return `${label}: ${ev.title}`;
            });
          upcoming.push(...gcalUpcoming);

          if (upcoming.length > 0) {
            return {
              success: true,
              navigated_to: page,
              upcoming_schedule: upcoming.join('\n'),
              instruction: 'The calendar page is now open. Briefly tell the user what is coming up on their schedule in the next few days in a natural, conversational way. Be concise.',
            };
          }
        } catch { /* fall through */ }
        return {
          success: true,
          navigated_to: page,
          instruction: 'The calendar page is open. Let the user know their calendar is ready and ask if they need to add anything.',
        };
      }

      if (page === 'home-assistant') {
        try {
          let haUrl   = getCachedSetting('jarvis_ha_url');
          let haToken = getCachedSetting('jarvis_ha_token');
          if (!haUrl || !haToken) {
            const s = await loadServerSettings();
            haUrl   = s.jarvis_ha_url   ?? '';
            haToken = s.jarvis_ha_token ?? '';
          }
          if (haUrl && haToken) {
            const res = await fetch(`/api/home-assistant?url=${encodeURIComponent(haUrl)}&token=${encodeURIComponent(haToken)}&path=/api/states`);
            if (res.ok) {
              const states = await res.json() as Array<{ entity_id: string; state: string; attributes: { friendly_name?: string } }>;
              const on  = states.filter((e) => e.state === 'on').length;
              const all = states.length;
              return {
                success: true,
                navigated_to: page,
                devices_on: on,
                devices_total: all,
                instruction: `The Home Assistant page is open. ${on} of ${all} devices are currently on. Briefly let the user know their smart home is ready and mention a few key stats.`,
              };
            }
          }
        } catch { /* fall through */ }
        return {
          success: true,
          navigated_to: page,
          instruction: 'The Home Assistant page is open. Ask the user to connect their Home Assistant server if they haven\'t yet.',
        };
      }

      if (page === '3d-printers') {
        try {
          const statusRes = await fetch('/api/bambu/status');
          const status = await statusRes.json() as { authenticated?: boolean; mqttConnected?: boolean; printerCount?: number };
          if (status.authenticated) {
            const printRes = await fetch('/api/bambu/printers');
            const printers = printRes.ok ? await printRes.json() as Array<{ name: string; deviceId: string }> : [];
            const telRes = await fetch('/api/bambu/telemetry');
            const telemetry = telRes.ok ? await telRes.json() as Record<string, { gcode_state?: string; mc_percent?: number; subtask_name?: string }> : {};
            const active = printers.filter((p) => ['RUNNING','PAUSE'].includes((telemetry[p.deviceId]?.gcode_state ?? '').toUpperCase()));
            const summary = printers.map((p) => {
              const t = telemetry[p.deviceId] ?? {};
              const state = t.gcode_state ?? 'unknown';
              const pct = t.mc_percent != null ? ` — ${t.mc_percent}%` : '';
              const job = t.subtask_name && t.subtask_name !== '-' ? ` printing "${t.subtask_name}"` : '';
              return `${p.name}: ${state}${pct}${job}`;
            }).join(', ');
            return {
              success: true,
              navigated_to: page,
              printers: summary,
              active_count: active.length,
              instruction: `The 3D Printer dashboard is now open. You have ${printers.length} printer${printers.length !== 1 ? 's' : ''}. ${active.length > 0 ? `${active.length} ${active.length === 1 ? 'is' : 'are'} currently printing. ` : 'None are currently printing. '}${summary ? 'Status: ' + summary + '.' : ''} Give the user a brief natural summary.`,
            };
          }
        } catch { /* fall through */ }
        return {
          success: true,
          navigated_to: page,
          instruction: 'The 3D Printer dashboard is open. Ask the user to connect their Bambu Lab account if they haven\'t yet.',
        };
      }

      if (page === 'music') {
        try {
          const res  = await fetch('/api/music');
          const data = await res.json() as { title?: string; artist?: string; isPlaying?: boolean; error?: string };
          if (!data.error && data.title) {
            return {
              success: true,
              navigated_to: page,
              now_playing: { title: data.title, artist: data.artist, playing: data.isPlaying },
              instruction: `The music page is now open — the spinning record visualizer is showing. ${data.isPlaying ? `Currently playing "${data.title}" by ${data.artist}. Let the user know what's on.` : `Nothing is playing right now. Let the user know the music player is open.`}`,
            };
          }
        } catch { /* fall through */ }
        return {
          success: true,
          navigated_to: page,
          instruction: 'The music player is now open. Let the user know.',
        };
      }

      if (page === 'spiderman') {
        return {
          success: true,
          navigated_to: page,
          instruction:
            'The Spider-Man suit armory is now open — the suits are filing onto their holographic podiums. Available suits: Homemade Suit (Homecoming), Tech Suit (Homecoming), Iron Spider (Infinity War), Amazing Suit (TASM 2), and Symbiote Suit (Spider-Man 2 PS5). The user can swipe through them and tap one to inspect and spin it. Briefly announce the armory is ready.',
        };
      }

      if (page === 'audio-test') {
        return {
          success: true,
          navigated_to: page,
          instruction:
            'The Audio Lab is open. The user can type a script, switch between OpenAI and ElevenLabs, preview speech, and save it as an MP3. Briefly confirm the lab is ready.',
        };
      }

      return { success: true, navigated_to: page };
    },
  },
  {
    name: 'open_3d_model',
    label: 'Open 3D Model',
    description: 'Display a 3D model in the center of the round display',
    tool: {
      type: 'function',
      name: 'open_3d_model',
      description:
        'Open and display a 3D model (GLTF/GLB) in the center of the Jarvis round display. ' +
        'The model will spin and fill the inner circle with the name displayed beneath it. ' +
        'Use when the user asks to "show", "open", "display", or "load" a 3D model by name. ' +
        'Call navigate_to_page with "round-display" first if not already there.',
      parameters: {
        type: 'object',
        properties: {
          model_name: {
            type: 'string',
            description: 'The filename of the model in the /models/ folder, without extension (e.g. "Dum-E" for Dum-E.gltf).',
          },
          display_name: {
            type: 'string',
            description: 'The human-readable name to display on screen. Defaults to model_name if not provided.',
          },
        },
        required: ['model_name'],
      },
    },
    handler: async (args) => {
      const requested = (args.model_name as string ?? '').trim();
      const displayName = ((args.display_name as string | undefined) ?? requested).trim();
      if (!requested) return { error: 'No model name specified.' };

      // Fetch available models from the server
      let available: { file: string; name: string }[] = [];
      try {
        const res = await fetch('/api/list-models');
        const data = await res.json() as { models: { file: string; name: string }[] };
        available = data.models;
      } catch { /* swallow */ }

      if (available.length === 0) {
        return { error: 'No 3D models found in the models folder.' };
      }

      // Fuzzy match: case-insensitive substring search
      const match = available.find(
        m => m.name.toLowerCase() === requested.toLowerCase()
      ) ?? available.find(
        m => m.name.toLowerCase().includes(requested.toLowerCase()) ||
             requested.toLowerCase().includes(m.name.toLowerCase())
      );

      if (!match) {
        return {
          error: `No model matching "${requested}" found.`,
          available_models: available.map(m => m.name),
          instruction: `Tell the user the model "${requested}" was not found and list the available models: ${available.map(m => m.name).join(', ')}.`,
        };
      }

      window.dispatchEvent(new CustomEvent('jarvis:open-model', {
        detail: { path: `/models/${match.file}`, name: displayName || match.name },
      }));

      return {
        success: true,
        model: match.name,
        instruction: `The 3D model "${displayName || match.name}" is now displayed, spinning. Briefly acknowledge it.`,
      };
    },
  },
  {
    name: 'map_command',
    label: 'Map Control',
    description: 'Control the Jarvis map — fly to locations, add markers, draw glowing routes',
    tool: {
      type: 'function',
      name: 'map_command',
      description:
        'Open the Jarvis Map page and fly to / interact with any location. ' +
        'This is the ONLY function for ANYTHING map or location related. ALWAYS call this — never navigate_to_page or control_hud — when the user says things like: ' +
        '"navigate to X", "show me X", "go to X", "take me to X", "pull up X on the map", "where is X", "open the map", "fly to X", "zoom in on X", "find X", "search for X nearby". ' +
        'For any location request use command=fly_to with location set to the place name. ' +
        'Examples: "navigate to Tokyo" → fly_to, location="Tokyo". "show me Paris" → fly_to, location="Paris". ' +
        '"where am I?" → show_user_location. "route from Chicago to Detroit" → draw_route. "find coffee nearby" → search_nearby.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: [
              'fly_to',
              'fly_to_coordinates',
              'add_marker',
              'show_user_location',
              'draw_route',
              'clear_markers',
              'search_nearby',
            ],
            description:
              'fly_to: fly to a named location. ' +
              'fly_to_coordinates: fly to lat/lng. ' +
              'add_marker: pin a labeled marker. ' +
              'show_user_location: fly to and mark the user\'s GPS position. ' +
              'draw_route: draw a glowing driving route between two places. ' +
              'clear_markers: remove all markers and routes. ' +
              'search_nearby: search for a type of place near a location.',
          },
          location: {
            type: 'string',
            description: 'City, address, or place name (for fly_to and search_nearby).',
          },
          lat: { type: 'number', description: 'Latitude (for fly_to_coordinates and add_marker).' },
          lng: { type: 'number', description: 'Longitude (for fly_to_coordinates and add_marker).' },
          zoom: { type: 'number', description: 'Map zoom level 1–20 (optional, defaults to 13).' },
          label: { type: 'string', description: 'Marker label text (for add_marker).' },
          description: { type: 'string', description: 'Optional marker subtitle (for add_marker).' },
          start: { type: 'string', description: 'Route start location name (for draw_route).' },
          end: { type: 'string', description: 'Route end location name (for draw_route).' },
          query: { type: 'string', description: 'What to search for nearby, e.g. "coffee" (for search_nearby).' },
        },
        required: ['command'],
      },
    },
    handler: (args) => {
      const command = args.command as string;

      // Embed the map command in the navigate event so page.tsx can pass it as
      // a prop to MapPage — no setTimeout race condition.
      window.dispatchEvent(new CustomEvent('jarvis:navigate', {
        detail: { page: 'map', mapCommand: { type: command, ...args } },
      }));

      const desc: Record<string, string> = {
        fly_to: `Flying to "${args.location ?? ''}" on the map.`,
        fly_to_coordinates: `Flying to coordinates ${args.lat}, ${args.lng}.`,
        add_marker: `Marking "${args.label ?? ''}" on the map.`,
        show_user_location: 'Locating you on the map.',
        draw_route: `Drawing route from "${args.start ?? ''}" to "${args.end ?? ''}".`,
        clear_markers: 'Clearing all markers.',
        search_nearby: `Searching for "${args.query ?? ''}" near "${args.location ?? ''}".`,
      };

      return { success: true, message: desc[command] ?? `Map command "${command}" sent.` };
    },
  },
  {
    name: 'calendar_command',
    label: 'Calendar',
    description: 'Open the Jarvis calendar and manage tasks — add, complete, or list tasks for any day',
    tool: {
      type: 'function',
      name: 'calendar_command',
      description:
        'Open the Jarvis Calendar page and manage tasks or answer questions about the schedule. ' +
        'Use for ANY calendar or schedule question: viewing upcoming events, adding tasks, marking things done, or checking availability. ' +
        'Examples: "add a meeting at 3pm tomorrow" → add_task. "what do I have today?" → list_tasks. "what\'s on my schedule this week?" → get_upcoming. "am I free Friday?" → get_upcoming. "mark gym as done" → complete_task.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['add_task', 'complete_task', 'delete_event', 'list_tasks', 'clear_tasks', 'go_to_date', 'get_upcoming'],
            description:
              'add_task: add a new task/event to a day. ' +
              'complete_task: mark a LOCAL task done by text match. ' +
              'delete_event: permanently delete a Google Calendar event by title — use this when the user says "remove", "delete", or "cancel" an event. ' +
              'list_tasks: get full schedule for a specific day (local tasks + Google events). ' +
              'get_upcoming: get all events for the next 7 days — use this to answer questions like "what do I have this week?" or "am I free on Thursday?". ' +
              'clear_tasks: remove all local tasks for a day. ' +
              'go_to_date: navigate the calendar view to a specific date.',
          },
          date: {
            type: 'string',
            description: 'ISO date string YYYY-MM-DD. Omit for today.',
          },
          text: {
            type: 'string',
            description: 'Task text to add, or partial text to match when completing.',
          },
          time: {
            type: 'string',
            description: 'Optional time label for the task, e.g. "3:00 PM".',
          },
        },
        required: ['command'],
      },
    },
    handler: async (args) => {
      const command = args.command as string;

      // Navigate to calendar page
      window.dispatchEvent(new CustomEvent('jarvis:navigate', { detail: { page: 'calendar' } }));

      // Helper: build a combined schedule for a date key
      const getScheduleForKey = async (dateKey: string): Promise<string> => {
        const lines: string[] = [];
        // Local tasks
        try {
          const store = JSON.parse(localStorage.getItem('jarvis_calendar_tasks') ?? '{}') as Record<string, { text: string; time?: string; done: boolean }[]>;
          const tasks = (store[dateKey] ?? []);
          for (const t of tasks) lines.push(`${t.time ? t.time + ' — ' : ''}${t.text}${t.done ? ' (done)' : ''}`);
        } catch { /* ignore */ }
        // Google Calendar events: try MCP first, fall back to iCal
        try {
          const allEvents = await fetchUpcomingCalendarEvents();
          for (const ev of allEvents.filter(e => e.start.slice(0, 10) === dateKey)) {
            const time = ev.allDay ? 'All day' : new Date(ev.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            lines.push(`${time} — ${ev.title} (Google)`);
          }
        } catch { /* ignore */ }
        return lines.join('\n');
      };

      if (command === 'list_tasks') {
        const key = (args.date as string) ?? new Date().toISOString().split('T')[0];
        const schedule = await getScheduleForKey(key);
        if (!schedule) return { success: true, instruction: 'There is nothing scheduled for that day.' };
        return {
          success: true,
          schedule,
          instruction: `Read out this schedule naturally and conversationally: ${schedule}`,
        };
      }

      if (command === 'get_upcoming') {
        // Return next 7 days for Jarvis to answer any question
        const upcoming: string[] = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(); d.setDate(d.getDate() + i);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          const sched = await getScheduleForKey(key);
          if (sched) upcoming.push(`${label}:\n${sched}`);
        }
        const summary = upcoming.length ? upcoming.join('\n\n') : 'Nothing scheduled in the next 7 days.';
        return { success: true, upcoming: summary, instruction: `Answer the user's question using this schedule data:\n${summary}` };
      }

      // add_task: create in Google Calendar when MCP is connected, else local
      if (command === 'add_task') {
        try {
          const mcpStatus = await fetch('/api/mcp/dynamic');
          const mcpData = await mcpStatus.json() as { connected?: boolean };
          if (mcpData.connected) {
            const res = await fetch('/api/mcp/create-event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                summary:     args.text  as string,
                date:        args.date  as string | undefined,
                time:        args.time  as string | undefined,
                description: args.description as string | undefined,
              }),
            });
            const data = await res.json() as { success?: boolean; error?: string; optimistic?: { id: string; title: string; start: string; end: string; allDay: boolean; location: string; description: string } };
            if (res.ok && data.success) {
              const targetDate = (data.optimistic?.start ?? (args.date as string | undefined) ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
              // Navigate immediately
              window.dispatchEvent(new CustomEvent('jarvis:calendar', { detail: { type: 'go_to_date', date: targetDate } }));
              // Optimistic insert — appears in the UI right away, no waiting
              if (data.optimistic) {
                window.dispatchEvent(new CustomEvent('jarvis:calendar', { detail: { type: 'add_mcp_event', event: data.optimistic } }));
              }
              // Background refresh to replace the optimistic placeholder with real GCal data
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('jarvis:calendar', { detail: { type: 'refresh_ical' } }));
              }, 4000);
              const dateLabel = args.date ? ` on ${args.date}` : ' for today';
              const timeLabel = args.time ? ` at ${args.time}` : '';
              return { success: true, message: `Added "${args.text}"${dateLabel}${timeLabel} to Google Calendar.` };
            }
            // MCP failed — fall through to local
          }
        } catch { /* fall through to local */ }

        // Fallback: add locally
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('jarvis:calendar', {
            detail: { type: 'add_task', ...args },
          }));
        }, 400);
        return { success: true, message: `Added "${args.text ?? ''}"${args.date ? ` on ${args.date}` : ' for today'} (saved locally).` };
      }

      // delete_event: remove a Google Calendar event by title match
      if (command === 'delete_event') {
        try {
          const mcpStatus = await fetch('/api/mcp/dynamic');
          const mcpData = await mcpStatus.json() as { connected?: boolean };
          if (mcpData.connected) {
            const res = await fetch('/api/mcp/delete-event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text:       args.text as string,
                date:       args.date as string | undefined,
                calendarId: 'primary',
              }),
            });
            const data = await res.json() as { success?: boolean; deletedId?: string; deletedTitle?: string; error?: string };
            if (res.ok && data.success) {
              // Optimistic removal — remove matching events from UI immediately
              window.dispatchEvent(new CustomEvent('jarvis:calendar', {
                detail: { type: 'remove_mcp_event', text: args.text, eventId: data.deletedId },
              }));
              // Navigate to the relevant date so user sees the removal
              if (args.date) {
                window.dispatchEvent(new CustomEvent('jarvis:calendar', { detail: { type: 'go_to_date', date: args.date } }));
              }
              // Safety refresh — CalendarPage also re-fetches immediately on
              // remove_mcp_event, but this catches any edge cases.
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('jarvis:calendar', { detail: { type: 'refresh_ical' } }));
              }, 4000);
              return { success: true, message: `Deleted "${data.deletedTitle ?? args.text}" from Google Calendar.` };
            }
            return { success: false, message: data.error ?? `Could not find an event matching "${args.text}".` };
          }
        } catch { /* fall through */ }
        return { success: false, message: 'Google Calendar is not connected. Cannot delete event.' };
      }

      // For all other commands (complete, clear, go_to_date), dispatch to CalendarPage
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('jarvis:calendar', {
          detail: { type: command, ...args },
        }));
      }, 400);

      const desc: Record<string, string> = {
        complete_task: `Marked "${args.text ?? ''}" as done.`,
        clear_tasks:   `Cleared all tasks${args.date ? ` for ${args.date}` : ' for today'}.`,
        go_to_date:    `Navigated calendar to ${args.date ?? 'today'}.`,
      };
      return { success: true, message: desc[command] ?? 'Calendar updated.' };
    },
  },
  {
    name: 'home_assistant_command',
    label: 'Smart Home',
    description: 'Control Home Assistant smart home devices — lights, switches, climate, fans, locks, and more',
    tool: {
      type: 'function',
      name: 'home_assistant_command',
      description:
        'Control smart home devices and read sensors via Home Assistant. ' +
        'IMPORTANT TV/MEDIA RULES: When the user says "put on Netflix", "switch to HDMI 1", "play Hulu", "change the input", or anything about what is playing on the TV — ALWAYS use select_source with the source name. Do NOT ask for clarification about which TV if only one TV/media_player exists — just use it automatically. ' +
        'IMPORTANT LIGHTS RULE: The lights in this home are smart plugs in the switch domain with friendly names "Light 1", "Light 2", "Light 3", "Light 4". When the user says "turn on the lights", "turn off all lights", "dim the lights", etc. — use domain="light" and the system will automatically find the correct switch entities. Do NOT say you cannot find the lights. ' +
        'For lights, switches, fans: use turn_on/turn_off/toggle. ' +
        'For brightness: set_brightness. For temperature: set_temperature. ' +
        'For listing devices or reading sensors: list_devices. ' +
        'Examples: "put on Netflix" → select_source, source="Netflix". "turn off the lights" → turn_off, domain=light. "turn on all lights" → turn_on, domain=light.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['turn_on', 'turn_off', 'toggle', 'set_brightness', 'set_temperature', 'select_source', 'list_devices'],
            description:
              'turn_on / turn_off / toggle: control a device on/off. ' +
              'set_brightness: set light brightness (0-100%). ' +
              'set_temperature: set climate target temperature. ' +
              'select_source: REQUIRED for any TV input/app change — "put on Netflix", "switch to HDMI 1", "change to Hulu" etc. Auto-finds the TV if no entity specified. ' +
              'list_devices: get all available entities and their current states.',
          },
          entity_id: {
            type: 'string',
            description: 'The HA entity ID. OPTIONAL for select_source — if omitted, auto-resolves to the first/only TV. Required for other commands when you know the ID.',
          },
          friendly_name: {
            type: 'string',
            description: 'Human-readable device name. OPTIONAL for select_source (auto-finds TV). Use for other commands when you don\'t know the entity_id.',
          },
          brightness: {
            type: 'number',
            description: 'Brightness percentage 0-100 for set_brightness command.',
          },
          temperature: {
            type: 'number',
            description: 'Target temperature (in the unit configured in HA) for set_temperature.',
          },
          source: {
            type: 'string',
            description: 'REQUIRED for select_source. The exact input or app name: "Netflix", "Hulu", "Disney+", "HDMI 1", "HDMI 2", "YouTube", etc. Use the name as the user said it.',
          },
          domain: {
            type: 'string',
            description: 'HA domain to filter list_devices or scope a broad command: "light", "switch", "climate", "fan", "cover", "media_player", "lock", "sensor", "binary_sensor", "automation", "script".',
          },
        },
        required: ['command'],
      },
    },
    handler: async (args) => {
      const command      = args.command      as string;
      const entityId     = args.entity_id    as string | undefined;
      const friendlyName = args.friendly_name as string | undefined;
      const brightness   = args.brightness   as number | undefined;
      const temperature  = args.temperature  as number | undefined;
      const source       = args.source       as string | undefined;
      const domain       = args.domain       as string | undefined;

      // Use getCachedSetting (cache → localStorage). If both are empty the server
      // settings cache is cold — load it now so mobile/tablet clients work too.
      let haUrl   = getCachedSetting('jarvis_ha_url');
      let haToken = getCachedSetting('jarvis_ha_token');
      if (!haUrl || !haToken) {
        const s = await loadServerSettings();
        haUrl   = s.jarvis_ha_url   ?? '';
        haToken = s.jarvis_ha_token ?? '';
      }

      if (!haUrl || !haToken) {
        return { success: false, message: 'Home Assistant is not configured. Navigate to the Home Assistant page and connect first.' };
      }

      // Navigate to the HA page so user can see changes (skip for list_devices — it's a background lookup)
      if (command !== 'list_devices') {
        window.dispatchEvent(new CustomEvent('jarvis:navigate', { detail: { page: 'home-assistant' } }));
      }

      // list_devices: return all entity states
      if (command === 'list_devices') {
        try {
          const res = await fetch(`/api/home-assistant?url=${encodeURIComponent(haUrl)}&token=${encodeURIComponent(haToken)}&path=/api/states`);
          if (!res.ok) return { success: false, message: 'Could not fetch device list from Home Assistant.' };
          const states = await res.json() as Array<{ entity_id: string; state: string; attributes: { friendly_name?: string; unit_of_measurement?: string } }>;
          const filterDomain = domain?.toLowerCase();
          const relevant = states.filter((e) => {
            if (filterDomain) return e.entity_id.startsWith(filterDomain + '.');
            return ['light','switch','climate','fan','cover','media_player','lock','automation','script','sensor','binary_sensor'].some((d) => e.entity_id.startsWith(d + '.'));
          });
          const summary = relevant.map((e) => {
            const name = e.attributes.friendly_name ?? e.entity_id;
            const unit = e.attributes.unit_of_measurement ? ` ${e.attributes.unit_of_measurement}` : '';
            return `${name} (${e.entity_id}): ${e.state}${unit}`;
          }).join('\n');
          return {
            success: true,
            devices: summary,
            instruction: `Here are the smart home devices and their states:\n${summary}\n\nRead a brief natural summary of the key devices and their current states.`,
          };
        } catch (e) {
          return { success: false, message: `Failed to list devices: ${String(e)}` };
        }
      }

      // For control commands, resolve entity_id
      let resolvedEntityId = entityId;

      // ── Bulk domain operation ────────────────────────────────────────────────
      // When a domain is given but no specific entity/name, apply the command to
      // ALL entities in that domain (e.g. "turn on all lights" → every light.*).
      // Also handles "lights" as an alias for switches named "light" since the
      // user's lights are smart plugs (switch domain, friendly names Light 1–4).
      if (!resolvedEntityId && domain && command !== 'select_source' && command !== 'list_devices') {
        try {
          const res = await fetch(`/api/home-assistant?url=${encodeURIComponent(haUrl)}&token=${encodeURIComponent(haToken)}&path=/api/states`);
          if (res.ok) {
            const states = await res.json() as Array<{ entity_id: string; state: string; attributes: { friendly_name?: string } }>;
            const domainLower = domain.toLowerCase();

            // When asked about "light" domain but none exist, also search for
            // switch entities whose friendly name contains "light" — covers smart
            // plugs that act as lights (e.g. "Light 1", "Light 2", etc.)
            let targets = states.filter((e) => e.entity_id.startsWith(domainLower + '.'));
            if (targets.length === 0 && domainLower === 'light') {
              targets = states.filter((e) =>
                e.entity_id.startsWith('switch.') &&
                (e.attributes.friendly_name ?? e.entity_id).toLowerCase().includes('light')
              );
            }

            // If friendly_name is also given, narrow to matching entities
            if (friendlyName) {
              const q = friendlyName.toLowerCase();
              const narrow = targets.filter((e) =>
                (e.attributes.friendly_name ?? '').toLowerCase().includes(q) ||
                e.entity_id.toLowerCase().includes(q.replace(/ /g, '_'))
              );
              if (narrow.length > 0) targets = narrow;
            }

            if (targets.length > 0) {
              const svc = command === 'set_brightness' ? 'turn_on' : command;
              const results: string[] = [];
              for (const t of targets) {
                const svcData: Record<string, unknown> = { entity_id: t.entity_id };
                if (command === 'set_brightness') svcData.brightness = Math.round(((brightness ?? 100) / 100) * 255);
                const r = await fetch(`/api/home-assistant?url=${encodeURIComponent(haUrl)}&token=${encodeURIComponent(haToken)}&path=/api/services/${t.entity_id.split('.')[0]}/${svc}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(svcData),
                });
                results.push(`${t.attributes.friendly_name ?? t.entity_id}: ${r.ok ? 'done' : 'failed'}`);
              }
              return { success: true, message: `Applied "${command}" to ${targets.length} device(s): ${results.join(', ')}` };
            }
          }
        } catch { /* fall through to single-entity path */ }
      }

      // Auto-resolve TV for select_source when no entity specified
      if (command === 'select_source' && !resolvedEntityId && !friendlyName) {
        try {
          const res = await fetch(`/api/home-assistant?url=${encodeURIComponent(haUrl)}&token=${encodeURIComponent(haToken)}&path=/api/states`);
          if (res.ok) {
            const states = await res.json() as Array<{ entity_id: string; state: string; attributes: { friendly_name?: string; source_list?: string[] } }>;
            const tvs = states.filter((e) => e.entity_id.startsWith('media_player.'));
            if (tvs.length === 1) {
              resolvedEntityId = tvs[0].entity_id;
            } else if (tvs.length > 1) {
              const names = tvs.map((e) => e.attributes.friendly_name ?? e.entity_id).join(', ');
              return { success: false, message: `Multiple TVs found: ${names}. Which one should I switch to ${source}?` };
            } else {
              return { success: false, message: 'No TV or media player found in Home Assistant.' };
            }
          }
        } catch { /* fall through */ }
      }

      if (!resolvedEntityId && friendlyName) {
        try {
          const res = await fetch(`/api/home-assistant?url=${encodeURIComponent(haUrl)}&token=${encodeURIComponent(haToken)}&path=/api/states`);
          if (res.ok) {
            const states = await res.json() as Array<{ entity_id: string; state: string; attributes: { friendly_name?: string } }>;
            const query = friendlyName.toLowerCase();
            const match = states.find((e) =>
              (e.attributes.friendly_name ?? '').toLowerCase().includes(query) ||
              e.entity_id.toLowerCase().includes(query.replace(/ /g, '_'))
            );
            resolvedEntityId = match?.entity_id;
          }
        } catch { /* fall through */ }
      }

      if (!resolvedEntityId) {
        return { success: false, message: `Could not find a device matching "${friendlyName ?? entityId}". Try list_devices to see available entities.` };
      }

      const entityDomain = resolvedEntityId.split('.')[0];
      let service: string;
      const serviceData: Record<string, unknown> = { entity_id: resolvedEntityId };

      if (command === 'set_brightness') {
        service = 'turn_on';
        serviceData.brightness = Math.round(((brightness ?? 100) / 100) * 255);
      } else if (command === 'set_temperature') {
        service = 'set_temperature';
        serviceData.temperature = temperature;
      } else if (command === 'select_source') {
        service = 'select_source';
        serviceData.source = source;
      } else {
        service = command; // turn_on | turn_off | toggle
      }

      try {
        const res = await fetch('/api/home-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: haUrl, token: haToken, domain: entityDomain, service, serviceData }),
        });
        if (!res.ok) {
          const err = await res.json() as { error?: string };
          return { success: false, message: err.error ?? `HA returned ${res.status}` };
        }
        // Notify the page to refresh its state
        window.dispatchEvent(new CustomEvent('jarvis:home-assistant', {
          detail: { entityId: resolvedEntityId, domain: entityDomain, service, serviceData },
        }));
        const name = friendlyName ?? resolvedEntityId;
        const resultMsg = command === 'set_brightness'
          ? `Set ${name} brightness to ${brightness ?? 100}%.`
          : command === 'set_temperature'
          ? `Set ${name} temperature to ${temperature}°.`
          : command === 'select_source'
          ? `Switched ${name} input to ${source}.`
          : `${command === 'turn_on' ? 'Turned on' : command === 'turn_off' ? 'Turned off' : 'Toggled'} ${name}.`;
        return { success: true, message: resultMsg };
      } catch (e) {
        return { success: false, message: `Failed to control device: ${String(e)}` };
      }
    },
  },
  {
    name: 'printer_command',
    label: '3D Printers',
    description: 'Check status of Bambu Lab 3D printers and send print control commands',
    tool: {
      type: 'function',
      name: 'printer_command',
      description:
        'Query and control Bambu Lab 3D printers via the cloud. ' +
        'Use "status" to get the current state of all printers (temperatures, progress, current job, filament). ' +
        'Use "pause", "resume", or "stop" to control an active print job. ' +
        'Examples: "what are my printers doing?" → status. "pause the print" → pause. "how much time is left?" → status.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['status', 'pause', 'resume', 'stop'],
            description: '"status" = get all printer states and active jobs. "pause"/"resume"/"stop" = control an active print.',
          },
          printer_name: {
            type: 'string',
            description: 'Optional printer name to target for pause/resume/stop. If omitted and only one printer is active, it is used automatically.',
          },
        },
        required: ['command'],
      },
    },
    handler: async (args) => {
      const command     = args.command      as string;
      const printerName = args.printer_name as string | undefined;

      // Navigate to the printer page so the user can see changes
      window.dispatchEvent(new CustomEvent('jarvis:navigate', { detail: { page: '3d-printers' } }));

      try {
        // Fetch printers + telemetry
        const [printersRes, telRes] = await Promise.all([
          fetch('/api/bambu/printers'),
          fetch('/api/bambu/telemetry'),
        ]);

        if (!printersRes.ok) {
          return { success: false, message: 'Could not reach the 3D printer service. Make sure you are connected to Bambu Cloud on the 3D Printers page.' };
        }

        const printers = await printersRes.json() as Array<{ deviceId: string; name: string; model?: string }>;
        const telemetry: Record<string, {
          gcode_state?: string; subtask_name?: string; mc_percent?: number;
          mc_remaining_time?: number; nozzle_temper?: number; nozzle_target_temper?: number;
          bed_temper?: number; bed_target_temper?: number; chamber_temper?: number;
          wifi_signal?: string; ams?: unknown;
        }> = telRes.ok ? await telRes.json() : {};

        if (command === 'status') {
          if (!printers.length) {
            return { success: true, message: 'No printers found. Make sure your Bambu Lab account is connected and printers are registered.', instruction: 'Tell the user no printers were found and to check their Bambu Lab account.' };
          }

          const summaries = printers.map((p) => {
            const t = telemetry[p.deviceId] ?? {};
            const state = t.gcode_state ?? 'Unknown';
            const lines: string[] = [`${p.name}${p.model ? ` (${p.model})` : ''}: ${state}`];
            if (t.subtask_name && t.subtask_name !== '-') lines.push(`  Job: ${t.subtask_name}`);
            if (t.mc_percent != null) lines.push(`  Progress: ${t.mc_percent}%`);
            if (t.mc_remaining_time) {
              const h = Math.floor(t.mc_remaining_time / 3600);
              const m = Math.floor((t.mc_remaining_time % 3600) / 60);
              lines.push(`  Time remaining: ${h > 0 ? `${h}h ` : ''}${m}m`);
            }
            if (t.nozzle_temper != null) lines.push(`  Nozzle: ${Math.round(t.nozzle_temper)}°C / ${t.nozzle_target_temper ?? 0}°C target`);
            if (t.bed_temper != null)    lines.push(`  Bed: ${Math.round(t.bed_temper)}°C / ${t.bed_target_temper ?? 0}°C target`);
            if (t.chamber_temper != null) lines.push(`  Chamber: ${Math.round(t.chamber_temper)}°C`);
            return lines.join('\n');
          });

          const activePrinters = printers.filter((p) => ['RUNNING','PAUSE'].includes((telemetry[p.deviceId]?.gcode_state ?? '').toUpperCase()));

          return {
            success: true,
            printer_count: printers.length,
            active_count: activePrinters.length,
            details: summaries.join('\n\n'),
            instruction: `Here is the current status of your 3D printers:\n\n${summaries.join('\n\n')}\n\nGive the user a clear, natural voice summary. Mention what is printing, how far along it is, and any key temperatures. Keep it concise.`,
          };
        }

        // pause / resume / stop — find target printer
        const activeList = printers.filter((p) => {
          const s = (telemetry[p.deviceId]?.gcode_state ?? '').toUpperCase();
          return command === 'resume' ? s === 'PAUSE' : s === 'RUNNING' || s === 'PAUSE';
        });

        let target = activeList[0];
        if (printerName) {
          const match = activeList.find((p) => p.name.toLowerCase().includes(printerName.toLowerCase()));
          if (match) target = match;
        }

        if (!target) {
          return { success: false, message: `No active printer found to ${command}.`, instruction: `Tell the user there is no printer currently ${command === 'resume' ? 'paused' : 'printing'} that can be ${command}d.` };
        }

        const cmdRes = await fetch('/api/bambu/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: target.deviceId, command }),
        });

        if (!cmdRes.ok) {
          const err = await cmdRes.json() as { error?: string };
          return { success: false, message: err.error ?? 'Command failed' };
        }

        return {
          success: true,
          printer: target.name,
          command,
          instruction: `Successfully sent "${command}" to ${target.name}. Confirm to the user that the print has been ${command === 'pause' ? 'paused' : command === 'resume' ? 'resumed' : 'stopped'}.`,
        };
      } catch (e) {
        return { success: false, message: `Printer service error: ${String(e)}` };
      }
    },
  },
  {
    name: 'add_home_widget',
    label: 'Home Dashboard Widget',
    description: 'Add or remove a live widget on the Jarvis home dashboard',
    tool: {
      type: 'function',
      name: 'add_home_widget',
      description:
        'Add or remove a live widget on the Jarvis home screen dashboard. ' +
        'Use "add" to place a widget, "remove" to close it. ' +
        'Widget types: ' +
        '"tv" = TV remote control panel. ' +
        '"printer" = 3D printer live status card. ' +
        '"weather-home" = current weather conditions. ' +
        '"weather-radar" = animated precipitation radar map. ' +
        '"agenda" = upcoming calendar events. ' +
        '"todo" = today\'s task list. ' +
        '"stocks" = live market ticker (optionally pass symbols like "AAPL,TSLA"). ' +
        '"headlines" = rotating world news headlines. ' +
        '"timer" = active countdowns and reminders. ' +
        '"camera-feed" = live webcam view. ' +
        '"transcript" = live conversation log. ' +
        '"uptime" = host reachability monitor (optionally pass hosts like "192.168.1.1:80,github.com:443"). ' +
        '"orbit" = ISS tracker with sunrise/sunset and moon phase. ' +
        '"calculator" = futuristic arithmetic / compute pad. ' +
        '"ha-device" = Home Assistant device card showing multiple devices. ' +
        '"ha-toggle" = a single bare glowing power button for ONE specific device. ' +
        'IMPORTANT — when adding an "ha-toggle": ALWAYS call home_assistant_command with command=list_devices FIRST to get the real entity IDs and friendly names. Then pass entity_ids=[the exact entity_id] and label=the short human name (e.g. "Light 2") to add_home_widget. This ensures the correct device is targeted and the button shows a clean label. ' +
        'Examples: "add a button for Light 1" → 1) list_devices to find "switch.light_1", 2) ha-toggle, entity_ids=["switch.light_1"], label="Light 1". ' +
        '"add my lights to the dashboard" → ha-device, domain=light. ' +
        '"remove the weather widget" → weather-home, action=remove.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'remove'],
            description: '"add" opens the widget on the home screen. "remove" closes it.',
          },
          widget_type: {
            type: 'string',
            enum: [
              'tv', 'printer', 'weather-home', 'weather-radar', 'agenda', 'todo', 'stocks', 'headlines',
              'timer', 'camera-feed', 'transcript', 'uptime', 'orbit', 'calculator', 'ha-device', 'ha-toggle',
            ],
            description: 'Which widget to add or remove. Use "ha-toggle" for a single glowing power button for one specific device.',
          },
          title: {
            type: 'string',
            description: 'Optional custom title for the widget header (e.g. "Living Room TV", "X1 Carbon").',
          },
          printer_name: {
            type: 'string',
            description: 'For widget_type=printer: the printer name to display (e.g. "X1 Carbon", "A1 Mini"). Leave empty to show all printers.',
          },
          domain: {
            type: 'string',
            description: 'For widget_type=ha-device: HA domain to filter devices (e.g. "light", "switch", "climate"). Use "light" for lights — the system automatically includes smart plugs named "Light 1-4" even though they are in the switch domain.',
          },
          entity_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'For widget_type=ha-device: specific entity IDs to show (e.g. ["light.living_room", "switch.fan"]).',
          },
          name_filter: {
            type: 'string',
            description: 'For widget_type=ha-device or ha-toggle: fuzzy name filter. For ha-toggle prefer entity_ids after calling list_devices.',
          },
          label: {
            type: 'string',
            description: 'For widget_type=ha-toggle: short display name shown under the power button (e.g. "Light 2"). Always set this to the clean human name.',
          },
          symbols: {
            type: 'string',
            description: 'For widget_type=stocks: comma-separated ticker symbols to track, e.g. "AAPL,TSLA,BTC-USD". Omit for a sensible default list.',
          },
          hosts: {
            type: 'string',
            description: 'For widget_type=uptime: comma-separated host:port targets to monitor, e.g. "192.168.1.1:80,github.com:443". Omit for defaults.',
          },
        },
        required: ['action', 'widget_type'],
      },
    },
    handler: async (args) => {
      const action      = args.action      as string;
      const widgetType  = args.widget_type as string;
      const title       = args.title       as string | undefined;
      const printerName = args.printer_name as string | undefined;
      const domain      = args.domain      as string | undefined;
      const nameFilter  = args.name_filter as string | undefined;
      const label       = args.label       as string | undefined;

      // entity_ids may be a proper array (OpenAI) or a comma-separated string (ElevenLabs)
      const rawEntityIds = args.entity_ids;
      const resolvedEntityIds: string[] | undefined =
        Array.isArray(rawEntityIds) ? rawEntityIds :
        typeof rawEntityIds === 'string' && rawEntityIds.trim()
          ? rawEntityIds.split(',').map(s => s.trim()).filter(Boolean)
          : undefined;

      const widgetConfig: Record<string, unknown> = {};
      if (printerName)              widgetConfig.printer_name = printerName;
      if (domain)                   widgetConfig.domain = domain;
      if (resolvedEntityIds?.length) widgetConfig.entity_ids = resolvedEntityIds;
      if (nameFilter)               widgetConfig.name = nameFilter;
      if (label)                    widgetConfig.label = label;
      if (typeof args.symbols === 'string' && args.symbols.trim()) widgetConfig.symbols = args.symbols.trim();
      if (typeof args.hosts === 'string' && args.hosts.trim())     widgetConfig.hosts = args.hosts.trim();

      if (action === 'add') {
        window.dispatchEvent(new CustomEvent('jarvis:hud', {
          detail: {
            command: 'open',
            widget: widgetType,
            title: title ?? undefined,
            widget_config: Object.keys(widgetConfig).length > 0 ? widgetConfig : undefined,
          },
        }));

        const widgetNames: Record<string, string> = {
          'tv': 'TV Control', 'printer': 'Printer Status',
          'weather-home': 'Weather', 'ha-device': 'Device Controls', 'ha-toggle': 'Power Button',
          'weather-radar': 'Weather Radar', 'agenda': 'Agenda', 'todo': 'Tasks', 'stocks': 'Markets',
          'headlines': 'Headlines', 'timer': 'Timers', 'camera-feed': 'Camera Feed',
          'transcript': 'Comms Log', 'uptime': 'Host Monitor', 'orbit': 'Orbital Tracker',
          'calculator': 'Compute',
        };
        const label = title ?? widgetNames[widgetType] ?? widgetType;
        return {
          success: true,
          instruction: `Added the "${label}" widget to your home dashboard. Let the user know it's now visible on the home screen.`,
        };
      }

      if (action === 'remove') {
        window.dispatchEvent(new CustomEvent('jarvis:hud', {
          detail: { command: 'close', widget: widgetType },
        }));
        return {
          success: true,
          instruction: `Removed the ${widgetType} widget from the dashboard. Confirm to the user.`,
        };
      }

      return { success: false, message: 'Unknown action' };
    },
  },
  {
    name: 'fullscreen',
    label: 'Fullscreen',
    description: 'Toggle fullscreen mode on or off for the Jarvis app',
    tool: {
      type: 'function',
      name: 'fullscreen',
      description:
        'Enter or exit fullscreen mode for the Jarvis interface. ' +
        'Use this when the user says "go fullscreen", "fullscreen mode", "make it fullscreen", "exit fullscreen", "leave fullscreen", or "go back to normal".',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['enter', 'exit', 'toggle'],
            description: 'Use "enter" to go fullscreen, "exit" to leave fullscreen, "toggle" to switch between states.',
          },
        },
        required: ['action'],
      },
    },
    handler: async (args) => {
      const action = args.action as string;

      const isFullscreen = () => !!document.fullscreenElement;

      try {
        if (action === 'enter' || (action === 'toggle' && !isFullscreen())) {
          await document.documentElement.requestFullscreen();
          return { success: true, state: 'fullscreen' };
        } else if (action === 'exit' || (action === 'toggle' && isFullscreen())) {
          await document.exitFullscreen();
          return { success: true, state: 'windowed' };
        }
        return { error: 'Invalid action.' };
      } catch (err) {
        return { error: String(err) };
      }
    },
  },
  {
    name: 'lock_interface',
    label: 'Lock Interface',
    description: 'Let Jarvis lock the interface behind the PIN lock screen',
    tool: {
      type: 'function',
      name: 'lock_interface',
      description:
        'Lock the Jarvis interface behind the PIN lock screen. ' +
        'Use when the user says "lock it down", "lock the interface", "security lockdown", "lock up", or similar. ' +
        'The user must have enabled the lock and set a PIN in Settings → Security first. ' +
        'Unlocking requires the PIN on screen — it can NOT be done by voice.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: () => {
      try {
        const raw = localStorage.getItem('jarvis_settings');
        const s = raw ? JSON.parse(raw) as { lockEnabled?: boolean; lockPinHash?: string } : {};
        if (!s.lockEnabled || !s.lockPinHash) {
          return {
            success: false,
            message: 'The lock screen is not configured. Ask the user to enable it and set a PIN in Settings → Security.',
          };
        }
      } catch { /* fall through and attempt anyway */ }
      window.dispatchEvent(new CustomEvent('jarvis:lock'));
      return { success: true, message: 'Interface locked. The PIN is required on screen to unlock.' };
    },
  },
  {
    name: 'set_timer',
    label: 'Timers',
    description: 'Let Jarvis start, cancel, and list countdown timers',
    tool: {
      type: 'function',
      name: 'set_timer',
      description:
        'Manage countdown timers. Use when the user says "set a timer for 10 minutes", "cancel the timer", or "how long is left on my timer?". ' +
        'Starting a timer also opens the TIMERS widget on the HUD. When a timer finishes, a notification appears on screen with a sound.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'cancel', 'list'],
            description: 'start = begin a new countdown. cancel = stop a running timer. list = report active timers.',
          },
          minutes: {
            type: 'number',
            description: 'Timer duration in minutes (may be fractional, e.g. 0.5 for 30 seconds). Required for start.',
          },
          label: {
            type: 'string',
            description: 'Optional short label, e.g. "pasta" or "print check". Also used to match which timer to cancel.',
          },
        },
        required: ['action'],
      },
    },
    handler: (args) => {
      const action = args.action as string;

      if (action === 'start') {
        const minutes = Number(args.minutes);
        if (!minutes || minutes <= 0) return { error: 'A positive number of minutes is required.' };
        const label = (args.label as string | undefined)?.trim();
        const timer = addTimer(minutes * 60_000, label ? label.toUpperCase() : `${minutes} MIN TIMER`);
        window.dispatchEvent(new CustomEvent('jarvis:hud', { detail: { command: 'open', widget: 'timer' } }));
        return {
          success: true,
          ends_at: new Date(timer.endsAt).toLocaleTimeString(),
          message: `Timer "${timer.label}" started — it will finish at ${new Date(timer.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
        };
      }

      if (action === 'cancel') {
        const query = (args.label as string | undefined)?.trim();
        const timers = getTimers();
        if (timers.length === 0) return { success: false, message: 'There are no active timers.' };
        const removed = cancelTimer(query || timers[0].id);
        return removed
          ? { success: true, message: 'Timer cancelled.' }
          : { success: false, message: `No timer matching "${query}" found.` };
      }

      // list
      const timers = getTimers();
      if (timers.length === 0) return { success: true, message: 'No timers are running.' };
      const summary = timers.map((t) => {
        const remainMin = Math.max(0, Math.round((t.endsAt - Date.now()) / 60_000));
        return `${t.label}: about ${remainMin} minute${remainMin === 1 ? '' : 's'} remaining`;
      }).join('; ');
      return { success: true, timers: summary, instruction: `Tell the user their timer status: ${summary}` };
    },
  },
  {
    name: 'set_reminder',
    label: 'Reminders',
    description: 'Let Jarvis set reminders that fire an on-screen alert at a specific time',
    tool: {
      type: 'function',
      name: 'set_reminder',
      description:
        'Manage reminders that pop an on-screen notification (with sound) at a specific time. ' +
        'Use for "remind me at 3pm to check the print" or "remind me in 20 minutes to stretch". ' +
        'Reminders persist across app restarts. Provide EITHER in_minutes OR time (24-hour HH:MM, with optional date).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'cancel', 'list'],
            description: 'add = create a reminder. cancel = remove one by text match. list = report pending reminders.',
          },
          text: {
            type: 'string',
            description: 'What to remind the user about, e.g. "check the print". Required for add; used to match for cancel.',
          },
          in_minutes: {
            type: 'number',
            description: 'Fire the reminder this many minutes from now. Use for relative requests ("in 20 minutes").',
          },
          time: {
            type: 'string',
            description: '24-hour time HH:MM (e.g. "15:00" for 3pm). Use for absolute requests ("at 3pm").',
          },
          date: {
            type: 'string',
            description: 'Optional ISO date YYYY-MM-DD for the time parameter. Defaults to today (or tomorrow if the time already passed).',
          },
        },
        required: ['action'],
      },
    },
    handler: (args) => {
      const action = args.action as string;

      if (action === 'add') {
        const text = (args.text as string | undefined)?.trim();
        if (!text) return { error: 'Reminder text is required.' };

        let at: number | null = null;
        const inMinutes = Number(args.in_minutes);
        if (inMinutes > 0) {
          at = Date.now() + inMinutes * 60_000;
        } else if (typeof args.time === 'string' && /^\d{1,2}:\d{2}$/.test(args.time.trim())) {
          const [h, m] = args.time.trim().split(':').map(Number);
          const target = new Date();
          if (typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
            const [y, mo, d] = args.date.split('-').map(Number);
            target.setFullYear(y, mo - 1, d);
          }
          target.setHours(h, m, 0, 0);
          // If no explicit date and the time already passed today, assume tomorrow
          if (!args.date && target.getTime() <= Date.now()) {
            target.setDate(target.getDate() + 1);
          }
          at = target.getTime();
        }

        if (!at || at <= Date.now()) {
          return { error: 'Could not determine a valid future time. Provide in_minutes or time (HH:MM).' };
        }

        addReminder(at, text);
        window.dispatchEvent(new CustomEvent('jarvis:hud', { detail: { command: 'open', widget: 'timer' } }));
        const when = new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
        return { success: true, message: `Reminder set for ${when}: "${text}".` };
      }

      if (action === 'cancel') {
        const query = (args.text as string | undefined)?.trim();
        if (!query) return { error: 'Provide the reminder text to cancel.' };
        const removed = cancelReminder(query);
        return removed
          ? { success: true, message: 'Reminder cancelled.' }
          : { success: false, message: `No reminder matching "${query}" found.` };
      }

      // list
      const reminders = getReminders();
      if (reminders.length === 0) return { success: true, message: 'No pending reminders.' };
      const summary = reminders
        .map((r) => `"${r.text}" at ${new Date(r.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`)
        .join('; ');
      return { success: true, reminders: summary, instruction: `Tell the user their pending reminders: ${summary}` };
    },
  },
  {
    name: 'hud_layout',
    label: 'HUD Layouts',
    description: 'Let Jarvis save, load, and manage named HUD widget layouts (e.g. "workshop mode")',
    tool: {
      type: 'function',
      name: 'hud_layout',
      description:
        'Save or restore named HUD widget layout presets. ' +
        'Use when the user says "save this layout as workshop", "switch to monitoring mode", "load my workshop configuration", or "what layouts do I have?". ' +
        'Layout names are free-form lowercase strings like "workshop" or "monitoring".',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['save', 'load', 'delete', 'list'],
            description: 'save = store the current widget arrangement under a name. load = restore a saved preset. delete = remove a preset. list = report saved presets.',
          },
          name: {
            type: 'string',
            description: 'Preset name, e.g. "workshop". Required for save/load/delete.',
          },
        },
        required: ['action'],
      },
    },
    handler: (args) => {
      const action = args.action as string;
      const name = (args.name as string | undefined)?.trim().toLowerCase();

      if (action === 'list') {
        try {
          const presets = JSON.parse(localStorage.getItem('jarvis_hud_layouts') ?? '{}') as Record<string, unknown[]>;
          const names = Object.keys(presets);
          if (names.length === 0) return { success: true, message: 'No layout presets saved yet.' };
          return {
            success: true,
            layouts: names,
            instruction: `Tell the user their saved layouts: ${names.join(', ')}.`,
          };
        } catch {
          return { success: true, message: 'No layout presets saved yet.' };
        }
      }

      if (!name) return { error: 'A layout name is required.' };
      const command = action === 'save' ? 'save_layout' : action === 'load' ? 'load_layout' : 'delete_layout';
      window.dispatchEvent(new CustomEvent('jarvis:hud', { detail: { command, layout_name: name } }));
      const verbs: Record<string, string> = { save: 'saved as', load: 'switched to', delete: 'deleted' };
      return { success: true, message: `Layout ${verbs[action] ?? action} "${name}".` };
    },
  },
  {
    name: 'briefing',
    label: 'Briefing',
    description: 'Let Jarvis deliver a full status briefing — weather, schedule, headlines, and markets',
    tool: {
      type: 'function',
      name: 'briefing',
      description:
        'Run a full status briefing. Use when the user says "morning briefing", "daily briefing", "brief me", "what\'s the situation", or "catch me up". ' +
        'This gathers current weather, today\'s schedule, top news headlines, and market movers, and opens the matching HUD widgets. ' +
        'Summarize the returned data in a natural, flowing spoken briefing — a few sentences per section, not a list.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async () => {
      // Open the relevant widgets so the briefing has visuals
      for (const widget of ['weather-home', 'agenda', 'headlines', 'stocks']) {
        window.dispatchEvent(new CustomEvent('jarvis:hud', { detail: { command: 'open', widget } }));
      }

      const briefing: Record<string, unknown> = {};

      // Weather
      try {
        const stored = getCachedSetting('jarvis_weather_location');
        let lat: number | undefined;
        let lon: number | undefined;
        if (stored) {
          const geo = await fetch(`/api/geocode?q=${encodeURIComponent(stored)}`).then((r) => r.json()) as { lat?: number; lon?: number };
          lat = geo.lat; lon = geo.lon;
        }
        if (lat == null || lon == null) {
          const pos = await new Promise<GeolocationPosition | null>((resolve) => {
            if (!navigator.geolocation) { resolve(null); return; }
            navigator.geolocation.getCurrentPosition((p) => resolve(p), () => resolve(null), { timeout: 5000 });
          });
          lat = pos?.coords.latitude; lon = pos?.coords.longitude;
        }
        if (lat != null && lon != null) {
          const w = await fetch(`/api/weather?lat=${lat}&lon=${lon}`).then((r) => r.json()) as
            { temp?: number; condition?: string; city?: string; hi?: number; lo?: number };
          if (w.temp != null) {
            briefing.weather = `${Math.round(w.temp)}° and ${w.condition} in ${w.city}. High ${Math.round(w.hi ?? 0)}°, low ${Math.round(w.lo ?? 0)}°.`;
          }
        }
      } catch { /* section skipped */ }

      // Schedule (local tasks today + calendar events)
      try {
        const lines: string[] = [];
        const store = JSON.parse(localStorage.getItem('jarvis_calendar_tasks') ?? '{}') as
          Record<string, { text: string; time?: string; done: boolean }[]>;
        const d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        for (const t of (store[key] ?? []).filter((t) => !t.done)) {
          lines.push(`${t.time ? t.time + ' — ' : ''}${t.text}`);
        }
        const events = await fetchUpcomingCalendarEvents();
        const todayStr = new Date().toISOString().slice(0, 10);
        for (const ev of events.filter((e) => e.start.slice(0, 10) === todayStr).slice(0, 6)) {
          const time = ev.allDay ? 'All day' : new Date(ev.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          lines.push(`${time} — ${ev.title}`);
        }
        briefing.schedule = lines.length > 0 ? lines.join('; ') : 'Nothing on the schedule today.';
      } catch { /* section skipped */ }

      // Headlines
      try {
        const news = await fetch('/api/news-headlines').then((r) => r.json()) as { items?: { title: string }[] };
        briefing.headlines = (news.items ?? []).slice(0, 5).map((h) => h.title);
      } catch { /* section skipped */ }

      // Markets
      try {
        const stocks = await fetch('/api/stock-quote?symbols=SPY,QQQ,AAPL,NVDA,TSLA').then((r) => r.json()) as
          { quotes?: { symbol: string; changePct?: number; up?: boolean; error?: string }[] };
        briefing.markets = (stocks.quotes ?? [])
          .filter((q) => !q.error)
          .map((q) => `${q.symbol} ${q.up ? 'up' : 'down'} ${Math.abs(q.changePct ?? 0).toFixed(1)}%`)
          .join(', ');
      } catch { /* section skipped */ }

      return {
        success: true,
        ...briefing,
        instruction:
          'Deliver this as one continuous natural spoken briefing: start with the weather, then the schedule, then a 2-sentence news summary, then one sentence on the markets. Keep the whole thing under 30 seconds of speech.',
      };
    },
  },
  {
    name: 'set_theme',
    label: 'Theme Control',
    description: 'Let Jarvis switch the interface color theme by voice',
    tool: {
      type: 'function',
      name: 'set_theme',
      description:
        'Change the Jarvis interface color theme. Use when the user says "switch to crimson", "go matrix mode", "change the theme", or names a color. ' +
        'Themes: arc-reactor (cyan/blue, default), midnight (purple), crimson (red), matrix (green), custom (uses the accent color from Settings → UI).',
      parameters: {
        type: 'object',
        properties: {
          theme: {
            type: 'string',
            enum: ['arc-reactor', 'midnight', 'crimson', 'matrix', 'custom'],
            description: 'The theme to activate. Map color words: blue/cyan → arc-reactor, purple → midnight, red → crimson, green → matrix.',
          },
        },
        required: ['theme'],
      },
    },
    handler: (args) => {
      const theme = args.theme as string;
      if (!['arc-reactor', 'midnight', 'crimson', 'matrix', 'custom'].includes(theme)) {
        return { error: 'Unknown theme.' };
      }
      window.dispatchEvent(new CustomEvent('jarvis:set-theme', { detail: { theme } }));
      return { success: true, message: `Theme switched to ${theme}.` };
    },
  },
  {
    name: 'ambient_mode',
    label: 'Ambient Mode',
    description: 'Let Jarvis enter or exit the ambient standby screen (dimmed clock display)',
    tool: {
      type: 'function',
      name: 'ambient_mode',
      description:
        'Enter or exit ambient standby mode — a dimmed full-screen clock display. ' +
        'Use when the user says "ambient mode", "standby", "screensaver", "dim the screen", or "wake up" / "exit standby".',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['enter', 'exit'],
            description: 'enter = show the ambient standby screen. exit = return to the normal interface.',
          },
        },
        required: ['action'],
      },
    },
    handler: (args) => {
      const action = args.action as string;
      window.dispatchEvent(new CustomEvent(action === 'exit' ? 'jarvis:ambient-exit' : 'jarvis:ambient'));
      return {
        success: true,
        message: action === 'exit' ? 'Exited ambient mode.' : 'Ambient standby engaged. Any input wakes the interface.',
      };
    },
  },
];

export function getFunctionByName(name: string): JarvisFunction | undefined {
  return FUNCTION_REGISTRY.find((f) => f.name === name);
}
