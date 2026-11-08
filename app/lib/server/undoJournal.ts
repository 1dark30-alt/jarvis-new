import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Undo — one shared journal of everything Jarvis changed, so "undo" can take
 * it back. Port of Mark 58's `core/undo.py`, adapted for a server that runs
 * file operations out-of-process.
 *
 * From Mark 58's design:
 *   A voice assistant misunderstands. When it does, "sorry" is not a remedy —
 *   the file is already in another folder. So: act immediately, remember how
 *   to reverse it, and let the user say "undo". Confirmation is reserved for
 *   the handful of actions that genuinely cannot be reversed.
 *
 * How it works here: the shell route records an inverse operation for the
 * file commands it recognises (move/copy/ren/del). `del` never destroys —
 * the file is moved to Jarvis Trash first, so undo puts it back. Arbitrary
 * shell commands are executed as-is but can't be recorded; only things
 * Jarvis changed through a recognised operation are undoable.
 *
 * The stack is in-memory (depth 10, "this conversation"): an undo entry that
 * holds a file's old contents must not outlive the session. A `delete`
 * inverse survives by way of the trash folder on disk, not RAM.
 */

const MAX_DEPTH = 10;

export type InverseOp =
  | { op: 'move'; from: string; to: string }             // undo: move to -> from
  | { op: 'copy'; path: string }                         // undo: delete the copy
  | { op: 'delete'; trashPath: string; origPath: string }// undo: restore from trash
  | { op: 'write'; path: string; prev: string | null }   // undo: restore old content (null = did not exist)
  | { op: 'mkdir'; path: string };                       // undo: remove if empty

export interface UndoEntry {
  id: number;
  label: string;   // human sentence, spoken back to the user
  at: number;
  inverse: InverseOp;
}

let stack: UndoEntry[] = [];
let seq = 0;

function journalFile(): string {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Jarvis')
    : path.join(process.env.HOME ?? process.env.USERPROFILE ?? os.tmpdir(), 'Jarvis');
  return path.join(base, 'undo.json');
}

function load(): void {
  // Always re-read: Next dev compiles routes as separate bundles, so several
  // module instances share this file rather than memory.
  try {
    const raw = JSON.parse(fs.readFileSync(journalFile(), 'utf8')) as { seq?: number; entries?: UndoEntry[] };
    stack = Array.isArray(raw.entries) ? raw.entries : [];
    seq = raw.seq ?? stack.length;
  } catch {
    stack = [];
  }
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(journalFile()), { recursive: true });
    fs.writeFileSync(journalFile(), JSON.stringify({ seq, entries: stack }), 'utf8');
  } catch (e) {
    console.error('[Undo] save failed:', e);
  }
}

export function pushUndo(label: string, inverse: InverseOp): UndoEntry | null {
  try {
    load();
    seq++;
    const entry: UndoEntry = { id: seq, label: String(label).slice(0, 160), at: Date.now(), inverse };
    stack.push(entry);
    // Drop the oldest rather than refusing the newest: the recent past is
    // what people ask to undo.
    while (stack.length > MAX_DEPTH) stack.shift();
    save();
    return entry;
  } catch (e) {
    console.error('[Undo] push failed:', e);
    return null;
  }
}

export function canUndo(): boolean {
  load();
  return stack.length > 0;
}

export function peek(): string {
  load();
  return stack.length ? stack[stack.length - 1].label : '';
}

/** Most recent first — used by the undo tool's list mode. */
export function history(): { id: number; label: string; at: number }[] {
  load();
  return [...stack].reverse().map((e) => ({ id: e.id, label: e.label, at: e.at }));
}

export function clear(): void {
  load();
  stack = [];
  save();
}

export function trashDir(): string {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Jarvis')
    : path.join(process.env.HOME ?? process.env.USERPROFILE ?? os.tmpdir(), 'Jarvis');
  return path.join(base, 'Trash');
}

/** Execute the inverse of one entry. Returns a short result string. */
async function runInverse(entry: UndoEntry): Promise<string> {
  const inv = entry.inverse;
  switch (inv.op) {
    case 'move': {
      await fsp.mkdir(path.dirname(inv.from), { recursive: true });
      await fsp.rename(inv.to, inv.from);
      return `${path.basename(inv.to)} is back at ${inv.from}`;
    }
    case 'copy': {
      await fsp.unlink(inv.path);
      return `Removed the copy at ${inv.path}`;
    }
    case 'delete': {
      if (fs.existsSync(inv.origPath)) return 'Cannot restore: something already occupies the original location.';
      await fsp.mkdir(path.dirname(inv.origPath), { recursive: true });
      await fsp.rename(inv.trashPath, inv.origPath);
      return `${path.basename(inv.origPath)} restored from trash`;
    }
    case 'write': {
      await fsp.mkdir(path.dirname(inv.path), { recursive: true });
      if (inv.prev === null) {
        await fsp.unlink(inv.path);
        return `${path.basename(inv.path)} deleted again (it did not exist before)`;
      }
      await fsp.writeFile(inv.path, inv.prev, 'utf8');
      return `${path.basename(inv.path)} restored to its previous content`;
    }
    case 'mkdir': {
      try { await fsp.rmdir(inv.path); return `Removed empty folder ${inv.path}`; }
      catch { return `Folder ${inv.path} is not empty — left in place`; }
    }
  }
}

/**
 * Reverse the most recent reversible operation.
 * The entry is popped *before* running so a failing undo cannot be retried
 * forever against a world that has already moved on.
 */
export async function undoLast(): Promise<string> {
  load();
  const entry = stack.pop();
  if (!entry) {
    return 'There is nothing to undo. I only track things I changed myself — files I moved, copied, renamed or deleted.';
  }
  try {
    const detail = await runInverse(entry);
    save();
    return `Undone: ${entry.label}. ${detail}`.trim();
  } catch (e) {
    save();
    return `Could not undo '${entry.label}': ${String(e)}`;
  }
}
