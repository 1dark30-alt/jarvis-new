import { NextRequest, NextResponse } from 'next/server';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Excel Writer — port of Mark 58's `excel_writer.py` (voice → real .xlsx).
 * The model turns the spoken request into a spec; this file builds a genuine
 * workbook from it — bold headers, typed cells, an optional SUM total row —
 * and saves it to the Desktop. No chart in this first port (openpyxl drew
 * them; ExcelJS does not); everything else matches.
 */

interface Spec {
  filename?: string;
  sheet?: string;
  headers?: unknown[];
  rows?: unknown[][];
  totalRow?: boolean;
  totalLabel?: string;
  columnWidths?: number[];
}

const MAX_ROWS = 5000;
const MAX_COLS = 64;

function cellNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function slug(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
  return base || 'jarvis-spreadsheet';
}

export async function POST(req: NextRequest) {
  try {
    const spec = (await req.json()) as Spec;
    const headers = (spec.headers ?? []).map((h) => String(h)).slice(0, MAX_COLS);
    const rows = (spec.rows ?? [])
      .slice(0, MAX_ROWS)
      .map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS).map((c) => (c === null || c === undefined ? '' : c)) : []));
    if (!headers.length && !rows.length) {
      return NextResponse.json({ error: 'The spec needs headers and/or rows.' }, { status: 400 });
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(String(spec.sheet ?? 'Sheet1').slice(0, 31) || 'Sheet1');
    const nCols = Math.max(headers.length, ...rows.map((r) => r.length), 1);

    if (headers.length) {
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.border = { bottom: { style: 'thin' } };
    }

    for (const row of rows) {
      const added = ws.addRow(row);
      // Type the cells: numbers land as real numbers, strings as strings.
      added.eachCell((cell, col) => {
        const num = cellNumber(cell.value);
        if (num !== null) {
          cell.value = num;
          cell.numFmt = Number.isInteger(num) ? '0' : '0.00';
        } else if (typeof cell.value === 'string' && cell.value.length > 60) {
          cell.alignment = { wrapText: true };
        }
        void col;
      });
    }

    if (spec.totalRow && headers.length) {
      // SUM under every column that holds at least one number.
      const total = new Array(nCols).fill(null);
      let anySum = false;
      for (let c = 1; c <= nCols; c++) {
        let hasNum = false;
        for (let r = (headers.length ? 2 : 1); r <= ws.rowCount; r++) {
          const v = ws.getCell(r, c).value;
          if (typeof v === 'number') hasNum = true;
        }
        if (hasNum) {
          const colLetter = ws.getColumn(c).letter;
          const first = (headers.length ? 2 : 1);
          total[c - 1] = { formula: `SUM(${colLetter}${first}:${colLetter}${ws.rowCount})` };
          anySum = true;
        }
      }
      if (anySum) {
        total[0] = spec.totalLabel ?? 'TOTAL';
        const tr = ws.addRow(total);
        tr.font = { bold: true };
        tr.border = { top: { style: 'thin' } };
        tr.eachCell((cell) => { if (cell.type === ExcelJS.ValueType.Formula) cell.numFmt = '0.00'; });
      }
    }

    ws.columns.forEach((col, i) => {
      col.width = spec.columnWidths?.[i] ?? Math.min(40, Math.max(12, String(headers[i] ?? '').length + 6));
    });

    const desktop = path.join(os.homedir(), 'Desktop');
    const outDir = fs.existsSync(desktop) ? desktop : os.homedir();
    const filename = `${slug(spec.filename ?? 'jarvis-spreadsheet')}.xlsx`;
    const outPath = path.join(outDir, filename);
    await wb.xlsx.writeFile(outPath);

    return NextResponse.json({
      ok: true,
      path: outPath,
      sheets: 1,
      rows: rows.length,
      cols: nCols,
      totalRow: Boolean(spec.totalRow),
      saved: outDir,
    });
  } catch (err) {
    console.error('[excel]', err);
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}