import { NextRequest, NextResponse } from 'next/server';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';
import { callGemini, SMART } from '../../lib/server/geminiLadder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Max wait for a screen grab on a busy machine.
const CAPTURE_TIMEOUT_MS = 15_000;

/**
 * Screen Eyes — a picture of the screen, reasoned about by the vision ladder.
 * Simplified first rung of Mark 58's `_screen_eyes.py`: grab the screen,
 * answer the question about it. Numbered-box click geometry arrives later —
 * computer_use already covers acting on the screen today.
 */

async function grabScreenJpeg(): Promise<{ base64: string; width: number; height: number }> {
  const png = (await screenshot({ format: 'png' })) as Buffer;
  const resized = await sharp(png)
    .resize({ width: 1440, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  return {
    base64: resized.toString('base64'),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { question } = (await req.json()) as { question?: string };
    const q = (question ?? '').trim() ||
      'Describe what is on this screen in two or three sentences: what app or page is open, and what the user is likely doing.';

    let shot: { base64: string; width: number; height: number };
    try {
      shot = await grabScreenJpeg();
    } catch (e) {
      return NextResponse.json(
        { error: `Screen capture failed: ${String(e).slice(0, 200)}` },
        { status: 500 }
      );
    }

    try {
      const result = await callGemini({
        contents: `The user asked about their screen: "${q}"\n\nAnswer from the attached screenshot only — do not guess about things not visible. Be concrete and brief.`,
        system: 'You are Jarvis reading the user\'s screen. Answer in the language of the question.',
        images: [{ mimeType: 'image/jpeg', data: shot.base64 }],
        timeoutMs: 120_000,
      }, SMART);
      return NextResponse.json({ answer: result.text, model: result.model, width: shot.width, height: shot.height });
    } catch (e) {
      const msg = String(e);
      if (msg.includes('NO_GEMINI_KEY')) {
        return NextResponse.json(
          { error: 'Screen Eyes runs on the Gemini vision ladder — add a Gemini API key in Settings.' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
    }
  } catch (err) {
    console.error('[screen-eyes]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
