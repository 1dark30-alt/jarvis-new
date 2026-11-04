import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const TIMEOUT_MS = 30_000;

/** Strip quotes and stray whitespace — broken ComSpec values break fs.existsSync on Windows. */
function normalizeWindowsCmdPath(raw: string): string {
  return raw.trim().replace(/^["']+|["']+$/g, '');
}

/**
 * Resolve cmd.exe: ComSpec can be missing, point at non-existent paths, or contain
 * unexpanded %VAR% placeholders in some launcher environments — all of which caused
 * resolveShell to fall through to /bin/bash (ENOENT on stock Windows).
 */
function resolveWindowsCmd(command: string): { shell: string; args: string[] } | null {
  const candidates: string[] = [];
  const com = process.env.ComSpec && normalizeWindowsCmdPath(process.env.ComSpec);
  if (com && !/%[^%]+%/.test(com)) {
    candidates.push(com);
  }
  const root = process.env.SystemRoot || process.env.windir || '';
  const normalizedRoot = root && !/%[^%]+%/.test(root) ? root : '';
  if (normalizedRoot) {
    candidates.push(
      path.join(normalizedRoot, 'System32', 'cmd.exe'),
      path.join(normalizedRoot, 'Sysnative', 'cmd.exe')
    );
  }
  candidates.push('C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\Sysnative\\cmd.exe');

  for (const shell of candidates) {
    if (shell && fs.existsSync(shell)) {
      return { shell, args: ['/d', '/s', '/c', command] };
    }
  }
  return null;
}

/**
 * Pick a real shell binary. On Windows use cmd only. On macOS/Linux, only spawn shells
 * that exist under /bin. If nothing POSIX is available but cmd.exe exists (odd runtimes),
 * fall back to cmd so we never spawn /bin/bash on a plain Windows system.
 *
 * Optional `shellPathOverride` from Settings → System: full path to cmd.exe, PowerShell,
 * or zsh/bash (macOS/Linux).
 */
function resolveShell(
  command: string,
  shellPathOverride?: string | null
): { shell: string; args: string[]; isWin: boolean } {
  const trimmed =
    typeof shellPathOverride === 'string' ? shellPathOverride.trim() : '';
  if (trimmed && fs.existsSync(trimmed)) {
    const base = path.basename(trimmed).toLowerCase();
    const isWindows = process.platform === 'win32' || process.env.OS === 'Windows_NT';
    if (isWindows) {
      if (base === 'pwsh.exe' || base.includes('powershell')) {
        return {
          shell: trimmed,
          args: ['-NoProfile', '-NonInteractive', '-Command', command],
          isWin: true,
        };
      }
      return { shell: trimmed, args: ['/d', '/s', '/c', command], isWin: true };
    }
    if (base === 'sh' || base === 'dash') {
      return { shell: trimmed, args: ['-c', command], isWin: false };
    }
    return { shell: trimmed, args: ['-lc', command], isWin: false };
  }

  const platform = process.platform;
  const isWindows = platform === 'win32' || process.env.OS === 'Windows_NT';

  if (isWindows) {
    const w = resolveWindowsCmd(command);
    if (w) return { ...w, isWin: true };
  }

  const candidates: Array<{ shell: string; args: string[] }> = [];
  if (platform === 'darwin' && fs.existsSync('/bin/zsh')) {
    candidates.push({ shell: '/bin/zsh', args: ['-lc', command] });
  }
  if (fs.existsSync('/bin/bash')) {
    candidates.push({ shell: '/bin/bash', args: ['-lc', command] });
  }
  if (fs.existsSync('/bin/sh')) {
    candidates.push({ shell: '/bin/sh', args: ['-c', command] });
  }
  if (candidates.length > 0) {
    return { ...candidates[0], isWin: false };
  }

  const w = resolveWindowsCmd(command);
  if (w) {
    console.warn(`[shell] No POSIX shell in /bin; using cmd.exe (platform=${platform})`);
    return { ...w, isWin: true };
  }

  if (platform === 'darwin') {
    return { shell: '/bin/zsh', args: ['-lc', command], isWin: false };
  }
  // Never use /bin/bash on Windows — cmd was already tried via resolveWindowsCmd.
  if (platform === 'win32' || process.env.OS === 'Windows_NT') {
    console.error('[shell] cmd.exe could not be resolved; check ComSpec / SystemRoot');
    return {
      shell: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', command],
      isWin: true,
    };
  }
  return { shell: '/bin/bash', args: ['-lc', command], isWin: false };
}

function runCommand(
  command: string,
  shellPathOverride?: string | null
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  platform: string;
}> {
  return new Promise((resolve) => {
    const platform = process.platform;
    const overrideTrim =
      typeof shellPathOverride === 'string' ? shellPathOverride.trim() : '';
    if (overrideTrim && !fs.existsSync(overrideTrim)) {
      resolve({
        stdout: '',
        stderr: `Shell path override not found: ${overrideTrim}`,
        exitCode: 127,
        platform,
      });
      return;
    }

    const { shell, args, isWin } = resolveShell(command, shellPathOverride);

    console.log(`[shell] platform=${platform} shell=${shell}`);

    const winPathFragments = [
      process.env.Path || process.env.PATH,
      'C:\\Windows\\System32',
      'C:\\Windows',
      'C:\\Windows\\System32\\Wbem',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
    ];

    const env = isWin
      ? {
          ...process.env,
          // Windows reads Path or PATH depending on tooling — set both.
          Path: winPathFragments.filter(Boolean).join(';'),
          PATH: winPathFragments.filter(Boolean).join(';'),
        }
      : {
          ...process.env,
          PATH: [
            process.env.PATH,
            '/opt/homebrew/bin',
            '/opt/homebrew/sbin',
            '/opt/anaconda3/bin',
            '/usr/local/bin',
          ]
            .filter(Boolean)
            .join(':'),
        };

    const proc = spawn(shell, args, {
      env,
      ...(isWin && {
        windowsHide: true,
        cwd:
          process.env.USERPROFILE ||
          (process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\'),
      }),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({
        stdout: stdout.trim(),
        stderr: `Command timed out after ${TIMEOUT_MS / 1000}s`,
        exitCode: 124,
        platform,
      });
    }, TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
        platform,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: 1, platform });
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { command, shellPathOverride } = body as {
      command?: string;
      shellPathOverride?: string | null;
    };
    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid command' }, { status: 400 });
    }

    console.log(`[shell] Running: ${command}`);
    const result = await runCommand(command, shellPathOverride);
    console.log(`[shell] Exit ${result.exitCode} | stdout: ${result.stdout.slice(0, 200)}`);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
