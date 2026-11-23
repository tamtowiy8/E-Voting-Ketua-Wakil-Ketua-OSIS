import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseGasResponseText,
  shouldFallbackFromProxyResponse,
} from './gasClient';

test('shouldFallbackFromProxyResponse falls back on 404/405 or HTML SPA responses, not JSON API errors', () => {
  assert.equal(shouldFallbackFromProxyResponse(404, 'text/html'), true);
  assert.equal(shouldFallbackFromProxyResponse(405, 'text/plain'), true);
  assert.equal(shouldFallbackFromProxyResponse(200, 'text/html; charset=utf-8'), true);
  assert.equal(shouldFallbackFromProxyResponse(200, null), true);

  assert.equal(shouldFallbackFromProxyResponse(200, 'application/json; charset=utf-8'), false);
  assert.equal(shouldFallbackFromProxyResponse(403, 'application/json'), false);
  assert.equal(shouldFallbackFromProxyResponse(400, 'application/json'), false);
});

test('parseGasResponseText parses valid GAS JSON and rejects HTML login/permission pages', () => {
  const ok = parseGasResponseText<{ ok: boolean; schoolName: string }>(
    JSON.stringify({ ok: true, schoolName: 'SMAN 1 Kabun' }),
    200
  );
  assert.equal(ok.schoolName, 'SMAN 1 Kabun');

  assert.throws(
    () => parseGasResponseText('<!DOCTYPE html><html><body>Login</body></html>', 200),
    /Anyone/
  );
  assert.throws(
    () => parseGasResponseText(JSON.stringify({ ok: false, error: 'Sheet locked' }), 200),
    /Sheet locked/
  );
  assert.throws(
    () => parseGasResponseText('not json', 200),
    /bukan format JSON/
  );
  assert.throws(
    () => parseGasResponseText('Server Error', 502),
    /HTTP 502/
  );
});

test('Netlify deployment configuration files exist with COOP header and function/SPA redirects', () => {
  const rootDir = path.resolve(process.cwd());
  const netlifyToml = fs.readFileSync(path.join(rootDir, 'netlify.toml'), 'utf-8');
  const publicHeaders = fs.readFileSync(path.join(rootDir, 'public/_headers'), 'utf-8');
  const publicRedirects = fs.readFileSync(path.join(rootDir, 'public/_redirects'), 'utf-8');
  const gasProxyFn = fs.readFileSync(
    path.join(rootDir, 'netlify/functions/gas-proxy.mts'),
    'utf-8'
  );
  const ttsFn = fs.readFileSync(path.join(rootDir, 'netlify/functions/tts.mts'), 'utf-8');

  assert.match(netlifyToml, /publish\s*=\s*"dist"/);
  assert.match(netlifyToml, /functions\s*=\s*"netlify\/functions"/);
  assert.match(netlifyToml, /\/api\/gas\/proxy/);
  assert.match(netlifyToml, /same-origin-allow-popups/);

  assert.match(publicHeaders, /Cross-Origin-Opener-Policy:\s*same-origin-allow-popups/);
  assert.match(publicRedirects, /\/api\/gas\/proxy\s+\/\.netlify\/functions\/gas-proxy\s+200/);
  assert.match(publicRedirects, /\/\*\s+\/index\.html\s+200/);

  assert.match(gasProxyFn, /isValidGasWebAppUrl/);
  assert.match(gasProxyFn, /parseGasPayloadText/);
  assert.match(ttsFn, /GEMINI_API_KEY/);
});

test('parseGasResponseText handles BOM, lowercase doctype, /dev URL, and specific Apps Script HTML errors without Unexpected token <', () => {
  assert.throws(
    () => parseGasResponseText('\uFEFF<!doctype html><html><body>accounts.google.com/ServiceLogin</body></html>', 200),
    (err: Error) => !err.message.includes('Unexpected token') && /Anyone/.test(err.message)
  );

  assert.throws(
    () =>
      parseGasResponseText(
        '<!DOCTYPE html><html><body>Login</body></html>',
        200,
        'https://script.google.com/macros/s/AKfycb123/dev?action=ping'
      ),
    (err: Error) => !err.message.includes('Unexpected token') && /\/dev/.test(err.message) && /\/exec/.test(err.message)
  );

  assert.throws(
    () => parseGasResponseText('<html><body>Script function not found: doGet</body></html>', 200),
    /doGet\/doPost/
  );

  assert.throws(
    () => parseGasResponseText('<html><body>Authorization is required to perform that action.</body></html>', 200),
    /setupDatabase\(\)/
  );

  assert.throws(
    () => parseGasResponseText('<!DOCTYPE html><html><body>Bad Gateway</body></html>', 502),
    (err: Error) => /HTTP 502/.test(err.message) && !err.message.includes('Unexpected token')
  );
});

