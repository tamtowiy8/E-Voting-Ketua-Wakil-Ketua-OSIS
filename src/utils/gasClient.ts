import type { DatabaseState } from '../types/evoting';
import { isValidGasWebAppUrl, sanitizeDbForSheetsCellLimit } from './gasGenerator';
import {
  isGasDevUrl,
  isHtmlResponseText,
  parseGasPayloadText,
  stripBomAndTrim,
} from './safeJson';

import { DEFAULT_GAS_WEB_APP_URL } from './startupSyncConfig';

export const GAS_CONFIG_KEY = 'osis_evoting_gas_config_v1';

export interface GasConfig {
  webAppUrl: string;
  autoSync: boolean;
  lastSyncedAt: number | null;
  userDisabledAutoSync?: boolean;
}

export function normalizeGasConfig(raw: Partial<GasConfig> | null | undefined): GasConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      webAppUrl: DEFAULT_GAS_WEB_APP_URL,
      autoSync: true,
      lastSyncedAt: null,
      userDisabledAutoSync: false,
    };
  }

  const rawUrl = typeof raw.webAppUrl === 'string' ? raw.webAppUrl.trim() : '';
  const hasUrl = rawUrl.length > 0;
  const userDisabled = Boolean(raw.userDisabledAutoSync);

  if (!hasUrl) {
    return {
      webAppUrl: DEFAULT_GAS_WEB_APP_URL,
      autoSync: !userDisabled,
      lastSyncedAt: typeof raw.lastSyncedAt === 'number' ? raw.lastSyncedAt : null,
      userDisabledAutoSync: userDisabled,
    };
  }

  return {
    webAppUrl: rawUrl,
    autoSync: userDisabled ? false : raw.autoSync === false ? false : true,
    lastSyncedAt: typeof raw.lastSyncedAt === 'number' ? raw.lastSyncedAt : null,
    userDisabledAutoSync: userDisabled,
  };
}

export function loadGasConfig(): GasConfig {
  if (typeof window === 'undefined') {
    return normalizeGasConfig(null);
  }
  try {
    const raw = window.localStorage.getItem(GAS_CONFIG_KEY);
    if (!raw) return normalizeGasConfig(null);
    const parsed = JSON.parse(raw) as Partial<GasConfig>;
    return normalizeGasConfig(parsed);
  } catch {
    return normalizeGasConfig(null);
  }
}

export function saveGasConfig(config: GasConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GAS_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota error
  }
}

export function shouldFallbackFromProxyResponse(
  status: number,
  contentType: string | null
): boolean {
  if (status === 404 || status === 405) return true;
  if (!contentType) return true;
  return !contentType.toLowerCase().includes('application/json');
}

export function parseGasResponseText<T>(
  rawText: string,
  httpStatus: number,
  requestUrl?: string
): T {
  return parseGasPayloadText<T>(rawText, httpStatus, requestUrl);
}

async function callGasDirectCors<T>(body: {
  url: string;
  method: 'GET' | 'POST';
  queryAction?: string;
  payload?: unknown;
}): Promise<T> {
  const targetUrl = new URL(body.url.trim());
  if (body.method === 'GET') {
    targetUrl.searchParams.set('action', body.queryAction || 'ping');
  }
  let res: Response;
  try {
    res = await fetch(targetUrl.toString(), {
      method: body.method,
      redirect: 'follow',
      headers:
        body.method === 'POST'
          ? { 'Content-Type': 'text/plain;charset=utf-8' }
          : undefined,
      body: body.method === 'POST' ? JSON.stringify(body.payload ?? {}) : undefined,
    });
  } catch (err) {
    if (isGasDevUrl(targetUrl.toString())) {
      throw new Error(
        'URL Google Apps Script masih berakhiran "/dev" (diblokir login Google). Ganti dengan URL deployment produksi berakhiran "/exec".'
      );
    }
    if (err instanceof TypeError) {
      throw new Error(
        'Gagal menghubungi Web App Google Apps Script secara langsung (kemungkinan diblokir CORS/halaman login HTML atau koneksi terputus). Pastikan Deploy Web App diatur "Who has access: Anyone" dan gunakan URL /exec.'
      );
    }
    throw err;
  }
  const rawText = await res.text();
  return parseGasResponseText<T>(rawText, res.status, targetUrl.toString());
}

async function callGasProxy<T>(body: {
  url: string;
  method: 'GET' | 'POST';
  queryAction?: string;
  payload?: unknown;
}): Promise<T> {
  if (!isValidGasWebAppUrl(body.url)) {
    throw new Error(
      'URL Web App Google Apps Script tidak valid. Harus diawali https://script.google.com/macros/...'
    );
  }
  if (isGasDevUrl(body.url)) {
    throw new Error(
      'URL Apps Script masih berakhiran "/dev" (mode pengembang yang mengembalikan halaman login HTML). Gunakan URL deployment berakhiran "/exec".'
    );
  }
  try {
    const res = await fetch('/api/gas/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const contentType = res.headers.get('content-type');
    const proxyRaw = await res.text();
    if (
      shouldFallbackFromProxyResponse(res.status, contentType) ||
      isHtmlResponseText(proxyRaw)
    ) {
      return await callGasDirectCors<T>(body);
    }

    let json: { ok?: boolean; error?: string; data?: T };
    try {
      json = JSON.parse(stripBomAndTrim(proxyRaw)) as {
        ok?: boolean;
        error?: string;
        data?: T;
      };
    } catch {
      if (res.status >= 500) {
        return await callGasDirectCors<T>(body);
      }
      throw new Error('Respons proxy Google Apps Script bukan format JSON yang valid.');
    }

    if (!res.ok || !json.ok || !json.data) {
      throw new Error(json.error || 'Gagal menghubungi Web App Google Apps Script.');
    }
    return json.data;
  } catch (err) {
    if (err instanceof TypeError) {
      return await callGasDirectCors<T>(body);
    }
    throw err;
  }
}

export async function gasPing(url: string): Promise<{
  ok: boolean;
  app?: string;
  schoolName?: string;
  totalDpt?: number;
  totalCandidates?: number;
}> {
  return callGasProxy({ url, method: 'GET', queryAction: 'ping' });
}

export async function gasPullState(url: string): Promise<{ ok: boolean; db?: DatabaseState; error?: string }> {
  return callGasProxy({ url, method: 'GET', queryAction: 'getState' });
}

export async function gasPushState(
  url: string,
  db: DatabaseState
): Promise<{ ok: boolean; db?: DatabaseState; error?: string }> {
  const safeDb = sanitizeDbForSheetsCellLimit(db);
  return callGasProxy({
    url,
    method: 'POST',
    payload: {
      action: 'syncState',
      db: safeDb,
    },
  });
}
