import { GoogleGenAI } from '@google/genai';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, fallback: true, error: 'Method tidak diizinkan.' }, 405);
  }

  let body: { text?: unknown };
  try {
    body = (await req.json()) as { text?: unknown };
  } catch {
    return jsonResponse({ ok: false, fallback: true, error: 'Payload JSON tidak valid.' }, 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 400) {
    return jsonResponse({ ok: false, fallback: true, error: 'Teks suara tidak valid.' }, 400);
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return jsonResponse({ ok: false, fallback: true, reason: 'NO_API_KEY' }, 200);
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text,
              speechMetadata: {
                style:
                  'Warm, clear, authoritative Indonesian male voice speaking naturally in Bahasa Indonesia',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Charon' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return jsonResponse({ ok: false, fallback: true, reason: 'EMPTY_AUDIO' }, 200);
    }

    return jsonResponse({ ok: true, mimeType: 'audio/wav', audioBase64: base64Audio }, 200);
  } catch {
    return jsonResponse({ ok: false, fallback: true, reason: 'TTS_ERROR' }, 200);
  }
}
