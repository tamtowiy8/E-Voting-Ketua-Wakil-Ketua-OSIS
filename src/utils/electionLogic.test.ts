import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVoterEditInState,
  canAccessAdminTab,
  canEditVotedCandidate,
  castVoteInState,
  computeStatistics,
  deleteVotersByIds,
  encodeVoterQrPayload,
  exportVotersCsv,
  extractGrade,
  generateSixDigitToken,
  getAllowedAdminTabs,
  parseVoterQrPayload,
  parseVotersCsv,
  resetElectionData,
  resolveEffectiveVoterLoginMode,
  validateVoterLogin,
  validateVoterQrLogin,
} from './electionLogic';
import type { AdminUser, DatabaseState, ElectionSettings, Voter } from '../types/evoting';

const baseSettings: ElectionSettings = {
  schoolName: 'SMA Negeri 1 Jakarta',
  academicYear: '2026/2027',
  electionTitle: 'Pemilihan Ketua & Wakil Ketua OSIS',
  logoUrl: '',
  isBoothOpen: true,
  startTime: '2026-01-01T07:00',
  endTime: '2027-12-31T17:00',
  hideLiveResults: false,
};

const sampleVoters: Voter[] = [
  {
    id: 'v1',
    nis: '2024001',
    name: 'Budi Santoso',
    kelas: 'XII IPA 1',
    grade: 'XII',
    token: '482910',
    hasVoted: false,
  },
  {
    id: 'v2',
    nis: '2024002',
    name: 'Siti Aminah',
    kelas: 'XI IPS 2',
    grade: 'XI',
    token: '739204',
    hasVoted: true,
    votedAt: '2026-11-16T10:00:00.000Z',
    votedCandidateId: 'c1',
  },
];

const sampleState: DatabaseState = {
  voters: sampleVoters,
  candidates: [
    {
      id: 'c1',
      nomorUrut: 1,
      ketuaName: 'Arya',
      ketuaClass: 'XI IPA 1',
      wakilName: 'Nadia',
      wakilClass: 'X 2',
      photoUrl: '',
      vision: 'Visi 1',
      missions: ['Misi 1'],
      programs: ['Proker 1'],
      votes: 1,
      accentColor: '#1E3A5F',
    },
    {
      id: 'c2',
      nomorUrut: 2,
      ketuaName: 'Fajar',
      ketuaClass: 'XI IPS 1',
      wakilName: 'Rani',
      wakilClass: 'X 4',
      photoUrl: '',
      vision: 'Visi 2',
      missions: ['Misi 2'],
      programs: ['Proker 2'],
      votes: 0,
      accentColor: '#D97706',
    },
  ],
  admins: [],
  settings: baseSettings,
  auditLogs: [],
  lastUpdated: 0,
};

test('extractGrade resolves X, XI, XII accurately', () => {
  assert.equal(extractGrade('XII IPA 1'), 'XII');
  assert.equal(extractGrade('XI IPS 3'), 'XI');
  assert.equal(extractGrade('X Merdeka 4'), 'X');
  assert.equal(extractGrade('12 MIPA 2'), 'XII');
});

test('generateSixDigitToken produces unique 6-digit numeric strings', () => {
  const existing = new Set<string>(['123456']);
  const token = generateSixDigitToken(existing);
  assert.match(token, /^\d{6}$/);
  assert.notEqual(token, '123456');
});

