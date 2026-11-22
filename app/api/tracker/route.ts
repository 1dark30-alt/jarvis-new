import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Financial Tracker — the user's league finance workbook as a Jarvis screen.
 *
 * The workbook lives in the vault (synced to the laptop + Olares) and is the
 * live file: weekly team counts, actual deposits and Players-Fund expenses
 * are edited on the page and written back with exceljs, preserving every
 * formula, style and untouched cell. The original master copy stays in the
 * user's Projects folder, untouched.
 *
 * Structure (their sheet):
 *   C4 "Players Fund" / D4 "Basic Weekly" — rate column headers
 *   rows 5-8: A = fund label, C = players-fund rate, D = basic-weekly rate
 *   row 15: column headers
 *   rows 16+: A = play-end date, B = =A+6 invoice, C-F = team counts,
 *             G-J = counts × rates, K = SUM(G:J) collected,
 *             L = actual bank deposit;  N-P = expenses (Date/Amount/Desc)
 */

const DEFAULT_FILE = path.join(
  process.env.JARVIS_DATA_DIR || process.cwd(),
  'trackers', 'Financial Tracker.xlsx',
);

function settingsFile(): string {
  const base = process.env.JARVIS_DATA_DIR || process.cwd();
  return path.join(base, 'jarvis-server-settings.json');
}

function trackerFile(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>;
    const inner = (typeof raw.jarvis_settings === 'string'
      ? JSON.parse(raw.jarvis_settings)
      : raw.jarvis_settings ?? {}) as Record<string, unknown>;
    const vault = String(inner.obsidian_vault_path ?? '').trim();
    if (vault) return path.join(vault, 'APA League', 'Trackers', '970 26.27 LY Financial Tracker.xlsx');
  } catch { /* fall back */ }
  return DEFAULT_FILE;
}

const TRACKER_SHEETS = ['Summer', 'Fall', 'Spring'];
const RATE_ROWS = [5, 6, 7, 8];
const FIRST_WEEK_ROW = 16;

interface TrackerData {
  file: string;
  year: string;
  lo: string;
  sessions: {
    name: string;
    rates: { label: string; players: number | null; basic: number | null }[];
    weeks: {
      row: number; date: string; invoice: string;
      teams: (number | null)[]; funds: (number | null)[]; total: number | null; deposit: number | null;
    }[];
    expenses: { row: number; date: string; amount: number | null; description: string }[];
  }[];
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && 'result' in (v as Record<string, unknown>)) {
    const r = (v as { result?: unknown }).result;
    if (typeof r === 'number' && Number.isFinite(r)) return r;
  }
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function loadTracker(file: string): Promise<TrackerData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const data: TrackerData = { file, year: '', lo: '', sessions: [] };

  for (const name of TRACKER_SHEETS) {
    const ws = wb.worksheets.find((w) => w.name.trim() === name);
    if (!ws) continue;
    if (!data.year) data.year = String(ws.getCell(1, 1).value ?? '').trim();
    if (!data.lo) data.lo = String(ws.getCell(2, 1).value ?? '').trim();
    const session: TrackerData['sessions'][0] = { name, rates: [], weeks: [], expenses: [] };

    for (const r of RATE_ROWS) {
      const label = ws.getCell(r, 1).value;
      const players = asNumber(ws.getCell(r, 3).value);
      const basic = asNumber(ws.getCell(r, 4).value);
      if (label || players !== null || basic !== null) {
        session.rates.push({ label: String(label ?? ''), players, basic });
      }
    }

    for (let r = FIRST_WEEK_ROW; r <= Math.min(ws.rowCount, FIRST_WEEK_ROW + 40); r++) {
      const dateCell = ws.getCell(r, 1).value;
      if (!dateCell) continue;
      const date = dateCell instanceof Date ? dateCell.toISOString().slice(0, 10) : String(dateCell);
      const teams = [3, 4, 5, 6].map((c) => asNumber(ws.getCell(r, c).value));
      const funds = [7, 8, 9, 10].map((c) => asNumber(ws.getCell(r, c).value));
      const deposit = asNumber(ws.getCell(r, 12).value);
      const total = funds.reduce((a, b) => a + (b ?? 0), 0) || null;
      session.weeks.push({ row: r, date, invoice: '', teams, funds, total, deposit });
    }

    for (let r = FIRST_WEEK_ROW + 1; r <= Math.min(ws.rowCount, FIRST_WEEK_ROW + 60); r++) {
      const dateCell = ws.getCell(r, 14).value;
      const amount = asNumber(ws.getCell(r, 15).value);
      const desc = ws.getCell(r, 16).value;
      if (!dateCell && amount === null && !desc) continue;
      session.expenses.push({
        row: r,
        date: dateCell instanceof Date ? dateCell.toISOString().slice(0, 10) : String(dateCell ?? ''),
        amount,
        description: String(desc ?? ''),
      });
    }

    data.sessions.push(session);
  }
  return data;
}

