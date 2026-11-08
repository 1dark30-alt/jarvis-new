import { NextRequest, NextResponse } from 'next/server';

type Provider = 'openai' | 'elevenlabs' | 'olares';

interface TtsBody {
  /** 'speak' (default) synthesizes audio; 'resolve-voice' returns the agent's voice id */
  action?: 'speak' | 'resolve-voice';
  provider?: Provider;
  baseUrl?: string;
  model?: string;
  text?: string;
  /** OpenAI voice id */
  voice?: string;
  /** OpenAI API key */
  apiKey?: string;
  /** ElevenLabs xi-api-key — required for ElevenLabs TTS / MP3 export */
  elevenLabsApiKey?: string;
  /** ElevenLabs Conversational AI agent — used to resolve the agent's voice */
  elevenLabsAgentId?: string;
  /** Optional explicit ElevenLabs voice id (skips agent lookup) */
  elevenLabsVoiceId?: string;
  /** OpenAI: gpt-4o-mini-tts | tts-1 | tts-1-hd */
  openaiModel?: string;
  /** ElevenLabs model id */
  elevenLabsModel?: string;
}

async function resolveElevenLabsVoiceId(
  apiKey: string,
  agentId: string
): Promise<{ voiceId: string | null; error?: string }> {
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      const txt = await res.text();
      return { voiceId: null, error: `Failed to load agent (${res.status}): ${txt.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      conversation_config?: { tts?: { voice_id?: string } };
      tts?: { voice_id?: string };
    };
    const voiceId =
      data.conversation_config?.tts?.voice_id ??
      data.tts?.voice_id ??
      null;
    if (!voiceId) {
      return { voiceId: null, error: 'Agent has no TTS voice configured in ElevenLabs.' };
    }
    return { voiceId };
  } catch (e) {
    return { voiceId: null, error: String(e) };
  }
}

async function openaiSpeech(params: {
  apiKey: string;
  text: string;
  voice: string;
  model: string;
}): Promise<Response> {
  const { apiKey, text, voice, model } = params;
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      response_format: 'mp3',
    }),
  });
  return res;
}

async function elevenLabsSpeech(params: {
  apiKey: string;
  text: string;
  voiceId: string;
  model: string;
}): Promise<Response> {
  const { apiKey, text, voiceId, model } = params;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      output_format: 'mp3_44100_128',
    }),
  });
  return res;
}

export async function POST(req: NextRequest) {
  let body: TtsBody;
  try {
    body = (await req.json()) as TtsBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  if (!['openai', 'elevenlabs', 'olares'].includes(provider)) {
    return NextResponse.json({ error: 'Unsupported TTS provider' }, { status: 400 });
  }

  // Resolve agent → voice id without synthesizing
  if (body.action === 'resolve-voice') {
    const apiKey = (body.elevenLabsApiKey ?? '').trim();
    const agentId = (body.elevenLabsAgentId ?? '').trim();
    if (!apiKey || !agentId) {
      return NextResponse.json({ error: 'elevenLabsApiKey and elevenLabsAgentId required' }, { status: 400 });
    }
    const resolved = await resolveElevenLabsVoiceId(apiKey, agentId);
    if (!resolved.voiceId) {
      return NextResponse.json({ error: resolved.error ?? 'No voice' }, { status: 400 });
    }
    return NextResponse.json({ voiceId: resolved.voiceId });
  }

  const text = (body.text ?? '').trim();
  if (!text) {
    return NextResponse.json({ error: 'Text is required' }, { status: 400 });
  }
  if (text.length > 4096) {
    return NextResponse.json({ error: 'Text must be 4096 characters or fewer' }, { status: 400 });
  }

  try {
    if (provider === 'olares') {
      if (!body.baseUrl?.trim() || !body.apiKey?.trim()) {
        return NextResponse.json({ error: 'Enter the Olares Router Base URL and API key in Settings → Speech Output.' }, { status: 400 });
      }
      let base: URL;
      try { base = new URL(body.baseUrl.trim()); } catch {
        return NextResponse.json({ error: 'Invalid Router Base URL.' }, { status: 400 });
      }
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
        return NextResponse.json({ error: 'Use an HTTP or HTTPS Router Base URL without embedded credentials, query, or fragment.' }, { status: 400 });
      }
      const root = base.href.replace(/\/+$/, '').replace(/\/v1$/, '');
      const voice = body.voice?.trim() || 'en-m';
      const res = await fetch(`${root}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${body.apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: body.model?.trim() || 'default-tts', text }),
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(120000)]),
      });
      if (!res.ok) {
        // Avoid echoing upstream diagnostics that might contain private connection details.
        return NextResponse.json({ error: `Olares speech request failed (HTTP ${res.status}). Check Router's Breeze model, API key permissions, and connection example.` }, { status: 502 });
      }
      const type = res.headers.get('content-type')?.split(';')[0] || '';
      if (!type.startsWith('audio/') && type !== 'application/octet-stream') {
        return NextResponse.json({ error: 'Router returned no audio. Check the speech endpoint and model in its connection example.' }, { status: 502 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) return NextResponse.json({ error: 'Router returned empty audio.' }, { status: 502 });
      const extension = type.includes('wav') ? 'wav' : type.includes('ogg') ? 'ogg' : 'mp3';
      return new NextResponse(buf, { headers: {
        'Content-Type': type === 'application/octet-stream' ? 'audio/mpeg' : type,
        'Content-Disposition': `attachment; filename="jarvis-speech.${extension}"`,
        'Cache-Control': 'no-store', 'X-Jarvis-Provider': 'olares',
      } });
    }
    if (provider === 'openai') {
      const apiKey = (body.apiKey ?? '').trim();
      if (!apiKey) {
        return NextResponse.json({ error: 'OpenAI API key is required' }, { status: 400 });
      }
      const voice = (body.voice ?? 'echo').trim();
      const model = (body.openaiModel ?? 'gpt-4o-mini-tts').trim();

      let res = await openaiSpeech({ apiKey, text, voice, model });
      // Fallback if the account doesn't have gpt-4o-mini-tts yet
      if (!res.ok && model === 'gpt-4o-mini-tts') {
        res = await openaiSpeech({ apiKey, text, voice, model: 'tts-1-hd' });
      }
      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json(
          { error: `OpenAI TTS failed (${res.status}): ${errText.slice(0, 300)}` },
          { status: 502 }
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Disposition': 'attachment; filename="jarvis-speech.mp3"',
          'Cache-Control': 'no-store',
          'X-Jarvis-Provider': 'openai',
          'X-Jarvis-Voice': voice,
        },
      });
    }

    // ElevenLabs — uses the agent's configured voice when possible
    const apiKey = (body.elevenLabsApiKey ?? '').trim();
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'ElevenLabs API key is required for TTS / MP3 export. Add it in Settings → Voice Engine (ElevenLabs mode).',
        },
        { status: 400 }
      );
    }

    let voiceId = (body.elevenLabsVoiceId ?? '').trim();
    if (!voiceId) {
      const agentId = (body.elevenLabsAgentId ?? '').trim();
      if (!agentId) {
        return NextResponse.json(
          { error: 'ElevenLabs Agent ID or Voice ID is required' },
          { status: 400 }
        );
      }
      const resolved = await resolveElevenLabsVoiceId(apiKey, agentId);
      if (!resolved.voiceId) {
        return NextResponse.json(
          { error: resolved.error ?? 'Could not resolve agent voice' },
          { status: 400 }
        );
      }
      voiceId = resolved.voiceId;
    }

    const model = (body.elevenLabsModel ?? 'eleven_multilingual_v2').trim();
    const res = await elevenLabsSpeech({ apiKey, text, voiceId, model });
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `ElevenLabs TTS failed (${res.status}): ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'attachment; filename="jarvis-speech.mp3"',
        'Cache-Control': 'no-store',
        'X-Jarvis-Provider': 'elevenlabs',
        'X-Jarvis-Voice': voiceId,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