test('validateVoterLogin enforces NIS/NISN credentials, double voting, booth toggle, and schedule', () => {
  const now = new Date('2026-11-16T12:00:00Z').getTime();

  const validRes = validateVoterLogin(sampleVoters, '2024001', baseSettings, now);
  assert.equal(validRes.ok, true);

  const alreadyVotedRes = validateVoterLogin(sampleVoters, '2024002', baseSettings, now);
  assert.equal(alreadyVotedRes.ok, false);
  if (!alreadyVotedRes.ok) {
    assert.equal(alreadyVotedRes.code, 'ALREADY_VOTED');
    assert.match(alreadyVotedRes.error, /Anda sudah menggunakan hak suara/);
  }

  const wrongRes = validateVoterLogin(sampleVoters, '9999999', baseSettings, now);
  assert.equal(wrongRes.ok, false);
  if (!wrongRes.ok) {
    assert.equal(wrongRes.code, 'INVALID_CREDENTIALS');
  }

  const closedRes = validateVoterLogin(
    sampleVoters,
    '2024001',
    { ...baseSettings, isBoothOpen: false },
    now
  );
  assert.equal(closedRes.ok, false);
  if (!closedRes.ok) {
    assert.equal(closedRes.code, 'BOOTH_CLOSED');
  }

  const beforeScheduleRes = validateVoterLogin(
    sampleVoters,
    '2024001',
    { ...baseSettings, startTime: '2027-01-01T07:00' },
    now
  );
  assert.equal(beforeScheduleRes.ok, false);
  if (!beforeScheduleRes.ok) {
    assert.equal(beforeScheduleRes.code, 'OUTSIDE_SCHEDULE');
  }
});

test('castVoteInState marks voter hasVoted, records votedCandidateId, increments candidate votes, and creates receipt', () => {
  const { nextState, receipt } = castVoteInState(sampleState, 'v1', 'c2', '2026-11-16T12:05:00.000Z');
  const updatedVoter = nextState.voters.find((v) => v.id === 'v1');
  const updatedCandidate = nextState.candidates.find((c) => c.id === 'c2');

  assert.equal(updatedVoter?.hasVoted, true);
  assert.equal(updatedVoter?.votedCandidateId, 'c2');
  assert.equal(updatedCandidate?.votes, 1);
  assert.equal(receipt.voterNis, '2024001');
  assert.ok(receipt.receiptCode.startsWith('OSIS-2026-'));

  assert.throws(() => {
    castVoteInState(nextState, 'v1', 'c1');
  }, /Anda sudah menggunakan hak suara/);
});

test('applyVoterEditInState allows SuperAdmin to change voted Paslon & sync tallies, while restricting Admin', () => {
  const superActor = { fullName: 'Tamtowi Yahya, S.Pd.', role: 'SUPERADMIN' as const };
  const adminActor = { fullName: 'Panitia 1', role: 'ADMIN' as const };

  // SuperAdmin moves v2 from c1 -> c2
  const resSuper = applyVoterEditInState(
    sampleState,
    'v2',
    {
      nis: '2024002',
      name: 'Siti Aminah',
      kelas: 'XI IPS 2',
      hasVoted: true,
      votedCandidateId: 'c2',
    },
    superActor,
    '2026-11-17T08:00:00.000Z'
  );
  assert.equal(resSuper.auditAction, 'UPDATE_VOTER_VOTE_CHOICE');
  assert.equal(resSuper.nextState.voters.find((v) => v.id === 'v2')?.votedCandidateId, 'c2');
  assert.equal(resSuper.nextState.candidates.find((c) => c.id === 'c1')?.votes, 0);
  assert.equal(resSuper.nextState.candidates.find((c) => c.id === 'c2')?.votes, 1);

  // Regular Admin attempting to change v2 from c1 -> c2 must be ignored
  const resAdmin = applyVoterEditInState(
    sampleState,
    'v2',
    {
      nis: '2024002',
      name: 'Siti Aminah Baru',
      kelas: 'XI IPS 2',
      hasVoted: true,
      votedCandidateId: 'c2',
    },
    adminActor,
    '2026-11-17T08:05:00.000Z'
  );
  assert.equal(resAdmin.auditAction, 'UPDATE_VOTER');
  assert.equal(resAdmin.nextState.voters.find((v) => v.id === 'v2')?.name, 'Siti Aminah Baru');
  assert.equal(resAdmin.nextState.voters.find((v) => v.id === 'v2')?.votedCandidateId, 'c1');
  assert.equal(resAdmin.nextState.candidates.find((c) => c.id === 'c1')?.votes, 1);
  assert.equal(resAdmin.nextState.candidates.find((c) => c.id === 'c2')?.votes, 0);

  // Unchecking hasVoted clears votedCandidateId & votedAt and decrements c2 votes
  const resUncheck = applyVoterEditInState(
    resSuper.nextState,
    'v2',
    {
      nis: '2024002',
      name: 'Siti Aminah',
      kelas: 'XI IPS 2',
      hasVoted: false,
    },
    superActor,
    '2026-11-17T08:10:00.000Z'
  );
  const uncheckedVoter = resUncheck.nextState.voters.find((v) => v.id === 'v2');
  assert.equal(uncheckedVoter?.hasVoted, false);
  assert.equal(uncheckedVoter?.votedAt, undefined);
  assert.equal(uncheckedVoter?.votedCandidateId, undefined);
  assert.equal(resUncheck.nextState.candidates.find((c) => c.id === 'c2')?.votes, 0);
});

