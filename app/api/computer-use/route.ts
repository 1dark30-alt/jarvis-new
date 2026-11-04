import { NextRequest, NextResponse } from 'next/server';
import { spawn, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

// In production (packaged .app), process.cwd() is the standalone dir which
// contains scripts/dist/computer_use (the PyInstaller binary).
// In development, fall back to calling python3 directly.
const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');

// Use both process.platform and process.env.OS — some Electron-as-Node
// launch environments on Windows have process.platform !== 'win32' even
// though the OS is Windows. process.env.OS is reliably 'Windows_NT' on Windows.
const IS_WINDOWS = process.platform === 'win32' || process.env.OS === 'Windows_NT';

// On Windows we expect the .exe; on other platforms no extension.
// resolveRealBinaryPath() also checks the alternate name so a macOS binary
// that was accidentally cross-bundled is not silently spawned on Windows
// (it would spawn as ENOENT because Windows can't execute a Mach-O binary).
function resolveRealBinaryPath(): string | null {
  const base = path.join(SCRIPTS_DIR, 'dist', 'computer_use');
  if (IS_WINDOWS) {
    if (fs.existsSync(base + '.exe')) return base + '.exe';
    // .exe missing — the macOS binary may be present but is useless on Windows
    return null;
  }
  if (fs.existsSync(base)) return base;
  return null;
}

const BINARY_PATH = path.resolve(
  path.join(SCRIPTS_DIR, 'dist', IS_WINDOWS ? 'computer_use.exe' : 'computer_use')
);
const SCRIPT_PATH = path.resolve(path.join(SCRIPTS_DIR, 'computer_use.py'));

// Candidate Python binaries — used only when the compiled binary is absent.
const PYTHON_CANDIDATES_UNIX = [
  path.join(os.homedir(), 'opt', 'anaconda3', 'bin', 'python3'),
  path.join(os.homedir(), 'anaconda3', 'bin', 'python3'),
  '/opt/anaconda3/bin/python3',
  path.join(os.homedir(), 'opt', 'miniconda3', 'bin', 'python3'),
  path.join(os.homedir(), 'miniconda3', 'bin', 'python3'),
  '/opt/miniconda3/bin/python3',
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  path.join(os.homedir(), '.pyenv', 'shims', 'python3'),
  '/usr/bin/python3',
  'python3',
];

const PYTHON_CANDIDATES_WIN = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
  path.join(os.homedir(), 'anaconda3', 'python.exe'),
  path.join(os.homedir(), 'miniconda3', 'python.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
];

let cachedScriptRunner: { cmd: string; args: string[] } | null = null;

/** Ensures System32 is on Path/PATH so py.exe, python, and where.exe resolve on Windows. */
function processEnvForWinChild(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return process.env;
  const base = process.env.Path || process.env.PATH || '';
  const merged = [
    base,
    'C:\\Windows\\System32',
    'C:\\Windows',
    'C:\\Windows\\System32\\Wbem',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
  ]
    .filter(Boolean)
    .join(';');
  return { ...process.env, Path: merged, PATH: merged };
}

function whereExe(): string {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.join(root, 'System32', 'where.exe');
}

/** First python.exe on PATH (Windows), via where.exe */
function firstPythonFromWhere(name: 'python' | 'python3'): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(whereExe(), [name], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: processEnvForWinChild(),
    });
    const line = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0 && !s.startsWith('INFO:'));
    if (line && fs.existsSync(line)) return line;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolves how to run computer_use.py when the PyInstaller binary is missing.
 * Windows: prefer `py -3`, then `python` / `python3` on PATH, then common install paths.
 * Never return a bare `python3` on Windows without verifying it exists (avoids spawn ENOENT).
 */
