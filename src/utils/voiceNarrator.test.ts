import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWelcomeVoiceText,
  computeMaleSpeechParams,
  isLikelyFemaleVoiceName,
  isLikelyMaleVoiceName,
  selectPreferredIndonesianMaleVoice,
  VOTER_SAVED_VOICE_TEXT,
} from './voiceNarrator';

test('buildWelcomeVoiceText formats exact greeting with configured school name and safe fallback', () => {
  assert.equal(
    buildWelcomeVoiceText('SMA Negeri 1 Kabun'),
    'Selamat Datang di Aplikasi Pemilihan Ketua & Wakil Ketua OSIS SMA Negeri 1 Kabun. Gunakan hak suara Anda secara langsung, bebas, rahasia, jujur, dan adil.'
  );
  assert.equal(
    buildWelcomeVoiceText('   '),
    'Selamat Datang di Aplikasi Pemilihan Ketua & Wakil Ketua OSIS SMAN 1 Kabun. Gunakan hak suara Anda secara langsung, bebas, rahasia, jujur, dan adil.'
  );
});

test('VOTER_SAVED_VOICE_TEXT matches exact required verification phrase', () => {
  assert.equal(VOTER_SAVED_VOICE_TEXT, 'Pilihanmu sudah tersimpan, terima kasih');
});

test('selectPreferredIndonesianMaleVoice prioritizes Indonesian male voices over female or foreign voices', () => {
  const voices = [
    { name: 'Microsoft David - English (United States)', lang: 'en-US', default: true },
    { name: 'Microsoft Gadis Online (Natural) - Indonesian (Indonesia)', lang: 'id-ID' },
    { name: 'Microsoft Ardian Online (Natural) - Indonesian (Indonesia)', lang: 'id-ID' },
    { name: 'Google Bahasa Indonesia', lang: 'id-ID' },
  ];

  const picked = selectPreferredIndonesianMaleVoice(voices);
  assert.ok(picked);
  assert.equal(picked.name, 'Microsoft Ardian Online (Natural) - Indonesian (Indonesia)');

  const femaleOnlyId = [
    { name: 'Microsoft David - English (United States)', lang: 'en-US' },
    { name: 'Damayanti', lang: 'id_ID' },
    { name: 'Google Bahasa Indonesia', lang: 'id-ID', default: true },
  ];
  const fallbackId = selectPreferredIndonesianMaleVoice(femaleOnlyId);
  assert.ok(fallbackId);
  assert.equal(fallbackId.name, 'Google Bahasa Indonesia');

  const noIndonesian = [{ name: 'Microsoft David', lang: 'en-US', default: true }];
  assert.equal(selectPreferredIndonesianMaleVoice(noIndonesian), null);
});

test('computeMaleSpeechParams applies masculine pitch tuning for male and fallback voices', () => {
  assert.equal(isLikelyMaleVoiceName('Ardian Male ID'), true);
  assert.equal(isLikelyFemaleVoiceName('Microsoft Gadis'), true);

  const maleVoiceParams = computeMaleSpeechParams('Microsoft Ardian Online');
  assert.equal(maleVoiceParams.lang, 'id-ID');
  assert.ok(maleVoiceParams.pitch < 1);

  const fallbackParams = computeMaleSpeechParams('Google Bahasa Indonesia');
  assert.equal(fallbackParams.lang, 'id-ID');
  assert.ok(fallbackParams.pitch < maleVoiceParams.pitch);
});
