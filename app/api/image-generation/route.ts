import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { toFile } from 'openai';

const SIZES = new Set(['1024x1024', '1536x1024', '1024x1536', 'auto']);
const QUALITIES = new Set(['low', 'medium', 'high', 'auto']);

async function optimizePromptWithGpt55(params: {
  client: OpenAI;
  prompt: string;
  hasReferenceImage: boolean;
}) {
  const { client, prompt, hasReferenceImage } = params;
  const instruction =
    'Rewrite the user image request into a concise, production-ready prompt for an image generation model. ' +
    'Keep the user intent exactly. Be specific about subject, composition, environment, style, lighting, and constraints. ' +
    'If reference image is available, include "preserve key visual identity and composition cues from the reference image" as a constraint. ' +
    'Return strict JSON only with keys: optimized_prompt, short_title.';

  const input = [
    {
      role: 'system' as const,
      content: [{ type: 'input_text' as const, text: instruction }],
    },
    {
      role: 'user' as const,
      content: [
        {
          type: 'input_text' as const,
          text:
            `User request: ${prompt}\n` +
            `Reference image present: ${hasReferenceImage ? 'yes' : 'no'}\n` +
            'short_title must be 2-6 words.',
        },
      ],
    },
  ];

  const tryModels = ['gpt-5.5', 'gpt-5'];
  for (const model of tryModels) {
    try {
      const resp = await client.responses.create({
        model,
        input,
      });
      const raw = (resp.output_text || '').trim();
      const parsed = JSON.parse(raw) as { optimized_prompt?: string; short_title?: string };
      const optimized = parsed.optimized_prompt?.trim();
      if (optimized) {
        return {
          optimizedPrompt: optimized,
          shortTitle: parsed.short_title?.trim() || null,
          modelUsed: model,
        };
      }
    } catch {
      // Try next model fallback.
    }
  }

  return {
    optimizedPrompt: prompt,
    shortTitle: null as string | null,
    modelUsed: null as string | null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, apiKey, size, quality, referenceImageBase64, enhancePrompt } = body as {
      prompt?: string;
      apiKey?: string;
      size?: string;
      quality?: string;
      referenceImageBase64?: string;
      enhancePrompt?: boolean;
    };

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing apiKey' }, { status: 400 });
    }

    const imageSize = size && SIZES.has(size) ? size : '1024x1024';
    const imageQuality = quality && QUALITIES.has(quality) ? quality : 'auto';

    const client = new OpenAI({ apiKey });

    const normalizedRef = referenceImageBase64?.trim();
    const shouldEnhance = enhancePrompt !== false;
    const optimized = shouldEnhance
      ? await optimizePromptWithGpt55({
          client,
          prompt: prompt.trim(),
          hasReferenceImage: !!normalizedRef,
        })
      : { optimizedPrompt: prompt.trim(), shortTitle: null, modelUsed: null };
    const finalPrompt = optimized.optimizedPrompt;

    const response = normalizedRef
      ? await (async () => {
          const base64Payload = normalizedRef.includes(',')
            ? normalizedRef.split(',')[1]
            : normalizedRef;
          const imageBuffer = Buffer.from(base64Payload, 'base64');
          const imageFile = await toFile(imageBuffer, 'reference.png', { type: 'image/png' });
          return client.images.edit({
            model: 'gpt-image-2',
            image: imageFile,
            prompt: finalPrompt,
            n: 1,
            size: imageSize as '1024x1024' | '1536x1024' | '1024x1536' | 'auto',
            quality: imageQuality as 'low' | 'medium' | 'high' | 'auto',
          });
        })()
      : await client.images.generate({
          model: 'gpt-image-2',
          prompt: finalPrompt,
          n: 1,
          size: imageSize as '1024x1024' | '1536x1024' | '1024x1536' | 'auto',
          quality: imageQuality as 'low' | 'medium' | 'high' | 'auto',
        });

    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
      return NextResponse.json({ error: 'No image returned' }, { status: 500 });
    }

    return NextResponse.json({
      imageBase64: imageData,
      optimizedPrompt: finalPrompt,
      optimizedTitle: optimized.shortTitle,
      optimizerModel: optimized.modelUsed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
