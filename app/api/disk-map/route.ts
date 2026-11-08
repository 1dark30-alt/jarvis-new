import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * Disk Map — what is taking the space on a drive or folder, as a live,
 * clickable treemap. Port of the JARVIS-system _disk_map_core.py scanner.
 *
 * The scan only stats; it never opens a file, so OneDrive cloud-only
 * placeholders are never hydrated. Junctions and symbolic links are not
 * followed (their target is counted where it really lives, once).
 *
 *   op=drives              -> available drive roots with disk usage
 *   op=scan&path=...       -> SSE stream; every top-level item lands as soon
 *                             as its size is known, so the map grows live
 *   op=expand&path=...     -> one level of a folder, each child fully sized
 *   op=reveal&path=...     -> show the file in Windows Explorer
 */

// Same extension table as the original scanner — index is the category.
const CAT_NAMES = [
  'VIDEO', 'IMAGES', 'AUDIO', 'ARCHIVES', 'PROGRAMS', 'DOCUMENTS', 'CODE & DEV',
] as const;

const EXT_TABLE: Record<string, number> = {};
for (let c = 0; c < CAT_NAMES.length; c++) {
  const names = [
    'mp4 mkv avi mov wmv flv webm m4v mpg mpeg ts m2ts mts 3gp vob ogv',
    'jpg jpeg png gif bmp tif tiff webp heic heif raw cr2 cr3 nef arw dng psd svg ico tga exr hdr avif',
    'mp3 wav flac aac ogg m4a wma opus aiff aif mid midi',
    'zip rar 7z tar gz tgz bz2 xz zst iso img cab dmg wim esd vhd vhdx vmdk',
    'exe dll sys msi msp msix appx ocx drv so dylib lib jar apk cpl mui efi',
    'pdf doc docx xls xlsx ppt pptx txt rtf odt ods odp csv md epub one',
    'py pyc pyd js mjs cjs ts tsx jsx json xml html htm css c cc cpp h hpp cs java class go rs rb php lua sh ps1 bat ipynb whl pdb obj o a map',
  ][c].split(' ');
  for (const e of names) EXT_TABLE[e] = c;
}

function categoryOf(name: string): number {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return 7; // OTHER
  return EXT_TABLE[name.slice(dot + 1).toLowerCase()] ?? 7;
}

const isWin = os.platform() === 'win32';

/** Long-path prefix so Windows answers beyond 260 characters. */
function ioPath(p: string): string {
  const abs = path.resolve(p);
  if (isWin && !abs.startsWith('\\\\?\\') && !abs.startsWith('\\\\')) {
    return '\\\\?\\' + abs;
  }
  return abs;
}

type FileStat = { size: number; cat: number };

/** stat without opening — safe for OneDrive placeholders (no hydration). */
async function statFile(full: string): Promise<FileStat | null> {
  try {
    const st = await fsp.lstat(full);
    if (st.isSymbolicLink()) return null;
    return { size: st.isFile() ? st.size : 0, cat: 0 };
  } catch {
    return null;
  }
}

/** Semaphore-bounded folder walk that returns {size, files}. */
function makeWalker(limit: number) {
  let active = 0;
  const waiters: (() => void)[] = [];

  function acquire(): Promise<void> {
    if (active < limit) { active++; return Promise.resolve(); }
    return new Promise((res) => waiters.push(res));
  }
  function release() {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }

  async function walk(dir: string): Promise<{ size: number; files: number; catBytes: number[] }> {
    let size = 0;
    let files = 0;
    const catBytes = new Array<number>(8).fill(0);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(ioPath(dir), { withFileTypes: true });
    } catch {
      return { size: 0, files: 0, catBytes: [] };
    }
    const dirs: string[] = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // junctions & symlinks are not followed
      const full = path.join(dir, e.name);
      if (e.isDirectory()) dirs.push(full);
      else {
        try {
          const st = await fsp.lstat(ioPath(full));
          if (st.isFile()) {
            size += st.size;
            files++;
            catBytes[categoryOf(e.name)] += st.size;
          }
        } catch { /* unreadable — skipped */ }
      }
    }
    // Walk subfolders with bounded concurrency.
    let i = 0;
    const runners = Array.from({ length: Math.min(limit, dirs.length) }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= dirs.length) return;
        await acquire();
        try {
          const r = await walk(dirs[idx]);
          size += r.size;
          files += r.files;
          for (let c = 0; c < 8; c++) catBytes[c] += r.catBytes[c];
        } finally {
          release();
        }
      }
    });
    await Promise.all(runners);
    return { size, files, catBytes };
  }

  return walk;
}

type DiskUsage = { used: number; total: number; free: number };

async function diskUsage(p: string): Promise<DiskUsage> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await (fsp as any).statfs(ioPath(p));
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bfree) * Number(s.bsize);
    if (total > 0) return { total, free, used: total - free };
    throw new Error('statfs unsupported');
  } catch {
    if (!isWin) return { total: 0, free: 0, used: 0 };
    // Windows fallback: GetDiskFreeSpaceExW via PowerShell.
    const drive = p.slice(0, 2); // "C:"
    try {
      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command',
            `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'" | Select-Object Size,FreeSpace | ConvertTo-Json -Compress)`],
          { timeout: 8000, windowsHide: true },
          (err, stdout) => (err ? reject(err) : resolve({ stdout: String(stdout) }))
        );
      });
      const j = JSON.parse(stdout) as { Size?: number; FreeSpace?: number };
      const total = Number(j.Size ?? 0);
      const free = Number(j.FreeSpace ?? 0);
      return { total, free, used: Math.max(0, total - free) };
    } catch {
      return { total: 0, free: 0, used: 0 };
    }
  }
}

