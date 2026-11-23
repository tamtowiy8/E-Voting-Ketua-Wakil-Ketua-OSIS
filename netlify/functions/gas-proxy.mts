import { isValidGasWebAppUrl } from '../../src/utils/gasGenerator.ts';
import { isHtmlResponseText, parseGasPayloadText } from '../../src/utils/safeJson.ts';

interface GasProxyBody {
  url?: string;
  method?: string;
  queryAction?: string;
  payload?: unknown;
}

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
    return jsonResponse({ ok: false, error: 'Method tidak diizinkan.' }, 405);
  }

  let body: GasProxyBody;
  try {
    body = (await req.json()) as GasProxyBody;
  } catch {
    return jsonResponse({ ok: false, error: 'Payload JSON tidak valid.' }, 400);
  }

  const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
  const method = body.method === 'POST' ? 'POST' : 'GET';
  const queryAction = typeof body.queryAction === 'string' ? body.queryAction.trim() : 'ping';

  if (!isValidGasWebAppUrl(rawUrl)) {
    return jsonResponse(
      {
        ok: false,
        error:
          'URL Web App Google Apps Script tidak valid. Harus berupa HTTPS script.google.com/macros/...',
      },
      400
    );
  }

  if (!/^[a-zA-Z0-9_-]*$/.test(queryAction)) {
    return jsonResponse({ ok: false, error: 'Parameter action Apps Script tidak valid.' }, 400);
  }

  try {
    const targetUrl = new URL(rawUrl);
    if (method === 'GET') {
      targetUrl.searchParams.set('action', queryAction || 'ping');
    }

    const gasResponse = await fetch(targetUrl.toString(), {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(22000),
      headers:
        method === 'POST'
          ? { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' }
          : { Accept: 'application/json' },
      body: method === 'POST' ? JSON.stringify(body.payload ?? {}) : undefined,
    });

    const rawText = await gasResponse.text();
    try {
      const parsed = parseGasPayloadText<{ ok?: boolean; error?: string }>(
        rawText,
        gasResponse.status,
        targetUrl.toString()
      );
      return jsonResponse({ ok: true, data: parsed }, 200);
    } catch (parseErr) {
      const msg =
        parseErr instanceof Error ? parseErr.message : 'Gagal membaca respons Google Apps Script.';
      const statusCode = isHtmlResponseText(rawText) ? 403 : gasResponse.ok ? 400 : 502;
      return jsonResponse({ ok: false, error: msg }, statusCode);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gagal terhubung ke Google Apps Script.';
    return jsonResponse({ ok: false, error: msg }, 502);
  }
}
