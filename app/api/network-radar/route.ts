import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Network Radar — who is on the network and how good the connection is.
 * Port of the useful core of Mark 58's `_network_radar_core.py` (its 2.9k
 * lines are mostly a PyQt radar UI): the ARP table for devices, a quick
 * ping sweep to wake the table up, an OUI vendor lookup, known-device
 * memory so strangers stand out, and gateway/internet latency samples.
 */

const LIMIT_MS = 15_000;

function sh(cmd: string, timeoutMs = LIMIT_MS): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      resolve(err && !stdout ? '' : String(stdout ?? ''));
    });
  });
}

// A compact vendor table — the OUI prefixes this radar actually meets on
// home and office networks. Full IEEE databases are megabytes; this is what
// a radar is for at a glance.
const OUI: Record<string, string> = {
  '3c:5a:b4': 'Google', '30:ae:a4': 'Espressif', '54:2a:1b': 'Espressif',
  '00:1a:11': 'Google', 'f4:f5:d8': 'Google', 'dc:a6:32': 'Raspberry Pi',
  'b8:27:eb': 'Raspberry Pi', 'e4:5f:01': 'Raspberry Pi', 'd8:3a:dd': 'Raspberry Pi',
  '00:17:88': 'Philips Hue', 'ec:1b:bd': 'LIFX', 'ac:de:48': 'Private',
  '00:50:f2': 'Microsoft', '7c:d1:c3': 'Asus', '04:d4:c4': 'Asus',
  '00:1b:63': 'Apple', 'ac:bc:32': 'Apple', 'f0:18:98': 'Apple',
  'a4:83:e7': 'Apple', 'dc:2b:2a': 'Apple', '50:32:37': 'Apple',
  '84:66:e8': 'Intel', '9c:b6:d0': 'Intel', '98:4f:ee': 'Intel',
  '44:85:00': 'Intel', 'a0:a8:cd': 'Intel', '3c:97:0e': 'Wistron',
  '00:1e:64': 'D-Link', '34:08:04': 'D-Link', 'c8:d3:a3': 'D-Link',
  '00:26:5a': 'Delta', '20:dc:e6': 'Xiaomi', '64:09:80': 'Xiaomi',
  '78:11:dc': 'Xiaomi', 'f8:a4:5f': 'Cameo', '44:74:6c': 'Hon Hai',
  '8c:85:90': 'TP-Link', '50:c7:bf': 'TP-Link', 'ac:84:c6': 'TP-Link',
  'b0:4e:26': 'Espressif', 'bc:dd:c2': 'Espressif', '68:c6:3a': 'Espressif',
  '2c:cf:67': 'Espressif', '40:9f:38': 'AzureWave', '00:0c:29': 'VMware',
  '00:05:69': 'VMware', '08:00:27': 'VirtualBox', '52:54:00': 'QEMU',
  '00:15:5d': 'Hyper-V', 'f8:1a:67': 'Hon Hai', '24:4b:fe': 'ASRock',
  '0c:9d:9e': 'ASUS', '74:4c:a1': 'AzureWave', '90:09:d0': 'Hon Hai',
};

function vendorFor(mac: string): string {
  const prefix = mac.toLowerCase().slice(0, 8);
  return OUI[prefix] ?? 'Unknown maker';
}

interface Device { ip: string; mac: string; vendor: string; isNew: boolean; firstSeen: string | null; lastSeen: string }

function storeFile(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'network-devices.json');
}

function loadKnown(): Record<string, { firstSeen: string; lastSeen: string }> {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as Record<string, { firstSeen: string; lastSeen: string }>;
  } catch {
    return {};
  }
}

function saveKnown(known: Record<string, { firstSeen: string; lastSeen: string }>): void {
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(known, null, 2), 'utf8');
  } catch { /* best effort */ }
}

function parseArp(text: string): { ip: string; mac: string }[] {
  const out: { ip: string; mac: string }[] = [];
  for (const line of text.split('\n')) {
    // Windows: "  192.168.1.23        a4-83-e7-...     dynamic"
    const m = /\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:-]{11,17})\s+\S+/.exec(line);
    if (!m) continue;
    const mac = m[2].toLowerCase().replace(/-/g, ':');
    if (mac === 'ff:ff:ff:ff:ff:ff' || mac.startsWith('00:00:00')) continue;
    if (/\.255$/.test(m[1])) continue;
    out.push({ ip: m[1], mac });
  }
  return out;
}

