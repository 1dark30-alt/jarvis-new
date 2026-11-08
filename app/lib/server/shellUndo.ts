import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { pushUndo, trashDir } from './undoJournal';

/**
 * Best-effort undo capture for the shell route (Windows cmd syntax).
 *
 * Before a command runs, `captureBefore` stashes anything a `del` is about
 * to remove into Jarvis Trash. After it runs, `captureAfter` records the
 * inverse for the move/copy/rename/delete it can positively confirm. Anything
 * ambiguous (wildcards, multiple targets, flags it does not know) is simply
 * not recorded — undo only ever covers what Jarvis can prove it did.
 */

type Pending = { origPath: string; trashPath: string }[];
const pendingDeletes = new Map<string, Pending>(); // command -> stash

function splitTopLevel(command: string): string[] {
  // Split on && / & but not inside quotes.
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of command) {
    if (ch === '"') inQuote = !inQuote;
    if ((ch === '&' || ch === '|') && !inQuote) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Extract candidate path tokens (strip cmd flags and quotes). */
function pathTokens(rest: string): string[] {
  return rest
    .match(/"[^"]+"|\S+/g)
    ?.map((t) => t.replace(/^"|"$/g, ''))
    .filter((t) => !/^\/[a-z]+$/i.test(t) && !/^--[a-z-]+/.test(t)) ?? [];
}

async function trashCopyFor(p: string): Promise<string> {
  const dir = trashDir();
  await fsp.mkdir(dir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const trashPath = path.join(dir, `${stamp}-${path.basename(p)}`);
  await fsp.copyFile(p, trashPath);
  return trashPath;
}

export async function captureBefore(command: string): Promise<void> {
  pendingDeletes.delete(command);
  for (const part of splitTopLevel(command)) {
    const m = /^\s*(del|erase)\s+(.*)$/i.exec(part);
    if (!m) continue;
    const tokens = pathTokens(m[2]);
    if (tokens.length !== 1 || /[*?]/.test(tokens[0])) continue; // ambiguous — skip
    const target = path.resolve(tokens[0]);
    try {
      const st = await fsp.stat(target);
      if (!st.isFile()) continue;
      const trashPath = await trashCopyFor(target);
      const list = pendingDeletes.get(command) ?? [];
      list.push({ origPath: target, trashPath });
      pendingDeletes.set(command, list);
    } catch { /* nothing to protect */ }
  }
}

export async function captureAfter(command: string, exitCode: number): Promise<void> {
  if (exitCode !== 0) { pendingDeletes.delete(command); return; }

  for (const part of splitTopLevel(command)) {
    let m = /^\s*move\s+(.*)$/i.exec(part);
    if (m) {
      const t = pathTokens(m[1]);
      if (t.length === 2 && !/[*?]/.test(t[0] + t[1])) {
        const from = path.resolve(t[0]);
        const to = path.resolve(t[1]);
        // `move A dir\` keeps the basename — resolve it if `to` is a directory.
        const toResolved = fs.existsSync(to) && fs.statSync(to).isDirectory()
          ? path.join(to, path.basename(from))
          : to;
        if (fs.existsSync(toResolved) && !fs.existsSync(from)) {
          pushUndo(`moved ${path.basename(from)} to ${path.dirname(toResolved)}`, { op: 'move', from, to: toResolved });
        }
      }
      continue;
    }

    m = /^\s*(copy|xcopy|robocopy)\s+(.*)$/i.exec(part);
    if (m && /^\s*copy\s/i.test(part)) {
      const t = pathTokens(m[2]);
      if (t.length === 2 && !/[*?]/.test(t[0] + t[1])) {
        const to = path.resolve(t[1]);
        const toResolved = fs.existsSync(to) && fs.statSync(to).isDirectory()
          ? path.join(to, path.basename(path.resolve(t[0])))
          : to;
        if (fs.existsSync(toResolved)) {
          pushUndo(`copied ${path.basename(t[0])} to ${toResolved}`, { op: 'copy', path: toResolved });
        }
      }
      continue;
    }

    m = /^\s*(ren|rename)\s+(.*)$/i.exec(part);
    if (m) {
      const t = pathTokens(m[2]);
      if (t.length === 2 && !/[*?]/.test(t[0])) {
        const from = path.resolve(t[0]);
        const to = path.join(path.dirname(from), t[1]);
        if (fs.existsSync(to) && !fs.existsSync(from)) {
          pushUndo(`renamed ${path.basename(from)} to ${t[1]}`, { op: 'move', from, to });
        }
      }
      continue;
    }

    m = /^\s*(del|erase)\s+(.*)$/i.exec(part);
    if (m) {
      const stashed = pendingDeletes.get(command) ?? [];
      for (const { origPath, trashPath } of stashed) {
        if (!fs.existsSync(trashPath)) continue;
        // Deletion can lag briefly (OneDrive placeholders, AV scanners) —
        // give it a moment before confirming.
        for (let tries = 0; tries < 4; tries++) {
          if (!fs.existsSync(origPath)) break;
          await new Promise((r) => setTimeout(r, 300));
        }
        // Push even if the file lingers: undo's restore re-checks the
        // original location and refuses to overwrite, so this stays safe.
        pushUndo(`deleted ${path.basename(origPath)}`, { op: 'delete', trashPath, origPath });
      }
    }
  }

  pendingDeletes.delete(command);
}