test('computeStatistics calculates totals, percentages, and grade breakdowns accurately', () => {
  const stats = computeStatistics(sampleVoters, sampleState.candidates);
  assert.equal(stats.totalDpt, 2);
  assert.equal(stats.totalVoted, 1);
  assert.equal(stats.totalNotVoted, 1);
  assert.equal(stats.participationRate, 50);
  assert.equal(stats.totalValidVotes, 1);
  assert.equal(stats.candidateStats[0].percentage, 100);
  assert.equal(stats.gradeStats.find((g) => g.grade === 'XI')?.voted, 1);
  assert.equal(stats.gradeStats.find((g) => g.grade === 'XII')?.voted, 0);
});

test('parseVotersCsv and exportVotersCsv handle CSV roundtrips cleanly', () => {
  const csv = 'NIS,Nama,Kelas,Token\n2024099,Andi Wijaya,X Merdeka 1,654321\n2024001,Duplicate,XII IPA 1,111111';
  const existingNis = new Set(['2024001']);
  const existingTokens = new Set(['482910']);

  const parsed = parseVotersCsv(csv, existingNis, existingTokens);
  assert.equal(parsed.added.length, 1);
  assert.equal(parsed.skippedCount, 1);
  assert.equal(parsed.added[0].token, '654321');
  assert.equal(parsed.added[0].grade, 'X');

  const exported = exportVotersCsv(sampleVoters);
  assert.match(exported, /2024001,"Budi Santoso","XII IPA 1",XII,Belum Memilih/);
  assert.doesNotMatch(exported, /482910/);
});

test('resetElectionData clears votes, votedCandidateId, and voter status and logs audit trail', () => {
  const admin: AdminUser = {
    id: 'a1',
    username: 'smansakabun',
    password: 'Smansakabun123!',
    fullName: 'Tamtowi Yahya, S.Pd.',
    role: 'SUPERADMIN',
    createdAt: '2026-01-01T00:00:00Z',
  };
  const next = resetElectionData(sampleState, admin, '2026-11-16T13:00:00.000Z');
  assert.equal(next.voters.every((v) => !v.hasVoted && !v.votedCandidateId), true);
  assert.equal(next.candidates.every((c) => c.votes === 0), true);
  assert.equal(next.auditLogs[0].action, 'RESET_ELECTION');
});

test('deleteVotersByIds removes selected voters accurately', () => {
  const remaining = deleteVotersByIds(sampleVoters, new Set(['v1']));
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'v2');

  const unchanged = deleteVotersByIds(sampleVoters, new Set());
  assert.equal(unchanged.length, 2);
});

