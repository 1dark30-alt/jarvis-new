import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://feeds.bbci.co.uk/news/world/rss.xml', {
      headers: { 'User-Agent': 'JarvisClient/1.0' },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch news feed' }, { status: 502 });
    }

    const xml = await res.text();

    const items: { title: string; link: string }[] = [];
    const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const match of matches) {
      const block = match[1];
      const titleMatch =
        block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ??
        block.match(/<title>(.*?)<\/title>/);
      const linkMatch = block.match(/<link>(.*?)<\/link>/);

      if (titleMatch?.[1]) {
        items.push({
          title: titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
          link: linkMatch?.[1] ?? '',
        });
      }
    }

    return NextResponse.json({ items: items.slice(0, 25) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
