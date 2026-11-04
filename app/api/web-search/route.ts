import { NextRequest, NextResponse } from 'next/server';
import { searchDuckDuckGoHtml } from '@/app/lib/ddg-html-search';

export async function POST(req: NextRequest) {
  const { query } = await req.json();
  if (!query) return NextResponse.json({ error: 'No query provided.' }, { status: 400 });

  try {
    const results = await searchDuckDuckGoHtml(query, 8);

    if (results.length === 0) {
      return NextResponse.json({
        results: [],
        message: 'No results found. DuckDuckGo may have changed its HTML structure.',
      });
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
