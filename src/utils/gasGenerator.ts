import type { DatabaseState } from '../types/evoting';

const DEFAULT_LOGO_PATH = '/assets/aistudio/LOGO_SMANSA_3D_d5e941c9.png';
const DEFAULT_PASLON_PATH = '/src/assets/images/paslon_01_portrait_1794869429956.jpg';

export function resolveGasAssetUrl(url: string | undefined, assetBaseUrl?: string): string {
  const raw = (url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  if (raw.startsWith('/') && assetBaseUrl) {
    const cleanBase = assetBaseUrl.replace(/\/+$/, '');
    return `${cleanBase}${raw}`;
  }
  return raw;
}

export function isValidGasWebAppUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'script.google.com' && host !== 'script.googleusercontent.com') {
      return false;
    }
    return parsed.pathname.includes('/macros/') || parsed.pathname.includes('/a/macros/');
  } catch {
    return false;
  }
}

/**
 * Google Sheets rejects any single cell exceeding 50,000 characters.
 * Clamp base64 data URIs cleanly so Spreadsheet writes from Apps Script never fail.
 */
export function sanitizeDbForSheetsCellLimit(
  db: DatabaseState,
  assetBaseUrl?: string
): DatabaseState {
  const rawLogo =
    db.settings.logoUrl && db.settings.logoUrl.length <= 40000
      ? db.settings.logoUrl
      : DEFAULT_LOGO_PATH;

  return {
    ...db,
    settings: {
      ...db.settings,
      logoUrl: resolveGasAssetUrl(rawLogo, assetBaseUrl),
    },
    candidates: db.candidates.map((c) => {
      const rawPhoto =
        c.photoUrl && c.photoUrl.length <= 40000 ? c.photoUrl : DEFAULT_PASLON_PATH;
      return {
        ...c,
        photoUrl: resolveGasAssetUrl(rawPhoto, assetBaseUrl),
      };
    }),
    auditLogs: db.auditLogs.slice(0, 150),
  };
}

export function generateGasManifestJson(): string {
  return JSON.stringify(
    {
      timeZone: 'Asia/Jakarta',
      dependencies: {},
      exceptionLogging: 'STACKDRIVER',
      runtimeVersion: 'V8',
      webapp: {
        executeAs: 'USER_DEPLOYING',
        access: 'ANYONE_ANONYMOUS',
      },
    },
    null,
    2
  );
}

export function generateGasCodeGs(db: DatabaseState, assetBaseUrl?: string): string {
  const safeDb = sanitizeDbForSheetsCellLimit(db, assetBaseUrl);
  const seedJson = JSON.stringify(safeDb);

  return `/**
 * E-VOTING PENGURUS OSIS — Google Apps Script Backend + Web App (Full AI Studio Parity)
 * Sekolah: ${safeDb.settings.schoolName} (${safeDb.settings.academicYear})
 *
 * Cara Deploy / Perbarui di Google Apps Script (script.google.com):
 * 1. Buka Google Spreadsheet -> Ekstensi -> Apps Script.
 * 2. Tempel seluruh kode ini ke Code.gs, lalu tempel Index.html ke file HTML bernama "Index".
 * 3. Aktifkan file manifes (appsscript.json) di Pengaturan Proyek lalu tempel isinya.
 * 4. Jalankan fungsi setupDatabase() sekali untuk membuat tab Settings, Paslon, DPT, Panitia, AuditLogs.
 * 5. Untuk deploy pertama: Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone.
 *    Untuk update versi tampilan: Deploy -> Manage deployments -> Edit (ikon pensil) -> Version: New version -> Deploy!
 */

var SHEET_SETTINGS = 'Settings';
var SHEET_PASLON = 'Paslon';
var SHEET_DPT = 'DPT';
var SHEET_PANITIA = 'Panitia';
var SHEET_LOGS = 'AuditLogs';

var INITIAL_SEED_JSON = ${JSON.stringify(seedJson)};

function getInitialSeed_() {
  return JSON.parse(INITIAL_SEED_JSON);
}

function getOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var seed = getInitialSeed_();
  writeFullStateToSpreadsheet_(ss, seed);
  return { ok: true, message: 'Database Google Sheets berhasil diinisialisasi.' };
}

function ensureInitialized_(ss) {
  if (!ss.getSheetByName(SHEET_SETTINGS) || !ss.getSheetByName(SHEET_DPT) || !ss.getSheetByName(SHEET_PASLON)) {
    writeFullStateToSpreadsheet_(ss, getInitialSeed_());
  }
}

function writeFullStateToSpreadsheet_(ss, db) {
  var sSheet = getOrCreateSheet_(ss, SHEET_SETTINGS, ['Key', 'Value']);
  sSheet.clearContents();
  sSheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
  var settingsPayload = [
    ['schoolName', String(db.settings.schoolName || '')],
    ['academicYear', String(db.settings.academicYear || '')],
    ['electionTitle', String(db.settings.electionTitle || '')],
    ['logoUrl', String((db.settings.logoUrl || '').slice(0, 45000))],
    ['isBoothOpen', db.settings.isBoothOpen ? 'TRUE' : 'FALSE'],
    ['startTime', String(db.settings.startTime || '')],
    ['endTime', String(db.settings.endTime || '')],
    ['hideLiveResults', db.settings.hideLiveResults ? 'TRUE' : 'FALSE'],
    ['voterLoginMode', String(db.settings.voterLoginMode || 'NISN')],
    ['themeJson', JSON.stringify(db.settings.theme || {})],
    ['lastUpdated', String(db.lastUpdated || Date.now())]
  ];
  sSheet.getRange(2, 1, settingsPayload.length, 2).setValues(settingsPayload);

  var pSheet = getOrCreateSheet_(ss, SHEET_PASLON, [
    'id', 'nomorUrut', 'ketuaName', 'ketuaClass', 'wakilName', 'wakilClass',
    'photoUrl', 'vision', 'missionsJson', 'votes', 'accentColor'
  ]);
  pSheet.clearContents();
  pSheet.getRange(1, 1, 1, 11).setValues([[
    'id', 'nomorUrut', 'ketuaName', 'ketuaClass', 'wakilName', 'wakilClass',
    'photoUrl', 'vision', 'missionsJson', 'votes', 'accentColor'
  ]]);
  if (db.candidates && db.candidates.length > 0) {
    var pRows = db.candidates.map(function (c) {
      return [
        String(c.id),
        Number(c.nomorUrut || 1),
        String(c.ketuaName || ''),
        String(c.ketuaClass || ''),
        String(c.wakilName || ''),
        String(c.wakilClass || ''),
        String((c.photoUrl || '').slice(0, 45000)),
        String(c.vision || ''),
        JSON.stringify(c.missions || []),
        Number(c.votes || 0),
        String(c.accentColor || '#1E3A5F')
      ];
    });
    pSheet.getRange(2, 1, pRows.length, 11).setValues(pRows);
  }

  var dSheet = getOrCreateSheet_(ss, SHEET_DPT, [
    'id', 'nis', 'name', 'kelas', 'grade', 'token', 'hasVoted', 'votedAt', 'votedCandidateId'
  ]);
  dSheet.clearContents();
  dSheet.getRange(1, 1, 1, 9).setValues([[
    'id', 'nis', 'name', 'kelas', 'grade', 'token', 'hasVoted', 'votedAt', 'votedCandidateId'
  ]]);
  if (db.voters && db.voters.length > 0) {
    var dRows = db.voters.map(function (v) {
      return [
        String(v.id),
        String(v.nis),
        String(v.name),
        String(v.kelas),
        String(v.grade || 'X'),
        String(v.token || '000000'),
        v.hasVoted ? 'TRUE' : 'FALSE',
        String(v.votedAt || ''),
        String(v.votedCandidateId || '')
      ];
    });
    dSheet.getRange(2, 1, dRows.length, 9).setValues(dRows);
  }

  var aSheet = getOrCreateSheet_(ss, SHEET_PANITIA, [
    'id', 'username', 'password', 'fullName', 'role', 'whatsappNumber', 'createdAt'
  ]);
  aSheet.clearContents();
  aSheet.getRange(1, 1, 1, 7).setValues([[
    'id', 'username', 'password', 'fullName', 'role', 'whatsappNumber', 'createdAt'
  ]]);
  if (db.admins && db.admins.length > 0) {
    var aRows = db.admins.map(function (a) {
      return [
        String(a.id),
        String(a.username),
        String(a.password),
        String(a.fullName),
        String(a.role),
        String(a.whatsappNumber || ''),
        String(a.createdAt || '')
      ];
    });
    aSheet.getRange(2, 1, aRows.length, 7).setValues(aRows);
  }

  var lSheet = getOrCreateSheet_(ss, SHEET_LOGS, [
    'id', 'timestamp', 'actorName', 'actorRole', 'action', 'detail'
  ]);
  lSheet.clearContents();
  lSheet.getRange(1, 1, 1, 6).setValues([[
    'id', 'timestamp', 'actorName', 'actorRole', 'action', 'detail'
  ]]);
  if (db.auditLogs && db.auditLogs.length > 0) {
    var logs = db.auditLogs.slice(0, 150);
    var lRows = logs.map(function (l) {
      return [
        String(l.id),
        String(l.timestamp),
        String(l.actorName),
        String(l.actorRole),
        String(l.action),
        String(l.detail)
      ];
    });
    lSheet.getRange(2, 1, lRows.length, 6).setValues(lRows);
  }
}

function readDatabaseState_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureInitialized_(ss);

  var sValues = ss.getSheetByName(SHEET_SETTINGS).getDataRange().getValues();
  var sMap = {};
  for (var i = 1; i < sValues.length; i++) {
    sMap[String(sValues[i][0])] = String(sValues[i][1] || '');
  }

  var themeObj = {};
  try {
    themeObj = sMap.themeJson ? JSON.parse(sMap.themeJson) : {};
  } catch (err) {
    themeObj = {};
  }

  var settings = {
    schoolName: sMap.schoolName || 'SMA Negeri 1 Kabun',
    academicYear: sMap.academicYear || '2026/2027',
    electionTitle: sMap.electionTitle || 'Pemilihan Ketua & Wakil Ketua OSIS',
    logoUrl: sMap.logoUrl || '',
    isBoothOpen: sMap.isBoothOpen === 'TRUE',
    startTime: sMap.startTime || '2026-01-01T07:00',
    endTime: sMap.endTime || '2027-12-31T17:00',
    hideLiveResults: sMap.hideLiveResults === 'TRUE',
    voterLoginMode: sMap.voterLoginMode || 'NISN',
    theme: themeObj
  };

  var pValues = ss.getSheetByName(SHEET_PASLON).getDataRange().getValues();
  var candidates = [];
  for (var p = 1; p < pValues.length; p++) {
    var pr = pValues[p];
    if (!pr[0]) continue;
    var missions = [];
    try {
      missions = JSON.parse(String(pr[8] || '[]'));
    } catch (err2) {
      missions = [];
    }
    candidates.push({
      id: String(pr[0]),
      nomorUrut: Number(pr[1] || p),
      ketuaName: String(pr[2] || ''),
      ketuaClass: String(pr[3] || ''),
      wakilName: String(pr[4] || ''),
      wakilClass: String(pr[5] || ''),
      photoUrl: String(pr[6] || ''),
      vision: String(pr[7] || ''),
      missions: Array.isArray(missions) ? missions : [],
      votes: Number(pr[9] || 0),
      accentColor: String(pr[10] || '#1E3A5F')
    });
  }

  var candidateIds = {};
  for (var ci = 0; ci < candidates.length; ci++) {
    candidateIds[candidates[ci].id] = true;
  }
  var legacySeedChoice = {
    v_13: 'paslon_1', v_14: 'paslon_1', v_15: 'paslon_1', v_16: 'paslon_1',
    v_17: 'paslon_1', v_18: 'paslon_1', v_19: 'paslon_1', v_20: 'paslon_1',
    v_21: 'paslon_2', v_22: 'paslon_2', v_23: 'paslon_2', v_24: 'paslon_2',
    v_25: 'paslon_2', v_26: 'paslon_2',
    v_27: 'paslon_3', v_28: 'paslon_3', v_29: 'paslon_3', v_30: 'paslon_3'
  };

  var dValues = ss.getSheetByName(SHEET_DPT).getDataRange().getValues();
  var voters = [];
  for (var d = 1; d < dValues.length; d++) {
    var dr = dValues[d];
    if (!dr[0]) continue;
    var vid = String(dr[0]);
    var hasVoted = String(dr[6]).toUpperCase() === 'TRUE' || dr[6] === true;
    var vcId = dr[8] ? String(dr[8]) : undefined;
    if (hasVoted && !vcId && legacySeedChoice[vid] && candidateIds[legacySeedChoice[vid]]) {
      vcId = legacySeedChoice[vid];
    }
    voters.push({
      id: vid,
      nis: String(dr[1] || ''),
      name: String(dr[2] || ''),
      kelas: String(dr[3] || ''),
      grade: String(dr[4] || 'X'),
      token: String(dr[5] || '000000'),
      hasVoted: hasVoted,
      votedAt: dr[7] ? String(dr[7]) : undefined,
      votedCandidateId: hasVoted ? vcId : undefined
    });
  }

  var aValues = ss.getSheetByName(SHEET_PANITIA).getDataRange().getValues();
  var admins = [];
  for (var a = 1; a < aValues.length; a++) {
    var ar = aValues[a];
    if (!ar[0]) continue;
    var aid = String(ar[0]);
    var uname = String(ar[1] || '');
    var upass = String(ar[2] || '');
    if (aid === 'adm_super' && uname === 'superadmin') {
      uname = 'smansakabun';
      if (upass === 'super123') {
        upass = 'Smansakabun123!';
      }
    }
    admins.push({
      id: aid,
      username: uname,
      password: upass,
      fullName: String(ar[3] || ''),
      role: String(ar[4] || 'ADMIN'),
      whatsappNumber: String(ar[5] || ''),
      createdAt: String(ar[6] || '')
    });
  }

  var lValues = ss.getSheetByName(SHEET_LOGS).getDataRange().getValues();
  var auditLogs = [];
  for (var l = 1; l < lValues.length; l++) {
    var lr = lValues[l];
    if (!lr[0]) continue;
    auditLogs.push({
      id: String(lr[0]),
      timestamp: String(lr[1] || ''),
      actorName: String(lr[2] || ''),
      actorRole: String(lr[3] || 'SYSTEM'),
      action: String(lr[4] || ''),
      detail: String(lr[5] || '')
    });
  }

  return {
    settings: settings,
    candidates: candidates,
    voters: voters,
    admins: admins,
    auditLogs: auditLogs,
    lastUpdated: Number(sMap.lastUpdated || Date.now())
  };
}

function appendAuditEntry_(ss, actorName, actorRole, action, detail) {
  var lSheet = getOrCreateSheet_(ss, SHEET_LOGS, [
    'id', 'timestamp', 'actorName', 'actorRole', 'action', 'detail'
  ]);
  var entry = [
    'log_' + new Date().getTime(),
    new Date().toISOString(),
    String(actorName),
    String(actorRole),
    String(action),
    String(detail)
  ];
  lSheet.insertRowAfter(1);
  lSheet.getRange(2, 1, 1, 6).setValues([entry]);
}

function normalizeWhatsappNumber_(raw) {
  var digits = String(raw || '').replace(/\\D/g, '');
  if (!digits) return '';
  if (digits.indexOf('0') === 0) return '62' + digits.slice(1);
  if (digits.indexOf('8') === 0) return '62' + digits;
  return digits;
}

function maskWhatsappNumber_(raw) {
  var norm = normalizeWhatsappNumber_(raw);
  if (!norm) return '-';
  if (norm.length <= 6) return norm;
  return norm.slice(0, 4) + '****' + norm.slice(-3);
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : '';
  if (action === 'ping') {
    try {
      var db = readDatabaseState_();
      return jsonOutput_({
        ok: true,
        app: 'E-VOTING PENGURUS OSIS',
        schoolName: db.settings.schoolName,
        totalDpt: db.voters.length,
        totalCandidates: db.candidates.length,
        lastUpdated: db.lastUpdated
      });
    } catch (err) {
      return jsonOutput_({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  }
  if (action === 'getState') {
    try {
      return jsonOutput_({ ok: true, db: readDatabaseState_() });
    } catch (err) {
      return jsonOutput_({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  var tpl = HtmlService.createTemplateFromFile('Index');
  var state = readDatabaseState_();
  return tpl
    .evaluate()
    .setTitle('E-VOTING PENGURUS OSIS — ' + state.settings.schoolName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    lock.waitLock(15000);
    hasLock = true;
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action || '';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureInitialized_(ss);

    if (action === 'syncState' && body.db) {
      writeFullStateToSpreadsheet_(ss, body.db);
      return jsonOutput_({ ok: true, db: readDatabaseState_() });
    }

    if (action === 'castVote') {
      return jsonOutput_(submitVote(body.voterId, body.candidateId));
    }

    return jsonOutput_({ ok: false, error: 'Aksi POST tidak dikenali: ' + action });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err && err.message ? err.message : String(err) });
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

// --- Functions Called by Google Apps Script Web App UI (Index.html) ---

function getPublicBootstrap() {
  var db = readDatabaseState_();
  var votedCount = db.voters.filter(function (v) { return v.hasVoted; }).length;
  return {
    settings: db.settings,
    candidates: db.candidates,
    voters: db.voters.map(function (v) {
      return { id: v.id, nis: v.nis, name: v.name, kelas: v.kelas, grade: v.grade, hasVoted: v.hasVoted };
    }),
    stats: {
      totalDpt: db.voters.length,
      totalVoted: votedCount
    },
    lastUpdated: db.lastUpdated
  };
}

function loginVoter(nisInput) {
  var cleanNis = String(nisInput || '').trim();
  if (!cleanNis) return { ok: false, error: 'Harap masukkan Nomor Induk Siswa (NIS / NISN) Anda.' };
  var db = readDatabaseState_();
  if (!db.settings.isBoothOpen) {
    return { ok: false, error: 'Bilik suara saat ini sedang ditutup sementara oleh panitia.' };
  }
  var now = Date.now();
  if (db.settings.startTime) {
    var startMs = new Date(db.settings.startTime).getTime();
    if (!isNaN(startMs) && now < startMs) {
      return { ok: false, error: 'Jadwal pemungutan suara belum dimulai.' };
    }
  }
  if (db.settings.endTime) {
    var endMs = new Date(db.settings.endTime).getTime();
    if (!isNaN(endMs) && now > endMs) {
      return { ok: false, error: 'Masa pemungutan suara telah berakhir.' };
    }
  }

  var voter = null;
  for (var i = 0; i < db.voters.length; i++) {
    if (String(db.voters[i].nis).trim() === cleanNis) {
      voter = db.voters[i];
      break;
    }
  }
  if (!voter) return { ok: false, error: 'NIS / NISN tidak terdaftar dalam Daftar Pemilih Tetap (DPT).' };
  if (voter.hasVoted) return { ok: false, error: 'Anda sudah menggunakan hak suara dan tidak dapat memilih ulang.' };
  return { ok: true, voter: voter };
}

function submitVote(voterIdOrNis, candidateId) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    lock.waitLock(15000);
    hasLock = true;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureInitialized_(ss);
    var dSheet = ss.getSheetByName(SHEET_DPT);
    var pSheet = ss.getSheetByName(SHEET_PASLON);
    var sSheet = ss.getSheetByName(SHEET_SETTINGS);

    var dRows = dSheet.getDataRange().getValues();
    var voterRowIdx = -1;
    var voterObj = null;
    for (var i = 1; i < dRows.length; i++) {
      if (String(dRows[i][0]) === String(voterIdOrNis) || String(dRows[i][1]) === String(voterIdOrNis)) {
        voterRowIdx = i + 1;
        voterObj = {
          id: String(dRows[i][0]),
          nis: String(dRows[i][1]),
          name: String(dRows[i][2]),
          kelas: String(dRows[i][3]),
          hasVoted: String(dRows[i][6]).toUpperCase() === 'TRUE' || dRows[i][6] === true
        };
        break;
      }
    }
    if (!voterObj) return { ok: false, error: 'Pemilih tidak ditemukan di DPT.' };
    if (voterObj.hasVoted) return { ok: false, error: 'Anda sudah menggunakan hak suara.' };

    var pRows = pSheet.getDataRange().getValues();
    var candRowIdx = -1;
    var currentVotes = 0;
    for (var j = 1; j < pRows.length; j++) {
      if (String(pRows[j][0]) === String(candidateId)) {
        candRowIdx = j + 1;
        currentVotes = Number(pRows[j][9] || 0);
        break;
      }
    }
    if (candRowIdx < 0) return { ok: false, error: 'Kandidat tidak ditemukan.' };

    var nowIso = new Date().toISOString();
    dSheet.getRange(voterRowIdx, 7, 1, 3).setValues([['TRUE', nowIso, String(candidateId)]]);
    pSheet.getRange(candRowIdx, 10).setValue(currentVotes + 1);

    var sRows = sSheet.getDataRange().getValues();
    for (var k = 1; k < sRows.length; k++) {
      if (String(sRows[k][0]) === 'lastUpdated') {
        sSheet.getRange(k + 1, 2).setValue(String(Date.now()));
        break;
      }
    }

    appendAuditEntry_(ss, 'Pemilih Bilik', 'SYSTEM', 'CAST_VOTE', 'Satu suara sah masuk & terverifikasi (anonim).');

    var receipt = {
      receiptCode: 'KPPO-' + Math.floor(100000 + Math.random() * 900000),
      voterName: voterObj.name,
      voterNis: voterObj.nis,
      voterClass: voterObj.kelas,
      timestamp: nowIso
    };
    return { ok: true, receipt: receipt, db: readDatabaseState_() };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

function verifyAdminCredentials_(username, password) {
  var db = readDatabaseState_();
  var u = String(username || '').trim().toLowerCase();
  var p = String(password || '');
  for (var i = 0; i < db.admins.length; i++) {
    if (String(db.admins[i].username).toLowerCase() === u && String(db.admins[i].password) === p) {
      return db.admins[i];
    }
  }
  return null;
}

function loginAdmin(username, password) {
  var admin = verifyAdminCredentials_(username, password);
  if (!admin) return { ok: false, error: 'Username atau kata sandi admin tidak valid.' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  appendAuditEntry_(ss, admin.fullName, admin.role, 'ADMIN_LOGIN', 'Masuk panel panitia via Web App Google Apps Script.');
  return { ok: true, admin: admin, db: readDatabaseState_() };
}

function requestAdminForgotPassword(usernameInput, whatsappInput) {
  var u = String(usernameInput || '').trim();
  var waNorm = normalizeWhatsappNumber_(whatsappInput);
  if (!u || !waNorm) {
    return { ok: false, error: 'Masukkan username pengelola dan nomor WhatsApp yang terdaftar.' };
  }
  var db = readDatabaseState_();
  var target = null;
  for (var i = 0; i < db.admins.length; i++) {
    if (String(db.admins[i].username).toLowerCase() === u.toLowerCase()) {
      target = db.admins[i];
      break;
    }
  }
  if (!target) {
    return { ok: false, error: 'Username pengelola tidak ditemukan.' };
  }
  var storedWa = normalizeWhatsappNumber_(target.whatsappNumber || '');
  if (!storedWa || storedWa !== waNorm) {
    return {
      ok: false,
      error: 'Nomor WhatsApp tidak sesuai dengan nomor yang terdaftar pada Manajemen Akun Panitia.'
    };
  }
  var otp = String(Math.floor(100000 + Math.random() * 900000));
  var props = PropertiesService.getScriptProperties();
  props.setProperty('OTP_' + target.username.toLowerCase(), JSON.stringify({
    otp: otp,
    expiresAt: Date.now() + 15 * 60 * 1000
  }));

  var msg = 'Konfirmasi Reset Kata Sandi ' + target.role + ' (' + target.fullName + ') pada E-VOTING PENGURUS OSIS ' + db.settings.schoolName + '. Kode konfirmasi Anda: ' + otp;
  var waUrl = 'https://wa.me/' + storedWa + '?text=' + encodeURIComponent(msg);
  var masked = maskWhatsappNumber_(target.whatsappNumber || storedWa);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  appendAuditEntry_(ss, target.fullName, target.role, 'FORGOT_PASSWORD_REQUEST', 'Mengirim kode konfirmasi lupa kata sandi ke WhatsApp ' + masked + '.');

  return {
    ok: true,
    maskedWhatsapp: masked,
    waUrl: waUrl,
    otpPreview: otp,
    adminFullName: target.fullName,
    role: target.role,
    db: readDatabaseState_()
  };
}

function resetAdminForgotPassword(usernameInput, otpInput, newPassword) {
  var u = String(usernameInput || '').trim().toLowerCase();
  var otp = String(otpInput || '').trim();
  var pw = String(newPassword || '');
  if (!u || !otp || pw.length < 4) {
    return { ok: false, error: 'Data verifikasi atau password baru tidak valid (minimal 4 karakter).' };
  }
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('OTP_' + u);
  if (!raw) {
    return { ok: false, error: 'Kode konfirmasi tidak ditemukan atau sudah kedaluwarsa.' };
  }
  var saved = JSON.parse(raw);
  if (Date.now() > Number(saved.expiresAt || 0)) {
    props.deleteProperty('OTP_' + u);
    return { ok: false, error: 'Kode konfirmasi telah kedaluwarsa. Silakan kirim ulang.' };
  }
  if (String(saved.otp) !== otp) {
    return { ok: false, error: 'Kode konfirmasi WhatsApp tidak cocok.' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var db = readDatabaseState_();
    var targetAdmin = null;
    db.admins = db.admins.map(function (a) {
      if (String(a.username).toLowerCase() === u) {
        targetAdmin = a;
        a.password = pw;
      }
      return a;
    });
    if (!targetAdmin) return { ok: false, error: 'Akun pengelola tidak ditemukan.' };
    db.lastUpdated = Date.now();
    writeFullStateToSpreadsheet_(ss, db);
    props.deleteProperty('OTP_' + u);
    appendAuditEntry_(ss, targetAdmin.fullName, targetAdmin.role, 'RESET_ADMIN_PASSWORD', 'Mengatur ulang kata sandi akun @' + u + ' setelah konfirmasi WhatsApp.');
    return { ok: true, db: readDatabaseState_() };
  } finally {
    lock.releaseLock();
  }
}

function adminToggleSecretMode() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var db = readDatabaseState_();
    db.settings.hideLiveResults = !db.settings.hideLiveResults;
    db.lastUpdated = Date.now();
    writeFullStateToSpreadsheet_(ss, db);
    appendAuditEntry_(ss, 'Panitia Monitor', 'SYSTEM', 'TOGGLE_SECRET_MODE', db.settings.hideLiveResults ? 'Mengaktifkan Mode Rahasia Quick Count.' : 'Menampilkan hasil Quick Count ke publik.');
    return { ok: true, hideLiveResults: db.settings.hideLiveResults, db: readDatabaseState_() };
  } finally {
    lock.releaseLock();
  }
}

function adminSaveVoters(username, password, nextVoters, detail) {
  var admin = verifyAdminCredentials_(username, password);
  if (!admin) return { ok: false, error: 'Sesi admin tidak valid.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var db = readDatabaseState_();
    db.voters = nextVoters;
    db.lastUpdated = Date.now();
    writeFullStateToSpreadsheet_(ss, db);
    appendAuditEntry_(ss, admin.fullName, admin.role, 'UPDATE_DPT', detail || 'Memperbarui data DPT.');
    return { ok: true, db: readDatabaseState_() };
  } finally {
    lock.releaseLock();
  }
}

function adminEditVoter(username, password, voterId, payload) {
  var admin = verifyAdminCredentials_(username, password);
  if (!admin) return { ok: false, error: 'Sesi admin tidak valid.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var db = readDatabaseState_();
    var existing = null;
    for (var i = 0; i < db.voters.length; i++) {
      if (db.voters[i].id === voterId) { existing = db.voters[i]; break; }
    }
    if (!existing) return { ok: false, error: 'Data pemilih tidak ditemukan.' };

    var nis = String((payload && payload.nis) || '').trim();
    var name = String((payload && payload.name) || '').trim();
    var kelas = String((payload && payload.kelas) || '').trim();
    if (!nis || !name || !kelas) {
      return { ok: false, error: 'NIS/NISN, Nama Lengkap, dan Kelas wajib diisi.' };
    }
    for (var d = 0; d < db.voters.length; d++) {
      if (db.voters[d].nis === nis && db.voters[d].id !== voterId) {
        return { ok: false, error: 'NIS/NISN ' + nis + ' sudah terdaftar di DPT.' };
      }
    }

    var canModifyChoice = admin.role === 'SUPERADMIN';
    var wasVoted = Boolean(existing.hasVoted);
    var prevCandidateId = existing.votedCandidateId ? String(existing.votedCandidateId) : undefined;
    var nextHasVoted = Boolean(payload && payload.hasVoted);
    var requestedId = payload && payload.votedCandidateId ? String(payload.votedCandidateId).trim() : undefined;

    var nextCandidateId = undefined;
    if (!nextHasVoted) {
      nextCandidateId = undefined;
    } else if (canModifyChoice) {
      if (requestedId) {
        var foundCand = false;
        for (var cIdx = 0; cIdx < db.candidates.length; cIdx++) {
          if (db.candidates[cIdx].id === requestedId) { foundCand = true; break; }
        }
        if (!foundCand) return { ok: false, error: 'Pasangan calon yang dipilih tidak ditemukan.' };
      }
      nextCandidateId = requestedId;
    } else {
      nextCandidateId = wasVoted ? prevCandidateId : undefined;
    }

    var prevEff = wasVoted ? prevCandidateId : undefined;
    var nextEff = nextHasVoted ? nextCandidateId : undefined;
    if (prevEff !== nextEff) {
      db.candidates = db.candidates.map(function (c) {
        var votes = Number(c.votes || 0);
        if (wasVoted && prevCandidateId === c.id) votes = Math.max(0, votes - 1);
        if (nextHasVoted && nextCandidateId === c.id) votes += 1;
        c.votes = votes;
        return c;
      });
    }

    var up = kelas.toUpperCase();
    var grade = (up.indexOf('XII') === 0 || up.indexOf('12') === 0) ? 'XII' : ((up.indexOf('XI') === 0 || up.indexOf('11') === 0) ? 'XI' : 'X');
    var nowIso = new Date().toISOString();

    db.voters = db.voters.map(function (v) {
      if (v.id !== voterId) return v;
      return {
        id: v.id,
        nis: nis,
        name: name,
        kelas: kelas,
        grade: grade,
        token: v.token || '000000',
        hasVoted: nextHasVoted,
        votedAt: nextHasVoted ? (v.votedAt || nowIso) : undefined,
        votedCandidateId: nextCandidateId
      };
    });

    db.lastUpdated = Date.now();
    writeFullStateToSpreadsheet_(ss, db);
    var detail = prevEff !== nextEff
      ? 'Memperbarui data & pilihan Paslon pemilih ' + name + ' (NIS/NISN ' + nis + ').'
      : 'Memperbarui data pemilih ' + name + ' (NIS/NISN ' + nis + ').';
    appendAuditEntry_(ss, admin.fullName, admin.role, prevEff !== nextEff ? 'UPDATE_VOTER_VOTE_CHOICE' : 'UPDATE_VOTER', detail);
    return { ok: true, db: readDatabaseState_() };
  } finally {
    lock.releaseLock();
  }
}

function adminSaveCandidates(username, password, nextCandidates, detail) {
  var admin = verifyAdminCredentials_(username, password);
  if (!admin || admin.role !== 'SUPERADMIN') return { ok: false, error: 'Akses khusus SuperAdmin.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var db = readDatabaseState_();
    db.candidates = (nextCandidates || []).map(function (c) {
      if (c.photoUrl && c.photoUrl.length > 45000) {
        c.photoUrl = '';
      }
      return c;
    });
    db.lastUpdated = Date.now();
    writeFullStateToSpreadsheet_(ss, db);
    appendAuditEntry_(ss, admin.fullName, admin.role, 'UPDATE_CANDIDATES', detail || 'Memperbarui daftar pasangan calon.');
    return { ok: true, db: readDatabaseState_() };
  } finally {
    lock.releaseLock();
  }
}

function adminSaveAdmins(username, password, nextAdmins, detail) {
  var admin = verifyAdminCredentials_(username, password);
  if (!admin || admin.role !== 'SUPERADMIN') return { ok: false, error: 'Akses khusus SuperAdmin.' };
  var superCount = (nextAdmins || []).filter(function (a) { return a.role === 'SUPERADMIN'; }).length;
  if (superCount < 1) return { ok: false, error: 'Minimal harus terdapat 1 akun SuperAdmin aktif.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var db = readDatabaseState_();
    db.admins = nextAdmins;
    db.lastUpdated = Date.now();
    writeFullStateToSpreadsheet_(ss, db);
    appendAuditEntry_(ss, admin.fullName, admin.role, 'UPDATE_STAFF', detail || 'Memperbarui daftar akun panitia.');
    return { ok: true, db: readDatabaseState_() };
  } finally {
    lock.releaseLock();
  }
}

function adminSaveSettings(username, password, nextSettings, detail) {
  var admin = verifyAdminCredentials_(username, password);
  if (!admin || admin.role !== 'SUPERADMIN') return { ok: false, error: 'Akses khusus SuperAdmin.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var db = readDatabaseState_();
    if (nextSettings && nextSettings.logoUrl && nextSettings.logoUrl.length > 45000) {
      nextSettings.logoUrl = db.settings.logoUrl || '';
    }
    db.settings = nextSettings;
    db.lastUpdated = Date.now();
    writeFullStateToSpreadsheet_(ss, db);
    appendAuditEntry_(ss, admin.fullName, admin.role, 'UPDATE_SETTINGS', detail || 'Memperbarui pengaturan pemilihan.');
    return { ok: true, db: readDatabaseState_() };
  } finally {
    lock.releaseLock();
  }
}

function adminResetElection(username, password) {
  var admin = verifyAdminCredentials_(username, password);
  if (!admin || admin.role !== 'SUPERADMIN') return { ok: false, error: 'Akses khusus SuperAdmin.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var db = readDatabaseState_();
    db.candidates = db.candidates.map(function (c) {
      c.votes = 0;
      return c;
    });
    db.voters = db.voters.map(function (v) {
      v.hasVoted = false;
      v.votedAt = '';
      v.votedCandidateId = '';
      return v;
    });
    db.lastUpdated = Date.now();
    writeFullStateToSpreadsheet_(ss, db);
    appendAuditEntry_(ss, admin.fullName, admin.role, 'RESET_ELECTION', 'Mereset perolehan suara & status memilih DPT.');
    return { ok: true, db: readDatabaseState_() };
  } finally {
    lock.releaseLock();
  }
}
`;
}