function localSubnet(): string | null {
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (i.address.startsWith('169.254.') || i.address.startsWith('127.')) continue;
      const parts = i.address.split('.');
      if (parts.length !== 4) continue;
      return `${parts[0]}.${parts[1]}.${parts[2]}.`;
    }
  }
  return null;
}

/** Quick ping sweep to populate the ARP table — bounded concurrency. */
async function pingSweep(subnet: string): Promise<void> {
  const targets: string[] = [];
  for (let i = 1; i <= 254; i++) targets.push(`${subnet}${i}`);
  const isWin = os.platform() === 'win32';
  let index = 0;
  const workers = Array.from({ length: 32 }, async () => {
    for (;;) {
      const i = index++;
      if (i >= targets.length) return;
      await new Promise<void>((resolve) => {
        exec(isWin ? `ping -n 1 -w 150 ${targets[i]}` : `ping -c 1 -W 1 ${targets[i]}`,
          { timeout: 4000, windowsHide: true }, () => resolve());
      });
    }
  });
  await Promise.all(workers);
}

function pingSamples(host: string, count = 5): Promise<{ avgMs: number | null; lossPct: number }> {
  const isWin = os.platform() === 'win32';
  return new Promise((resolve) => {
    exec(isWin ? `ping -n ${count} -w 2000 ${host}` : `ping -c ${count} -W 2 ${host}`,
      { timeout: (count + 2) * 3000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
        const text = String(stdout ?? '');
        const times = [...text.matchAll(/(?:time|time[=<])=?(\d+)ms/gi)].map((m) => Number(m[1]));
        const lossMatch = /(\d+)(?:%| percent)[^\n]*loss|lost = (\d+)/i.exec(text);
        const sent = count;
        const lossPct = times.length ? Math.round((1 - times.length / sent) * 100)
          : lossMatch ? 100 : 100;
        resolve({ avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null, lossPct });
      });
  });
}

function gatewayIp(): string | null {
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      // Skip link-local (169.254.x.x) and loopback — pick a real routed subnet.
      if (i.address.startsWith('169.254.') || i.address.startsWith('127.')) continue;
      const parts = i.address.split('.');
      return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const op = req.nextUrl.searchParams.get('op') ?? 'scan';

  if (op === 'quality') {
    const gw = gatewayIp() ?? '1.1.1.1';
    const [gwPing, netPing] = await Promise.all([pingSamples(gw), pingSamples('1.1.1.1')]);
    return NextResponse.json({
      gateway: { ip: gw, ...gwPing },
      internet: { host: '1.1.1.1', ...netPing },
    });
  }

  if (op === 'scan') {
    const subnet = localSubnet();
    if (subnet) await pingSweep(subnet); // wakes ARP for silent devices
    const arpText = await sh(os.platform() === 'win32' ? 'arp -a' : 'arp -a');
    // Only the local subnet: the raw table is full of multicast (224+/239+)
    // and virtual adapters (Hyper-V, Docker) that are not "someone on my Wi-Fi".
    const found = parseArp(arpText).filter((d) => !subnet || d.ip.startsWith(subnet));
    const known = loadKnown();
    const now = new Date().toISOString();
    const devices: Device[] = found.map(({ ip, mac }) => {
      const prior = known[mac];
      known[mac] = { firstSeen: prior?.firstSeen ?? now, lastSeen: now };
      return {
        ip, mac,
        vendor: vendorFor(mac),
        isNew: !prior,
        firstSeen: prior?.firstSeen ?? null,
        lastSeen: now,
      };
    });
    saveKnown(known);
    devices.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    return NextResponse.json({ ok: true, subnet, devices, total: devices.length, knownBefore: Object.keys(known).length - devices.length });
  }

  return NextResponse.json({ error: `Unknown op: ${op}` }, { status: 400 });
}