test('normalizeWhatsappNumber normalizes 08, 628, and +62 formats consistently', async () => {
  const { normalizeWhatsappNumber, maskWhatsappNumber } = await import('./electionLogic');
  assert.equal(normalizeWhatsappNumber('0812-3456-7890'), '6281234567890');
  assert.equal(normalizeWhatsappNumber('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalizeWhatsappNumber('81234567890'), '6281234567890');
  assert.equal(maskWhatsappNumber('081234567890'), '0812••••7890');
});

test('Admin RBAC restricts ADMIN to Ringkasan & Manajemen DPT only, and restricts Firebase/Sheets, GAS, and Paslon edits to SUPERADMIN', () => {
  assert.deepEqual(getAllowedAdminTabs('ADMIN'), ['overview', 'dpt']);
  assert.deepEqual(getAllowedAdminTabs('SUPERADMIN'), [
    'overview',
    'dpt',
    'candidates',
    'staff',
    'settings',
    'sheets',
    'gas',
    'audit',
  ]);

  assert.equal(canAccessAdminTab('ADMIN', 'overview'), true);
  assert.equal(canAccessAdminTab('ADMIN', 'dpt'), true);
  assert.equal(canAccessAdminTab('ADMIN', 'sheets'), false);
  assert.equal(canAccessAdminTab('ADMIN', 'gas'), false);
  assert.equal(canAccessAdminTab('ADMIN', 'candidates'), false);
  assert.equal(canAccessAdminTab('ADMIN', 'staff'), false);
  assert.equal(canAccessAdminTab('ADMIN', 'settings'), false);
  assert.equal(canAccessAdminTab('ADMIN', 'audit'), false);

  assert.equal(canAccessAdminTab('SUPERADMIN', 'sheets'), true);
  assert.equal(canAccessAdminTab('SUPERADMIN', 'gas'), true);
  assert.equal(canEditVotedCandidate('ADMIN'), false);
  assert.equal(canEditVotedCandidate('SUPERADMIN'), true);
});

test('resolveEffectiveVoterLoginMode, encodeVoterQrPayload, parseVoterQrPayload, and validateVoterQrLogin work consistently', () => {
  assert.equal(resolveEffectiveVoterLoginMode(baseSettings), 'NISN');
  assert.equal(resolveEffectiveVoterLoginMode({ voterLoginMode: 'QR_CODE' }), 'QR_CODE');
  assert.equal(resolveEffectiveVoterLoginMode({ voterLoginMode: 'BOTH' }), 'BOTH');

  const payload = encodeVoterQrPayload(sampleVoters[0]);
  assert.equal(payload, 'OSIS-VOTER:2024001');
  assert.equal(parseVoterQrPayload(payload), '2024001');
  assert.equal(parseVoterQrPayload('osis-voter: 2024001 '), '2024001');
  assert.equal(parseVoterQrPayload('{"nis":"2024001"}'), '2024001');
  assert.equal(parseVoterQrPayload('https://evoting.sch.id/?nis=2024001'), '2024001');
  assert.equal(parseVoterQrPayload('2024001'), '2024001');
  assert.equal(parseVoterQrPayload('   '), null);
  assert.equal(parseVoterQrPayload('{"invalid":true}'), null);

  const now = new Date('2026-11-16T12:00:00Z').getTime();
  const qrSettings: ElectionSettings = { ...baseSettings, voterLoginMode: 'QR_CODE' };

  const validQr = validateVoterQrLogin(sampleVoters, payload, qrSettings, now);
  assert.equal(validQr.ok, true);
  if (validQr.ok) {
    assert.equal(validQr.voter.id, 'v1');
  }

  const votedQr = validateVoterQrLogin(sampleVoters, 'OSIS-VOTER:2024002', qrSettings, now);
  assert.equal(votedQr.ok, false);
  if (!votedQr.ok) {
    assert.equal(votedQr.code, 'ALREADY_VOTED');
  }

  const malformedQr = validateVoterQrLogin(sampleVoters, '{"bad":1}', qrSettings, now);
  assert.equal(malformedQr.ok, false);
  if (!malformedQr.ok) {
    assert.equal(malformedQr.code, 'INVALID_CREDENTIALS');
  }

  const closedQr = validateVoterQrLogin(
    sampleVoters,
    payload,
    { ...qrSettings, isBoothOpen: false },
    now
  );
  assert.equal(closedQr.ok, false);
  if (!closedQr.ok) {
    assert.equal(closedQr.code, 'BOOTH_CLOSED');
  }
});

test('parseVotersCsv sets NIS as deterministic doc ID, supports 999 voters cleanly, and recognizes flexible headers', async () => {
  const { DPT_DISPLAY_LIMIT, MAX_CSV_VOTERS, computeNotVotedCount, getVoterDocIdFromNis } =
    await import('./electionLogic');

  assert.equal(DPT_DISPLAY_LIMIT, 20);
  assert.equal(MAX_CSV_VOTERS, 999);
  assert.equal(getVoterDocIdFromNis('2024.001'), '2024_001');
  assert.equal(computeNotVotedCount(999, 450), 549);
  assert.equal(computeNotVotedCount(100, 150), 0);

  const lines = ['NIS/Token,Nama,Kelas'];
  for (let i = 1; i <= 999; i++) {
    const grade = i % 3 === 0 ? 'XII IPA 1' : i % 2 === 0 ? 'XI IPS 1' : 'X Merdeka 1';
    lines.push(`${2026000 + i},Siswa ${i},${grade}`);
  }
  lines.push('2027999,Siswa Ke 1000,X Merdeka 2'); // Row 1000 must be capped

  const parsed = parseVotersCsv(lines.join('\n'), new Set(), new Set());
  assert.equal(parsed.added.length, 999);
  assert.equal(parsed.added[0].id, '2026001');
  assert.equal(parsed.added[0].nis, '2026001');
  assert.equal(parsed.added[0].hasVoted, false);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /999/);
});

test('computeStatistics calculates totalNotVoted directly from 1-doc summary override', () => {
  const stats = computeStatistics([], sampleState.candidates, {
    totalDpt: 999,
    totalVoted: 325,
    totalValidVotes: 325,
    candidateVotes: { c1: 200, c2: 125 },
    gradeTotals: { X: 333, XI: 333, XII: 333 },
    gradeVoted: { X: 100, XI: 125, XII: 100 },
  });

  assert.equal(stats.totalDpt, 999);
  assert.equal(stats.totalVoted, 325);
  assert.equal(stats.totalNotVoted, 674);
  assert.equal(stats.candidateStats[0].votes, 200);
  assert.equal(stats.candidateStats[1].votes, 125);
  assert.equal(stats.gradeStats.find((g) => g.grade === 'XI')?.voted, 125);
});

test('isAdditionalVoter distinguishes student classes from Kepala Sekolah, Guru, and Tendik', async () => {
  const { isAdditionalVoter } = await import('./electionLogic');

  assert.equal(isAdditionalVoter({ kelas: 'X A' }), false);
  assert.equal(isAdditionalVoter({ kelas: 'XI E' }), false);
  assert.equal(isAdditionalVoter({ kelas: 'XII B' }), false);
  assert.equal(isAdditionalVoter({ kelas: '10 MIPA 1' }), false);
  assert.equal(isAdditionalVoter({ kelas: '12 IPS 2' }), false);

  assert.equal(isAdditionalVoter({ kelas: 'Kepala Sekolah' }), true);
  assert.equal(isAdditionalVoter({ kelas: 'Wakil Kepala Sekolah' }), true);
  assert.equal(isAdditionalVoter({ kelas: 'Guru' }), true);
  assert.equal(isAdditionalVoter({ kelas: 'TENDIK' }), true);
  assert.equal(isAdditionalVoter({ kelas: 'Staf TU' }), true);
});

test('compareStudentVotersByClass and sortVotersOrdered keep student classes sorted from X A through XII E', async () => {
  const { compareStudentVotersByClass, compareAdditionalVoters, sortVotersOrdered } =
    await import('./electionLogic');

  const mkVoter = (id: string, name: string, kelas: string): Voter => ({
    id,
    nis: id,
    name,
    kelas,
    grade: extractGrade(kelas),
    token: '123456',
    hasVoted: false,
  });

  const scrambledStudents: Voter[] = [
    mkVoter('9', 'Zaki', 'XII E'),
    mkVoter('2', 'Bima', 'X C'),
    mkVoter('6', 'Citra', 'XI A'),
    mkVoter('1', 'Zahra', 'X A'),
    mkVoter('8', 'Dewi', 'XII A'),
    mkVoter('3', 'Ahmad', 'X A'),
    mkVoter('4', 'Rina', 'X B'),
    mkVoter('7', 'Eko', 'XI E'),
  ];

  const sortedStudents = [...scrambledStudents].sort(compareStudentVotersByClass);
  assert.deepEqual(
    sortedStudents.map((v) => `${v.kelas}:${v.name}`),
    [
      'X A:Ahmad',
      'X A:Zahra',
      'X B:Rina',
      'X C:Bima',
      'XI A:Citra',
      'XI E:Eko',
      'XII A:Dewi',
      'XII E:Zaki',
    ]
  );

  const scrambledAdditional: Voter[] = [
    mkVoter('2026030', 'Siti Tendik', 'TENDIK'),
    mkVoter('2026002', 'Budi Guru', 'Guru'),
    mkVoter('2026001', 'Ahmad Kepsek', 'Kepala Sekolah'),
    mkVoter('2026003', 'Andi Guru', 'Guru'),
    mkVoter('2026005', 'Dina Wakasek', 'Wakil Kepala Sekolah'),
    mkVoter('2026040', 'Roni TU', 'Staf TU'),
  ];

  const sortedAdditional = [...scrambledAdditional].sort(compareAdditionalVoters);
  assert.deepEqual(
    sortedAdditional.map((v) => `${v.kelas}:${v.name}`),
    [
      'Kepala Sekolah:Ahmad Kepsek',
      'Wakil Kepala Sekolah:Dina Wakasek',
      'Guru:Andi Guru',
      'Guru:Budi Guru',
      'Staf TU:Roni TU',
      'TENDIK:Siti Tendik',
    ]
  );

  const combined = sortVotersOrdered([...scrambledAdditional, ...scrambledStudents]);
  assert.equal(combined.length, 14);
  assert.equal(combined[0].kelas, 'X A');
  assert.equal(combined[7].kelas, 'XII E');
  assert.equal(combined[8].kelas, 'Kepala Sekolah');
  assert.equal(combined[13].kelas, 'TENDIK');
});

test('SEED_DATABASE student DPT sorts cleanly from X A to XII E and DPTb sorts cleanly', async () => {
  const { SEED_DATABASE } = await import('../data/seedData');
  const { isAdditionalVoter, compareStudentVotersByClass, compareAdditionalVoters } =
    await import('./electionLogic');

  const students = SEED_DATABASE.voters
    .filter((v) => !isAdditionalVoter(v))
    .sort(compareStudentVotersByClass);
  const additional = SEED_DATABASE.voters
    .filter((v) => isAdditionalVoter(v))
    .sort(compareAdditionalVoters);

  assert.equal(students.length, 498);
  assert.equal(additional.length, 37);
  assert.equal(students[0].kelas, 'X A');
  assert.equal(students[students.length - 1].kelas, 'XII E');

  const distinctClasses: string[] = [];
  for (const s of students) {
    if (distinctClasses[distinctClasses.length - 1] !== s.kelas) {
      distinctClasses.push(s.kelas);
    }
  }
  assert.deepEqual(distinctClasses, [
    'X A',
    'X B',
    'X C',
    'X D',
    'X E',
    'XI A',
    'XI B',
    'XI C',
    'XI D',
    'XI E',
    'XII A',
    'XII B',
    'XII C',
    'XII D',
    'XII E',
  ]);
  assert.equal(additional[0].kelas, 'Guru');
});

test('parseDptbVotersCsv parses ID/Nama/Keterangan, rejects student classes, and deduplicates existing IDs', async () => {
  const { parseDptbVotersCsv } = await import('./electionLogic');

  const csv = [
    'ID,Nama,Keterangan',
    '19750101,Drs. H. Ahmad Hidayat,Kepala Sekolah',
    '19820304,Siti Nurhaliza S.Pd.,Guru',
    '19900506,Bambang Sutrisno,TENDIK',
    '2024999,Siswa Nyasar,X A',
    '2024001,Sudah Terdaftar,Guru',
  ].join('\n');

  const existingNis = new Set(['2024001']);
  const existingTokens = new Set(['111111']);
  const res = parseDptbVotersCsv(csv, existingNis, existingTokens);

  assert.equal(res.added.length, 3);
  assert.equal(res.skippedCount, 1);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /kelas siswa/i);
  assert.equal(res.added[0].nis, '19750101');
  assert.equal(res.added[0].kelas, 'Kepala Sekolah');
  assert.equal(res.added[2].kelas, 'TENDIK');
});

