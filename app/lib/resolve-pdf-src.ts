/**
 * Turn a user-supplied PDF location into a URL the viewer iframe can load.
 * — http(s) and site-relative (/public/...) work in any environment.
 * — Absolute filesystem paths use the jarvis-pdf protocol in the desktop app.
 */

const UNIX_ABS_HINTS = [
  '/Users/',
  '/home/',
  '/Volumes/',
  '/private/',
  '/tmp/',
  '/var/',
  '/opt/',
  '/usr/',
  '/etc/',
];

function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electron?.isElectron === true;
}

function looksLikeWindowsAbs(p: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(p) || p.startsWith('\\\\');
}

function looksLikeUnixFsAbs(p: string): boolean {
  if (!p.startsWith('/')) return false;
  return UNIX_ABS_HINTS.some((h) => p.startsWith(h));
}

export function resolvePdfDisplayUrl(source: string): {
  url: string;
  hint?: string;
} {
  const trimmed = source.trim();
  if (!trimmed) {
    return { url: '', hint: 'Empty path or URL.' };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed };
  }

  if (/^file:\/\//i.test(trimmed)) {
    return { url: trimmed };
  }

  if (looksLikeWindowsAbs(trimmed) || looksLikeUnixFsAbs(trimmed)) {
    const normalized = trimmed.replace(/\\/g, '/');
    if (isElectron()) {
      return { url: `jarvis-pdf://${encodeURIComponent(normalized)}` };
    }
    const prefix = looksLikeWindowsAbs(trimmed) ? 'file:///' : 'file://';
    return {
      url: prefix + normalized,
      hint:
        'Local files usually need the Jarvis desktop app. In the browser, prefer an https URL or a file under /public (e.g. /manual.pdf).',
    };
  }

  // Site-relative (/report.pdf) or relative segment (report.pdf → /report.pdf)
  if (trimmed.startsWith('/')) {
    return { url: trimmed };
  }

  return { url: `/${trimmed.replace(/^\/+/, '')}` };
}
