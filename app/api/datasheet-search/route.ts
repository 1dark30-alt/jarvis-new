import { NextRequest, NextResponse } from 'next/server';
import { searchDuckDuckGoHtml } from '@/app/lib/ddg-html-search';
import {
  buildDatasheetQueries,
  manufacturerHostsForPart,
  pickBestPdf,
  rankPdfCandidate,
  type RankedPdfCandidate,
} from '@/app/lib/datasheet-ranking';

const MAX_QUERIES = 6;
const DDG_DELAY_MS = 160;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const part_name =
    typeof body === 'object' &&
    body !== null &&
    'part_name' in body &&
    typeof (body as { part_name: unknown }).part_name === 'string'
      ? (body as { part_name: string }).part_name.trim()
      : '';

  if (!part_name) {
    return NextResponse.json({ error: 'part_name is required.' }, { status: 400 });
  }

  const queries = buildDatasheetQueries(part_name).slice(0, MAX_QUERIES);
  const manufacturerHosts = manufacturerHostsForPart(part_name);

  const rawRows: { title: string; url: string; snippet: string }[] = [];

  try {
    for (let i = 0; i < queries.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, DDG_DELAY_MS));
      const batch = await searchDuckDuckGoHtml(queries[i], 8);
      rawRows.push(...batch);
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const rankedByUrl = new Map<string, RankedPdfCandidate>();
  for (const row of rawRows) {
    const ranked = rankPdfCandidate(row, part_name, manufacturerHosts);
    const prev = rankedByUrl.get(ranked.url);
    if (!prev || ranked.score > prev.score) {
      rankedByUrl.set(ranked.url, ranked);
    }
  }

  const allRanked = [...rankedByUrl.values()].sort((a, b) => b.score - a.score);
  const best = pickBestPdf(allRanked);

  return NextResponse.json({
    part_name,
    queries_run: queries,
    best_url: best?.url ?? null,
    best_title: best?.title ?? null,
    best_score: best?.score ?? null,
    alternatives: allRanked.slice(0, 12).map((c) => ({
      url: c.url,
      title: c.title,
      score: c.score,
    })),
  });
}
