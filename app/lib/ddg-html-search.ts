export interface DdgHtmlResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Server-side DuckDuckGo HTML search (no API key). Same endpoint the web_search route uses.
 */
export async function searchDuckDuckGoHtml(
  query: string,
  maxResults = 8
): Promise<DdgHtmlResult[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    body: `q=${encodeURIComponent(query)}`,
  });

  const html = await res.text();
  const results: DdgHtmlResult[] = [];

  const blockRegex =
    /<div class="result[^"]*results_links[^"]*"[\s\S]*?(?=<div class="result[^"]*results_links|<div class="nav-[^"]*"|$)/g;
  const blocks = html.match(blockRegex) ?? [];

  for (const block of blocks) {
    if (results.length >= maxResults) break;

    const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    let url = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();

    if (url.startsWith('//duckduckgo.com/l/?')) {
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
    } else if (url.startsWith('/')) {
      url = `https://duckduckgo.com${url}`;
    }

    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}
