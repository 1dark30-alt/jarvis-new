import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

/** Persist a webview HTML snapshot so we can reverse-engineer each
 *  platform's comment DOM before wiring auto-reply scrapers. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      platform?: string;
      url?: string;
      html?: string;
      title?: string;
    };
    const platform = (body.platform ?? 'unknown').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'unknown';
    const html = typeof body.html === 'string' ? body.html : '';
    if (!html) {
      return NextResponse.json({ success: false, error: 'Missing html' }, { status: 400 });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(process.cwd(), 'social-captures', platform);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${stamp}.html`);
    const meta = `<!-- platform: ${platform}\nurl: ${body.url ?? ''}\ntitle: ${body.title ?? ''}\ncaptured: ${new Date().toISOString()}\n-->\n`;
    await writeFile(file, meta + html, 'utf8');

    return NextResponse.json({
      success: true,
      path: path.relative(process.cwd(), file),
      bytes: Buffer.byteLength(html, 'utf8'),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Capture failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
