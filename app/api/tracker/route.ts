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
const EXTRA_SHEETS = ['Balance Sheet 26.27 LY', 'Budget', 'Singles Boards'];
const RATE_ROWS = [5, 6, 7, 8];
const FIRST_WEEK_ROW = 16;

interface TrackerData {
  file: string;
  year: string;
  lo: string;
  extras: { name: string; rows: string[][] }[];
  sessions: {
    name: string;
    rates: { label: string; players: number | null; basic: number | null }[];
    weeks: {
      row: number; date: string; invoice: string;
      teams: (number | null)[]; funds: (number | null)[]; total: number | null; deposit: number | null;
    }[];
    expenses: { row: number; date: string; amount: number | null; description: string }[];
    fees: { row: number; label: string; value: number | null }[];
    grandTotal: { row: number; value: number | null } | null;
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

/** ExcelJS cell → clean string, handling Dates, formulas (cached results),
 *  rich-text arrays, hyperlinks and shared formulas. */
function cellToString(cell: { value: unknown }): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // Formula: use the cached result if present, else show the formula
    if ('formula' in o) {
      const r = o.result;
      return r === null || r === undefined ? '' : String(r).slice(0, 40);
    }
    // Rich text: join the text runs
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('').trim();
    }
    // Hyperlink / plain text objects
    if ('text' in o && typeof o.text === 'string') return o.text.trim();
    if ('result' in o && o.result !== null && o.result !== undefined) return String(o.result);
    return '';
  }
  return String(v);
}

/** ExcelJS cell → ISO date, handling Dates, shared formulas (result Date),
 *  rich-text and hyperlink objects. Returns '' when there is no real date. */
function cellDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const cand = ('result' in o ? o.result : undefined) ?? ('text' in o ? o.text : undefined);
    if (cand instanceof Date && !Number.isNaN(cand.getTime())) return cand.toISOString().slice(0, 10);
    if (typeof cand === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cand)) return cand.slice(0, 10);
  }
  return '';
}

async function loadTracker(file: string): Promise<TrackerData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const data: TrackerData = { file, year: '', lo: '', extras: [], sessions: [] };

  for (const name of TRACKER_SHEETS) {
    const ws = wb.worksheets.find((w) => w.name.trim() === name);
    if (!ws) continue;
    if (!data.year) data.year = String(ws.getCell(1, 1).value ?? '').trim();
    if (!data.lo) data.lo = String(ws.getCell(2, 1).value ?? '').trim();
    const session: TrackerData['sessions'][0] = { name, rates: [], weeks: [], expenses: [], fees: [], grandTotal: null };

    for (const r of RATE_ROWS) {
      const label = ws.getCell(r, 1).value;
      const players = asNumber(ws.getCell(r, 3).value);
      const basic = asNumber(ws.getCell(r, 4).value);
      if (label || players !== null || basic !== null) {
        session.rates.push({ label: String(label ?? ''), players, basic });
      }
    }

    for (let r = FIRST_WEEK_ROW; r <= Math.min(ws.rowCount, FIRST_WEEK_ROW + 60); r++) {
      const dateCell = ws.getCell(r, 1).value;
      const date = cellDate(dateCell);
      // A week row must carry a real date — TOTAL rows and fragments are skipped.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const invoice = cellDate(ws.getCell(r, 2).value);
      const teams = [3, 4, 5, 6].map((c) => asNumber(ws.getCell(r, c).value));
      const funds = [7, 8, 9, 10].map((c) => asNumber(ws.getCell(r, c).value));
      const deposit = asNumber(ws.getCell(r, 12).value);
      const total = funds.reduce((a, b) => a + (b ?? 0), 0) || null;
      session.weeks.push({ row: r, date, invoice, teams, funds, total, deposit });
    }

    for (let r = FIRST_WEEK_ROW + 1; r <= Math.min(ws.rowCount, FIRST_WEEK_ROW + 80); r++) {
      const dateCell = ws.getCell(r, 14).value;
      const amount = asNumber(ws.getCell(r, 15).value);
      const desc = ws.getCell(r, 16).value;
      if (!dateCell && amount === null && !desc) continue;
      const expenseDate = cellDate(dateCell);
      session.expenses.push({ row: r, date: expenseDate, amount, description: String(desc ?? '') });
    }

    // Entry-fee collection block (B label + F value, rows ~33-50) and the
    // Grand Total (SUM formula — read its cached result).
    let fees: { row: number; label: string; value: number | null }[] = [];
    let grandTotal: { row: number; value: number | null } | null = null;
    for (let r = FIRST_WEEK_ROW + 1; r <= Math.min(ws.rowCount, FIRST_WEEK_ROW + 60); r++) {
      const bCell = ws.getCell(r, 2).value;
      const label = bCell && typeof bCell === 'object' && 'result' in (bCell as unknown as Record<string, unknown>)
        ? String((bCell as { result?: unknown }).result ?? '')
        : String(bCell ?? '');
      if (!/Entry Fees Collected|Grand Total Collected/i.test(label)) continue;
      const value = asNumber(ws.getCell(r, 6).value);
      if (/Grand Total/i.test(label)) grandTotal = { row: r, value };
      else fees.push({ row: r, label: label.slice(0, 60), value });
    }
    session.fees = fees;
    session.grandTotal = grandTotal;

    data.sessions.push(session);
  }

  // The non-session sheets (Balance Sheet / Budget / Singles Boards) carry the
  // workbook's own totals — surface them read-only so nothing is "missing".
  for (const name of EXTRA_SHEETS) {
    const ws = wb.worksheets.find((w) => w.name.trim() === name);
    if (!ws) continue;
    const rows: string[][] = [];
    const maxR = Math.min(ws.rowCount, 60);
    const maxC = Math.min(ws.columnCount, 14);
    for (let r = 1; r <= maxR; r++) {
      const line: string[] = [];
      let any = false;
      for (let c = 1; c <= maxC; c++) {
        const s = cellToString(ws.getCell(r, c));
        line.push(s);
        if (s) any = true;
      }
      rows.push(any ? line : []);
    }
    data.extras.push({ name, rows });
  }
  return data;
}

async function applyEdits(file: string, edits: {
  rates?: { session: string; row: number; label: string; players: number | null; basic: number | null }[];
  weeks?: { session: string; row: number; teams: (number | null)[]; deposit: number | null }[];
  expenses?: { session: string; rows: { date: string; amount: number | null; description: string }[] }[];
  fees?: { session: string; row: number; value: number | null }[];
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

  for (const fee of edits.fees ?? []) {
    const ws = wb.getWorksheet(fee.session);
    if (!ws) continue;
    ws.getCell(fee.row, 6).value = fee.value === null || fee.value === undefined ? null : Number(fee.value);
    ws.getCell(fee.row, 6).numFmt = '#,##0.00';
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
      // Local-noon Date: immune to the UTC/local shift that moves date-only
      // values a day off in negative-offset timezones.
      const parts = /^((\d{4})-(\d{2})-(\d{2}))/.exec(row.date ?? '');
      const d = parts ? new Date(Number(parts[2]), Number(parts[3]) - 1, Number(parts[4]), 12, 0, 0) : null;
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
  try {
    const file = trackerFile();
    if (!fs.existsSync(file)) {
      return NextResponse.json({
        configured: false,
        file,
        message: 'No tracker workbook found at ' + file + ' — copy your tracker xlsx into the vault Trackers folder or set it in Settings.',
      });
    }
    return NextResponse.json(await loadTracker(file));
  } catch (err) {
    console.error('[tracker] load failed:', err);
    return NextResponse.json({ error: String(err).slice(0, 400) }, { status: 500 });
  }
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