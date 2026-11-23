import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { SEED_DATABASE } from './src/data/seedData.ts';
import type {
  AdminRole,
  AdminUser,
  AuditLogEntry,
  Candidate,
  DatabaseState,
  ElectionSettings,
  Voter,
} from './src/types/evoting.ts';
import {
  addAuditLog,
  applyVoterEditInState,
  castVoteInState,
  ensureAdminQrTokens,
  generateSixDigitToken,
  maskWhatsappNumber,
  normalizeWhatsappNumber,
  resetElectionData,
  validateAdminQrLogin,
} from './src/utils/electionLogic.ts';
import { isValidGasWebAppUrl } from './src/utils/gasGenerator.ts';
import { DEFAULT_THEME } from './src/utils/theme.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '.data');
const DATA_FILE = path.resolve(DATA_DIR, 'evoting-db.json');
const TTS_CACHE_DIR = path.resolve(DATA_DIR, 'tts-cache');
const PORT = Number(process.env.PORT) || 3000;

const ttsMemoryCache = new Map<string, string>();
let geminiTtsClient: GoogleGenAI | null = null;

function getGeminiTtsClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  if (!geminiTtsClient) {
    geminiTtsClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiTtsClient;
}

function normalizeAdmins(rawAdmins: AdminUser[] | undefined): AdminUser[] {
  const baseList =
    !Array.isArray(rawAdmins) || rawAdmins.length === 0
      ? structuredClone(SEED_DATABASE.admins)
      : rawAdmins;

  const mapped = baseList.map((admin) => {
    const seedMatch = SEED_DATABASE.admins.find((s) => s.id === admin.id);
    const isLegacyDefaultSuper =
      admin.id === 'adm_super' && admin.username === 'superadmin';
    const username = isLegacyDefaultSuper ? 'smansakabun' : admin.username;
    const password =
      isLegacyDefaultSuper && admin.password === 'super123'
        ? 'Smansakabun123!'
        : admin.password;
    const fullName =
      admin.id === 'adm_super' && admin.fullName === 'Drs. Rizky Pratama, M.Pd.'
        ? 'Tamtowi Yahya, S.Pd.'
        : admin.fullName;
    const whatsappNumber = admin.whatsappNumber ?? seedMatch?.whatsappNumber ?? '';
    return {
      ...admin,
      username,
      password,
      fullName,
      whatsappNumber,
    };
  });

  return ensureAdminQrTokens(mapped).admins;
}

function normalizeState(raw: Partial<DatabaseState> | null | undefined): DatabaseState {
  if (!raw || !Array.isArray(raw.voters) || !Array.isArray(raw.candidates)) {
    return structuredClone(SEED_DATABASE);
  }
  const candidateIds = new Set(raw.candidates.map((c) => c.id));
  const voters = raw.voters.map((voter) => {
    if (!voter.hasVoted || voter.votedCandidateId) return voter;
    const seedVoter = SEED_DATABASE.voters.find((s) => s.id === voter.id);
    if (seedVoter?.votedCandidateId && candidateIds.has(seedVoter.votedCandidateId)) {
      return { ...voter, votedCandidateId: seedVoter.votedCandidateId };
    }
    return voter;
  });
  const rawLogo = (raw.settings?.logoUrl || '').trim();
  const normalizedLogoUrl =
    !rawLogo || rawLogo === '/src/assets/images/school_osis_emblem_1794869431849.jpg'
      ? SEED_DATABASE.settings.logoUrl
      : rawLogo;

  const rawMode = raw.settings?.voterLoginMode;
  const voterLoginMode =
    rawMode === 'QR_CODE' || rawMode === 'BOTH' || rawMode === 'NISN'
      ? rawMode
      : SEED_DATABASE.settings.voterLoginMode || 'QR_CODE';

  return {
    voters,
    candidates: raw.candidates,
    admins: normalizeAdmins(raw.admins),
    auditLogs: Array.isArray(raw.auditLogs) ? raw.auditLogs.slice(0, 200) : [],
    settings: {
      ...SEED_DATABASE.settings,
      ...(raw.settings || {}),
      logoUrl: normalizedLogoUrl,
      voterLoginMode,
      theme: {
        ...DEFAULT_THEME,
        ...(raw.settings?.theme || {}),
      },
    },
    lastUpdated: typeof raw.lastUpdated === 'number' ? raw.lastUpdated : Date.now(),
  };
}

