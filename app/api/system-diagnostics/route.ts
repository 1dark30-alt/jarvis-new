import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

function normalizeWindowsCmdPath(raw: string): string {
  return raw.trim().replace(/^["']+|["']+$/g, '');
}

function listWindowsCmdCandidates(): string[] {
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
  return candidates;
}

function firstExistingCmd(): string | null {
  for (const p of listWindowsCmdCandidates()) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function winChildEnv(): NodeJS.ProcessEnv {
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

function probePython(): { ok: boolean; via: string | null; detail: string } {
  if (process.platform !== 'win32') {
    for (const cmd of ['python3', 'python']) {
      try {
        const v = execFileSync(cmd, ['--version'], {
          timeout: 4000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }).toString().trim();
        return { ok: true, via: cmd, detail: v };
      } catch {
        /* next */
      }
    }
    return { ok: false, via: null, detail: 'No python3/python on PATH' };
  }

  const env = winChildEnv();
  for (const args of [['py', ['-3', '--version']], ['python', ['--version']], ['python3', ['--version']]] as const) {
    try {
      const v = execFileSync(args[0], args[1], {
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
        .toString()
        .trim();
      return { ok: true, via: args[0], detail: v };
    } catch {
      /* next */
    }
  }
  return { ok: false, via: null, detail: 'No py -3, python, or python3 found (try a Python path override in Settings → System)' };
}

export async function GET() {
  const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');
  const binaryName = process.platform === 'win32' ? 'computer_use.exe' : 'computer_use';
  const BINARY_PATH = path.join(SCRIPTS_DIR, 'dist', binaryName);
  const SCRIPT_PATH = path.join(SCRIPTS_DIR, 'computer_use.py');

  const isWin = process.platform === 'win32' || process.env.OS === 'Windows_NT';
  let shellResolved: string | null = null;
  if (isWin) {
    shellResolved = firstExistingCmd();
  } else {
    for (const sh of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
      if (fs.existsSync(sh)) {
        shellResolved = sh;
        break;
      }
    }
  }

  const python = probePython();

  return NextResponse.json({
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    pathEnvSet: !!(process.env.Path || process.env.PATH),
    shell: {
      resolvedPath: shellResolved,
      exists: !!(shellResolved && fs.existsSync(shellResolved)),
      candidatesTried: isWin ? listWindowsCmdCandidates() : ['/bin/zsh', '/bin/bash', '/bin/sh'],
    },
    computerUse: {
      scriptsDir: SCRIPTS_DIR,
      scriptsDirExists: fs.existsSync(SCRIPTS_DIR),
      scriptPath: SCRIPT_PATH,
      scriptExists: fs.existsSync(SCRIPT_PATH),
      binaryPath: BINARY_PATH,
      binaryExists: fs.existsSync(BINARY_PATH),
    },
    python,
  });
}