async function listDrives() {
  const drives: { path: string; total: number; free: number; used: number }[] = [];
  const roots = isWin
    ? Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`)
    : ['/'];
  await Promise.all(roots.map(async (root) => {
    try {
      await fsp.access(root);
      const usage = await diskUsage(root);
      drives.push({ path: root, ...usage });
    } catch { /* no such drive */ }
  }));
  return drives;
}

/** SSE scan of `root`: every top-level item lands as soon as it is counted. */
async function scanStream(root: string): Promise<Response> {
  const encoder = new TextEncoder();
  const walk = makeWalker(8);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); }
        catch { /* client gone */ }
      };

      const top = path.resolve(root);
      send({ type: 'start', path: top, disk: await diskUsage(top) });
      const t0 = Date.now();
      let scanned = 0;
      let errors = 0;

      let entries: import('node:fs').Dirent[];
      try {
        entries = await fsp.readdir(ioPath(top), { withFileTypes: true });
      } catch (e) {
        send({ type: 'error', error: `Cannot read ${top}: ${String(e)}` });
        controller.close();
        return;
      }

      const folders = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink());
      const files = entries.filter((e) => e.isFile());

      // Files land immediately.
      for (const f of files) {
        const full = path.join(top, f.name);
        const st = await statFile(full);
        if (!st) { errors++; continue; }
        scanned += st.size;
        send({
          type: 'item', kind: 'file', name: f.name, path: full,
          size: st.size, cat: categoryOf(f.name), files: 1,
        });
      }

      // Folders stream in as each walk finishes.
      let done = 0;
      await Promise.all(folders.map(async (d) => {
        const full = path.join(top, d.name);
        const r = await walk(full);
        done++;
        scanned += r.size;
        let cat = 7;
        let best = -1;
        for (let c = 0; c < 8; c++) if (r.catBytes[c] > best) { best = r.catBytes[c]; cat = c; }
        send({
          type: 'item', kind: 'folder', name: d.name, path: full,
          size: r.size, files: r.files, cat, done, of: folders.length,
        });
      }));

      send({ type: 'done', scanned, errors, seconds: (Date.now() - t0) / 1000 });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  });
}

/** One level of `dir`, every child fully sized. */
async function expand(dir: string) {
  const walk = makeWalker(8);
  const top = path.resolve(dir);
  const disk = await diskUsage(top);
  const items: {
    kind: 'folder' | 'file'; name: string; path: string;
    size: number; files: number; cat: number;
  }[] = [];

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fsp.readdir(ioPath(top), { withFileTypes: true });
  } catch (e) {
    return NextResponse.json({ error: `Cannot read ${top}: ${String(e)}`, path: top }, { status: 400 });
  }

  await Promise.all(entries.map(async (e) => {
    if (e.isSymbolicLink()) return;
    const full = path.join(top, e.name);
    if (e.isDirectory()) {
      const r = await walk(full);
      let cat = 7;
      let best = -1;
      for (let c = 0; c < 8; c++) if (r.catBytes[c] > best) { best = r.catBytes[c]; cat = c; }
      items.push({ kind: 'folder', name: e.name, path: full, size: r.size, files: r.files, cat });
    } else if (e.isFile()) {
      try {
        const st = await fsp.lstat(ioPath(full));
        items.push({ kind: 'file', name: e.name, path: full, size: st.size, files: 1, cat: categoryOf(e.name) });
      } catch { /* skipped */ }
    }
  }));

  items.sort((a, b) => b.size - a.size);
  return NextResponse.json({ path: top, disk, items });
}

function reveal(target: string) {
  if (isWin) {
    spawn('explorer.exe', ['/select,', path.resolve(target)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return NextResponse.json({ success: true });
  }
  const cmd = os.platform() === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [path.resolve(target)], { timeout: 5000 }, () => {});
  return NextResponse.json({ success: true });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const op = params.get('op') ?? 'drives';

  try {
    if (op === 'drives') return NextResponse.json({ drives: await listDrives() });
    if (op === 'scan') {
      const p = params.get('path');
      if (!p) return NextResponse.json({ error: 'Missing path' }, { status: 400 });
      return await scanStream(p);
    }
    if (op === 'expand') {
      const p = params.get('path');
      if (!p) return NextResponse.json({ error: 'Missing path' }, { status: 400 });
      return await expand(p);
    }
    if (op === 'reveal') {
      const p = params.get('path');
      if (!p) return NextResponse.json({ error: 'Missing path' }, { status: 400 });
      return reveal(p);
    }
    return NextResponse.json({ error: `Unknown op: ${op}` }, { status: 400 });
  } catch (err) {
    console.error('[disk-map]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}