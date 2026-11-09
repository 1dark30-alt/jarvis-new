import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolve a REAL Python 3 interpreter for spawning scripts.
 *
 * On Windows, a bare `python` can resolve to the Microsoft Store
 * app-execution-alias stub (prints "Python was not found…" and exits), and
 * the PATH the app process inherits may not include the user's Python at
 * all. So we probe well-known install locations directly, newest version
 * first, and only fall back to PATH.
 *
 * Order (Windows):
 *   1. JARVIS_PYTHON env var (explicit override)
 *   2. %LOCALAPPDATA%\Programs\Python\Python3XX\python.exe (per-user install)
 *   3. %ProgramFiles%\Python3XX\python.exe (all-users install)
 *   4. %LOCALAPPDATA%\Programs\Python\Launcher\py.exe (Python launcher)
 *   5. Anaconda/Miniconda on Windows
 *   6. bare "python" from PATH (last resort)
 *
 * Non-Windows: JARVIS_PYTHON, then "python3" from PATH.
 */

let cached: string | null = null;

export function pythonExe(): string {
  if (cached !== null) return cached;
  cached = resolve();
  return cached;
}

/** All concrete python.exe/py.exe locations worth probing on this Windows
 * machine, newest-first. Exported so callers with their own fallback chains
 * (e.g. computer-use) can use the same list instead of a hardcoded one. */
export function pythonCandidatesWin(): string[] {
  if (process.platform !== 'win32') return [];
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const candidates: string[] = [];

  // Per-user installs keep a folder per minor version: take the newest.
  const userPythonRoot = path.join(localAppData, 'Programs', 'Python');
  for (const dir of sortedPythonDirs(userPythonRoot)) {
    candidates.push(path.join(userPythonRoot, dir, 'python.exe'));
  }
  // All-users installs live flat: C:\Program Files\Python314\python.exe.
  for (const dir of sortedPythonDirs(programFiles, 'Python3')) {
    candidates.push(path.join(programFiles, dir, 'python.exe'));
  }
  // The Python launcher.
  candidates.push(path.join(localAppData, 'Programs', 'Python', 'Launcher', 'py.exe'));
  // Conda, if present.
  for (const conda of ['anaconda3', 'miniconda3']) {
    candidates.push(path.join(os.homedir(), conda, 'python.exe'));
  }
  return candidates.filter(Boolean);
}

function sortedPythonDirs(root: string, prefix = 'Python3'): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && new RegExp(`^${prefix}\\d{2,3}$`).test(e.name))
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

function resolve(): string {
  const override = process.env.JARVIS_PYTHON?.trim();
  if (override) return override;

  if (process.platform === 'win32') {
    for (const candidate of pythonCandidatesWin()) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}