export function generateGasIndexHtml(db: DatabaseState, assetBaseUrl?: string): string {
  const safeDb = sanitizeDbForSheetsCellLimit(db, assetBaseUrl);
  const safeSchool = safeDb.settings.schoolName || 'SMA Negeri 1 Kabun';
  const bootstrapJson = JSON.stringify({
    settings: safeDb.settings,
    candidates: safeDb.candidates,
    voters: safeDb.voters.map((v) => ({
      id: v.id,
      nis: v.nis,
      name: v.name,
      kelas: v.kelas,
      grade: v.grade,
      hasVoted: v.hasVoted,
    })),
    stats: {
      totalDpt: safeDb.voters.length,
      totalVoted: safeDb.voters.filter((v) => v.hasVoted).length,
    },
    lastUpdated: safeDb.lastUpdated,
  });

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>E-VOTING PENGURUS OSIS — ${safeSchool}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --app-primary: ${safeDb.settings.theme?.primaryColor || '#0F1E3D'};
      --app-secondary: ${safeDb.settings.theme?.secondaryColor || '#1E3A5F'};
      --app-accent: ${safeDb.settings.theme?.accentColor || '#D97706'};
      --app-bg: #F8FAFC;
      --app-surface: #FFFFFF;
    }
    html, body {
      font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
      background-color: var(--app-bg);
    }
    .font-mono {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
    }
    .tabular-nums { font-variant-numeric: tabular-nums; }
    @keyframes live-ping {
      75%, 100% { transform: scale(2); opacity: 0; }
    }
    .animate-live-ping { animation: live-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; }
    @keyframes splashBar {
      from { transform: translateX(-100%); }
      to { transform: translateX(0%); }
    }
    .animate-splash-bar { animation: splashBar 1.25s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-fade-up { animation: fadeUp 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
    .line-clamp-3 {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { background: #ffffff !important; }
      .no-print { display: none !important; }
      #print-report-sheet { display: block !important; }
      @page { size: A4 portrait; margin: 14mm 15mm 20mm 15mm; }
      .print-footer-fixed {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        border-top: 1px solid #cbd5e1;
        padding-top: 6px;
        font-size: 9px;
        color: #64748b;
        text-align: left;
      }
    }
  </style>
</head>
<body class="bg-[var(--app-bg)] text-slate-900 h-screen overflow-hidden antialiased">
  <!-- SPLASH INTRO OVERLAY -->
  <div id="splash-intro" role="status" aria-live="polite"
    class="no-print fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center text-white overflow-hidden transition-opacity duration-300"
    style="background-color: var(--app-primary, #0F1E3D);">
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 opacity-25"
      style="background: radial-gradient(circle at 50% 42%, var(--app-accent, #D97706) 0%, transparent 58%);"></div>
    <div class="relative z-10 max-w-3xl w-full flex flex-col items-center animate-fade-up">
      <div id="splash-logo-box" class="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white p-2 shadow-2xl flex items-center justify-center overflow-hidden mb-7"></div>
      <p class="text-xs sm:text-sm font-mono font-bold tracking-[0.28em] uppercase mb-3" style="color: var(--app-accent, #FBBF24);">
        SISTEM E-VOTING RESMI
      </p>
      <h1 class="text-xl sm:text-3xl md:text-4xl font-extrabold leading-tight tracking-tight text-white">
        KOMISI PEMILIHAN PENGURUS OSIS (KPPO)
      </h1>
      <p id="splash-school-name" class="mt-2.5 text-lg sm:text-2xl font-bold tracking-wide" style="color: var(--app-accent, #FBBF24);">
        ${safeSchool}
      </p>
      <div class="mt-8 w-52 sm:w-64 h-1 rounded-full bg-white/15 overflow-hidden">
        <div class="h-full w-full rounded-full animate-splash-bar" style="background-color: var(--app-accent, #D97706);"></div>
      </div>
    </div>
    <button type="button" onclick="dismissSplash()"
      class="relative z-10 mt-10 px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-200 transition-colors cursor-pointer">
      Masuk Aplikasi
    </button>
  </div>

  <!-- MAIN APP ROOT -->
  <div id="app-root" class="no-print h-screen overflow-hidden flex flex-col"></div>

  <!-- FLOATING SCROLL TO TOP BUTTON -->
  <button id="scroll-top-btn" type="button" onclick="scrollToTopGas()" aria-label="Gulir ke paling atas" title="Gulir ke paling atas"
    class="no-print hidden fixed bottom-6 right-6 z-40 w-11 h-11 rounded-xl text-white shadow-lg border border-white/25 flex items-center justify-center transition-all cursor-pointer"
    style="background-color: var(--app-primary);">
    <svg class="w-5 h-5" style="color: var(--app-accent);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
  </button>

  <!-- TOAST NOTIFICATION STACK -->
  <div id="toast-container" class="no-print fixed bottom-5 right-5 z-[70] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0"></div>

  <!-- GLOBAL LOADING OVERLAY -->
  <div id="loading-overlay" class="no-print hidden fixed inset-0 z-[80] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4" role="status" aria-live="polite">
    <div class="bg-white border border-slate-200 rounded-2xl px-7 py-6 shadow-2xl flex flex-col items-center gap-3 max-w-xs w-full text-center">
      <div class="w-11 h-11 rounded-xl flex items-center justify-center" style="background-color: var(--app-primary);">
        <svg class="w-6 h-6 animate-spin text-white" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
          <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"></path>
        </svg>
      </div>
      <p id="loading-label" class="text-sm font-bold text-slate-900">Memproses...</p>
      <p class="text-xs text-slate-500">Menyinkronkan data dengan Google Sheets...</p>
    </div>
  </div>

  <!-- GLOBAL MODAL CONTAINER -->
  <div id="modal-root" class="no-print"></div>

  <!-- PRINTABLE OFFICIAL PDF / A4 REPORT CONTAINER -->
  <div id="print-report-sheet" class="hidden text-slate-900 text-xs"></div>

  <script>
    // =========================================================================
    // 1. INITIAL BOOTSTRAP & THEME ENGINE (Matches AI Studio src/utils/theme.ts)
    // =========================================================================
    var INITIAL_BOOTSTRAP = ${bootstrapJson};
    var CHART_COLORS = ['#1E3A5F', '#D97706', '#059669', '#0284C7', '#7C3AED', '#DC2626'];
    var THEME_PRESETS = [
      { id: 'navy', name: 'Biru Navy Klasik', description: 'Formal pendidikan dengan aksen emas.', primaryColor: '#0F1E3D', secondaryColor: '#1E3A5F', accentColor: '#D97706' },
      { id: 'emerald', name: 'Zamrud Pendidikan', description: 'Hijau zamrud segar dan berwibawa.', primaryColor: '#064E3B', secondaryColor: '#047857', accentColor: '#D97706' },
      { id: 'maroon', name: 'Marun Nusantara', description: 'Merah marun tegas dengan aksen hangat.', primaryColor: '#581C1C', secondaryColor: '#7F1D1D', accentColor: '#D97706' },
      { id: 'indigo', name: 'Indigo Modern', description: 'Ungu tua akademik dengan aksen biru cerah.', primaryColor: '#1E1B4B', secondaryColor: '#312E81', accentColor: '#0284C7' },
      { id: 'slate', name: 'Slate Minimalis', description: 'Gelap netral dengan aksen hijau mint.', primaryColor: '#0F172A', secondaryColor: '#334155', accentColor: '#10B981' }
    ];
    var THEME_SURFACES = [
      { id: 'light', label: 'Terang Bersih', bgHex: '#F8FAFC', cardHex: '#FFFFFF' },
      { id: 'warm', label: 'Krem Hangat', bgHex: '#FAF7F0', cardHex: '#FFFDF9' },
      { id: 'cool', label: 'Abu Sejuk', bgHex: '#EFF4F9', cardHex: '#FFFFFF' }
    ];

    var state = {
      screen: 'LOGIN_PORTAL',
      appData: INITIAL_BOOTSTRAP,
      activeVoter: null,
      receipt: null,
      receiptCountdown: 5,
      receiptTimer: null,
      adminCreds: null,
      adminDb: null,
      adminTab: 'overview',
      dptSearch: '',
      dptGradeFilter: 'ALL',
      dptStatusFilter: 'ALL',
      selectedVoterIds: [],
      voterError: '',
      adminError: '',
      showAdminPass: false,
      hoveredCandId: null,
      isFullscreen: false,
      liveClockTimer: null,
      pollTimer: null
    };

    function esc(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function applyThemeVars(theme) {
      var t = theme || {};
      var primary = t.primaryColor || '#0F1E3D';
      var secondary = t.secondaryColor || '#1E3A5F';
      var accent = t.accentColor || '#D97706';
      var surfaceId = t.surfaceMode || 'light';
      var surface = THEME_SURFACES.filter(function (s) { return s.id === surfaceId; })[0] || THEME_SURFACES[0];
      var r = document.documentElement.style;
      r.setProperty('--app-primary', primary);
      r.setProperty('--app-secondary', secondary);
      r.setProperty('--app-accent', accent);
      r.setProperty('--app-bg', surface.bgHex);
      r.setProperty('--app-surface', surface.cardHex);
    }

    function activeDb() {
      return state.adminDb || state.appData;
    }

    // Crisp inline SVG icon set
    function svgIcon(name, cls, styleAttr) {
      var c = cls || 'w-4 h-4';
      var s = styleAttr ? ' style="' + styleAttr + '"' : '';
      var paths = {
        vote: '<path d="m9 12 2 2 4-4"/><path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z"/><path d="M22 19H2"/>',
        shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
        chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
        userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
        arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
        arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
        checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
        lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
        eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
        eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
        dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
        userCog: '<circle cx="18" cy="15" r="3"/><circle cx="9" cy="7" r="4"/><path d="M10 15H6a4 4 0 0 0-4 4v2"/><path d="m21.7 16.4-.9-.3"/><path d="m15.2 13.9-.9-.3"/><path d="m16.6 18.7.3-.9"/><path d="m19.1 12.2.3-.9"/>',
        settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
        history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
        fileDown: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
        key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
        message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
        plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
        trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
        edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
        x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
        palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
        search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        maximize: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
        minimize: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
        arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'
      };
      return '<svg class="' + c + '"' + s + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
    }

    function handleImgFallback(img) {
      if (!img) return;
      img.style.display = 'none';
      if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
    }

    function renderCandidatePortraitHtml(cand, cls) {
      var fallbackSvg =
        '<div style="display:flex" class="w-full h-full flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600 p-4 text-center">' +
          '<div class="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-mono font-extrabold text-lg shadow-sm mb-2" style="background-color: var(--app-primary);">0' + esc(cand.nomorUrut) + '</div>' +
          '<p class="text-xs font-bold text-slate-700 leading-tight">' + esc(cand.ketuaName) + '</p>' +
          '<p class="text-[11px] text-slate-500 mt-0.5">&amp; ' + esc(cand.wakilName) + '</p>' +
        '</div>';
      if (cand.photoUrl && (cand.photoUrl.indexOf('data:') === 0 || cand.photoUrl.indexOf('http') === 0 || cand.photoUrl.indexOf('/') === 0)) {
        return '<img src="' + esc(cand.photoUrl) + '" alt="Paslon 0' + esc(cand.nomorUrut) + '" class="' + (cls || 'w-full h-full object-cover object-top') + '" referrerpolicy="no-referrer" onerror="handleImgFallback(this)" />' +
          fallbackSvg.replace('style="display:flex"', 'style="display:none"');
      }
      return fallbackSvg;
    }

    function renderSchoolLogoHtml(logoUrl, schoolName, imgCls, fallbackCls) {
      if (logoUrl && (logoUrl.indexOf('data:') === 0 || logoUrl.indexOf('http') === 0 || logoUrl.indexOf('/') === 0)) {
        return '<img src="' + esc(logoUrl) + '" alt="Logo ' + esc(schoolName) + '" referrerpolicy="no-referrer" class="' + imgCls + '" onerror="handleImgFallback(this)" />' +
          '<div style="display:none" class="' + fallbackCls + ' items-center justify-center">' + svgIcon('vote', 'w-8 h-8', 'color: var(--app-primary)') + '</div>';
      }
      return svgIcon('vote', 'w-8 h-8', 'color: var(--app-primary)');
    }

    // Toast & Loading Helpers (zero native alert/confirm)
    function showToast(type, title, desc) {
      var box = document.getElementById('toast-container');
      var colors = type === 'error'
        ? 'bg-rose-50 border-rose-200 text-rose-900'
        : type === 'info'
          ? 'bg-sky-50 border-sky-200 text-sky-900'
          : 'bg-emerald-50 border-emerald-200 text-emerald-900';
      var el = document.createElement('div');
      el.className = 'pointer-events-auto border rounded-xl p-3.5 shadow-lg flex items-start gap-2.5 animate-fade-up ' + colors;
      el.innerHTML =
        '<div class="mt-0.5 shrink-0">' + svgIcon(type === 'error' ? 'alert' : 'checkCircle', 'w-4 h-4') + '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-xs font-extrabold">' + esc(title) + '</p>' +
          (desc ? '<p class="text-[11px] opacity-85 mt-0.5 leading-snug">' + esc(desc) + '</p>' : '') +
        '</div>';
      box.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4200);
    }

    function setLoading(active, label) {
      var ov = document.getElementById('loading-overlay');
      if (active) {
        document.getElementById('loading-label').textContent = label || 'Memproses...';
        ov.classList.remove('hidden');
      } else {
        ov.classList.add('hidden');
      }
    }

    function openModal(html) {
      document.getElementById('modal-root').innerHTML = html;
    }

    function closeModal() {
      document.getElementById('modal-root').innerHTML = '';
    }

    function gasCall(fnName, args, loadingMsg, onOk, onErr) {
      if (loadingMsg) setLoading(true, loadingMsg);
      if (typeof google === 'undefined' || !google.script || !google.script.run) {
        if (loadingMsg) setLoading(false);
        if (onErr) onErr('Runtime google.script.run tidak tersedia.');
        return;
      }
      var runner = google.script.run
        .withSuccessHandler(function (res) {
          if (loadingMsg) setLoading(false);
          onOk(res);
        })
        .withFailureHandler(function (err) {
          if (loadingMsg) setLoading(false);
          var msg = (err && err.message) ? err.message : String(err || 'Terjadi kesalahan server Apps Script.');
          if (onErr) onErr(msg);
          else showToast('error', 'Gagal Memproses', msg);
        });
      runner[fnName].apply(runner, args || []);
    }

    // =========================================================================
    // 2. STATISTICS ENGINE (Matches AI Studio computeStatistics)
    // =========================================================================
    function computeStats(voters, candidates) {
      var totalDpt = (voters || []).length;
      var totalVoted = (voters || []).filter(function (v) { return v.hasVoted; }).length;
      var totalNotVoted = Math.max(0, totalDpt - totalVoted);
      var participationRate = totalDpt > 0 ? Math.round((totalVoted / totalDpt) * 1000) / 10 : 0;
      var totalValidVotes = (candidates || []).reduce(function (s, c) { return s + Number(c.votes || 0); }, 0);
      var candidateStats = (candidates || []).slice().sort(function (a, b) {
        return Number(a.nomorUrut) - Number(b.nomorUrut);
      }).map(function (c) {
        var v = Number(c.votes || 0);
        return {
          id: c.id, nomorUrut: c.nomorUrut, ketuaName: c.ketuaName, ketuaClass: c.ketuaClass,
          wakilName: c.wakilName, wakilClass: c.wakilClass, photoUrl: c.photoUrl, vision: c.vision,
          missions: c.missions || [], votes: v, accentColor: c.accentColor,
          percentage: totalValidVotes > 0 ? Math.round((v / totalValidVotes) * 1000) / 10 : 0
        };
      });
      var gradeStats = ['X', 'XI', 'XII'].map(function (g) {
        var list = (voters || []).filter(function (v) { return v.grade === g; });
        var voted = list.filter(function (v) { return v.hasVoted; }).length;
        return {
          grade: g,
          label: 'Kelas ' + g,
          total: list.length,
          voted: voted,
          percentage: list.length > 0 ? Math.round((voted / list.length) * 1000) / 10 : 0
        };
      });
      return {
        totalDpt: totalDpt,
        totalVoted: totalVoted,
        totalNotVoted: totalNotVoted,
        participationRate: participationRate,
        totalValidVotes: totalValidVotes,
        candidateStats: candidateStats,
        gradeStats: gradeStats
      };
    }

    // Resize device-uploaded image safely under ~30KB JPEG so Google Sheets 50k cell limit never breaks
    function resizeImageForSheets(file, maxDim, callback) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          var quality = 0.78;
          var out = canvas.toDataURL('image/jpeg', quality);
          while (out.length > 35000 && quality > 0.35) {
            quality -= 0.1;
            out = canvas.toDataURL('image/jpeg', quality);
          }
          if (out.length > 38000) {
            showToast('error', 'Ukuran Gambar Terlalu Besar', 'Gunakan gambar yang lebih ringan agar muat disimpan di Google Sheets.');
            return;
          }
          callback(out);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    }

    // =========================================================================
    // 3. SCREEN RENDERERS (LOGIN_PORTAL, VOTER_PORTAL, RECEIPT, LIVE_MONITOR, ADMIN_LOGIN, ADMIN_PANEL)
    // =========================================================================
    var SCROLL_SHOW_THRESHOLD = 40;
    function getActiveScrollerGas() {
      var els = document.querySelectorAll('[data-page-scroller="true"]');
      var first = els.length > 0 ? els[0] : null;
      for (var i = 0; i < els.length; i++) {
        if (els[i].scrollHeight > els[i].clientHeight && els[i].scrollTop > 0) return els[i];
      }
      return first;
    }

    function evaluateScrollTopButtonGas() {
      var btn = document.getElementById('scroll-top-btn');
      if (!btn) return;
      var scroller = getActiveScrollerGas();
      var top = scroller ? scroller.scrollTop : (window.scrollY || window.pageYOffset || 0);
      if (top > SCROLL_SHOW_THRESHOLD) btn.classList.remove('hidden');
      else btn.classList.add('hidden');
    }

    function scrollToTopGas() {
      var els = document.querySelectorAll('[data-page-scroller="true"]');
      for (var i = 0; i < els.length; i++) {
        if (els[i].scrollTop > 0) els[i].scrollTo({ top: 0, behavior: 'smooth' });
      }
      if ((window.scrollY || window.pageYOffset || 0) > 0) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    function toggleFullscreenGas() {
      try {
        if (!document.fullscreenElement) {
          var req = document.documentElement.requestFullscreen ? document.documentElement.requestFullscreen() : null;
          if (req && typeof req.then === 'function') {
            req.then(function () { state.isFullscreen = true; render(); }).catch(function () { state.isFullscreen = !state.isFullscreen; render(); });
          } else {
            state.isFullscreen = !state.isFullscreen;
            render();
          }
        } else {
          var ex = document.exitFullscreen ? document.exitFullscreen() : null;
          if (ex && typeof ex.then === 'function') {
            ex.then(function () { state.isFullscreen = false; render(); }).catch(function () { state.isFullscreen = false; render(); });
          } else {
            state.isFullscreen = false;
            render();
          }
        }
      } catch (err) {
        state.isFullscreen = !state.isFullscreen;
        render();
      }
    }

    function setScreen(next) {
      if (state.receiptTimer) { clearInterval(state.receiptTimer); state.receiptTimer = null; }
      state.screen = next;
      render();
    }

    function render() {
      var db = activeDb();
      applyThemeVars(db.settings && db.settings.theme);
      var root = document.getElementById('app-root');
      if (state.screen === 'LOGIN_PORTAL') root.innerHTML = renderLoginPortal(db);
      else if (state.screen === 'VOTER_PORTAL') root.innerHTML = renderVoterPortal(db);
      else if (state.screen === 'RECEIPT') root.innerHTML = renderReceiptScreen(db);
      else if (state.screen === 'LIVE_MONITOR') root.innerHTML = renderLiveMonitor(db);
      else if (state.screen === 'ADMIN_LOGIN') root.innerHTML = renderAdminLogin(db);
      else if (state.screen === 'ADMIN_PANEL') root.innerHTML = renderAdminPanel(db);
      evaluateScrollTopButtonGas();
    }

    // --- SCREEN A: LOGIN PORTAL (Exact 2-column institutional UI) ---
    function renderLoginPortal(db) {
      var s = db.settings || {};
      var totalDpt = (db.voters || []).length;
      var totalVoted = (db.voters || []).filter(function (v) { return v.hasVoted; }).length;
      return '' +
        '<header class="bg-white border-b border-slate-200 shrink-0 z-30">' +
          '<div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">' +
            '<span class="text-xs sm:text-lg font-extrabold tracking-tight truncate min-w-0" style="color: var(--app-primary);">E-VOTING PENGURUS OSIS</span>' +
            '<div class="flex items-center gap-1.5 sm:gap-2.5 shrink-0">' +
              '<button type="button" onclick="toggleFullscreenGas()" aria-label="' + (state.isFullscreen ? 'Keluar layar penuh' : 'Mode layar penuh proyektor') + '" class="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 sm:py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer">' +
                svgIcon(state.isFullscreen ? 'minimize' : 'maximize', 'w-4 h-4', 'color: var(--app-secondary)') +
                '<span class="hidden sm:inline">' + (state.isFullscreen ? 'Normal' : 'Proyektor') + '</span>' +
              '</button>' +
              '<button type="button" onclick="state.adminError=\\'\\';setScreen(\\'ADMIN_LOGIN\\')" class="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer">' +
                svgIcon('shield', 'w-4 h-4', 'color: var(--app-secondary)') +
                '<span><span class="hidden sm:inline">Login </span>Admin</span>' +
              '</button>' +
              '<button type="button" onclick="setScreen(\\'LIVE_MONITOR\\')" class="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-lg text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer" style="background-color: var(--app-primary);">' +
                svgIcon('chart', 'w-4 h-4', 'color: var(--app-accent)') +
                '<span><span class="hidden sm:inline">Live </span>Monitor</span>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</header>' +
        '<div data-page-scroller="true" class="flex-1 min-h-0 overflow-y-auto">' +
        '<main class="min-h-full max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12 flex items-center">' +
          '<div class="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">' +
            '<section class="lg:col-span-7 flex flex-col justify-between text-white rounded-2xl p-6 sm:p-10" style="background-color: var(--app-primary);">' +
              '<div>' +
                '<div class="flex items-center gap-4 mb-6">' +
                  '<div class="w-16 h-16 rounded-xl bg-white p-1.5 shrink-0 flex items-center justify-center overflow-hidden">' +
                    renderSchoolLogoHtml(s.logoUrl, s.schoolName, 'w-full h-full object-contain', 'w-full h-full') +
                  '</div>' +
                  '<div>' +
                    '<p class="text-sm font-semibold tracking-wide" style="color: var(--app-accent);">' + esc(s.schoolName) + '</p>' +
                    '<p class="text-xs text-slate-300 mt-0.5">Tahun Ajaran ' + esc(s.academicYear) + ' · Komisi Pemilihan Pengurus OSIS</p>' +
                  '</div>' +
                '</div>' +
                '<h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">' + esc(s.electionTitle) + '</h1>' +
                '<p class="mt-4 text-slate-200 text-base leading-relaxed max-w-xl">' +
                  'Gunakan hak suara Anda secara langsung, bebas, rahasia, jujur, dan adil. Setiap siswa hanya dapat memberikan suara satu kali menggunakan NIS atau NISN yang terdaftar di DPT.' +
                '</p>' +
              '</div>' +
              '<div class="mt-8 pt-6 border-t border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-6">' +
                '<div>' +
                  '<p class="text-xs text-slate-300">Status Bilik Suara</p>' +
                  '<div class="mt-1.5 flex items-center gap-2 text-sm font-semibold">' +
                    (s.isBoothOpen
                      ? svgIcon('checkCircle', 'w-4 h-4 text-emerald-400 shrink-0') + '<span class="text-emerald-300">Dibuka untuk Pemilih</span>'
                      : svgIcon('lock', 'w-4 h-4 text-amber-400 shrink-0') + '<span class="text-amber-300">Ditutup Sementara</span>') +
                  '</div>' +
                '</div>' +
                '<div>' +
                  '<p class="text-xs text-slate-300">Daftar Pemilih Tetap</p>' +
                  '<p class="mt-1 text-xl font-bold font-mono tabular-nums text-white">' + totalDpt + ' Siswa</p>' +
                '</div>' +
                '<div>' +
                  '<p class="text-xs text-slate-300">Suara Masuk Sementara</p>' +
                  '<p class="mt-1 text-xl font-bold font-mono tabular-nums" style="color: var(--app-accent);">' + totalVoted + ' Suara</p>' +
                '</div>' +
              '</div>' +
            '</section>' +
            '<section class="lg:col-span-5 flex flex-col justify-between bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">' +
              '<div>' +
                '<div class="flex items-center gap-3 mb-5">' +
                  '<div class="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0" style="color: var(--app-primary);">' +
                    svgIcon('userCheck', 'w-5 h-5') +
                  '</div>' +
                  '<div>' +
                    '<h2 class="text-xl font-bold text-slate-900">Login Pemilih</h2>' +
                    '<p class="text-xs text-slate-500 mt-0.5">Masukkan NIS atau NISN Anda untuk langsung masuk bilik suara.</p>' +
                  '</div>' +
                '</div>' +
                '<form onsubmit="handleVoterSubmit(event)" class="space-y-5">' +
                  (state.voterError ? '<div role="alert" class="flex items-start gap-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">' + svgIcon('alert', 'w-5 h-5 shrink-0 text-rose-600 mt-0.5') + '<span class="font-medium leading-snug">' + esc(state.voterError) + '</span></div>' : '') +
                  '<div>' +
                    '<label for="voter-nis" class="block text-sm font-semibold text-slate-700 mb-1.5">Nomor Induk Siswa (NIS / NISN)</label>' +
                    '<input id="voter-nis" type="text" inputmode="numeric" autocomplete="off" placeholder="Contoh: 2024001" class="w-full min-h-[50px] px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 font-mono text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-700" />' +
                    '<p class="mt-2 text-xs text-slate-500">Cukup masukkan NIS/NISN yang terdaftar di Daftar Pemilih Tetap tanpa token tambahan.</p>' +
                  '</div>' +
                  '<button type="submit" class="w-full min-h-[52px] py-3.5 px-6 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer" style="background-color: var(--app-primary);">' +
                    '<span>Masuk Bilik Suara</span>' + svgIcon('arrowRight', 'w-5 h-5') +
                  '</button>' +
                '</form>' +
              '</div>' +
              '<div class="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between gap-4">' +
                '<p class="text-xs text-slate-500 leading-relaxed">Pantau hasil perolehan suara secara langsung tanpa perlu login.</p>' +
                '<button type="button" onclick="setScreen(\\'LIVE_MONITOR\\')" class="text-sm font-semibold underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer" style="color: var(--app-secondary);">Buka Live Monitor</button>' +
              '</div>' +
            '</section>' +
          '</div>' +
        '</main></div>';
    }

    function handleVoterSubmit(e) {
      e.preventDefault();
      var nis = (document.getElementById('voter-nis').value || '').trim();
      state.voterError = '';
      if (!nis) {
        state.voterError = 'Harap masukkan Nomor Induk Siswa (NIS / NISN) Anda.';
        render();
        showToast('error', 'Data Belum Lengkap', state.voterError);
        return;
      }
      gasCall('loginVoter', [nis], 'Memeriksa NIS / NISN...', function (res) {
        if (!res || !res.ok) {
          state.voterError = (res && res.error) || 'NIS / NISN tidak valid.';
          render();
          showToast('error', 'Akses Ditolak', state.voterError);
          return;
        }
        state.activeVoter = res.voter;
        showToast('success', 'Autentikasi Berhasil', 'Selamat datang, ' + res.voter.name + '.');
        setScreen('VOTER_PORTAL');
      });
    }

    // --- SCREEN B: VOTER PORTAL (Bilik Suara + Visi & Misi Modal + Konfirmasi Ganda Modal) ---
    function renderVoterPortal(db) {
      var v = state.activeVoter || {};
      var cands = (db.candidates || []).slice().sort(function (a, b) { return Number(a.nomorUrut) - Number(b.nomorUrut); });
      return '' +
        '<header class="bg-white border-b border-slate-200 shrink-0 z-30">' +
          '<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">' +
            '<div class="flex items-center gap-3 min-w-0">' +
              '<div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background-color: var(--app-primary); color: var(--app-accent);">' +
                svgIcon('vote', 'w-5 h-5') +
              '</div>' +
              '<div class="min-w-0">' +
                '<p class="text-sm font-extrabold truncate" style="color: var(--app-primary);">Bilik Suara Elektronik · ' + esc(db.settings.schoolName) + '</p>' +
                '<p class="text-xs text-slate-500 truncate">' + esc(db.settings.electionTitle) + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="flex items-center gap-3 shrink-0">' +
              '<div class="hidden sm:block text-right">' +
                '<p class="text-xs font-bold text-slate-900">' + esc(v.name) + '</p>' +
                '<p class="text-[11px] font-mono text-slate-500">NIS ' + esc(v.nis) + ' · ' + esc(v.kelas) + '</p>' +
              '</div>' +
              '<button type="button" onclick="state.activeVoter=null;setScreen(\\'LOGIN_PORTAL\\')" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer">' +
                svgIcon('logout', 'w-4 h-4') + '<span>Batal / Keluar</span>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</header>' +
        '<div data-page-scroller="true" class="flex-1 min-h-0 overflow-y-auto">' +
        '<main class="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">' +
          '<div class="rounded-2xl p-5 sm:p-6 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4" style="background-color: var(--app-primary);">' +
            '<div>' +
              '<p class="text-xs font-mono font-bold uppercase tracking-wider" style="color: var(--app-accent);">Pemilih Terverifikasi</p>' +
              '<h1 class="text-xl sm:text-2xl font-extrabold mt-0.5">Selamat Memilih, ' + esc(v.name) + '</h1>' +
              '<p class="text-xs sm:text-sm text-slate-300 mt-1">Kelas ' + esc(v.kelas) + ' · Pilih satu pasangan calon Ketua &amp; Wakil Ketua OSIS di bawah ini.</p>' +
            '</div>' +
            '<div class="px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-xs font-mono">' +
              '<p class="text-slate-300">Total Kandidat</p>' +
              '<p class="text-base font-extrabold text-white">' + cands.length + ' Pasangan Calon</p>' +
            '</div>' +
          '</div>' +
          '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">' +
            cands.map(function (c) {
              return '' +
                '<article class="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-md transition-shadow">' +
                  '<div>' +
                    '<div class="relative aspect-[4/3] bg-slate-100 overflow-hidden border-b border-slate-100">' +
                      renderCandidatePortraitHtml(c, 'w-full h-full object-cover object-top') +
                      '<span class="absolute top-3 left-3 px-3 py-1.5 rounded-xl text-xs font-mono font-extrabold shadow-md text-white" style="background-color: var(--app-primary);">' +
                        'PASLON 0' + esc(c.nomorUrut) +
                      '</span>' +
                    '</div>' +
                    '<div class="p-6">' +
                      '<div class="space-y-3">' +
                        '<div>' +
                          '<p class="text-xs font-semibold text-slate-500">Calon Ketua OSIS</p>' +
                          '<h3 class="text-lg font-extrabold text-slate-900 leading-snug">' + esc(c.ketuaName) + '</h3>' +
                          '<p class="text-xs text-slate-600">' + esc(c.ketuaClass) + '</p>' +
                        '</div>' +
                        '<div class="pt-2 border-t border-slate-100">' +
                          '<p class="text-xs font-semibold text-slate-500">Calon Wakil Ketua OSIS</p>' +
                          '<p class="text-base font-bold text-slate-800 leading-snug">' + esc(c.wakilName) + '</p>' +
                          '<p class="text-xs text-slate-600">' + esc(c.wakilClass) + '</p>' +
                        '</div>' +
                      '</div>' +
                      '<div class="mt-4 pt-4 border-t border-slate-100">' +
                        '<p class="text-xs font-semibold text-slate-500 mb-1">Visi Singkat</p>' +
                        '<p class="text-sm text-slate-700 leading-relaxed line-clamp-3">&ldquo;' + esc(c.vision) + '&rdquo;</p>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="px-6 pb-6 pt-2 flex flex-col gap-3">' +
                    '<button type="button" onclick="openVisiMisiModal(\\'' + esc(c.id) + '\\')" class="w-full min-h-[44px] py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer">' +
                      svgIcon('eye', 'w-4 h-4', 'color: var(--app-secondary)') + '<span>Lihat Visi &amp; Misi</span>' +
                    '</button>' +
                    '<button type="button" onclick="openConfirmVoteModal(\\'' + esc(c.id) + '\\')" class="w-full min-h-[52px] py-3.5 px-5 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer hover:opacity-95" style="background-color: var(--app-primary);">' +
                      svgIcon('vote', 'w-5 h-5') + '<span>Pilih Paslon Ini</span>' +
                    '</button>' +
                  '</div>' +
                '</article>';
            }).join('') +
          '</div>' +
        '</main></div>';
    }

    function openVisiMisiModal(candId) {
      var cand = (activeDb().candidates || []).filter(function (c) { return c.id === candId; })[0];
      if (!cand) return;
      openModal(
        '<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-xl">' +
            '<div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50">' +
              '<div>' +
                '<p class="text-xs font-mono font-bold text-amber-600">PASANGAN CALON 0' + esc(cand.nomorUrut) + '</p>' +
                '<h2 class="text-lg font-extrabold text-slate-900">' + esc(cand.ketuaName) + ' &amp; ' + esc(cand.wakilName) + '</h2>' +
              '</div>' +
              '<button type="button" onclick="closeModal()" aria-label="Tutup" class="p-2 rounded-lg text-slate-500 hover:bg-slate-200 cursor-pointer">' + svgIcon('x', 'w-5 h-5') + '</button>' +
            '</div>' +
            '<div class="p-6 overflow-y-auto space-y-6">' +
              '<div>' +
                '<h3 class="text-sm font-bold text-slate-900 mb-2">Visi</h3>' +
                '<p class="text-sm sm:text-base text-slate-800 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200">' + esc(cand.vision) + '</p>' +
              '</div>' +
              '<div>' +
                '<h3 class="text-sm font-bold text-slate-900 mb-2">Misi</h3>' +
                '<ol class="space-y-2.5 list-decimal list-inside text-sm text-slate-700 leading-relaxed">' +
                  (cand.missions || []).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') +
                '</ol>' +
              '</div>' +
            '</div>' +
            '<div class="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 bg-slate-50">' +
              '<button type="button" onclick="closeModal()" class="px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-sm cursor-pointer">Tutup</button>' +
              '<button type="button" onclick="closeModal();openConfirmVoteModal(\\'' + esc(cand.id) + '\\')" class="px-5 py-2.5 rounded-xl text-white font-bold text-sm cursor-pointer" style="background-color: var(--app-primary);">Pilih Paslon 0' + esc(cand.nomorUrut) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    function openConfirmVoteModal(candId) {
      var cand = (activeDb().candidates || []).filter(function (c) { return c.id === candId; })[0];
      if (!cand) return;
      openModal(
        '<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl">' +
            '<div class="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mb-4 text-amber-600">' +
              svgIcon('alert', 'w-6 h-6') +
            '</div>' +
            '<h2 class="text-xl font-extrabold text-slate-900">Konfirmasi Pilihan Anda</h2>' +
            '<p class="text-sm text-slate-600 mt-2 leading-relaxed">Apakah Anda yakin dengan pilihan Anda? Pilihan tidak dapat diubah setelah suara dikirim.</p>' +
            '<div class="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">' +
              '<p class="text-xs font-mono font-bold" style="color: var(--app-secondary);">PASANGAN CALON 0' + esc(cand.nomorUrut) + '</p>' +
              '<p class="text-base font-extrabold text-slate-900 mt-1">' + esc(cand.ketuaName) + ' &amp; ' + esc(cand.wakilName) + '</p>' +
              '<p class="text-xs text-slate-500 mt-0.5">' + esc(cand.ketuaClass) + ' · ' + esc(cand.wakilClass) + '</p>' +
            '</div>' +
            '<div class="mt-6 grid grid-cols-2 gap-3">' +
              '<button type="button" onclick="closeModal()" class="min-h-[48px] py-3 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-semibold text-sm cursor-pointer">Batal, Periksa Ulang</button>' +
              '<button type="button" onclick="submitConfirmedVote(\\'' + esc(cand.id) + '\\')" class="min-h-[48px] py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm cursor-pointer">Ya, Kirim Suara</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    function submitConfirmedVote(candId) {
      if (!state.activeVoter) return;
      closeModal();
      gasCall('submitVote', [state.activeVoter.id, candId], 'Menyimpan suara sah...', function (res) {
        if (!res || !res.ok) {
          showToast('error', 'Gagal Mengirim Suara', (res && res.error) || 'Suara tidak dapat diproses.');
          return;
        }
        if (res.db) {
          state.appData = res.db;
        }
        state.receipt = res.receipt;
        state.activeVoter = null;
        state.receiptCountdown = 5;
        state.screen = 'RECEIPT';
        render();
        showToast('success', 'Suara Berhasil Dicatat', 'Terima kasih telah berpartisipasi dalam pemilihan OSIS.');
        state.receiptTimer = setInterval(function () {
          state.receiptCountdown -= 1;
          var cdEl = document.getElementById('receipt-countdown');
          if (cdEl) cdEl.textContent = String(Math.max(0, state.receiptCountdown));
          if (state.receiptCountdown <= 0) {
            clearInterval(state.receiptTimer);
            state.receiptTimer = null;
            setScreen('LOGIN_PORTAL');
          }
        }, 1000);
      });
    }

    // --- SCREEN C: DIGITAL RECEIPT ---
    function renderReceiptScreen(db) {
      var r = state.receipt || {};
      return '' +
        '<div data-page-scroller="true" class="flex-1 min-h-0 overflow-y-auto">' +
          '<div class="min-h-full flex items-center justify-center p-4" style="background-color: var(--app-bg);">' +
            '<section class="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm text-center">' +
              '<div class="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-5 text-emerald-600">' +
                svgIcon('checkCircle', 'w-9 h-9') +
              '</div>' +
              '<span class="inline-block px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">Suara Sah Tercatat</span>' +
              '<h1 class="mt-3 text-2xl font-extrabold text-slate-900">Terima Kasih Telah Memilih</h1>' +
              '<p class="mt-2 text-sm text-slate-600 leading-relaxed">Suara Anda telah masuk ke kotak suara digital dan tersinkronisasi aman dengan Google Sheets.</p>' +
              '<div class="mt-6 rounded-xl bg-slate-50 border border-slate-200 p-4 text-left space-y-2.5 text-sm">' +
                '<div class="flex justify-between gap-2 pb-2 border-b border-slate-200">' +
                  '<span class="text-slate-500">Kode Bukti</span>' +
                  '<span class="font-mono font-bold" style="color: var(--app-primary);">' + esc(r.receiptCode) + '</span>' +
                '</div>' +
                '<div class="flex justify-between gap-2"><span class="text-slate-500">Pemilih</span><span class="font-semibold text-slate-900 text-right">' + esc(r.voterName) + '</span></div>' +
                '<div class="flex justify-between gap-2"><span class="text-slate-500">NIS / NISN</span><span class="font-mono text-slate-800">' + esc(r.voterNis) + '</span></div>' +
                '<div class="flex justify-between gap-2"><span class="text-slate-500">Kelas</span><span class="text-slate-800">' + esc(r.voterClass) + '</span></div>' +
                '<div class="flex justify-between gap-2"><span class="text-slate-500">Waktu Tercatat</span><span class="font-mono text-xs text-slate-700">' + esc(new Date(r.timestamp || Date.now()).toLocaleString('id-ID')) + '</span></div>' +
              '</div>' +
              '<p class="mt-5 text-xs text-slate-500">Kembali otomatis ke Login Pemilih dalam <strong id="receipt-countdown" class="font-mono text-slate-900">' + state.receiptCountdown + '</strong> detik...</p>' +
              '<button type="button" onclick="setScreen(\\'LOGIN_PORTAL\\')" class="mt-4 w-full py-3 px-4 rounded-xl text-white font-semibold text-sm cursor-pointer" style="background-color: var(--app-primary);">Selesai &amp; Kembali Sekarang</button>' +
            '</section>' +
          '</div>' +
        '</div>';
    }

    // --- SCREEN D: LIVE MONITOR (Bar Chart + SVG Donut Chart + X/XI/XII Grade Stats + Secret Mode) ---
    function renderLiveMonitor(db) {
      var stats = computeStats(db.voters, db.candidates);
      var isSecret = !!(db.settings && db.settings.hideLiveResults);
      var maxVotes = Math.max.apply(null, [1].concat(stats.candidateStats.map(function (c) { return c.votes; })));
      var radius = 84;
      var circumference = 2 * Math.PI * radius;
      var cumulativeOffset = 0;
      var nowText = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      var donutSegments = stats.candidateStats.map(function (c, idx) {
        var frac = stats.totalValidVotes > 0 ? c.votes / stats.totalValidVotes : 0;
        var dashLen = frac * circumference;
        var offset = cumulativeOffset;
        cumulativeOffset += dashLen;
        return {
          c: c,
          color: c.accentColor || CHART_COLORS[idx % CHART_COLORS.length],
          dashArray: dashLen + ' ' + (circumference - dashLen),
          dashOffset: -offset
        };
      });

      return '' +
        '<header class="text-white border-b border-white/10 shrink-0 z-30" style="background-color: var(--app-primary);">' +
          '<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">' +
            '<div class="flex items-center gap-4 min-w-0">' +
              '<button type="button" onclick="setScreen(state.adminCreds ? \\'ADMIN_PANEL\\' : \\'LOGIN_PORTAL\\')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold cursor-pointer">' +
                svgIcon('arrowLeft', 'w-4 h-4') + '<span>Kembali</span>' +
              '</button>' +
              '<div class="min-w-0">' +
                '<h1 class="text-base sm:text-lg font-extrabold truncate">Live Monitor Quick Count</h1>' +
                '<p class="text-xs text-slate-300 truncate hidden sm:block">' + esc(db.settings.schoolName) + ' · Tahun Ajaran ' + esc(db.settings.academicYear) + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="flex items-center gap-3 shrink-0">' +
              '<div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-mono font-bold">' +
                '<span class="relative flex h-2.5 w-2.5"><span class="animate-live-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span></span>' +
                '<span>LIVE</span><span id="live-clock" class="hidden md:inline text-emerald-200/80 tabular-nums">' + esc(nowText) + '</span>' +
              '</div>' +
              '<button type="button" onclick="toggleSecretModeGas()" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold cursor-pointer ' + (isSecret ? 'bg-amber-500 text-slate-950 hover:bg-amber-400' : 'bg-white/10 hover:bg-white/20 text-white') + '">' +
                svgIcon(isSecret ? 'eye' : 'eyeOff', 'w-4 h-4') +
                '<span>' + (isSecret ? 'Tampilkan Hasil' : 'Sembunyikan Hasil') + '</span>' +
              '</button>' +
              '<button type="button" onclick="toggleFullscreenGas()" aria-label="' + (state.isFullscreen ? 'Keluar layar penuh' : 'Mode layar penuh proyektor') + '" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer">' +
                svgIcon(state.isFullscreen ? 'minimize' : 'maximize', 'w-4 h-4') +
                '<span class="hidden sm:inline">' + (state.isFullscreen ? 'Normal' : 'Proyektor') + '</span>' +
              '</button>' +
              '<button type="button" onclick="refreshFromGas(true)" class="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer">' +
                svgIcon('rotate', 'w-4 h-4') + '<span>Segarkan</span>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</header>' +
        '<div data-page-scroller="true" class="flex-1 min-h-0 overflow-y-auto">' +
        '<main class="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">' +
          '<section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">' +
            '<div class="bg-white border border-slate-200 rounded-2xl p-5"><p class="text-xs font-semibold text-slate-500">Total Daftar Pemilih Tetap</p><p class="mt-2 text-3xl font-extrabold font-mono tabular-nums text-slate-900">' + stats.totalDpt + '</p><p class="text-xs text-slate-500 mt-1">Siswa terdaftar aktif</p></div>' +
            '<div class="bg-white border border-slate-200 rounded-2xl p-5"><p class="text-xs font-semibold text-slate-500">Total Suara Masuk</p><p class="mt-2 text-3xl font-extrabold font-mono tabular-nums text-emerald-600">' + stats.totalVoted + '</p><p class="text-xs text-slate-500 mt-1">Pemilih telah mencoblos</p></div>' +
            '<div class="bg-white border border-slate-200 rounded-2xl p-5"><p class="text-xs font-semibold text-slate-500">Belum Menggunakan Hak Suara</p><p class="mt-2 text-3xl font-extrabold font-mono tabular-nums text-amber-600">' + stats.totalNotVoted + '</p><p class="text-xs text-slate-500 mt-1">Menunggu kehadiran di bilik</p></div>' +
            '<div class="text-white rounded-2xl p-5" style="background-color: var(--app-primary);">' +
              '<p class="text-xs font-semibold text-slate-300">Tingkat Partisipasi Keseluruhan</p>' +
              '<p class="mt-2 text-3xl font-extrabold font-mono tabular-nums" style="color: var(--app-accent);">' + stats.participationRate + '%</p>' +
              '<div class="mt-2.5 w-full bg-white/15 rounded-full h-2 overflow-hidden"><div class="h-full" style="width:' + Math.min(100, stats.participationRate) + '%; background-color: var(--app-accent);"></div></div>' +
            '</div>' +
          '</section>' +
          (isSecret
            ? '<section class="bg-white border border-amber-300 rounded-2xl p-10 sm:p-14 text-center shadow-sm">' +
                '<div class="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-5 text-amber-600">' + svgIcon('lock', 'w-8 h-8') + '</div>' +
                '<h2 class="text-2xl font-extrabold text-slate-900">Mode Rahasia Aktif — Perolehan Suara Disembunyikan</h2>' +
                '<p class="text-sm sm:text-base text-slate-600 mt-2 max-w-xl mx-auto leading-relaxed">Panitia saat ini menahan publikasi grafik dan angka perolehan suara masing-masing pasangan calon hingga waktu pemilihan selesai. Statistik partisipasi pemilih tetap diperbarui secara realtime.</p>' +
                '<button type="button" onclick="toggleSecretModeGas()" class="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-xl text-white font-bold text-sm cursor-pointer" style="background-color: var(--app-primary);">' + svgIcon('eye', 'w-4 h-4') + '<span>Tampilkan Hasil Sekarang</span></button>' +
              '</section>'
            : '<section class="grid grid-cols-1 lg:grid-cols-12 gap-6">' +
                '<div class="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6">' +
                  '<div class="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">' +
                    '<div><h2 class="text-lg font-extrabold text-slate-900">Grafik Batang Perolehan Suara</h2><p class="text-xs text-slate-500 mt-0.5">Perbandingan jumlah suara sah setiap pasangan calon</p></div>' +
                    '<span class="text-xs font-mono font-semibold text-slate-700 tabular-nums">Total Sah: ' + stats.totalValidVotes + ' Suara</span>' +
                  '</div>' +
                  '<div class="mt-6 space-y-6">' +
                    stats.candidateStats.map(function (c, idx) {
                      var color = c.accentColor || CHART_COLORS[idx % CHART_COLORS.length];
                      var wPct = stats.totalValidVotes > 0 ? Math.max(4, (c.votes / maxVotes) * 100) : 0;
                      return '<div class="p-3 rounded-xl hover:bg-slate-50 transition-colors">' +
                        '<div class="flex items-center justify-between gap-3 mb-2">' +
                          '<div class="flex items-center gap-3 min-w-0">' +
                            '<div class="w-11 h-11 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">' + renderCandidatePortraitHtml(c, 'w-full h-full object-cover object-top') + '</div>' +
                            '<div class="min-w-0"><p class="text-xs font-mono font-bold text-slate-500">PASLON 0' + esc(c.nomorUrut) + '</p><p class="text-sm sm:text-base font-bold text-slate-900 truncate">' + esc(c.ketuaName) + ' &amp; ' + esc(c.wakilName) + '</p></div>' +
                          '</div>' +
                          '<div class="text-right shrink-0"><p class="text-lg font-extrabold font-mono tabular-nums text-slate-900">' + c.percentage + '%</p><p class="text-xs font-mono tabular-nums text-slate-500">' + c.votes + ' suara</p></div>' +
                        '</div>' +
                        '<div class="w-full h-4 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full transition-all duration-500" style="width:' + wPct + '%; background-color:' + esc(color) + ';"></div></div>' +
                      '</div>';
                    }).join('') +
                  '</div>' +
                '</div>' +
                '<div class="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between">' +
                  '<div class="pb-4 border-b border-slate-100"><h2 class="text-lg font-extrabold text-slate-900">Grafik Donat Proporsi Suara</h2><p class="text-xs text-slate-500 mt-0.5">Distribusi persentase suara masuk sah</p></div>' +
                  '<div class="my-6 flex flex-col items-center justify-center">' +
                    '<div class="relative w-56 h-56 flex items-center justify-center">' +
                      '<svg viewBox="0 0 220 220" class="w-full h-full -rotate-90" role="img" aria-label="Grafik Donat">' +
                        '<circle cx="110" cy="110" r="' + radius + '" fill="none" stroke="#E2E8F0" stroke-width="28" />' +
                        (stats.totalValidVotes > 0 ? donutSegments.map(function (seg) {
                          return '<circle cx="110" cy="110" r="' + radius + '" fill="none" stroke="' + esc(seg.color) + '" stroke-width="28" stroke-dasharray="' + seg.dashArray + '" stroke-dashoffset="' + seg.dashOffset + '" />';
                        }).join('') : '') +
                      '</svg>' +
                      '<div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">' +
                        svgIcon('vote', 'w-5 h-5 mb-1', 'color: var(--app-secondary)') +
                        '<span class="text-3xl font-extrabold font-mono tabular-nums text-slate-900">' + stats.totalValidVotes + '</span>' +
                        '<span class="text-xs font-medium text-slate-500">Suara Sah</span>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="space-y-2.5 pt-4 border-t border-slate-100">' +
                    stats.candidateStats.map(function (c, idx) {
                      var color = c.accentColor || CHART_COLORS[idx % CHART_COLORS.length];
                      return '<div class="flex items-center justify-between text-sm py-1">' +
                        '<div class="flex items-center gap-2.5 min-w-0"><span class="w-3 h-3 rounded-sm shrink-0" style="background-color:' + esc(color) + ';"></span><span class="font-semibold text-slate-800 truncate">0' + esc(c.nomorUrut) + '. ' + esc(c.ketuaName) + ' &amp; ' + esc(c.wakilName) + '</span></div>' +
                        '<span class="font-mono font-bold tabular-nums text-slate-900 shrink-0 ml-2">' + c.votes + ' (' + c.percentage + '%)</span>' +
                      '</div>';
                    }).join('') +
                  '</div>' +
                '</div>' +
              '</section>') +
          '<section class="bg-white border border-slate-200 rounded-2xl p-6">' +
            '<div class="flex items-center gap-2.5 pb-4 border-b border-slate-100">' +
              svgIcon('users', 'w-5 h-5', 'color: var(--app-secondary)') +
              '<div><h2 class="text-lg font-extrabold text-slate-900">Partisipasi Pemilih Per Angkatan</h2><p class="text-xs text-slate-500">Pemantauan kehadiran pemilih berdasarkan jenjang kelas X, XI, dan XII</p></div>' +
            '</div>' +
            '<div class="mt-5 grid grid-cols-1 md:grid-cols-3 gap-6">' +
              stats.gradeStats.map(function (g) {
                return '<div class="p-4 rounded-xl bg-slate-50 border border-slate-200">' +
                  '<div class="flex items-center justify-between mb-2"><h3 class="text-base font-bold text-slate-900">' + esc(g.label) + '</h3><span class="font-mono text-sm font-extrabold tabular-nums" style="color: var(--app-secondary);">' + g.percentage + '%</span></div>' +
                  '<div class="w-full h-3 bg-slate-200 rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:' + Math.min(100, g.percentage) + '%; background-color: var(--app-secondary);"></div></div>' +
                  '<div class="mt-2.5 flex items-center justify-between text-xs text-slate-600 font-mono tabular-nums"><span>Sudah: ' + g.voted + ' siswa</span><span>Total: ' + g.total + ' siswa</span></div>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</section>' +
        '</main></div>';
    }

    function toggleSecretModeGas() {
      gasCall('adminToggleSecretMode', [], 'Memperbarui tampilan Live Monitor...', function (res) {
        if (res && res.ok) {
          if (res.db) {
            state.appData = res.db;
            if (state.adminDb) state.adminDb = res.db;
          }
          render();
          showToast('info', res.hideLiveResults ? 'Mode Rahasia Diaktifkan' : 'Hasil Ditampilkan');
        }
      });
    }

    // --- SCREEN E: ADMIN LOGIN + FORGOT PASSWORD WHATSAPP ---
    function renderAdminLogin(db) {
      return '' +
        '<header class="bg-white border-b border-slate-200 shrink-0 z-30">' +
          '<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">' +
            '<div class="flex items-center gap-4 min-w-0">' +
              '<button type="button" onclick="setScreen(\\'LOGIN_PORTAL\\')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold cursor-pointer">' +
                svgIcon('arrowLeft', 'w-4 h-4') + '<span>Portal Pemilih</span>' +
              '</button>' +
              '<span class="text-lg font-extrabold tracking-tight whitespace-nowrap truncate" style="color: var(--app-primary);">E-VOTING PENGURUS OSIS</span>' +
            '</div>' +
            '<button type="button" onclick="setScreen(\\'LIVE_MONITOR\\')" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-semibold cursor-pointer" style="background-color: var(--app-primary);">' +
              svgIcon('chart', 'w-4 h-4', 'color: var(--app-accent)') + '<span>Live Monitor</span>' +
            '</button>' +
          '</div>' +
        '</header>' +
        '<div data-page-scroller="true" class="flex-1 min-h-0 overflow-y-auto">' +
        '<main class="min-h-full flex items-center justify-center p-4 sm:p-6">' +
          '<section class="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">' +
            '<div class="flex items-center gap-3 mb-6">' +
              '<div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style="background-color: var(--app-primary); color: var(--app-accent);">' + svgIcon('shield', 'w-6 h-6') + '</div>' +
              '<div><p class="text-xs font-semibold text-amber-700">' + esc(db.settings.schoolName) + '</p><h1 class="text-xl font-extrabold text-slate-900">Login Panel Panitia</h1></div>' +
            '</div>' +
            '<p class="text-sm text-slate-600 mb-6 leading-relaxed">Halaman khusus panitia pemilihan (Admin) dan pembina (SuperAdmin) untuk mengelola DPT, kandidat, dan pengaturan pemilihan.</p>' +
            '<form onsubmit="handleAdminLoginSubmit(event)" class="space-y-5">' +
              (state.adminError ? '<div role="alert" class="flex items-start gap-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">' + svgIcon('alert', 'w-5 h-5 shrink-0 text-rose-600 mt-0.5') + '<span>' + esc(state.adminError) + '</span></div>' : '') +
              '<div><label for="adm-user" class="block text-sm font-semibold text-slate-700 mb-1.5">Username Pengelola</label><input id="adm-user" type="text" autocomplete="username" placeholder="Masukkan username admin" class="w-full min-h-[48px] px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-base" /></div>' +
              '<div><label for="adm-pass" class="block text-sm font-semibold text-slate-700 mb-1.5">Kata Sandi</label><div class="relative"><input id="adm-pass" type="' + (state.showAdminPass ? 'text' : 'password') + '" autocomplete="current-password" placeholder="Masukkan kata sandi" class="w-full min-h-[48px] pl-4 pr-12 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-base" /><button type="button" onclick="state.showAdminPass=!state.showAdminPass;render()" class="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 cursor-pointer">' + svgIcon(state.showAdminPass ? 'eyeOff' : 'eye', 'w-5 h-5') + '</button></div></div>' +
              '<button type="submit" class="w-full min-h-[52px] py-3.5 px-6 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 cursor-pointer" style="background-color: var(--app-primary);"><span>Masuk Panel Admin</span>' + svgIcon('arrowRight', 'w-5 h-5') + '</button>' +
            '</form>' +
            '<div class="mt-4">' +
              '<button type="button" onclick="openForgotPasswordModal()" class="w-full py-2.5 px-4 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer">' +
                svgIcon('key', 'w-4 h-4') + '<span>Lupa Password? Konfirmasi via WhatsApp</span>' +
              '</button>' +
            '</div>' +
            '<div class="mt-6 pt-5 border-t border-slate-100 text-center">' +
              '<button type="button" onclick="setScreen(\\'LOGIN_PORTAL\\')" class="text-sm font-semibold text-slate-600 underline underline-offset-4 cursor-pointer">Kembali ke Portal Pemilih (Siswa)</button>' +
            '</div>' +
          '</section>' +
        '</main></div>';
    }

    function handleAdminLoginSubmit(e) {
      e.preventDefault();
      var u = (document.getElementById('adm-user').value || '').trim();
      var p = document.getElementById('adm-pass').value || '';
      state.adminError = '';
      if (!u || !p) {
        state.adminError = 'Masukkan username dan kata sandi pengelola.';
        render();
        return;
      }
      gasCall('loginAdmin', [u, p], 'Memverifikasi akun pengelola...', function (res) {
        if (!res || !res.ok) {
          state.adminError = (res && res.error) || 'Username atau kata sandi admin tidak valid.';
          render();
          showToast('error', 'Login Admin Gagal', state.adminError);
          return;
        }
        state.adminCreds = { username: u, password: p, admin: res.admin };
        state.adminDb = res.db;
        state.appData = res.db;
        state.adminTab = 'overview';
        showToast('success', 'Login Pengelola Berhasil', 'Masuk sebagai ' + res.admin.fullName + ' (' + res.admin.role + ').');
        setScreen('ADMIN_PANEL');
      });
    }

    function openForgotPasswordModal() {
      var uVal = (document.getElementById('adm-user') && document.getElementById('adm-user').value) || '';
      openModal(
        '<div class="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden">' +
            '<div class="px-6 py-4 text-white flex items-center justify-between" style="background-color: var(--app-primary);">' +
              '<div class="flex items-center gap-2.5">' + svgIcon('message', 'w-5 h-5', 'color: var(--app-accent)') + '<h2 class="font-bold text-lg">Lupa Password Pengelola</h2></div>' +
              '<button type="button" onclick="closeModal()" class="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer">' + svgIcon('x', 'w-5 h-5') + '</button>' +
            '</div>' +
            '<form onsubmit="submitForgotRequest(event)" class="p-6 space-y-4">' +
              '<p class="text-sm text-slate-600 leading-relaxed">Masukkan username SuperAdmin atau Admin beserta <strong>Nomor WhatsApp</strong> yang terdaftar pada Manajemen Akun Panitia.</p>' +
              '<div id="forgot-err-box" class="hidden p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"></div>' +
              '<div><label class="block text-sm font-semibold text-slate-700 mb-1">Username SuperAdmin / Admin *</label><input id="fp-user" type="text" required value="' + esc(uVal) + '" placeholder="Contoh: smansakabun atau panitia1" class="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm" /></div>' +
              '<div><label class="block text-sm font-semibold text-slate-700 mb-1">Nomor WhatsApp Terdaftar *</label><input id="fp-wa" type="tel" required placeholder="081234567890" class="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-mono" /></div>' +
              '<div class="pt-2 flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-sm cursor-pointer">Batal</button><button type="submit" class="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm cursor-pointer">Kirim Konfirmasi WhatsApp</button></div>' +
            '</form>' +
          '</div>' +
        '</div>'
      );
    }

    function submitForgotRequest(e) {
      e.preventDefault();
      var u = document.getElementById('fp-user').value.trim();
      var wa = document.getElementById('fp-wa').value.trim();
      gasCall('requestAdminForgotPassword', [u, wa], 'Memeriksa akun & WhatsApp...', function (res) {
        if (!res || !res.ok) {
          var box = document.getElementById('forgot-err-box');
          if (box) { box.textContent = (res && res.error) || 'Verifikasi gagal.'; box.classList.remove('hidden'); }
          return;
        }
        openModal(
          '<div class="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">' +
            '<div class="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden">' +
              '<div class="px-6 py-4 text-white flex items-center justify-between" style="background-color: var(--app-primary);">' +
                '<div class="flex items-center gap-2.5">' + svgIcon('message', 'w-5 h-5', 'color: var(--app-accent)') + '<h2 class="font-bold text-lg">Verifikasi Kode WhatsApp</h2></div>' +
                '<button type="button" onclick="closeModal()" class="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer">' + svgIcon('x', 'w-5 h-5') + '</button>' +
              '</div>' +
              '<form onsubmit="submitForgotReset(event, \\'' + esc(u) + '\\')" class="p-6 space-y-4">' +
                '<div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2 text-xs text-emerald-900">' +
                  '<p class="font-bold">Akun Terverifikasi: ' + esc(res.adminFullName) + ' (' + esc(res.role) + ')</p>' +
                  '<p>Tujuan WhatsApp: <strong class="font-mono">' + esc(res.maskedWhatsapp) + '</strong></p>' +
                  '<div class="flex items-center justify-between pt-2 border-t border-emerald-200">' +
                    '<span>Kode: <strong class="font-mono text-sm bg-white px-2 py-0.5 rounded border border-emerald-300">' + esc(res.otpPreview) + '</strong></span>' +
                    '<a href="' + esc(res.waUrl) + '" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold">Buka WhatsApp</a>' +
                  '</div>' +
                '</div>' +
                '<div id="forgot-reset-err" class="hidden p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"></div>' +
                '<div><label class="block text-sm font-semibold text-slate-700 mb-1">Kode Konfirmasi (6 Digit) *</label><input id="fp-otp" type="text" maxlength="6" required class="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-mono tracking-widest" /></div>' +
                '<div><label class="block text-sm font-semibold text-slate-700 mb-1">Password Baru *</label><input id="fp-newpw" type="password" minlength="4" required class="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm" /></div>' +
                '<div class="pt-2 flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-sm cursor-pointer">Batal</button><button type="submit" class="px-5 py-2.5 rounded-lg text-white font-semibold text-sm cursor-pointer" style="background-color: var(--app-primary);">Simpan Password Baru</button></div>' +
              '</form>' +
            '</div>' +
          '</div>'
        );
      });
    }

    function submitForgotReset(e, username) {
      e.preventDefault();
      var otp = document.getElementById('fp-otp').value.trim();
      var newPw = document.getElementById('fp-newpw').value;
      gasCall('resetAdminForgotPassword', [username, otp, newPw], 'Menyimpan kata sandi baru...', function (res) {
        if (!res || !res.ok) {
          var box = document.getElementById('forgot-reset-err');
          if (box) { box.textContent = (res && res.error) || 'Gagal reset password.'; box.classList.remove('hidden'); }
          return;
        }
        if (res.db) state.appData = res.db;
        closeModal();
        showToast('success', 'Kata Sandi Diperbarui', 'Silakan login kembali dengan password baru Anda.');
      });
    }

    // --- SCREEN F: FULL SIDEBAR ADMIN PANEL ---
    function renderAdminPanel(db) {
      var admin = (state.adminCreds && state.adminCreds.admin) || { fullName: 'Pengelola', role: 'ADMIN' };
      var isSuper = admin.role === 'SUPERADMIN';
      var navItems = [
        { id: 'overview', label: 'Ringkasan', icon: 'dashboard', superOnly: false },
        { id: 'dpt', label: 'Manajemen DPT', icon: 'users', superOnly: false },
        { id: 'candidates', label: 'Kandidat Paslon', icon: 'userCheck', superOnly: true },
        { id: 'staff', label: 'Akun Panitia', icon: 'userCog', superOnly: true },
        { id: 'settings', label: 'Pengaturan', icon: 'settings', superOnly: true },
        { id: 'audit', label: 'Log Aktivitas', icon: 'history', superOnly: true }
      ].filter(function (i) { return !i.superOnly || isSuper; });
      if (!isSuper && state.adminTab !== 'overview' && state.adminTab !== 'dpt') {
        state.adminTab = 'overview';
      }
      var activeLabel = (navItems.filter(function (i) { return i.id === state.adminTab; })[0] || navItems[0]).label;

      var tabHtml = '';
      if (state.adminTab === 'overview') tabHtml = renderAdminOverviewTab(db, admin);
      else if (state.adminTab === 'dpt') tabHtml = renderAdminDptTab(db);
      else if (state.adminTab === 'candidates' && isSuper) tabHtml = renderAdminCandidatesTab(db);
      else if (state.adminTab === 'staff' && isSuper) tabHtml = renderAdminStaffTab(db, admin);
      else if (state.adminTab === 'settings' && isSuper) tabHtml = renderAdminSettingsTab(db);
      else if (state.adminTab === 'audit' && isSuper) tabHtml = renderAdminAuditTab(db);

      return '' +
        '<div class="h-screen overflow-hidden flex flex-col lg:flex-row" style="background-color: var(--app-bg);">' +
          '<aside class="lg:w-64 lg:h-full overflow-y-auto text-white shrink-0 flex flex-col justify-between" style="background-color: var(--app-primary);">' +
            '<div>' +
              '<div class="px-6 py-5 border-b border-white/10">' +
                '<p class="text-xs font-mono font-bold" style="color: var(--app-accent);">PANEL PENGELOLA</p>' +
                '<h1 class="text-base font-extrabold tracking-tight mt-0.5 leading-snug">E-VOTING PENGURUS OSIS</h1>' +
                '<p class="text-xs text-slate-300 mt-1 truncate">' + esc(db.settings.schoolName) + '</p>' +
              '</div>' +
              '<nav class="p-3 flex lg:flex-col gap-1 overflow-x-auto">' +
                navItems.map(function (item) {
                  var isAct = state.adminTab === item.id;
                  return '<button type="button" onclick="state.adminTab=\\'' + item.id + '\\';render()" ' +
                    (isAct ? 'style="background-color: var(--app-accent);"' : '') +
                    ' class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ' +
                    (isAct ? 'text-slate-950 font-bold' : 'text-slate-200 hover:bg-white/10 font-semibold') + '">' +
                    svgIcon(item.icon, 'w-4 h-4 shrink-0') + '<span>' + esc(item.label) + '</span>' +
                  '</button>';
                }).join('') +
              '</nav>' +
            '</div>' +
            '<div class="hidden lg:block p-4 border-t border-white/10 space-y-3">' +
              '<div class="px-2"><p class="text-xs text-slate-400">Masuk sebagai</p><p class="text-sm font-bold text-white truncate mt-0.5">' + esc(admin.fullName) + '</p><p class="text-[11px] font-mono mt-0.5" style="color: var(--app-accent);">' + esc(admin.role) + '</p></div>' +
              '<button type="button" onclick="adminLogoutGas()" class="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold cursor-pointer">' +
                svgIcon('logout', 'w-4 h-4') + '<span>Keluar Panel</span>' +
              '</button>' +
            '</div>' +
          '</aside>' +
          '<div class="flex-1 min-h-0 flex flex-col min-w-0">' +
            '<header class="bg-white border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between gap-4 shrink-0 z-20">' +
              '<div class="flex items-center gap-2 min-w-0">' +
                svgIcon('shield', 'w-5 h-5 shrink-0', 'color: var(--app-secondary)') +
                '<span class="text-sm font-bold text-slate-900 truncate">' + esc(activeLabel) + '</span>' +
                '<span class="text-slate-300 hidden sm:inline">·</span>' +
                '<span class="text-xs font-mono text-slate-500 hidden sm:inline">' + esc(admin.role) + '</span>' +
              '</div>' +
              '<div class="flex items-center gap-2.5 shrink-0">' +
                '<button type="button" onclick="printOfficialPdfGas()" class="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold cursor-pointer">' +
                  svgIcon('fileDown', 'w-4 h-4 text-rose-600') + '<span>Unduh Hasil PDF</span>' +
                '</button>' +
                '<button type="button" onclick="toggleFullscreenGas()" aria-label="' + (state.isFullscreen ? 'Keluar layar penuh' : 'Mode layar penuh proyektor') + '" class="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold whitespace-nowrap cursor-pointer">' +
                  svgIcon(state.isFullscreen ? 'minimize' : 'maximize', 'w-4 h-4', 'color: var(--app-secondary)') +
                  '<span class="hidden sm:inline">' + (state.isFullscreen ? 'Normal' : 'Proyektor') + '</span>' +
                '</button>' +
                '<button type="button" onclick="setScreen(\\'LIVE_MONITOR\\')" class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-white text-xs font-bold cursor-pointer" style="background-color: var(--app-primary);">' +
                  svgIcon('chart', 'w-4 h-4', 'color: var(--app-accent)') + '<span>Live Monitor</span>' +
                '</button>' +
                '<button type="button" onclick="adminLogoutGas()" class="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold cursor-pointer">' +
                  svgIcon('logout', 'w-4 h-4') + '<span>Keluar</span>' +
                '</button>' +
              '</div>' +
            '</header>' +
            '<div data-page-scroller="true" class="flex-1 min-h-0 overflow-y-auto">' +
              '<main class="p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">' + tabHtml + '</main>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    function adminLogoutGas() {
      state.adminCreds = null;
      state.adminDb = null;
      showToast('info', 'Keluar dari Panel', 'Sesi pengelola diakhiri dengan aman.');
      setScreen('LOGIN_PORTAL');
    }

    function renderAdminOverviewTab(db, admin) {
      var stats = computeStats(db.voters, db.candidates);
      var isSuper = admin.role === 'SUPERADMIN';
      return '<div class="space-y-6">' +
        '<section class="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">' +
          '<div class="flex items-start gap-3.5 min-w-0">' +
            '<div class="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">' + svgIcon('fileDown', 'w-5 h-5') + '</div>' +
            '<div class="min-w-0"><h2 class="text-base font-extrabold text-slate-900">Download Laporan Hasil Pemilihan (PDF)</h2><p class="text-xs text-slate-600 mt-0.5 leading-relaxed">Unduh atau cetak berita acara resmi perolehan suara pasangan calon, tingkat partisipasi DPT, serta rincian per angkatan.</p></div>' +
          '</div>' +
          '<button type="button" onclick="printOfficialPdfGas()" class="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-white text-sm font-bold whitespace-nowrap shrink-0 cursor-pointer" style="background-color: var(--app-primary);">' +
            svgIcon('fileDown', 'w-4 h-4', 'color: var(--app-accent)') + '<span>Download Hasil (PDF)</span>' +
          '</button>' +
        '</section>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">' +
          '<div class="bg-white border border-slate-200 rounded-2xl p-5"><p class="text-xs font-semibold text-slate-500">Total DPT Terdaftar</p><p class="mt-2 text-3xl font-extrabold font-mono tabular-nums text-slate-900">' + stats.totalDpt + '</p><p class="text-xs text-slate-500 mt-1">Siswa berhak memilih</p></div>' +
          '<div class="bg-white border border-slate-200 rounded-2xl p-5"><p class="text-xs font-semibold text-slate-500">Total Suara Masuk</p><p class="mt-2 text-3xl font-extrabold font-mono tabular-nums text-emerald-600">' + stats.totalVoted + '</p><p class="text-xs text-slate-500 mt-1">Sudah mencoblos</p></div>' +
          '<div class="bg-white border border-slate-200 rounded-2xl p-5"><p class="text-xs font-semibold text-slate-500">Total Belum Memilih</p><p class="mt-2 text-3xl font-extrabold font-mono tabular-nums text-amber-600">' + stats.totalNotVoted + '</p><p class="text-xs text-slate-500 mt-1">Belum menggunakan suara</p></div>' +
          '<div class="text-white rounded-2xl p-5" style="background-color: var(--app-primary);"><p class="text-xs font-semibold text-slate-300">Persentase Partisipasi</p><p class="mt-2 text-3xl font-extrabold font-mono tabular-nums" style="color: var(--app-accent);">' + stats.participationRate + '%</p><p class="text-xs text-slate-300 mt-1">Bilik Suara: ' + (db.settings.isBoothOpen ? 'Dibuka' : 'Ditutup') + '</p></div>' +
        '</div>' +
        '<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">' +
          '<div class="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6">' +
            '<h2 class="text-base font-extrabold text-slate-900 mb-4">Partisipasi Pemilih per Angkatan</h2>' +
            '<div class="space-y-4">' +
              stats.gradeStats.map(function (g) {
                return '<div><div class="flex items-center justify-between text-sm mb-1.5"><span class="font-semibold text-slate-800">' + esc(g.label) + '</span><span class="font-mono text-xs font-bold text-slate-700 tabular-nums">' + g.voted + '/' + g.total + ' siswa (' + g.percentage + '%)</span></div><div class="w-full h-3 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:' + Math.min(100, g.percentage) + '%; background-color: var(--app-secondary);"></div></div></div>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between gap-4">' +
            '<div>' +
              '<h2 class="text-base font-extrabold text-slate-900">Informasi Pemilihan Aktif</h2>' +
              '<dl class="mt-4 space-y-3 text-sm">' +
                '<div class="flex justify-between gap-2 pb-2 border-b border-slate-100"><dt class="text-slate-500">Sekolah</dt><dd class="font-semibold text-slate-900 text-right">' + esc(db.settings.schoolName) + '</dd></div>' +
                '<div class="flex justify-between gap-2 pb-2 border-b border-slate-100"><dt class="text-slate-500">Tahun Ajaran</dt><dd class="font-mono font-semibold text-slate-900">' + esc(db.settings.academicYear) + '</dd></div>' +
                '<div class="flex justify-between gap-2 pb-2 border-b border-slate-100"><dt class="text-slate-500">Jumlah Paslon</dt><dd class="font-mono font-semibold text-slate-900">' + (db.candidates || []).length + ' Pasangan</dd></div>' +
                '<div class="flex justify-between gap-2"><dt class="text-slate-500">Hak Akses Anda</dt><dd class="font-mono font-bold" style="color: var(--app-secondary);">' + (isSuper ? 'SuperAdmin (Penuh)' : 'Admin (Panitia DPT)') + '</dd></div>' +
              '</dl>' +
            '</div>' +
            '<button type="button" onclick="state.adminTab=\\'dpt\\';render()" class="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-bold cursor-pointer">Kelola Daftar Pemilih Tetap (DPT)</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // --- ADMIN TAB: MANAJEMEN DPT ---
    function renderAdminDptTab(db) {
      var voters = db.voters || [];
      var q = state.dptSearch.toLowerCase();
      var filtered = voters.filter(function (v) {
        var mQ = !q || String(v.name).toLowerCase().indexOf(q) >= 0 || String(v.nis).toLowerCase().indexOf(q) >= 0 || String(v.kelas).toLowerCase().indexOf(q) >= 0;
        var mG = state.dptGradeFilter === 'ALL' || v.grade === state.dptGradeFilter;
        var mS = state.dptStatusFilter === 'ALL' || (state.dptStatusFilter === 'VOTED' ? v.hasVoted : !v.hasVoted);
        return mQ && mG && mS;
      });

      return '<div class="space-y-6">' +
        '<div class="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">' +
          '<div><h2 class="text-lg font-extrabold text-slate-900">Manajemen Daftar Pemilih Tetap (DPT)</h2><p class="text-xs text-slate-500 mt-0.5">Siswa cukup login menggunakan NIS/NISN yang terdaftar di sini.</p></div>' +
          '<div class="flex flex-wrap gap-2.5">' +
            '<button type="button" onclick="exportDptCsvGas()" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold cursor-pointer">' + svgIcon('download', 'w-4 h-4') + '<span>Ekspor CSV</span></button>' +
            '<label class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold cursor-pointer">' + svgIcon('upload', 'w-4 h-4') + '<span>Impor CSV</span><input type="file" accept=".csv" class="hidden" onchange="importDptCsvGas(this)" /></label>' +
            '<button type="button" onclick="openVoterFormModal()" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold cursor-pointer" style="background-color: var(--app-primary);">' + svgIcon('plus', 'w-4 h-4') + '<span>Tambah Pemilih</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row gap-3 items-center justify-between">' +
          '<div class="relative w-full md:max-w-xs"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">' + svgIcon('search', 'w-4 h-4') + '</span><input type="text" value="' + esc(state.dptSearch) + '" oninput="state.dptSearch=this.value;render()" placeholder="Cari NIS / Nama / Kelas..." class="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-300 text-xs" /></div>' +
          '<div class="flex flex-wrap items-center gap-2 w-full md:w-auto">' +
            '<select onchange="state.dptGradeFilter=this.value;render()" class="h-10 px-3 rounded-xl border border-slate-300 text-xs font-semibold">' +
              '<option value="ALL"' + (state.dptGradeFilter === 'ALL' ? ' selected' : '') + '>Semua Angkatan</option>' +
              '<option value="X"' + (state.dptGradeFilter === 'X' ? ' selected' : '') + '>Kelas X</option>' +
              '<option value="XI"' + (state.dptGradeFilter === 'XI' ? ' selected' : '') + '>Kelas XI</option>' +
              '<option value="XII"' + (state.dptGradeFilter === 'XII' ? ' selected' : '') + '>Kelas XII</option>' +
            '</select>' +
            '<select onchange="state.dptStatusFilter=this.value;render()" class="h-10 px-3 rounded-xl border border-slate-300 text-xs font-semibold">' +
              '<option value="ALL"' + (state.dptStatusFilter === 'ALL' ? ' selected' : '') + '>Semua Status</option>' +
              '<option value="VOTED"' + (state.dptStatusFilter === 'VOTED' ? ' selected' : '') + '>Sudah Memilih</option>' +
              '<option value="NOT_VOTED"' + (state.dptStatusFilter === 'NOT_VOTED' ? ' selected' : '') + '>Belum Memilih</option>' +
            '</select>' +
            (state.selectedVoterIds.length > 0 ? '<button type="button" onclick="confirmBulkDeleteVotersGas()" class="h-10 px-3.5 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">Hapus Terpilih (' + state.selectedVoterIds.length + ')</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">' +
          '<div class="overflow-x-auto"><table class="w-full text-left border-collapse">' +
            '<thead class="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600"><tr>' +
              '<th class="p-3.5 w-10"><input type="checkbox" onchange="toggleSelectAllVotersGas(this.checked)" /></th>' +
              '<th class="p-3.5">NIS / NISN</th><th class="p-3.5">Nama Lengkap</th><th class="p-3.5">Kelas</th><th class="p-3.5">Status</th><th class="p-3.5 text-right">Aksi</th>' +
            '</tr></thead>' +
            '<tbody class="divide-y divide-slate-100 text-xs">' +
              (filtered.length === 0 ? '<tr><td colspan="6" class="p-8 text-center text-slate-500">Tidak ada data pemilih yang cocok.</td></tr>' : filtered.map(function (v) {
                var checked = state.selectedVoterIds.indexOf(v.id) >= 0 ? ' checked' : '';
                return '<tr class="hover:bg-slate-50/70">' +
                  '<td class="p-3.5"><input type="checkbox"' + checked + ' onchange="toggleSelectVoterGas(\\'' + esc(v.id) + '\\', this.checked)" /></td>' +
                  '<td class="p-3.5 font-mono font-bold text-slate-900">' + esc(v.nis) + '</td>' +
                  '<td class="p-3.5 font-semibold text-slate-900">' + esc(v.name) + '</td>' +
                  '<td class="p-3.5 text-slate-600">' + esc(v.kelas) + '</td>' +
                  '<td class="p-3.5">' + (v.hasVoted ? '<span class="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold">Sudah Memilih</span>' : '<span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold">Belum Memilih</span>') + '</td>' +
                  '<td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">' +
                    '<button type="button" onclick="openVoterFormModal(\\'' + esc(v.id) + '\\')" class="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 cursor-pointer" aria-label="Edit">' + svgIcon('edit', 'w-3.5 h-3.5') + '</button>' +
                    '<button type="button" onclick="confirmDeleteVoterGas(\\'' + esc(v.id) + '\\')" class="p-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600 cursor-pointer" aria-label="Hapus">' + svgIcon('trash', 'w-3.5 h-3.5') + '</button>' +
                  '</td>' +
                '</tr>';
              }).join('')) +
            '</tbody>' +
          '</table></div>' +
        '</div>' +
      '</div>';
    }

    function toggleSelectVoterGas(id, isChecked) {
      if (isChecked && state.selectedVoterIds.indexOf(id) < 0) state.selectedVoterIds.push(id);
      if (!isChecked) state.selectedVoterIds = state.selectedVoterIds.filter(function (x) { return x !== id; });
      render();
    }

    function toggleSelectAllVotersGas(isChecked) {
      state.selectedVoterIds = isChecked ? (activeDb().voters || []).map(function (v) { return v.id; }) : [];
      render();
    }

    var tempVoterCandId = '';

    function buildVoterPaslonPanelHtml(checked, selectedCandId) {
      if (!checked) return '';
      var db = activeDb();
      var admin = (state.adminCreds && state.adminCreds.admin) || { role: 'ADMIN' };
      var isSuper = admin.role === 'SUPERADMIN';
      var cands = (db.candidates || []).slice().sort(function (a, b) { return Number(a.nomorUrut) - Number(b.nomorUrut); });
      var chosen = cands.filter(function (c) { return c.id === selectedCandId; })[0] || null;

      return '<div id="dpt-voted-paslon-panel" class="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">' +
        '<div>' +
          '<p class="text-[11px] font-bold uppercase tracking-wide text-slate-500">Paslon Ketua &amp; Wakil Ketua yang Dipilih</p>' +
          (chosen
            ? '<div class="mt-1.5 flex items-start gap-2.5">' +
                '<span class="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold text-white shrink-0 mt-0.5" style="background-color:' + esc(chosen.accentColor || 'var(--app-primary)') + ';">0' + esc(chosen.nomorUrut) + '</span>' +
                '<div class="min-w-0"><p class="text-xs font-extrabold text-slate-900">' + esc(chosen.ketuaName) + ' &amp; ' + esc(chosen.wakilName) + '</p><p class="text-[11px] text-slate-500">' + esc(chosen.ketuaClass) + ' · ' + esc(chosen.wakilClass) + '</p></div>' +
              '</div>'
            : '<p class="mt-1 text-xs font-medium text-amber-700">Pilihan pasangan calon belum tercatat pada pemilih ini.</p>') +
        '</div>' +
        (isSuper
          ? '<div class="pt-2 border-t border-slate-200/80">' +
              '<label for="dpt-voted-candidate" class="block text-[11px] font-bold text-slate-700 mb-1">Ubah Paslon Pilihan (Khusus SuperAdmin)</label>' +
              '<select id="dpt-voted-candidate" onchange="onVoterCandSelectChangeGas(this.value)" class="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-900">' +
                '<option value="">-- Belum Ditentukan --</option>' +
                cands.map(function (c) {
                  return '<option value="' + esc(c.id) + '"' + (selectedCandId === c.id ? ' selected' : '') + '>Paslon 0' + esc(c.nomorUrut) + ' — ' + esc(c.ketuaName) + ' &amp; ' + esc(c.wakilName) + '</option>';
                }).join('') +
              '</select>' +
              '<p class="text-[11px] text-slate-500 mt-1">Perolehan suara paslon otomatis disesuaikan saat perubahan disimpan.</p>' +
            '</div>'
          : '<p class="text-[11px] text-slate-500 pt-1 border-t border-slate-200/80">Hanya SuperAdmin yang dapat mengubah pasangan calon yang dipilih.</p>') +
      '</div>';
    }

    function refreshVoterPaslonPanelGas() {
      var cb = document.getElementById('vf-has-voted');
      var container = document.getElementById('vf-paslon-slot');
      if (!cb || !container) return;
      if (!cb.checked) tempVoterCandId = '';
      container.innerHTML = buildVoterPaslonPanelHtml(cb.checked, tempVoterCandId);
    }

    function onVoterCandSelectChangeGas(nextId) {
      tempVoterCandId = nextId || '';
      refreshVoterPaslonPanelGas();
    }

    function openVoterFormModal(voterId) {
      var existing = voterId ? (activeDb().voters || []).filter(function (v) { return v.id === voterId; })[0] : null;
      tempVoterCandId = existing && existing.votedCandidateId ? existing.votedCandidateId : '';
      var hasVotedChecked = existing ? Boolean(existing.hasVoted) : false;

      openModal(
        '<div class="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200">' +
            '<div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50"><h3 class="text-base font-extrabold">' + (existing ? 'Edit Data Pemilih' : 'Tambah Pemilih Baru') + '</h3><button type="button" onclick="closeModal()" class="p-1 rounded-lg text-slate-500 cursor-pointer">' + svgIcon('x', 'w-5 h-5') + '</button></div>' +
            '<form onsubmit="saveVoterFormGas(event, \\'' + esc(voterId || '') + '\\')" class="p-6 space-y-4">' +
              '<div><label class="block text-xs font-bold text-slate-700 mb-1">NIS / NISN *</label><input id="vf-nis" type="text" required value="' + esc(existing ? existing.nis : '') + '" class="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm font-mono" /></div>' +
              '<div><label class="block text-xs font-bold text-slate-700 mb-1">Nama Lengkap *</label><input id="vf-name" type="text" required value="' + esc(existing ? existing.name : '') + '" class="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm" /></div>' +
              '<div><label class="block text-xs font-bold text-slate-700 mb-1">Kelas (contoh: X Merdeka 1) *</label><input id="vf-kelas" type="text" required value="' + esc(existing ? existing.kelas : '') + '" class="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm" /></div>' +
              (existing
                ? '<div class="space-y-3 pt-1">' +
                    '<label class="flex items-center gap-2 cursor-pointer">' +
                      '<input id="vf-has-voted" type="checkbox"' + (hasVotedChecked ? ' checked' : '') + ' onchange="refreshVoterPaslonPanelGas()" class="w-4 h-4 rounded border-slate-300" />' +
                      '<span class="text-xs font-semibold text-slate-700">Tandai sudah menggunakan hak suara</span>' +
                    '</label>' +
                    '<div id="vf-paslon-slot">' + buildVoterPaslonPanelHtml(hasVotedChecked, tempVoterCandId) + '</div>' +
                  '</div>'
                : '') +
              '<div class="pt-2 flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold cursor-pointer">Batal</button><button type="submit" class="px-5 py-2 rounded-xl text-white text-xs font-bold cursor-pointer" style="background-color: var(--app-primary);">Simpan DPT</button></div>' +
            '</form>' +
          '</div>' +
        '</div>'
      );
    }

    function inferGradeGas(kelas) {
      var up = String(kelas || '').trim().toUpperCase();
      if (up.indexOf('XII') === 0 || up.indexOf('12') === 0) return 'XII';
      if (up.indexOf('XI') === 0 || up.indexOf('11') === 0) return 'XI';
      return 'X';
    }

    function saveVoterFormGas(e, voterId) {
      e.preventDefault();
      var nis = document.getElementById('vf-nis').value.trim();
      var name = document.getElementById('vf-name').value.trim();
      var kelas = document.getElementById('vf-kelas').value.trim();
      var db = activeDb();
      if (voterId) {
        var admin = (state.adminCreds && state.adminCreds.admin) || { role: 'ADMIN' };
        var isSuper = admin.role === 'SUPERADMIN';
        var cb = document.getElementById('vf-has-voted');
        var hasVoted = cb ? cb.checked : false;
        var sel = document.getElementById('dpt-voted-candidate');
        var chosenCandId = (isSuper && hasVoted) ? (sel ? sel.value : tempVoterCandId) : '';
        closeModal();
        gasCall('adminEditVoter', [state.adminCreds.username, state.adminCreds.password, voterId, { nis: nis, name: name, kelas: kelas, hasVoted: hasVoted, votedCandidateId: chosenCandId }], 'Menyimpan perubahan pemilih...', function (res) {
          if (!res || !res.ok) return showToast('error', 'Gagal Menyimpan DPT', (res && res.error) || '');
          state.adminDb = res.db; state.appData = res.db; render();
          showToast('success', 'DPT Diperbarui', name + ' berhasil disimpan.');
        });
      } else {
        var next = (db.voters || []).slice();
        next.unshift({ id: 'v_' + Date.now(), nis: nis, name: name, kelas: kelas, grade: inferGradeGas(kelas), token: '000000', hasVoted: false });
        closeModal();
        gasCall('adminSaveVoters', [state.adminCreds.username, state.adminCreds.password, next, 'Tambah pemilih ' + name], 'Menyimpan data DPT...', function (res) {
          if (!res || !res.ok) return showToast('error', 'Gagal Menyimpan DPT', (res && res.error) || '');
          state.adminDb = res.db; state.appData = res.db; render();
          showToast('success', 'DPT Diperbarui', name + ' berhasil disimpan.');
        });
      }
    }

    function confirmDeleteVoterGas(voterId) {
      var v = (activeDb().voters || []).filter(function (x) { return x.id === voterId; })[0];
      if (!v) return;
      openModal(
        '<div class="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">' +
            '<h3 class="text-base font-extrabold text-slate-900">Hapus Pemilih DPT?</h3>' +
            '<p class="text-xs text-slate-600">Apakah Anda yakin ingin menghapus <strong>' + esc(v.name) + '</strong> (NIS ' + esc(v.nis) + ') dari Daftar Pemilih Tetap?</p>' +
            '<div class="flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold cursor-pointer">Batal</button><button type="button" onclick="executeDeleteVotersGas([\\'' + esc(voterId) + '\\'], \\'Hapus pemilih ' + esc(v.name) + '\\')" class="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">Ya, Hapus</button></div>' +
          '</div>' +
        '</div>'
      );
    }

    function confirmBulkDeleteVotersGas() {
      var count = state.selectedVoterIds.length;
      if (count === 0) return;
      openModal(
        '<div class="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">' +
            '<h3 class="text-base font-extrabold text-slate-900">Hapus ' + count + ' Pemilih Terpilih?</h3>' +
            '<p class="text-xs text-slate-600">Data yang dihapus akan langsung disinkronkan ke Google Sheets.</p>' +
            '<div class="flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold cursor-pointer">Batal</button><button type="button" onclick="executeDeleteVotersGas(state.selectedVoterIds.slice(), \\'Hapus massal ' + count + ' DPT\\')" class="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">Ya, Hapus Semua</button></div>' +
          '</div>' +
        '</div>'
      );
    }

    function executeDeleteVotersGas(ids, detail) {
      closeModal();
      var next = (activeDb().voters || []).filter(function (v) { return ids.indexOf(v.id) < 0; });
      state.selectedVoterIds = [];
      gasCall('adminSaveVoters', [state.adminCreds.username, state.adminCreds.password, next, detail], 'Menghapus data DPT...', function (res) {
        if (!res || !res.ok) return showToast('error', 'Gagal Menghapus DPT', (res && res.error) || '');
        state.adminDb = res.db; state.appData = res.db; render();
        showToast('success', 'Data DPT Dihapus');
      });
    }

    function exportDptCsvGas() {
      var rows = [['NIS', 'Nama', 'Kelas', 'Angkatan', 'Status']];
      (activeDb().voters || []).forEach(function (v) {
        rows.push([v.nis, v.name, v.kelas, v.grade, v.hasVoted ? 'Sudah Memilih' : 'Belum Memilih']);
      });
      var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'dpt-e-voting-osis.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function importDptCsvGas(input) {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        var lines = String(ev.target.result || '').split(/\\r?\\n/).filter(function (l) { return l.trim().length > 0; });
        var added = [];
        lines.forEach(function (line, idx) {
          var cols = line.split(/[,;]/).map(function (c) { return c.replace(/^"|"$/g, '').trim(); });
          if (idx === 0 && cols[0].toLowerCase().indexOf('nis') >= 0) return;
          if (cols.length >= 3 && cols[0] && cols[1]) {
            added.push({ id: 'v_' + Date.now() + '_' + idx, nis: cols[0], name: cols[1], kelas: cols[2], grade: inferGradeGas(cols[2]), token: '000000', hasVoted: false });
          }
        });
        if (added.length === 0) return showToast('error', 'Format CSV Kosong', 'Gunakan kolom: NIS,Nama,Kelas');
        var next = added.concat(activeDb().voters || []);
        gasCall('adminSaveVoters', [state.adminCreds.username, state.adminCreds.password, next, 'Impor CSV ' + added.length + ' pemilih'], 'Mengimpor CSV DPT...', function (res) {
          if (!res || !res.ok) return showToast('error', 'Gagal Impor', (res && res.error) || '');
          state.adminDb = res.db; state.appData = res.db; render();
          showToast('success', 'Impor Berhasil', added.length + ' pemilih ditambahkan.');
        });
      };
      reader.readAsText(file);
    }

    // --- ADMIN TAB: KANDIDAT PASLON (Visi & Misi only, NO Program Kerja, device photo upload) ---
    function renderAdminCandidatesTab(db) {
      var cands = (db.candidates || []).slice().sort(function (a, b) { return Number(a.nomorUrut) - Number(b.nomorUrut); });
      return '<div class="space-y-6">' +
        '<div class="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">' +
          '<div><h2 class="text-lg font-extrabold text-slate-900">Manajemen Kandidat Pasangan Calon</h2><p class="text-xs text-slate-500 mt-0.5">Kelola foto paslon (unggah dari penyimpanan perangkat), nama ketua/wakil, serta Visi &amp; Misi.</p></div>' +
          '<button type="button" onclick="openCandFormModal()" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold cursor-pointer" style="background-color: var(--app-primary);">' + svgIcon('plus', 'w-4 h-4') + '<span>Tambah Paslon Baru</span></button>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">' +
          cands.map(function (c) {
            return '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between">' +
              '<div>' +
                '<div class="relative aspect-[4/3] bg-slate-100 overflow-hidden">' +
                  renderCandidatePortraitHtml(c, 'w-full h-full object-cover object-top') +
                  '<span class="absolute top-3 left-3 px-2.5 py-1 rounded-lg text-xs font-mono font-extrabold text-white" style="background-color: var(--app-primary);">PASLON 0' + esc(c.nomorUrut) + '</span>' +
                '</div>' +
                '<div class="p-5 space-y-2">' +
                  '<h3 class="text-base font-extrabold text-slate-900">' + esc(c.ketuaName) + ' &amp; ' + esc(c.wakilName) + '</h3>' +
                  '<p class="text-xs text-slate-500">' + esc(c.ketuaClass) + ' · ' + esc(c.wakilClass) + '</p>' +
                  '<p class="text-xs text-slate-700 line-clamp-3 pt-1">' + esc(c.vision) + '</p>' +
                '</div>' +
              '</div>' +
              '<div class="px-5 pb-5 pt-2 flex items-center justify-between gap-2 border-t border-slate-100">' +
                '<span class="font-mono text-xs font-bold text-slate-600">' + Number(c.votes || 0) + ' Suara</span>' +
                '<div class="flex gap-2">' +
                  '<button type="button" onclick="openCandFormModal(\\'' + esc(c.id) + '\\')" class="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold hover:bg-slate-50 cursor-pointer">Edit</button>' +
                  '<button type="button" onclick="confirmDeleteCandGas(\\'' + esc(c.id) + '\\')" class="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 text-xs font-bold hover:bg-rose-50 cursor-pointer">Hapus</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    var tempCandPhoto = '';
    function openCandFormModal(candId) {
      var cands = activeDb().candidates || [];
      var existing = candId ? cands.filter(function (c) { return c.id === candId; })[0] : null;
      tempCandPhoto = existing ? (existing.photoUrl || '') : '';
      var nextNo = existing ? existing.nomorUrut : (cands.length + 1);
      openModal(
        '<div class="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">' +
            '<div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50"><h3 class="text-base font-extrabold">' + (existing ? 'Edit Pasangan Calon' : 'Tambah Pasangan Calon Baru') + '</h3><button type="button" onclick="closeModal()" class="p-1 rounded-lg text-slate-500 cursor-pointer">' + svgIcon('x', 'w-5 h-5') + '</button></div>' +
            '<form onsubmit="saveCandFormGas(event, \\'' + esc(candId || '') + '\\')" class="p-6 overflow-y-auto space-y-4 text-xs">' +
              '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
                '<div><label class="block font-bold text-slate-700 mb-1">Nomor Urut *</label><input id="cf-no" type="number" min="1" required value="' + esc(nextNo) + '" class="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono" /></div>' +
                '<div class="sm:col-span-2"><label class="block font-bold text-slate-700 mb-1">Foto Paslon (Dari Penyimpanan Device)</label><input type="file" accept="image/*" onchange="handleCandPhotoUpload(this)" class="w-full text-xs file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:font-bold" /><p id="cf-photo-status" class="text-[11px] text-slate-500 mt-1">' + (tempCandPhoto ? 'Foto saat ini tersimpan' : 'Belum ada foto dipilih') + '</p></div>' +
              '</div>' +
              '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
                '<div><label class="block font-bold text-slate-700 mb-1">Nama Calon Ketua *</label><input id="cf-kname" type="text" required value="' + esc(existing ? existing.ketuaName : '') + '" class="w-full h-10 px-3 rounded-xl border border-slate-300" /></div>' +
                '<div><label class="block font-bold text-slate-700 mb-1">Kelas Ketua *</label><input id="cf-kclass" type="text" required value="' + esc(existing ? existing.ketuaClass : '') + '" class="w-full h-10 px-3 rounded-xl border border-slate-300" /></div>' +
                '<div><label class="block font-bold text-slate-700 mb-1">Nama Calon Wakil *</label><input id="cf-wname" type="text" required value="' + esc(existing ? existing.wakilName : '') + '" class="w-full h-10 px-3 rounded-xl border border-slate-300" /></div>' +
                '<div><label class="block font-bold text-slate-700 mb-1">Kelas Wakil *</label><input id="cf-wclass" type="text" required value="' + esc(existing ? existing.wakilClass : '') + '" class="w-full h-10 px-3 rounded-xl border border-slate-300" /></div>' +
              '</div>' +
              '<div><label class="block font-bold text-slate-700 mb-1">Visi Pasangan Calon *</label><textarea id="cf-vision" rows="2" required class="w-full p-3 rounded-xl border border-slate-300">' + esc(existing ? existing.vision : '') + '</textarea></div>' +
              '<div><label class="block font-bold text-slate-700 mb-1">Misi Pasangan Calon (1 poin per baris) *</label><textarea id="cf-missions" rows="4" required class="w-full p-3 rounded-xl border border-slate-300">' + esc(existing ? (existing.missions || []).join('\\n') : '') + '</textarea></div>' +
              '<div class="pt-2 flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-300 font-bold cursor-pointer">Batal</button><button type="submit" class="px-5 py-2 rounded-xl text-white font-bold cursor-pointer" style="background-color: var(--app-primary);">Simpan Paslon</button></div>' +
            '</form>' +
          '</div>' +
        '</div>'
      );
    }

    function handleCandPhotoUpload(input) {
      var file = input.files && input.files[0];
      if (!file) return;
      resizeImageForSheets(file, 360, function (dataUrl) {
        tempCandPhoto = dataUrl;
        var st = document.getElementById('cf-photo-status');
        if (st) st.textContent = 'Foto baru siap disimpan (' + Math.round(dataUrl.length / 1024) + ' KB)';
      });
    }

    function saveCandFormGas(e, candId) {
      e.preventDefault();
      var no = Number(document.getElementById('cf-no').value || 1);
      var kn = document.getElementById('cf-kname').value.trim();
      var kc = document.getElementById('cf-kclass').value.trim();
      var wn = document.getElementById('cf-wname').value.trim();
      var wc = document.getElementById('cf-wclass').value.trim();
      var vis = document.getElementById('cf-vision').value.trim();
      var mis = document.getElementById('cf-missions').value.split(/\\r?\\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      var cands = (activeDb().candidates || []).slice();
      if (candId) {
        cands = cands.map(function (c) {
          return c.id === candId ? Object.assign({}, c, { nomorUrut: no, ketuaName: kn, ketuaClass: kc, wakilName: wn, wakilClass: wc, photoUrl: tempCandPhoto || c.photoUrl, vision: vis, missions: mis }) : c;
        });
      } else {
        cands.push({ id: 'cand_' + Date.now(), nomorUrut: no, ketuaName: kn, ketuaClass: kc, wakilName: wn, wakilClass: wc, photoUrl: tempCandPhoto, vision: vis, missions: mis, votes: 0, accentColor: CHART_COLORS[(no - 1) % CHART_COLORS.length] });
      }
      closeModal();
      gasCall('adminSaveCandidates', [state.adminCreds.username, state.adminCreds.password, cands, 'Simpan Paslon 0' + no], 'Menyimpan data paslon...', function (res) {
        if (!res || !res.ok) return showToast('error', 'Gagal Simpan Paslon', (res && res.error) || '');
        state.adminDb = res.db; state.appData = res.db; render();
        showToast('success', 'Pasangan Calon Disimpan');
      });
    }

    function confirmDeleteCandGas(candId) {
      var c = (activeDb().candidates || []).filter(function (x) { return x.id === candId; })[0];
      if (!c) return;
      openModal(
        '<div class="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">' +
            '<h3 class="text-base font-extrabold">Hapus Paslon 0' + esc(c.nomorUrut) + '?</h3>' +
            '<p class="text-xs text-slate-600">Pasangan <strong>' + esc(c.ketuaName) + ' &amp; ' + esc(c.wakilName) + '</strong> akan dihapus permanen.</p>' +
            '<div class="flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold cursor-pointer">Batal</button><button type="button" onclick="executeDeleteCandGas(\\'' + esc(candId) + '\\')" class="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">Ya, Hapus</button></div>' +
          '</div>' +
        '</div>'
      );
    }

    function executeDeleteCandGas(candId) {
      closeModal();
      var next = (activeDb().candidates || []).filter(function (c) { return c.id !== candId; });
      gasCall('adminSaveCandidates', [state.adminCreds.username, state.adminCreds.password, next, 'Hapus pasangan calon'], 'Menghapus paslon...', function (res) {
        if (!res || !res.ok) return showToast('error', 'Gagal Hapus Paslon', (res && res.error) || '');
        state.adminDb = res.db; state.appData = res.db; render();
        showToast('success', 'Paslon Dihapus');
      });
    }

    // --- ADMIN TAB: AKUN PANITIA (with WhatsApp) ---
    function renderAdminStaffTab(db, currentAdmin) {
      var admins = db.admins || [];
      return '<div class="space-y-6">' +
        '<div class="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">' +
          '<div><h2 class="text-lg font-extrabold text-slate-900">Manajemen Akun Panitia</h2><p class="text-xs text-slate-500 mt-0.5">Kelola akun SuperAdmin &amp; Admin Panitia serta Nomor WhatsApp untuk fitur Lupa Password.</p></div>' +
          '<button type="button" onclick="openAddStaffModal()" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold cursor-pointer" style="background-color: var(--app-primary);">' + svgIcon('plus', 'w-4 h-4') + '<span>Tambah Akun Panitia</span></button>' +
        '</div>' +
        '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left border-collapse">' +
          '<thead class="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600"><tr><th class="p-3.5">Nama Lengkap</th><th class="p-3.5">Username</th><th class="p-3.5">Peran</th><th class="p-3.5">No. WhatsApp</th><th class="p-3.5 text-right">Aksi</th></tr></thead>' +
          '<tbody class="divide-y divide-slate-100 text-xs">' +
            admins.map(function (a) {
              return '<tr><td class="p-3.5 font-bold text-slate-900">' + esc(a.fullName) + '</td><td class="p-3.5 font-mono text-slate-700">@' + esc(a.username) + '</td><td class="p-3.5"><span class="px-2.5 py-1 rounded-full font-mono font-bold ' + (a.role === 'SUPERADMIN' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700') + '">' + esc(a.role) + '</span></td><td class="p-3.5 font-mono text-slate-600">' + esc(a.whatsappNumber || '-') + '</td><td class="p-3.5 text-right">' +
                (a.id === currentAdmin.id ? '<span class="text-slate-400 font-semibold">Aktif</span>' : '<button type="button" onclick="deleteStaffGas(\\'' + esc(a.id) + '\\')" class="px-3 py-1 rounded-lg border border-rose-200 text-rose-600 font-bold hover:bg-rose-50 cursor-pointer">Hapus</button>') +
              '</td></tr>';
            }).join('') +
          '</tbody>' +
        '</table></div></div>' +
      '</div>';
    }

    function openAddStaffModal() {
      openModal(
        '<div class="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200">' +
            '<div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50"><h3 class="text-base font-extrabold">Tambah Akun Panitia</h3><button type="button" onclick="closeModal()" class="p-1 rounded-lg text-slate-500 cursor-pointer">' + svgIcon('x', 'w-5 h-5') + '</button></div>' +
            '<form onsubmit="saveNewStaffGas(event)" class="p-6 space-y-3.5 text-xs">' +
              '<div><label class="block font-bold text-slate-700 mb-1">Nama Lengkap *</label><input id="sf-name" type="text" required class="w-full h-10 px-3 rounded-xl border border-slate-300" /></div>' +
              '<div><label class="block font-bold text-slate-700 mb-1">Username *</label><input id="sf-user" type="text" required class="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono" /></div>' +
              '<div><label class="block font-bold text-slate-700 mb-1">Kata Sandi *</label><input id="sf-pass" type="password" required minlength="4" class="w-full h-10 px-3 rounded-xl border border-slate-300" /></div>' +
              '<div><label class="block font-bold text-slate-700 mb-1">Nomor WhatsApp (untuk Lupa Password) *</label><input id="sf-wa" type="tel" required placeholder="081234567890" class="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono" /></div>' +
              '<div><label class="block font-bold text-slate-700 mb-1">Peran</label><select id="sf-role" class="w-full h-10 px-3 rounded-xl border border-slate-300"><option value="ADMIN">ADMIN (Panitia DPT)</option><option value="SUPERADMIN">SUPERADMIN</option></select></div>' +
              '<div class="pt-2 flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-300 font-bold cursor-pointer">Batal</button><button type="submit" class="px-5 py-2 rounded-xl text-white font-bold cursor-pointer" style="background-color: var(--app-primary);">Tambah Akun</button></div>' +
            '</form>' +
          '</div>' +
        '</div>'
      );
    }

    function saveNewStaffGas(e) {
      e.preventDefault();
      var item = {
        id: 'adm_' + Date.now(),
        fullName: document.getElementById('sf-name').value.trim(),
        username: document.getElementById('sf-user').value.trim(),
        password: document.getElementById('sf-pass').value,
        whatsappNumber: document.getElementById('sf-wa').value.trim(),
        role: document.getElementById('sf-role').value,
        createdAt: new Date().toISOString()
      };
      var next = (activeDb().admins || []).concat([item]);
      closeModal();
      gasCall('adminSaveAdmins', [state.adminCreds.username, state.adminCreds.password, next, 'Tambah akun panitia ' + item.fullName], 'Menyimpan akun panitia...', function (res) {
        if (!res || !res.ok) return showToast('error', 'Gagal Tambah Akun', (res && res.error) || '');
        state.adminDb = res.db; state.appData = res.db; render();
        showToast('success', 'Akun Panitia Ditambahkan');
      });
    }

    function deleteStaffGas(adminId) {
      var next = (activeDb().admins || []).filter(function (a) { return a.id !== adminId; });
      gasCall('adminSaveAdmins', [state.adminCreds.username, state.adminCreds.password, next, 'Hapus akun panitia'], 'Menghapus akun...', function (res) {
        if (!res || !res.ok) return showToast('error', 'Gagal Hapus Akun', (res && res.error) || '');
        state.adminDb = res.db; state.appData = res.db; render();
        showToast('success', 'Akun Panitia Dihapus');
      });
    }

    // --- ADMIN TAB: PENGATURAN (Identitas + Upload Logo Device + Tema + Bilik + Reset) ---
    var tempLogoDataUrl = '';
    function renderAdminSettingsTab(db) {
      var s = db.settings || {};
      var t = s.theme || { presetId: 'navy', primaryColor: '#0F1E3D', secondaryColor: '#1E3A5F', accentColor: '#D97706', surfaceMode: 'light' };
      return '<div class="space-y-6">' +
        '<form onsubmit="saveAllSettingsGas(event)" class="grid grid-cols-1 lg:grid-cols-12 gap-6">' +
          '<section class="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">' +
            '<h2 class="text-base font-extrabold text-slate-900">Identitas Sekolah &amp; Logo</h2>' +
            '<div class="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">' +
              '<div class="w-16 h-16 rounded-xl bg-white border border-slate-200 p-1.5 flex items-center justify-center overflow-hidden shrink-0">' + renderSchoolLogoHtml(tempLogoDataUrl || s.logoUrl, s.schoolName, 'w-full h-full object-contain', 'w-full h-full') + '</div>' +
              '<div class="min-w-0 flex-1"><label class="block text-xs font-bold text-slate-700 mb-1">Unggah Logo Sekolah dari Galeri / Folder Device</label><input type="file" accept="image/*" onchange="handleLogoUploadGas(this)" class="w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:font-bold" /></div>' +
            '</div>' +
            '<div><label class="block text-xs font-bold text-slate-700 mb-1">Nama Sekolah *</label><input id="set-school" type="text" required value="' + esc(s.schoolName) + '" class="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm" /></div>' +
            '<div><label class="block text-xs font-bold text-slate-700 mb-1">Tahun Ajaran *</label><input id="set-year" type="text" required value="' + esc(s.academicYear) + '" class="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm font-mono" /></div>' +
            '<div><label class="block text-xs font-bold text-slate-700 mb-1">Judul Pemilihan *</label><input id="set-title" type="text" required value="' + esc(s.electionTitle) + '" class="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm" /></div>' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
              '<div><label class="block text-xs font-bold text-slate-700 mb-1">Waktu Buka Bilik</label><input id="set-start" type="datetime-local" value="' + esc((s.startTime || '').slice(0, 16)) + '" class="w-full h-10 px-3 rounded-xl border border-slate-300 text-xs font-mono" /></div>' +
              '<div><label class="block text-xs font-bold text-slate-700 mb-1">Waktu Tutup Bilik</label><input id="set-end" type="datetime-local" value="' + esc((s.endTime || '').slice(0, 16)) + '" class="w-full h-10 px-3 rounded-xl border border-slate-300 text-xs font-mono" /></div>' +
            '</div>' +
            '<label class="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">' +
              '<input id="set-booth" type="checkbox"' + (s.isBoothOpen ? ' checked' : '') + ' class="w-4 h-4" />' +
              '<span class="text-xs font-bold text-slate-800">Buka Bilik Suara Elektronik Sekarang (Izinkan Pemilih Login)</span>' +
            '</label>' +
          '</section>' +
          '<section class="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 flex flex-col justify-between">' +
            '<div class="space-y-4">' +
              '<div class="flex items-center gap-2">' + svgIcon('palette', 'w-5 h-5', 'color: var(--app-secondary)') + '<h2 class="text-base font-extrabold text-slate-900">Tema Tampilan Aplikasi</h2></div>' +
              '<div class="grid grid-cols-1 gap-2">' +
                THEME_PRESETS.map(function (p) {
                  var sel = t.presetId === p.id;
                  return '<button type="button" onclick="applyPresetInputs(\\'' + p.id + '\\', \\'' + p.primaryColor + '\\', \\'' + p.secondaryColor + '\\', \\'' + p.accentColor + '\\')" class="flex items-center justify-between p-2.5 rounded-xl border text-left text-xs cursor-pointer ' + (sel ? 'border-slate-900 bg-slate-50 font-bold' : 'border-slate-200 hover:bg-slate-50') + '">' +
                    '<span>' + esc(p.name) + '</span>' +
                    '<span class="flex gap-1"><span class="w-4 h-4 rounded" style="background:' + p.primaryColor + '"></span><span class="w-4 h-4 rounded" style="background:' + p.accentColor + '"></span></span>' +
                  '</button>';
                }).join('') +
              '</div>' +
              '<div class="grid grid-cols-3 gap-2 text-xs">' +
                '<div><label class="block font-bold mb-1">Primer</label><input id="set-c1" type="color" value="' + esc(t.primaryColor || '#0F1E3D') + '" class="w-full h-9 rounded border" /></div>' +
                '<div><label class="block font-bold mb-1">Sekunder</label><input id="set-c2" type="color" value="' + esc(t.secondaryColor || '#1E3A5F') + '" class="w-full h-9 rounded border" /></div>' +
                '<div><label class="block font-bold mb-1">Aksen</label><input id="set-c3" type="color" value="' + esc(t.accentColor || '#D97706') + '" class="w-full h-9 rounded border" /></div>' +
              '</div>' +
              '<div><label class="block text-xs font-bold text-slate-700 mb-1">Latar Belakang</label><select id="set-surface" class="w-full h-10 px-3 rounded-xl border border-slate-300 text-xs">' +
                THEME_SURFACES.map(function (sf) { return '<option value="' + sf.id + '"' + ((t.surfaceMode || 'light') === sf.id ? ' selected' : '') + '>' + esc(sf.label) + '</option>'; }).join('') +
              '</select></div>' +
            '</div>' +
            '<button type="submit" class="w-full py-3 rounded-xl text-white font-bold text-sm cursor-pointer" style="background-color: var(--app-primary);">Simpan Semua Pengaturan</button>' +
          '</section>' +
        '</form>' +
        '<section class="bg-rose-50 border border-rose-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">' +
          '<div><h3 class="text-base font-extrabold text-rose-900">Reset Hasil Pemilihan (Nolkan Suara)</h3><p class="text-xs text-rose-700 mt-0.5">Menghapus seluruh perolehan suara paslon dan mengatur status memilih seluruh DPT kembali ke Belum Memilih.</p></div>' +
          '<button type="button" onclick="openResetElectionModal()" class="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold whitespace-nowrap cursor-pointer">Reset Pemilihan</button>' +
        '</section>' +
      '</div>';
    }

    function applyPresetInputs(id, c1, c2, c3) {
      if (document.getElementById('set-c1')) document.getElementById('set-c1').value = c1;
      if (document.getElementById('set-c2')) document.getElementById('set-c2').value = c2;
      if (document.getElementById('set-c3')) document.getElementById('set-c3').value = c3;
      applyThemeVars({ presetId: id, primaryColor: c1, secondaryColor: c2, accentColor: c3, surfaceMode: document.getElementById('set-surface') ? document.getElementById('set-surface').value : 'light' });
    }

    function handleLogoUploadGas(input) {
      var file = input.files && input.files[0];
      if (!file) return;
      resizeImageForSheets(file, 256, function (dataUrl) {
        tempLogoDataUrl = dataUrl;
        showToast('info', 'Logo Diproses', 'Klik "Simpan Semua Pengaturan" untuk menerapkan logo.');
      });
    }

    function saveAllSettingsGas(e) {
      e.preventDefault();
      var prev = activeDb().settings || {};
      var nextSettings = {
        schoolName: document.getElementById('set-school').value.trim(),
        academicYear: document.getElementById('set-year').value.trim(),
        electionTitle: document.getElementById('set-title').value.trim(),
        logoUrl: tempLogoDataUrl || prev.logoUrl || '',
        startTime: document.getElementById('set-start').value,
        endTime: document.getElementById('set-end').value,
        isBoothOpen: document.getElementById('set-booth').checked,
        hideLiveResults: !!prev.hideLiveResults,
        theme: {
          presetId: 'custom',
          primaryColor: document.getElementById('set-c1').value,
          secondaryColor: document.getElementById('set-c2').value,
          accentColor: document.getElementById('set-c3').value,
          surfaceMode: document.getElementById('set-surface').value
        }
      };
      gasCall('adminSaveSettings', [state.adminCreds.username, state.adminCreds.password, nextSettings, 'Perbarui identitas sekolah & tema'], 'Menyimpan pengaturan...', function (res) {
        if (!res || !res.ok) return showToast('error', 'Gagal Simpan Pengaturan', (res && res.error) || '');
        tempLogoDataUrl = '';
        state.adminDb = res.db; state.appData = res.db; render();
        showToast('success', 'Pengaturan Disimpan');
      });
    }

    function openResetElectionModal() {
      openModal(
        '<div class="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">' +
          '<div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-rose-200">' +
            '<h3 class="text-lg font-extrabold text-rose-800">Konfirmasi Reset Pemilihan</h3>' +
            '<p class="text-xs text-slate-600 leading-relaxed">Ketik <strong>RESET</strong> di bawah ini untuk menolkan seluruh perolehan suara dan membuka kembali hak pilih seluruh DPT.</p>' +
            '<input id="reset-confirm-input" type="text" placeholder="Ketik RESET" class="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm" />' +
            '<div class="flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold cursor-pointer">Batal</button><button type="button" onclick="executeResetElectionGas()" class="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold cursor-pointer">Reset Sekarang</button></div>' +
          '</div>' +
        '</div>'
      );
    }

    function executeResetElectionGas() {
      var val = (document.getElementById('reset-confirm-input').value || '').trim();
      if (val !== 'RESET') return showToast('error', 'Konfirmasi Salah', 'Harap ketik kata RESET persis dengan huruf kapital.');
      closeModal();
      gasCall('adminResetElection', [state.adminCreds.username, state.adminCreds.password], 'Mereset hasil pemilihan...', function (res) {
        if (!res || !res.ok) return showToast('error', 'Gagal Reset', (res && res.error) || '');
        state.adminDb = res.db; state.appData = res.db; render();
        showToast('success', 'Pemilihan Direset', 'Semua suara kembali ke 0.');
      });
    }

    // --- ADMIN TAB: AUDIT LOGS ---
    function renderAdminAuditTab(db) {
      var logs = db.auditLogs || [];
      return '<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">' +
        '<div class="px-6 py-4 border-b border-slate-200"><h2 class="text-base font-extrabold text-slate-900">Log Aktivitas Sistem</h2><p class="text-xs text-slate-500">Rekaman aksi admin, login, suara masuk, dan sinkronisasi.</p></div>' +
        '<div class="overflow-x-auto"><table class="w-full text-left border-collapse">' +
          '<thead class="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600"><tr><th class="p-3.5">Waktu</th><th class="p-3.5">Pelaku</th><th class="p-3.5">Aksi</th><th class="p-3.5">Keterangan</th></tr></thead>' +
          '<tbody class="divide-y divide-slate-100 text-xs">' +
            logs.map(function (l) {
              return '<tr><td class="p-3.5 font-mono text-slate-500 whitespace-nowrap">' + esc(new Date(l.timestamp).toLocaleString('id-ID')) + '</td><td class="p-3.5 font-bold text-slate-900">' + esc(l.actorName) + ' <span class="font-mono text-[10px] text-slate-500">(' + esc(l.actorRole) + ')</span></td><td class="p-3.5 font-mono font-bold text-slate-700">' + esc(l.action) + '</td><td class="p-3.5 text-slate-600">' + esc(l.detail) + '</td></tr>';
            }).join('') +
          '</tbody>' +
        '</table></div>' +
      '</div>';
    }

    // --- OFFICIAL PDF / PRINT REPORT (Matches AI Studio PdfReport layout) ---
    function printOfficialPdfGas() {
      var db = activeDb();
      var admin = (state.adminCreds && state.adminCreds.admin) || { fullName: 'Panitia Pemilihan', role: 'ADMIN' };
      var stats = computeStats(db.voters, db.candidates);
      var nowStr = new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' });
      var maxV = Math.max.apply(null, [0].concat(stats.candidateStats.map(function (c) { return c.votes; })));

      var html = '' +
        '<div style="background:#0F1E3D;color:#fff;padding:18px 22px;border-radius:8px;border-bottom:4px solid #D97706;margin-bottom:16px;display:flex;align-items:center;gap:16px;">' +
          '<div style="width:60px;height:60px;border-radius:10px;background:#fff;padding:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">' +
            renderSchoolLogoHtml(db.settings.logoUrl, db.settings.schoolName, 'w-full h-full object-contain', 'w-full h-full') +
          '</div>' +
          '<div style="min-width:0;flex:1;">' +
            '<p style="color:#FBBF24;font-weight:800;font-size:10px;letter-spacing:0.08em;margin:0 0 4px;">BERITA ACARA &amp; REKAPITULASI HASIL E-VOTING OSIS</p>' +
            '<h1 style="font-size:18px;font-weight:800;margin:0;line-height:1.2;">' + esc(db.settings.schoolName) + '</h1>' +
            '<p style="color:#E2E8F0;font-size:11px;margin:4px 0 0;">' + esc(db.settings.electionTitle) + ' · Tahun Ajaran ' + esc(db.settings.academicYear) + '</p>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:#475569;padding-bottom:8px;border-bottom:1px solid #cbd5e1;margin-bottom:14px;">' +
          '<span>Dicetak pada: ' + esc(nowStr) + '</span>' +
          '<span>Dicetak oleh: ' + esc(admin.fullName) + ' (' + esc(admin.role) + ')</span>' +
        '</div>' +
        '<h2 style="font-size:12px;font-weight:800;color:#0F1E3D;margin:0 0 8px;">1. Ringkasan Partisipasi Pemilih (DPT)</h2>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">' +
          '<div style="border:1px solid #e2e8f0;background:#f8fafc;padding:8px 10px;border-radius:6px;"><div style="font-size:9px;color:#64748b;">Total DPT</div><div style="font-size:13px;font-weight:800;color:#0F1E3D;">' + stats.totalDpt + ' Siswa</div></div>' +
          '<div style="border:1px solid #e2e8f0;background:#f8fafc;padding:8px 10px;border-radius:6px;"><div style="font-size:9px;color:#64748b;">Suara Masuk</div><div style="font-size:13px;font-weight:800;color:#059669;">' + stats.totalVoted + ' Suara</div></div>' +
          '<div style="border:1px solid #e2e8f0;background:#f8fafc;padding:8px 10px;border-radius:6px;"><div style="font-size:9px;color:#64748b;">Belum Memilih</div><div style="font-size:13px;font-weight:800;color:#d97706;">' + stats.totalNotVoted + ' Siswa</div></div>' +
          '<div style="border:1px solid #e2e8f0;background:#f8fafc;padding:8px 10px;border-radius:6px;"><div style="font-size:9px;color:#64748b;">Partisipasi</div><div style="font-size:13px;font-weight:800;color:#0F1E3D;">' + stats.participationRate + '%</div></div>' +
        '</div>' +
        '<h2 style="font-size:12px;font-weight:800;color:#0F1E3D;margin:0 0 8px;">2. Perolehan Suara Pasangan Calon</h2>' +
        '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:10px;">' +
          '<thead><tr style="background:#0F1E3D;color:#fff;"><th style="padding:7px 8px;text-align:left;">No.</th><th style="padding:7px 8px;text-align:left;">Pasangan Calon</th><th style="padding:7px 8px;text-align:right;">Suara Sah</th><th style="padding:7px 8px;text-align:right;">Persentase</th></tr></thead>' +
          '<tbody>' +
            stats.candidateStats.map(function (c, i) {
              var lead = maxV > 0 && c.votes === maxV ? ' (Unggul)' : '';
              return '<tr style="background:' + (i % 2 === 0 ? '#f8fafc' : '#fff') + ';border-bottom:1px solid #e2e8f0;">' +
                '<td style="padding:8px;font-weight:800;">0' + esc(c.nomorUrut) + '</td>' +
                '<td style="padding:8px;"><strong>' + esc(c.ketuaName) + ' &amp; ' + esc(c.wakilName) + esc(lead) + '</strong><br/><span style="color:#64748b;font-size:9px;">' + esc(c.ketuaClass) + ' · ' + esc(c.wakilClass) + '</span></td>' +
                '<td style="padding:8px;text-align:right;font-weight:800;">' + c.votes + '</td>' +
                '<td style="padding:8px;text-align:right;font-weight:800;">' + c.percentage + '%</td>' +
              '</tr>';
            }).join('') +
            '<tr style="background:#f1f5f9;font-weight:800;"><td></td><td style="padding:7px 8px;">Total Suara Sah Masuk</td><td style="padding:7px 8px;text-align:right;">' + stats.totalValidVotes + '</td><td style="padding:7px 8px;text-align:right;">' + (stats.totalValidVotes > 0 ? '100%' : '0%') + '</td></tr>' +
          '</tbody>' +
        '</table>' +
        '<h2 style="font-size:12px;font-weight:800;color:#0F1E3D;margin:0 0 8px;">3. Rincian Partisipasi Per Angkatan</h2>' +
        '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:10px;">' +
          '<thead><tr style="background:#1E3A5F;color:#fff;"><th style="padding:6px 8px;text-align:left;">Angkatan</th><th style="padding:6px 8px;text-align:right;">Sudah Memilih</th><th style="padding:6px 8px;text-align:right;">Total DPT</th><th style="padding:6px 8px;text-align:right;">Persentase</th></tr></thead>' +
          '<tbody>' +
            stats.gradeStats.map(function (g) {
              return '<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:7px 8px;font-weight:700;">' + esc(g.label) + '</td><td style="padding:7px 8px;text-align:right;">' + g.voted + ' siswa</td><td style="padding:7px 8px;text-align:right;">' + g.total + ' siswa</td><td style="padding:7px 8px;text-align:right;font-weight:800;">' + g.percentage + '%</td></tr>';
            }).join('') +
          '</tbody>' +
        '</table>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:20px;">' +
          '<div style="width:240px;max-width:100%;text-align:left;font-size:10px;line-height:1.4;word-break:break-word;">' +
            '<p style="margin:0;color:#475569;">Mengetahui,</p>' +
            '<p style="margin:2px 0 46px;font-weight:800;color:#0F1E3D;">Panitia Pemilihan OSIS ' + esc(db.settings.schoolName) + '</p>' +
            '<div style="border-top:1px solid #94a3b8;padding-top:4px;color:#334155;">' + esc(admin.fullName) + ' (' + esc(admin.role) + ')</div>' +
          '</div>' +
        '</div>' +
        '<div class="print-footer-fixed">Dokumen resmi dihasilkan oleh Sistem E-Voting OSIS.</div>';

      document.getElementById('print-report-sheet').innerHTML = html;
      window.print();
    }

    // =========================================================================
    // 4. BOOTSTRAP, SPLASH INTRO & LIVE POLLING
    // =========================================================================
    function dismissSplash() {
      var el = document.getElementById('splash-intro');
      if (!el || el.dataset.done === '1') return;
      el.dataset.done = '1';
      el.style.opacity = '0';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 360);
    }

    function refreshFromGas(notifyOnSuccess) {
      if (typeof google === 'undefined' || !google.script || !google.script.run) return;
      google.script.run.withSuccessHandler(function (res) {
        if (!res) return;
        state.appData = res;
        var sp = document.getElementById('splash-school-name');
        if (sp && res.settings) sp.textContent = res.settings.schoolName;
        render();
        if (notifyOnSuccess) showToast('success', 'Data Disegarkan', 'Data terbaru dimuat dari Google Sheets.');
      }).getPublicBootstrap();
    }

    (function initApp() {
      applyThemeVars(INITIAL_BOOTSTRAP.settings && INITIAL_BOOTSTRAP.settings.theme);
      var logoBox = document.getElementById('splash-logo-box');
      if (logoBox) {
        logoBox.innerHTML = renderSchoolLogoHtml(INITIAL_BOOTSTRAP.settings.logoUrl, INITIAL_BOOTSTRAP.settings.schoolName, 'w-full h-full object-contain', 'w-full h-full');
      }
      render();
      document.addEventListener('fullscreenchange', function () {
        state.isFullscreen = !!document.fullscreenElement;
        render();
      });
      document.addEventListener('scroll', function (e) {
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-page-scroller') === 'true') {
          evaluateScrollTopButtonGas();
        } else if (t === document || t === window) {
          evaluateScrollTopButtonGas();
        }
      }, true);
      window.addEventListener('resize', evaluateScrollTopButtonGas);
      if (window.location.search.indexOf('autostart=1') >= 0) {
        dismissSplash();
      } else {
        setTimeout(dismissSplash, 1750);
      }
      refreshFromGas(false);
      state.liveClockTimer = setInterval(function () {
        var c = document.getElementById('live-clock');
        if (c) c.textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }, 1000);
      state.pollTimer = setInterval(function () {
        if (state.screen === 'LIVE_MONITOR' || state.screen === 'LOGIN_PORTAL') {
          refreshFromGas(false);
        }
      }, 6000);
    })();
  </script>
</body>
</html>`;
}
