import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Obsidian Vault — port of Mark 58's `obsidian_vault.py`: read, search and
 * write the user's Obsidian vault by voice. The vault path is a per-user
 * setting; everything is plain markdown on disk, so no Obsidian app or API
 * is needed — only the folder.
 */

const VAULT_KEY = 'obsidian_vault_path';
const MAX_SEARCH_HITS = 12;

function settingsFile(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'jarvis-server-settings.json');
}

function vaultPath(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
    // The vault path lives with the other user settings inside jarvis_settings.
    let p = String(raw[VAULT_KEY] ?? '').trim();
    if (!p && typeof raw.jarvis_settings === 'string') {
      const inner = JSON.parse(raw.jarvis_settings) as Record<string, unknown>;
      p = String(inner[VAULT_KEY] ?? '').trim();
    }
    return p && fs.existsSync(p) ? p : '';
  } catch {
    return '';
  }
}

function safeVaultFile(rel: string): string | null {
  const vault = vaultPath();
  if (!vault) return null;
  const resolved = path.resolve(vault, rel.replace(/^([a-zA-Z]:)?[\\/]+/, ''));
  if (!resolved.toLowerCase().startsWith(vault.toLowerCase() + path.sep) && path.resolve(resolved) !== path.resolve(vault)) {
    return null; // outside the vault — refuse
  }
  return resolved;
}

function listVault(vault: string): { folders: { name: string; notes: number }[]; totalNotes: number } {
  const folders: { name: string; notes: number }[] = [];
  let total = 0;
  const walk = (dir: string, rel: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    let notesHere = 0;
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, rel ? `${rel}/${e.name}` : e.name, depth + 1);
      else if (e.name.toLowerCase().endsWith('.md')) { notesHere++; total++; }
    }
    if (depth <= 1 && notesHere) folders.push({ name: rel || path.basename(vault), notes: notesHere });
  };
  walk(vault, '', 0);
  return { folders: folders.sort((a, b) => b.notes - a.notes), totalNotes: total };
}

function searchVault(vault: string, query: string): { file: string; line: number; text: string }[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const hits: { file: string; line: number; text: string; score: number }[] = [];
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const relName = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(full, relName); continue; }
      if (!e.name.toLowerCase().endsWith('.md')) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const lower = lines[i].toLowerCase();
          let score = 0;
          for (const t of terms) if (lower.includes(t)) score += lower.startsWith('#') ? 2 : 1;
          if (score > 0) {
            hits.push({ file: relName, line: i + 1, text: lines[i].trim().slice(0, 200), score });
            if (hits.length > 400) return;
          }
        }
      } catch { /* skip unreadable */ }
    }
  };
  walk(vault, '');
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, MAX_SEARCH_HITS).map(({ file, line, text }) => ({ file, line, text }));
}

export async function GET() {
  const vault = vaultPath();
  if (!vault) {
    return NextResponse.json({ configured: false, message: 'No vault configured. Set the path to your Obsidian vault folder.' });
  }
  return NextResponse.json({ configured: true, path: vault, ...listVault(vault) });
}

export async function POST(req: NextRequest) {
  try {
    const a = (await req.json()) as Record<string, unknown>;
    const op = String(a.op ?? '').trim().toLowerCase();

    if (op === 'set_path') {
      const p = path.resolve(String(a.path ?? '').trim());
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
        return NextResponse.json({ error: `No such folder: ${p}` }, { status: 400 });
      }
      const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
      if (typeof raw.jarvis_settings === 'string') {
        const inner = JSON.parse(raw.jarvis_settings) as Record<string, unknown>;
        inner[VAULT_KEY] = p;
        raw.jarvis_settings = JSON.stringify(inner);
      } else {
        raw[VAULT_KEY] = p;
      }
      fs.writeFileSync(settingsFile(), JSON.stringify(raw, null, 2), 'utf8');
      return NextResponse.json({ ok: true, path: p, ...listVault(p) });
    }

    const vault = vaultPath();
    if (!vault) return NextResponse.json({ error: 'No vault configured. Set the vault path first.' }, { status: 400 });

    switch (op) {
      case 'list':
        return NextResponse.json({ ok: true, path: vault, ...listVault(vault) });

      case 'search':
        return NextResponse.json({ ok: true, results: searchVault(vault, String(a.query ?? '')) });

      case 'read': {
        const file = safeVaultFile(String(a.file ?? ''));
        if (!file || !fs.existsSync(file)) return NextResponse.json({ error: `No such note in the vault.` }, { status: 404 });
        const content = await fsp.readFile(file, 'utf8');
        return NextResponse.json({ ok: true, file: path.relative(vault, file), content: content.slice(0, 20_000) });
      }

      case 'create': {
        const title = String(a.title ?? '').trim();
        if (!title) return NextResponse.json({ error: 'A note title is required.' }, { status: 400 });
        const file = safeVaultFile(`${title}.md`);
        if (!file) return NextResponse.json({ error: 'Invalid note path.' }, { status: 400 });
        if (fs.existsSync(file)) return NextResponse.json({ error: `Note "${title}.md" already exists.` }, { status: 409 });
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const body = String(a.content ?? '').trim();
        const content = `# ${title}\n\n${body}\n`.replace(/\n{3,}/g, '\n\n');
        await fsp.writeFile(file, content, 'utf8');
        return NextResponse.json({ ok: true, file: path.relative(vault, file) });
      }

      case 'write': {
        // Write/update any text file inside the vault (confined).
        const file = safeVaultFile(String(a.file ?? ''));
        if (!file) return NextResponse.json({ error: 'Invalid file path.' }, { status: 400 });
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, String(a.content ?? ''), 'utf8');
        return NextResponse.json({ ok: true, file: path.relative(vault, file) });
      }

      case 'append': {
        const file = safeVaultFile(String(a.file ?? ''));
        if (!file || !fs.existsSync(file)) return NextResponse.json({ error: 'No such note in the vault.' }, { status: 404 });
        const text = String(a.text ?? '').trim();
        if (!text) return NextResponse.json({ error: 'Nothing to append.' }, { status: 400 });
        await fsp.appendFile(file, `\n${text}\n`, 'utf8');
        return NextResponse.json({ ok: true, file: path.relative(vault, file) });
      }

      default:
        return NextResponse.json({ error: `Unknown op: ${op || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[obsidian]', err);
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}