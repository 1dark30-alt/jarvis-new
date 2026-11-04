import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string };
    if (!url || !url.startsWith('http')) {
      return NextResponse.json({ error: 'Invalid or missing URL' }, { status: 400 });
    }

    // Use macOS `open` command to open the URL in the default system browser.
    // This works from the server-side Node.js process even inside Electron.
    await new Promise<void>((resolve, reject) => {
      exec(`open "${url.replace(/"/g, '\\"')}"`, { timeout: 5000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