test('mergeDptbCsvVoters appends new DPTb voters without removing Student DPT or existing votes', async () => {
  const { mergeDptbCsvVoters, parseDptbVotersCsv } = await import('./electionLogic');

  const existing: Voter[] = [
    {
      id: '2024001',
      nis: '2024001',
      name: 'Bima Pratama',
      kelas: 'X A',
      grade: 'X',
      token: '111111',
      hasVoted: true,
      votedAt: '2026-11-01T08:00:00.000Z',
      votedCandidateId: 'cand_1',
    },
    {
      id: '2026001',
      nis: '2026001',
      name: 'Guru Lama',
      kelas: 'Guru',
      grade: 'X',
      token: '222222',
      hasVoted: false,
    },
  ];

  const { added } = parseDptbVotersCsv(
    'NIP;Nama;Jabatan\n19700101;Kepala Sekolah Baru;Kepala Sekolah',
    new Set(existing.map((v) => v.nis)),
    new Set(existing.map((v) => v.token))
  );

  const merged = mergeDptbCsvVoters(existing, added);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].nis, '2024001');
  assert.equal(merged[0].hasVoted, true);
  assert.equal(merged[0].votedCandidateId, 'cand_1');
  assert.equal(merged[1].nis, '19700101');
  assert.equal(merged[1].kelas, 'Kepala Sekolah');
  assert.equal(merged[2].nis, '2026001');
});