async function applyEdits(file: string, edits: {
  rates?: { session: string; row: number; label: string; players: number | null; basic: number | null }[];
  weeks?: { session: string; row: number; teams: (number | null)[]; deposit: number | null }[];
  expenses?: { session: string; rows: { date: string; amount: number | null; description: string }[] }[];
}): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  for (const rate of edits.rates ?? []) {
    const ws = wb.getWorksheet(rate.session);
    if (!ws) continue;
    ws.getCell(rate.row, 1).value = rate.label || null;
    ws.getCell(rate.row, 3).value = rate.players ?? null;
    ws.getCell(rate.row, 4).value = rate.basic ?? null;
  }

  for (const week of edits.weeks ?? []) {
    const ws = wb.getWorksheet(week.session);
    if (!ws) continue;
    week.teams.forEach((t, idx) => {
      ws.getCell(week.row, 3 + idx).value = t === null || t === undefined ? null : Number(t);
    });
    ws.getCell(week.row, 12).value = week.deposit === null || week.deposit === undefined ? null : Number(week.deposit);
  }

  for (const exp of edits.expenses ?? []) {
    const ws = wb.getWorksheet(exp.session);
    if (!ws) continue;
    // Rewrite the expense block (N17 downward): clear the existing extent,
    // then write the new rows — dates as real dates, amounts as numbers.
    let last = FIRST_WEEK_ROW;
    for (let r = FIRST_WEEK_ROW + 1; r <= Math.min(ws.rowCount, FIRST_WEEK_ROW + 80); r++) {
      if (ws.getCell(r, 14).value || ws.getCell(r, 15).value || ws.getCell(r, 16).value) last = r;
    }
    for (let r = FIRST_WEEK_ROW + 1; r <= last; r++) {
      ws.getCell(r, 14).value = null;
      ws.getCell(r, 15).value = null;
      ws.getCell(r, 16).value = null;
    }
    exp.rows.forEach((row, i) => {
      const r = FIRST_WEEK_ROW + 1 + i;
      const d = row.date ? new Date(row.date) : null;
      ws.getCell(r, 14).value = d && !Number.isNaN(d.getTime()) ? d : null;
      ws.getCell(r, 14).numFmt = 'mm/dd/yyyy';
      ws.getCell(r, 15).value = row.amount === null ? null : Number(row.amount);
      ws.getCell(r, 15).numFmt = '#,##0.00';
      ws.getCell(r, 16).value = row.description || null;
    });
  }

  wb.xlsx.writeFile(file);
}

export async function GET() {
  const file = trackerFile();
  if (!fs.existsSync(file)) {
    return NextResponse.json({
      configured: false,
      file,
      message: 'No tracker workbook found at ' + file + ' — copy your tracker xlsx into the vault Trackers folder or set it in Settings.',
    });
  }
  return NextResponse.json(await loadTracker(file));
}

export async function POST(req: NextRequest) {
  try {
    const a = (await req.json()) as Record<string, unknown>;
    const op = String(a.op ?? '').trim().toLowerCase();

    if (op === 'save') {
      const file = trackerFile();
      if (!fs.existsSync(file)) return NextResponse.json({ error: 'No tracker workbook found.' }, { status: 404 });
      await applyEdits(
        file,
        a as {
          rates?: { session: string; row: number; label: string; players: number | null; basic: number | null }[];
          weeks?: { session: string; row: number; teams: (number | null)[]; deposit: number | null }[];
          expenses?: { session: string; rows: { date: string; amount: number | null; description: string }[] }[];
        },
      );
      return NextResponse.json({ ok: true, saved: file });
    }

    if (op === 'download') {
      const file = trackerFile();
      if (!fs.existsSync(file)) return NextResponse.json({ error: 'No tracker workbook found.' }, { status: 404 });
      const buf = fs.readFileSync(file);
      return new NextResponse(buf, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
        },
      });
    }

    return NextResponse.json({ error: `Unknown op: ${op || '(none)'}` }, { status: 400 });
  } catch (err) {
    console.error('[tracker]', err);
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}