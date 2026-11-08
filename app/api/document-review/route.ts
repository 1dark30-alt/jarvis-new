import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { callGemini, SMART } from '../../lib/server/geminiLadder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Document Review — port of Mark 58's `document_review.py`: a lease, an
 * insurance policy, a contract, terms of service, a job offer — JARVIS lays
 * out what it actually says and what is worth knowing before signing.
 *
 * Input: a file path (pdf / txt / md / docx / rtf-ish) on this machine.
 * The text is extracted locally; the ladder only ever sees the document's
 * own words — it is told to quote the document, not invent.
 */

const MAX_CHARS = 60_000;

async function extractText(file: string): Promise<{ text: string; kind: string }> {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') {
    const mod = (await import('pdf-parse')) as unknown as { default?: unknown; pdf?: (b: Buffer) => Promise<{ text: string }> } & Record<string, unknown>;
    const pdfParse = (mod.pdf ?? mod.default) as (b: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(fs.readFileSync(file));
    return { text: data.text, kind: 'pdf' };
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: fs.readFileSync(file) });
    return { text: value, kind: 'docx' };
  }
  // txt / md / any plain-ish text file
  return { text: fs.readFileSync(file, 'utf8'), kind: ext.replace('.', '') || 'text' };
}

export async function POST(req: NextRequest) {
  try {
    const { file, focus } = (await req.json()) as { file?: string; focus?: string };
    const p = file?.trim();
    if (!p) return NextResponse.json({ error: 'Give the full path to the document.' }, { status: 400 });
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return NextResponse.json({ error: `No such file: ${resolved}` }, { status: 404 });
    }

    let doc: { text: string; kind: string };
    try {
      doc = await extractText(resolved);
    } catch (e) {
      return NextResponse.json({ error: `Could not read the document: ${String(e).slice(0, 200)}` }, { status: 400 });
    }
    const text = doc.text.replace(/\s+/g, ' ').trim();
    if (text.length < 50) {
      return NextResponse.json({ error: 'The document contains no readable text (scanned image? try screen_eyes or take_photo).' }, { status: 400 });
    }

    const result = await callGemini({
      contents: `DOCUMENT (${doc.kind}, ${path.basename(resolved)}):\n"""${text.slice(0, MAX_CHARS)}"""\n\n${focus ? `The user's particular concern: ${focus}\n` : ''}Write the plain-language review in the language of the document: what this document actually says (parties, money, dates, obligations), then what is worth knowing BEFORE SIGNING — obligations that bind, money that can be taken, rights given up, unusual clauses, anything one-sided — each point with the clause it comes from. End with: questions to ask before signing. Be concrete; quote the document where it matters; flag anything you are unsure of instead of guessing.`,
      system: 'You review legal-ish everyday documents honestly. You only use the document\'s own words; you flag uncertainty instead of inventing.',
      timeoutMs: 180_000,
    }, SMART);

    return NextResponse.json({ review: result.text, model: result.model, file: resolved, kind: doc.kind, chars: text.length });
  } catch (err) {
    console.error('[document-review]', err);
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}