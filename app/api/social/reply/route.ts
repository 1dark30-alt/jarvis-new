import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_MODEL = 'gpt-4.1-mini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      apiKey?: string;
      model?: string;
      persona?: string;
      platform?: string;
      comment?: string;
      author?: string;
    };

    const apiKey = (body.apiKey ?? '').trim();
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'Missing OpenAI API key. Set it in Settings.' }, { status: 400 });
    }

    const comment = (body.comment ?? '').trim();
    if (!comment) {
      return NextResponse.json({ success: false, error: 'Missing comment' }, { status: 400 });
    }

    const model = (body.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const platform = body.platform ?? 'social';
    const author = body.author?.trim() || 'viewer';
    const persona = (body.persona ?? '').trim() ||
      'You are a friendly creator replying to comments on social media. Keep replies short, natural, and on-brand. Never be rude.';

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.85,
      max_completion_tokens: 180,
      messages: [
        {
          role: 'system',
          content:
            `${persona}\n\n` +
            `Platform: ${platform}. You are the post/reel creator replying in-thread. ` +
            `Follow the instructions above exactly. No quotation marks around the whole reply.`,
        },
        {
          role: 'user',
          content: `Comment from @${author}:\n${comment}`,
        },
      ],
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!reply) {
      return NextResponse.json({ success: false, error: 'Model returned an empty reply' }, { status: 502 });
    }

    return NextResponse.json({ success: true, reply, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reply generation failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
