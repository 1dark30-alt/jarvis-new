import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';

const FALLBACK = [
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
  'o4-mini',
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { apiKey?: string };
    const apiKey = (body.apiKey ?? '').trim();
    if (!apiKey) {
      return NextResponse.json({ success: true, models: FALLBACK, source: 'fallback' });
    }

    const client = new OpenAI({ apiKey });
    const list = await client.models.list();
    const models = list.data
      .map((m) => m.id)
      .filter((id) =>
        /^(gpt-4|gpt-5|o[0-9]|chatgpt)/i.test(id) &&
        !/realtime|audio|transcribe|tts|whisper|embed|image|moderation|search/i.test(id),
      )
      .sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      success: true,
      models: models.length > 0 ? models : FALLBACK,
      source: models.length > 0 ? 'openai' : 'fallback',
    });
  } catch {
    return NextResponse.json({ success: true, models: FALLBACK, source: 'fallback' });
  }
}
