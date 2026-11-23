export function stripBomAndTrim(rawText: string): string {
  return String(rawText ?? '')
    .replace(/^\uFEFF+/, '')
    .trim();
}

export function isHtmlResponseText(rawText: string): boolean {
  const cleaned = stripBomAndTrim(rawText);
  if (!cleaned.startsWith('<')) return false;
  return (
    /^<(?:!doctype|html|head|body|title|meta|script|style|noscript|!--)/i.test(cleaned) ||
    /^<[a-z!/][\s\S]*>/i.test(cleaned)
  );
}

export function isGasDevUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return /\/dev\/?$/i.test(parsed.pathname);
  } catch {
    return /\/dev(?:[/?#]|$)/i.test(trimmed);
  }
}

export function diagnoseGasHtmlError(htmlText: string, requestUrl?: string): string {
  if (requestUrl && isGasDevUrl(requestUrl)) {
    return 'URL Google Apps Script masih berakhiran "/dev" (mode pengembang yang mewajibkan login Google sehingga mengembalikan HTML). Gunakan URL deployment produksi berakhiran "/exec" dari menu Deploy -> Manage deployments.';
  }

  if (
    /accounts\.google\.com|ServiceLogin|signin\/v2|Masuk\s*-\s*Akun Google|Sign in\s*-\s*Google Accounts/i.test(
      htmlText
    )
  ) {
    return 'Google Apps Script mengembalikan halaman HTML/login. Pastikan saat Deploy Web App opsi "Who has access" diatur ke "Anyone" dan gunakan URL berakhiran "/exec".';
  }

  if (/Script function not found:\s*do(?:Get|Post)|Fungsi skrip tidak ditemukan:\s*do(?:Get|Post)/i.test(htmlText)) {
    return 'Fungsi doGet/doPost belum ditemukan pada deployment Apps Script Anda. Tempel Code.gs terbaru, simpan, lalu lakukan Deploy -> Manage deployments -> Edit -> Version: New version -> Deploy.';
  }

  if (/Authorization is required|Otorisasi diperlukan|needs your permission/i.test(htmlText)) {
    return 'Google Apps Script memerlukan otorisasi akses Spreadsheet. Buka editor Apps Script, jalankan fungsi setupDatabase() sekali dan setujui izin Google, lalu Deploy ulang Web App (New version).';
  }

  if (
    /TypeError:|ReferenceError:|Exception:|Exceeded maximum execution time|We're sorry, a server error occurred/i.test(
      htmlText
    )
  ) {
    return 'Google Apps Script mengalami galat runtime dan mengembalikan halaman HTML error. Buka log Eksekusi di script.google.com, pastikan setupDatabase() sudah dijalankan, lalu perbarui Code.gs dan Deploy ulang (New version).';
  }

  return 'Google Apps Script mengembalikan halaman HTML/login (bukan JSON). Pastikan opsi "Who has access" diatur ke "Anyone", Code.gs sudah diperbarui dan di-Deploy sebagai versi terbaru (/exec).';
}

export function parseGasPayloadText<T>(
  rawText: string,
  httpStatus: number,
  requestUrl?: string
): T {
  const cleaned = stripBomAndTrim(rawText);
  const isHtml = isHtmlResponseText(cleaned);

  if (httpStatus < 200 || httpStatus >= 300) {
    if (isHtml) {
      throw new Error(
        `Google Apps Script merespons HTTP ${httpStatus}. ${diagnoseGasHtmlError(cleaned, requestUrl)}`
      );
    }
    if (cleaned) {
      try {
        const errObj = JSON.parse(cleaned) as { error?: string; message?: string };
        if (errObj?.error) throw new Error(errObj.error);
        if (errObj?.message) throw new Error(errObj.message);
      } catch (inner) {
        if (inner instanceof Error && inner.message && !(inner instanceof SyntaxError)) {
          throw inner;
        }
      }
    }
    throw new Error(`Google Apps Script merespons HTTP ${httpStatus}.`);
  }

  if (isHtml) {
    throw new Error(diagnoseGasHtmlError(cleaned, requestUrl));
  }

  let parsed: T & { ok?: boolean; error?: string };
  try {
    parsed = JSON.parse(cleaned) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(
      'Respons Google Apps Script bukan format JSON yang valid. Pastikan URL mengarah ke Web App /exec yang telah di-deploy dengan akses "Anyone".'
    );
  }

  if (parsed && typeof parsed === 'object' && parsed.ok === false) {
    throw new Error(parsed.error || 'Permintaan ditolak oleh Google Apps Script.');
  }

  return parsed;
}

export async function safeParseGoogleSheetsResponse<T>(
  res: Response,
  contextLabel: string,
  options?: { allowEmpty?: boolean }
): Promise<T> {
  const rawText = await res.text();
  const cleaned = stripBomAndTrim(rawText);
  const isHtml = isHtmlResponseText(cleaned);

  if (!res.ok) {
    if (isHtml) {
      throw new Error(
        `Google Sheets mengembalikan halaman HTML error (HTTP ${res.status}) saat ${contextLabel}. Periksa koneksi/proxy jaringan atau hubungkan ulang akun Google Anda.`
      );
    }
    if (cleaned) {
      try {
        const data = JSON.parse(cleaned) as { error?: { message?: string; status?: string } };
        if (data?.error?.message) {
          throw new Error(data.error.message);
        }
      } catch (err) {
        if (err instanceof Error && !(err instanceof SyntaxError)) {
          throw err;
        }
      }
    }
    throw new Error(`Permintaan Google Sheets gagal saat ${contextLabel} (HTTP ${res.status}).`);
  }

  if (isHtml) {
    throw new Error(
      `Respons Google Sheets berupa halaman HTML, bukan JSON (kemungkinan jaringan/proxy atau sesi login Google terputus) saat ${contextLabel}. Muat ulang atau hubungkan ulang akun Google.`
    );
  }

  if (!cleaned) {
    if (options?.allowEmpty) {
      return {} as T;
    }
    throw new Error(`Respons Google Sheets kosong saat ${contextLabel}.`);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(
      `Respons Google Sheets bukan format JSON yang valid saat ${contextLabel}.`
    );
  }
}