function loadInitialDb(): DatabaseState {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(content) as Partial<DatabaseState>;
      const normalized = normalizeState(parsed);
      const hadMissingQrToken =
        !Array.isArray(parsed.admins) ||
        parsed.admins.some((a) => !a.qrToken || a.qrToken.trim().length < 8);
      if (hadMissingQrToken) {
        persistDb(normalized);
      }
      return normalized;
    }
  } catch (err) {
    console.error('Failed reading persisted DB file, using seed data:', err);
  }
  const initial = normalizeState(structuredClone(SEED_DATABASE));
  persistDb(initial);
  return initial;
}

function persistDb(state: DatabaseState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(state), 'utf-8');
  } catch (err) {
    console.error('Failed persisting DB file:', err);
  }
}

let serverDb: DatabaseState = loadInitialDb();
let serverVersion = serverDb.lastUpdated || Date.now();
const sseClients = new Set<express.Response>();
const pendingPasswordResets = new Map<
  string,
  { otp: string; adminId: string; expiresAt: number }
>();

function broadcastState(eventName: 'init' | 'state' = 'state'): void {
  const payload = JSON.stringify({
    type: eventName,
    version: serverVersion,
    db: serverDb,
  });
  for (const res of sseClients) {
    try {
      res.write(`event: ${eventName}\ndata: ${payload}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

function commitServerDb(nextState: DatabaseState): DatabaseState {
  serverVersion = Math.max(Date.now(), serverVersion + 1);
  serverDb = normalizeState({
    ...nextState,
    lastUpdated: serverVersion,
  });
  persistDb(serverDb);
  broadcastState('state');
  return serverDb;
}

function prependAudit(
  logs: AuditLogEntry[],
  actorName: string,
  actorRole: AdminRole | 'SYSTEM',
  action: string,
  detail: string
): AuditLogEntry[] {
  return addAuditLog(logs, actorName, actorRole, action, detail);
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: serverVersion });
  });

  app.get('/api/state', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ db: serverDb, version: serverVersion });
  });

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sseClients.add(res);
    const initPayload = JSON.stringify({
      type: 'init',
      version: serverVersion,
      db: serverDb,
    });
    res.write(`event: init\ndata: ${initPayload}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  // Atomic vote submission (prevents duplicate voting across multiple devices)
  app.post('/api/vote', (req, res) => {
    const { voterId, candidateId } = req.body as { voterId?: string; candidateId?: string };
    if (!voterId || !candidateId) {
      res.status(400).json({ ok: false, error: 'Parameter pemilih atau kandidat tidak lengkap.' });
      return;
    }

    try {
      const { nextState, receipt } = castVoteInState(serverDb, voterId, candidateId);
      const saved = commitServerDb(nextState);
      res.json({ ok: true, db: saved, version: serverVersion, receipt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mencatat suara.';
      res.status(409).json({ ok: false, error: msg, db: serverDb, version: serverVersion });
    }
  });

  app.post('/api/admin/voters', (req, res) => {
    const { voters, actorName, actorRole, action, detail } = req.body as {
      voters?: Voter[];
      actorName?: string;
      actorRole?: AdminRole | 'SYSTEM';
      action?: string;
      detail?: string;
    };
    if (!Array.isArray(voters)) {
      res.status(400).json({ ok: false, error: 'Daftar pemilih tidak valid.' });
      return;
    }
    const auditLogs =
      actorName && action && detail
        ? prependAudit(serverDb.auditLogs, actorName, actorRole || 'ADMIN', action, detail)
        : serverDb.auditLogs;
    const saved = commitServerDb({ ...serverDb, voters, auditLogs });
    res.json({ ok: true, db: saved, version: serverVersion });
  });

  app.post('/api/admin/voter-edit', (req, res) => {
    const {
      voterId,
      nis,
      name,
      kelas,
      hasVoted,
      votedCandidateId,
      actorName,
      actorRole,
    } = req.body as {
      voterId?: string;
      nis?: string;
      name?: string;
      kelas?: string;
      hasVoted?: boolean;
      votedCandidateId?: string;
      actorName?: string;
      actorRole?: AdminRole;
    };
    if (!voterId || typeof nis !== 'string' || typeof name !== 'string' || typeof kelas !== 'string') {
      res.status(400).json({ ok: false, error: 'Data pemilih tidak lengkap.' });
      return;
    }
    try {
      const { nextState } = applyVoterEditInState(
        serverDb,
        voterId,
        {
          nis,
          name,
          kelas,
          hasVoted: Boolean(hasVoted),
          votedCandidateId,
        },
        {
          fullName: actorName || 'Panitia OSIS',
          role: actorRole === 'SUPERADMIN' ? 'SUPERADMIN' : 'ADMIN',
        }
      );
      const saved = commitServerDb(nextState);
      res.json({ ok: true, db: saved, version: serverVersion });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memperbarui pemilih.';
      res.status(400).json({ ok: false, error: msg, db: serverDb, version: serverVersion });
    }
  });

  app.post('/api/admin/candidates', (req, res) => {
    const { candidates, actorName, actorRole, action, detail } = req.body as {
      candidates?: Candidate[];
      actorName?: string;
      actorRole?: AdminRole | 'SYSTEM';
      action?: string;
      detail?: string;
    };
    if (!Array.isArray(candidates)) {
      res.status(400).json({ ok: false, error: 'Daftar kandidat tidak valid.' });
      return;
    }
    const auditLogs =
      actorName && action && detail
        ? prependAudit(serverDb.auditLogs, actorName, actorRole || 'SUPERADMIN', action, detail)
        : serverDb.auditLogs;
    const saved = commitServerDb({ ...serverDb, candidates, auditLogs });
    res.json({ ok: true, db: saved, version: serverVersion });
  });

  app.post('/api/admin/admins', (req, res) => {
    const { admins, actorName, actorRole, action, detail } = req.body as {
      admins?: AdminUser[];
      actorName?: string;
      actorRole?: AdminRole | 'SYSTEM';
      action?: string;
      detail?: string;
    };
    if (!Array.isArray(admins) || admins.length === 0) {
      res.status(400).json({ ok: false, error: 'Minimal satu akun pengelola harus tersedia.' });
      return;
    }
    const sanitizedAdmins = ensureAdminQrTokens(admins).admins;
    const auditLogs =
      actorName && action && detail
        ? prependAudit(serverDb.auditLogs, actorName, actorRole || 'SUPERADMIN', action, detail)
        : serverDb.auditLogs;
    const saved = commitServerDb({ ...serverDb, admins: sanitizedAdmins, auditLogs });
    res.json({ ok: true, db: saved, version: serverVersion });
  });

  app.post('/api/admin/settings', (req, res) => {
    const { settings, actorName, actorRole, action, detail } = req.body as {
      settings?: ElectionSettings;
      actorName?: string;
      actorRole?: AdminRole | 'SYSTEM';
      action?: string;
      detail?: string;
    };
    if (!settings) {
      res.status(400).json({ ok: false, error: 'Data pengaturan tidak valid.' });
      return;
    }
    const auditLogs =
      actorName && action && detail
        ? prependAudit(serverDb.auditLogs, actorName, actorRole || 'SUPERADMIN', action, detail)
        : serverDb.auditLogs;
    const saved = commitServerDb({ ...serverDb, settings, auditLogs });
    res.json({ ok: true, db: saved, version: serverVersion });
  });

  app.post('/api/admin/restore', (req, res) => {
    const { db: incomingDb } = req.body as {
      db?: Partial<DatabaseState>;
    };
    if (!incomingDb || !Array.isArray(incomingDb.voters) || !Array.isArray(incomingDb.candidates)) {
      res.status(400).json({ ok: false, error: 'Snapshot database tidak valid.' });
      return;
    }
    const saved = commitServerDb(normalizeState(incomingDb));
    res.json({ ok: true, db: saved, version: serverVersion });
  });

  app.post('/api/gas/proxy', async (req, res) => {
    const { url, method = 'GET', queryAction, payload } = req.body as {
      url?: string;
      method?: 'GET' | 'POST';
      queryAction?: string;
      payload?: unknown;
    };

    if (!url || !isValidGasWebAppUrl(url)) {
      res.status(400).json({
        ok: false,
        error: 'URL Web App Google Apps Script tidak valid. Gunakan URL https://script.google.com/macros/s/.../exec',
      });
      return;
    }

    try {
      const targetUrl = new URL(url);
      if (method === 'GET' && queryAction) {
        targetUrl.searchParams.set('action', queryAction);
      }

      const gasResponse = await fetch(targetUrl.toString(), {
        method,
        headers:
          method === 'POST'
            ? { 'Content-Type': 'text/plain;charset=utf-8' }
            : undefined,
        body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      const rawText = await gasResponse.text();
      if (!gasResponse.ok) {
        res.status(502).json({
          ok: false,
          error: `Google Apps Script merespons HTTP ${gasResponse.status}.`,
        });
        return;
      }

      const trimmed = rawText.trim();
      if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
        res.status(403).json({
          ok: false,
          error:
            'Google Apps Script mengembalikan halaman HTML/login. Pastikan saat Deploy Web App opsi "Who has access" diatur ke "Anyone".',
        });
        return;
      }

      const parsed = JSON.parse(trimmed) as { ok?: boolean; error?: string };
      if (parsed && parsed.ok === false) {
        res.status(400).json({
          ok: false,
          error: parsed.error || 'Permintaan ditolak oleh Google Apps Script.',
        });
        return;
      }

      res.json({ ok: true, data: parsed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal terhubung ke Google Apps Script.';
      res.status(502).json({ ok: false, error: msg });
    }
  });

  app.post('/api/admin/login-log', (req, res) => {
    const { actorName, actorRole, detail } = req.body as {
      actorName?: string;
      actorRole?: AdminRole;
      detail?: string;
    };
    if (!actorName || !actorRole) {
      res.status(400).json({ ok: false });
      return;
    }
    const auditLogs = prependAudit(
      serverDb.auditLogs,
      actorName,
      actorRole,
      'ADMIN_LOGIN',
      detail || `Login ke Panel Pengelola sebagai ${actorRole}.`
    );
    const saved = commitServerDb({ ...serverDb, auditLogs });
    res.json({ ok: true, db: saved, version: serverVersion });
  });

  app.post('/api/admin/qr-login', (req, res) => {
    const { qrPayload } = req.body as { qrPayload?: string };
    if (!qrPayload || typeof qrPayload !== 'string') {
      res.status(400).json({ ok: false, error: 'Payload QR Code Panitia tidak valid.' });
      return;
    }
    const check = validateAdminQrLogin(serverDb.admins, qrPayload);
    if (!check.ok) {
      res.status(401).json({ ok: false, error: check.error });
      return;
    }
    res.json({ ok: true, admin: check.admin });
  });

  app.post('/api/tts', async (req, res) => {
    const rawText = (req.body as { text?: unknown })?.text;
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text || text.length > 400) {
      res.status(400).json({ ok: false, fallback: true, error: 'Teks suara tidak valid.' });
      return;
    }

    const cacheKey = crypto
      .createHash('sha256')
      .update(`gemini-3.8-flash-lite-tts:Charon:${text}`)
      .digest('hex');

    const memHit = ttsMemoryCache.get(cacheKey);
    if (memHit) {
      res.json({ ok: true, mimeType: 'audio/wav', audioBase64: memHit });
      return;
    }

    const cacheFile = path.resolve(TTS_CACHE_DIR, `${cacheKey}.wav`);
    try {
      if (fs.existsSync(cacheFile)) {
        const diskBase64 = fs.readFileSync(cacheFile).toString('base64');
        ttsMemoryCache.set(cacheKey, diskBase64);
        res.json({ ok: true, mimeType: 'audio/wav', audioBase64: diskBase64 });
        return;
      }
    } catch {
      // Ignore cache read error
    }

    const ai = getGeminiTtsClient();
    if (!ai) {
      res.json({ ok: false, fallback: true, reason: 'NO_API_KEY' });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text,
                speechMetadata: {
                  style: 'Warm, clear, authoritative Indonesian male voice speaking naturally in Bahasa Indonesia',
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

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.json({ ok: false, fallback: true, reason: 'EMPTY_AUDIO' });
        return;
      }

      ttsMemoryCache.set(cacheKey, base64Audio);
      try {
        if (!fs.existsSync(TTS_CACHE_DIR)) {
          fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
        }
        fs.writeFileSync(cacheFile, Buffer.from(base64Audio, 'base64'));
      } catch {
        // Ignore disk cache write error
      }

      res.json({ ok: true, mimeType: 'audio/wav', audioBase64: base64Audio });
    } catch (err) {
      console.warn('Gemini TTS fallback to browser speech synthesis:', err instanceof Error ? err.message : err);
      res.json({ ok: false, fallback: true, reason: 'TTS_ERROR' });
    }
  });

  app.post('/api/admin/reset', (req, res) => {
    const { actor } = req.body as { actor?: AdminUser };
    if (!actor) {
      res.status(400).json({ ok: false, error: 'Aktor reset tidak valid.' });
      return;
    }
    const resetState = resetElectionData(serverDb, actor);
    const saved = commitServerDb(resetState);
    res.json({ ok: true, db: saved, version: serverVersion });
  });

  app.post('/api/monitor/secret-mode', (req, res) => {
    const { hideLiveResults, actorName, actorRole } = req.body as {
      hideLiveResults?: boolean;
      actorName?: string;
      actorRole?: AdminRole | 'SYSTEM';
    };
    const nextHide =
      typeof hideLiveResults === 'boolean'
        ? hideLiveResults
        : !serverDb.settings.hideLiveResults;
    const auditLogs = prependAudit(
      serverDb.auditLogs,
      actorName || 'Operator Live Monitor',
      actorRole || 'SYSTEM',
      'TOGGLE_SECRET_MODE',
      nextHide
        ? 'Menyembunyikan angka hasil pada Live Monitor.'
        : 'Menampilkan angka hasil pada Live Monitor.'
    );
    const saved = commitServerDb({
      ...serverDb,
      settings: { ...serverDb.settings, hideLiveResults: nextHide },
      auditLogs,
    });
    res.json({ ok: true, db: saved, version: serverVersion });
  });

  app.post('/api/admin/forgot-password/request', (req, res) => {
    const { username, whatsappNumber } = req.body as {
      username?: string;
      whatsappNumber?: string;
    };
    const u = (username || '').trim().toLowerCase();
    const waNorm = normalizeWhatsappNumber(whatsappNumber || '');
    if (!u || !waNorm) {
      res.status(400).json({
        ok: false,
        error: 'Masukkan username dan nomor WhatsApp pengelola yang terdaftar.',
      });
      return;
    }

    const admin = serverDb.admins.find((a) => a.username.toLowerCase() === u);
    if (!admin) {
      res.status(404).json({ ok: false, error: 'Username pengelola tidak ditemukan.' });
      return;
    }

    const storedWa = normalizeWhatsappNumber(admin.whatsappNumber || '');
    if (!storedWa || storedWa !== waNorm) {
      res.status(400).json({
        ok: false,
        error:
          'Nomor WhatsApp tidak sesuai dengan nomor yang terdaftar pada Manajemen Akun Panitia.',
      });
      return;
    }

    const otp = generateSixDigitToken();
    pendingPasswordResets.set(admin.username.toLowerCase(), {
      otp,
      adminId: admin.id,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const msg = `Konfirmasi Reset Kata Sandi ${admin.role} (${admin.fullName}) pada E-VOTING PENGURUS OSIS ${serverDb.settings.schoolName}. Kode konfirmasi Anda: ${otp}`;
    const waUrl = `https://wa.me/${storedWa}?text=${encodeURIComponent(msg)}`;
    const auditLogs = prependAudit(
      serverDb.auditLogs,
      admin.fullName,
      admin.role,
      'FORGOT_PASSWORD_REQUEST',
      `Mengirim kode konfirmasi lupa kata sandi ke WhatsApp ${maskWhatsappNumber(admin.whatsappNumber || storedWa)}.`
    );
    const saved = commitServerDb({ ...serverDb, auditLogs });

    res.json({
      ok: true,
      db: saved,
      version: serverVersion,
      maskedWhatsapp: maskWhatsappNumber(admin.whatsappNumber || storedWa),
      waUrl,
      otpPreview: otp,
      adminFullName: admin.fullName,
      role: admin.role,
    });
  });

  app.post('/api/admin/forgot-password/reset', (req, res) => {
    const { username, otp, newPassword } = req.body as {
      username?: string;
      otp?: string;
      newPassword?: string;
    };
    const u = (username || '').trim().toLowerCase();
    const record = pendingPasswordResets.get(u);
    if (!record || record.expiresAt < Date.now()) {
      res.status(400).json({
        ok: false,
        error: 'Sesi konfirmasi telah kedaluwarsa. Silakan ajukan konfirmasi WhatsApp ulang.',
      });
      return;
    }
    if ((otp || '').trim() !== record.otp) {
      res.status(400).json({ ok: false, error: 'Kode konfirmasi WhatsApp tidak cocok.' });
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      res.status(400).json({ ok: false, error: 'Kata sandi baru minimal 4 karakter.' });
      return;
    }

    const targetAdmin = serverDb.admins.find((a) => a.id === record.adminId);
    if (!targetAdmin) {
      res.status(404).json({ ok: false, error: 'Akun pengelola tidak ditemukan.' });
      return;
    }

    const nextAdmins = serverDb.admins.map((a) =>
      a.id === record.adminId ? { ...a, password: newPassword } : a
    );
    const auditLogs = prependAudit(
      serverDb.auditLogs,
      targetAdmin.fullName,
      targetAdmin.role,
      'RESET_ADMIN_PASSWORD',
      `Mengatur ulang kata sandi akun @${targetAdmin.username} setelah konfirmasi WhatsApp.`
    );
    pendingPasswordResets.delete(u);
    const saved = commitServerDb({ ...serverDb, admins: nextAdmins, auditLogs });
    res.json({ ok: true, db: saved, version: serverVersion });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`E-Voting OSIS server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
