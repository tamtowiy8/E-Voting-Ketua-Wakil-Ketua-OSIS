import type { DatabaseState } from '../types/evoting';
import { isValidGasWebAppUrl, sanitizeDbForSheetsCellLimit } from './gasGenerator';

export const GAS_CONFIG_KEY = 'osis_evoting_gas_config_v1';

export interface GasConfig {
  webAppUrl: string;
  autoSync: boolean;
  lastSyncedAt: number | null;
}

export function loadGasConfig(): GasConfig {
  try {
    const raw = window.localStorage.getItem(GAS_CONFIG_KEY);
    if (!raw) return { webAppUrl: '', autoSync: false, lastSyncedAt: null };
    const parsed = JSON.parse(raw) as Partial<GasConfig>;
    return {
      webAppUrl: typeof parsed.webAppUrl === 'string' ? parsed.webAppUrl : '',
      autoSync: Boolean(parsed.autoSync),
      lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : null,
    };
  } catch {
    return { webAppUrl: '', autoSync: false, lastSyncedAt: null };
  }
}

export function saveGasConfig(config: GasConfig): void {
  try {
    window.localStorage.setItem(GAS_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota error
  }
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
  const res = await fetch('/api/gas/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok?: boolean; error?: string; data?: T };
  if (!res.ok || !json.ok || !json.data) {
    throw new Error(json.error || 'Gagal menghubungi Web App Google Apps Script.');
  }
  return json.data;
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
