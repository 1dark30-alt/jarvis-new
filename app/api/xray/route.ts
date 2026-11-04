import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { toFile } from 'openai';

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, apiKey } = await req.json();

    if (!imageBase64) return NextResponse.json({ error: 'Missing image' }, { status: 400 });
    if (!apiKey) return NextResponse.json({ error: 'Missing apiKey' }, { status: 400 });

    const client = new OpenAI({ apiKey });

    // Convert base64 → File object for the Image edit API
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const imageFile = await toFile(imageBuffer, 'capture.png', { type: 'image/png' });

    // Use the Image edit endpoint — gpt-image-2 is built to faithfully
    // modify the existing image rather than generate a new one from scratch
    const response = await client.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt:
        'Apply an X-ray visual effect to this exact image. Keep the identical subject, framing, and composition. Render it as a realistic X-ray scan: black background, glowing blue-white translucent internals, visible bones, anatomy, or internal components depending on the subject. Do not change or replace the subject.',
      n: 1,
      size: '1024x1024',
    });

    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
      return NextResponse.json({ error: 'No image returned' }, { status: 500 });
    }

    return NextResponse.json({ imageBase64: imageData });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
