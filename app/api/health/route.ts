import { NextResponse } from 'next/server';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { geminiAvailable } from '../../lib/server/geminiLadder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Health — Mark 58's platform_health idea: what is actually true on this
 * machine right now, with no model call needed. Machine gauges + service
 * checks, so "the assistant does not answer" has a first place to look.
 */

async function diskUsage(drive: string): Promise<{ total: number; free: number }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await (fsp as any).statfs(drive.endsWith(':') ? drive + '\\' : drive);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bfree) * Number(s.bsize);
    if (total > 0) return { total, free };
  } catch { /* fall through to PowerShell */ }
  if (os.platform() !== 'win32') return { total: 0, free: 0 };
  try {
    const { execFile } = await import('node:child_process');
    const out = await new Promise<string>((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_LogicalDisk | Where-Object {$_.Size} | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress`],
        { timeout: 8000, windowsHide: true }, (e, stdout) => resolve(e ? '' : String(stdout)));
    });
    const arr = JSON.parse(out) as { DeviceID: string; Size: number; FreeSpace: number }[];
    const one = Array.isArray(arr) ? arr : [arr];
    const d = one.find((x) => x.DeviceID?.toUpperCase().startsWith(drive.charAt(0)));
    return d ? { total: d.Size, free: d.FreeSpace } : { total: 0, free: 0 };
  } catch {
    return { total: 0, free: 0 };
  }
}

function cpuLoadSample(ms = 120): Promise<number> {
  const cpus = os.cpus();
  const times = () => cpus.map((c) => c.times).reduce((a, t) => ({ user: a.user + t.user, idle: a.idle + t.idle }), { user: 0, idle: 0 });
  const first = times();
  return new Promise((resolve) => {
    setTimeout(() => {
      // os.cpus() re-reads on call in Node — sample again.
      const second = os.cpus().map((c) => c.times).reduce((a, t) => ({ user: a.user + t.user, idle: a.idle + t.idle }), { user: 0, idle: 0 });
      const du = second.user - first.user;
      const di = second.idle - first.idle;
      const total = du + di;
      resolve(total > 0 ? du / total : 0);
    }, ms);
  });
}

function fileOk(name: string): { name: string; ok: boolean; detail: string } {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  const p = path.join(base, name);
  if (!fs.existsSync(p)) return { name, ok: true, detail: 'not created yet' };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const count = Array.isArray(parsed) ? parsed.length
      : Array.isArray(parsed.routines) ? parsed.routines.length
      : Array.isArray(parsed.missions) ? parsed.missions.length
      : Object.keys(parsed).length;
    return { name, ok: true, detail: `${count} entries` };
  } catch (e) {
    return { name, ok: false, detail: `unreadable: ${String(e).slice(0, 80)}` };
  }
}

export async function GET() {
  const cpu = await cpuLoadSample();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disks: { drive: string; total: number; free: number }[] = [];
  for (const drive of os.platform() === 'win32' ? ['C:', 'D:'] : ['/']) {
    try {
      await fs.promises.access(drive.endsWith(':') ? drive + '\\' : drive);
      disks.push({ drive, ...(await diskUsage(drive)) });
    } catch { /* no such drive */ }
  }

  const brainGemini = geminiAvailable();
  let localModel = { configured: false, reachable: false };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.env.JARVIS_DATA_DIR || process.cwd(), 'jarvis-server-settings.json'), 'utf8')) as Record<string, unknown>;
    const s = JSON.parse(String(raw.jarvis_settings ?? '{}')) as Record<string, unknown>;
    const url = String(s.localLlmUrl ?? '').trim();
    const model = String(s.localLlmModel ?? '').trim();
    localModel = { configured: Boolean(url && model), reachable: false };
    if (localModel.configured) {
      try {
        const base = url.replace(/\/$/, '');
        const res = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${String(s.localLlmApiKey ?? '')}` },
          signal: AbortSignal.timeout(4000),
        });
        localModel.reachable = res.ok;
      } catch { /* unreachable */ }
    }
  } catch { /* no settings file */ }

  return NextResponse.json({
    machine: {
      cpuLoad: cpu,
      cores: os.cpus().length,
      memUsed: totalMem - freeMem,
      memTotal: totalMem,
      uptimeSeconds: Math.round(os.uptime()),
      platform: `${os.type()} ${os.release()}`,
      hostname: os.hostname(),
      serverUptimeSeconds: Math.round(process.uptime()),
    },
    disks,
    services: {
      geminiLadder: { ok: brainGemini, detail: brainGemini ? 'key configured — text ladder armed' : 'no Gemini key — using local model' },
      localModel,
      stores: [
        fileOk('jarvis-memory.json'),
        fileOk('routines.json'),
        fileOk('missions.json'),
        fileOk('jarvis-server-settings.json'),
      ],
    },
  });
}