function resolveScriptRunner(task: string, apiKey: string): { cmd: string; args: string[] } | null {
  if (cachedScriptRunner) {
    const { cmd } = cachedScriptRunner;
    const baseArgs = cachedScriptRunner.args.slice(0, -2);
    return { cmd, args: [...baseArgs, task, apiKey] };
  }

  const tryCmd = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => {
    try {
      execFileSync(cmd, args, { timeout: 5000, stdio: 'pipe', env: env ?? process.env });
      return true;
    } catch {
      return false;
    }
  };

  if (process.platform === 'win32') {
    const winEnv = processEnvForWinChild();
    if (tryCmd('py', ['-3', '--version'], winEnv)) {
      cachedScriptRunner = { cmd: 'py', args: ['-3', SCRIPT_PATH, task, apiKey] };
      return cachedScriptRunner;
    }
    for (const name of ['python', 'python3'] as const) {
      if (tryCmd(name, ['--version'], winEnv)) {
        cachedScriptRunner = { cmd: name, args: [SCRIPT_PATH, task, apiKey] };
        return cachedScriptRunner;
      }
    }
    for (const name of ['python3', 'python'] as const) {
      const full = firstPythonFromWhere(name);
      if (full && tryCmd(full, ['--version'], winEnv)) {
        cachedScriptRunner = { cmd: full, args: [SCRIPT_PATH, task, apiKey] };
        return cachedScriptRunner;
      }
    }
    for (const candidate of PYTHON_CANDIDATES_WIN) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      try {
        execFileSync(candidate, ['--version'], {
          timeout: 5000,
          stdio: 'pipe',
          env: winEnv,
        });
        cachedScriptRunner = { cmd: candidate, args: [SCRIPT_PATH, task, apiKey] };
        return cachedScriptRunner;
      } catch {
        /* next */
      }
    }
    return null;
  }

  for (const candidate of PYTHON_CANDIDATES_UNIX) {
    if (!candidate) continue;
    try {
      if (candidate !== 'python3' && !fs.existsSync(candidate)) continue;
      execFileSync(candidate, ['--version'], { timeout: 3000, stdio: 'pipe' });
      cachedScriptRunner = { cmd: candidate, args: [SCRIPT_PATH, task, apiKey] };
      return cachedScriptRunner;
    } catch {
      /* next */
    }
  }

  return null;
}

const MISSING_HELPER_MSG =
  'Computer Use could not start. Either install Python 3 for Windows (from python.org — enable "Add python.exe to PATH") and restart Jarvis, or rebuild the app on Windows with `npm run build:python` so scripts/dist/computer_use.exe is bundled.';

function run(
  task: string,
  apiKey: string,
  pythonPathOverride: string | null
): Promise<{ result?: string; turns?: number; error?: string }> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];

    const realBinaryPath = resolveRealBinaryPath();

    if (pythonPathOverride) {
      if (!fs.existsSync(SCRIPT_PATH)) {
        resolve({
          error: `${MISSING_HELPER_MSG} (Missing script: ${SCRIPT_PATH})`,
        });
        return;
      }
      cmd = pythonPathOverride;
      args = [SCRIPT_PATH, task, apiKey];
      console.log('[computer-use] Using Python path from settings:', cmd);
    } else if (realBinaryPath) {
      // Self-contained binary — no Python needed on the user's machine
      cmd = realBinaryPath;
      args = [task, apiKey];
      console.log('[computer-use] Using bundled binary:', realBinaryPath);
    } else {
      if (!fs.existsSync(SCRIPT_PATH)) {
        resolve({
          error: `${MISSING_HELPER_MSG} (Missing script: ${SCRIPT_PATH})`,
        });
        return;
      }
      const resolved = resolveScriptRunner(task, apiKey);
      if (!resolved) {
        const winNote = IS_WINDOWS
          ? ` On Windows, computer_use.exe was not found at ${BINARY_PATH} — the Windows build requires running 'npm run build:python' on a Windows machine before packaging.`
          : '';
        resolve({
          error: `${MISSING_HELPER_MSG}${winNote}`,
        });
        return;
      }
      cmd = resolved.cmd;
      args = resolved.args;
      console.log('[computer-use] Falling back to Python:', cmd);
    }

    const proc = spawn(cmd, args, {
      cwd: SCRIPTS_DIR,
      windowsHide: process.platform === 'win32',
      env: process.platform === 'win32' ? processEnvForWinChild() : process.env,
    });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      process.stdout.write(d.toString());
    });

    proc.on('close', () => {
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({ error: stderr || 'Failed to parse output', result: stdout });
      }
    });

    proc.on('error', (err) => {
      resolve({ error: err.message });
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { task, apiKey, pythonPathOverride } = body as {
      task?: string;
      apiKey?: string;
      pythonPathOverride?: string | null;
    };
    if (!task) return NextResponse.json({ error: 'Missing task' }, { status: 400 });
    if (!apiKey) return NextResponse.json({ error: 'Missing apiKey' }, { status: 400 });

    let pyOverride: string | null = null;
    if (typeof pythonPathOverride === 'string' && pythonPathOverride.trim()) {
      const p = pythonPathOverride.trim();
      if (!fs.existsSync(p)) {
        return NextResponse.json(
          { error: `Computer Use: Python executable not found at "${p}"` },
          { status: 400 }
        );
      }
      pyOverride = p;
    }

    const result = await run(task, apiKey, pyOverride);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