test('computeStatistics excludes Guru & Tendik from Kelas X and exposes dedicated DPTB bucket', async () => {
  const { SEED_DATABASE } = await import('../data/seedData');
  const stats = computeStatistics(SEED_DATABASE.voters, SEED_DATABASE.candidates);

  const kelasX = stats.gradeStats.find((g) => g.grade === 'X');
  const kelasXI = stats.gradeStats.find((g) => g.grade === 'XI');
  const kelasXII = stats.gradeStats.find((g) => g.grade === 'XII');
  const dptb = stats.gradeStats.find((g) => g.grade === 'DPTB');

  assert.ok(kelasX && kelasXI && kelasXII && dptb);
  assert.equal(dptb.label, 'Guru & Tendik');
  assert.equal(dptb.total, 37);
  assert.equal(kelasX.total + kelasXI.total + kelasXII.total, 498);
  assert.equal(kelasX.total + kelasXI.total + kelasXII.total + dptb.total, 535);

  const p1 = SEED_DATABASE.candidates.find((c) => c.nomorUrut === 1);
  const p3 = SEED_DATABASE.candidates.find((c) => c.nomorUrut === 3);
  assert.equal(p1?.accentColor, '#059669');
  assert.notEqual(p1?.accentColor, p3?.accentColor);
  assert.equal(SEED_DATABASE.settings.voterLoginMode, 'QR_CODE');
});

test('formatCameraPermissionError provides clear guidance for permission denied, blocked, security, missing, or busy camera', async () => {
  const { formatCameraPermissionError } = await import('./electionLogic');

  assert.match(formatCameraPermissionError('NotAllowedError', false), /Persetujuan kamera ditolak/i);
  assert.match(formatCameraPermissionError('PermissionDeniedError', true), /Izin kamera diblokir/i);
  assert.match(formatCameraPermissionError('SecurityError', false), /HTTPS/i);
  assert.match(formatCameraPermissionError('NotFoundError', false), /tidak ditemukan/i);
  assert.match(formatCameraPermissionError('NotReadableError', false), /sedang digunakan aplikasi lain/i);
  assert.match(formatCameraPermissionError('UnknownError', false), /tidak dapat diakses/i);
});
