import type { DatabaseState } from '../types/evoting.ts';
import { DEFAULT_THEME } from '../utils/theme.ts';
import { DEFAULT_CANDIDATES, DEFAULT_VOTERS } from './defaultSeedData.ts';

export const SEED_TIMESTAMP = 1763276400000;

export const SEED_DATABASE: DatabaseState = {
  settings: {
    schoolName: 'SMA Negeri 1 Kabun',
    academicYear: '2026/2027',
    electionTitle: 'Pemilihan Ketua & Wakil Ketua OSIS',
    logoUrl: '/assets/aistudio/LOGO_SMANSA_3D_d5e941c9.png',
    isBoothOpen: true,
    startTime: '2026-01-01T07:00',
    endTime: '2027-12-31T17:00',
    hideLiveResults: false,
    voterLoginMode: 'QR_CODE',
    theme: DEFAULT_THEME,
  },
  candidates: DEFAULT_CANDIDATES,
  voters: DEFAULT_VOTERS,
  admins: [
    {
      id: 'adm_super',
      username: 'smansakabun',
      password: 'Smansakabun123!',
      fullName: 'Tamtowi Yahya, S.Pd.',
      role: 'SUPERADMIN',
      whatsappNumber: '082288418531',
      createdAt: '2026-10-01T08:00:00.000Z',
    },
    {
      id: 'adm_panitia',
      username: 'panitia1',
      password: 'admin123',
      fullName: 'Dina Kusuma (Ketua KPPO)',
      role: 'ADMIN',
      whatsappNumber: '082233445566',
      createdAt: '2026-10-15T09:30:00.000Z',
    },
  ],
  auditLogs: [
    {
      id: 'log_init_1',
      timestamp: '2026-11-16T07:00:00.000Z',
      actorName: 'Tamtowi Yahya, S.Pd.',
      actorRole: 'SUPERADMIN',
      action: 'OPEN_BOOTH',
      detail: 'Membuka bilik suara elektronik untuk Pemilihan Ketua & Wakil Ketua OSIS 2026/2027.',
    },
    {
      id: 'log_init_2',
      timestamp: '2026-11-16T06:45:00.000Z',
      actorName: 'Dina Kusuma (Ketua KPPO)',
      actorRole: 'ADMIN',
      action: 'VERIFY_DPT',
      detail: `Memverifikasi ${DEFAULT_VOTERS.length} Daftar Pemilih Tetap (DPT) guru, tendik, dan siswa kelas X, XI, dan XII berdasarkan NIS/NISN.`,
    },
  ],
  lastUpdated: SEED_TIMESTAMP,
};
