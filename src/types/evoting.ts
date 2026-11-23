export type GradeLevel = 'X' | 'XI' | 'XII';

export interface Voter {
  id: string;
  nis: string;
  name: string;
  kelas: string;
  grade: GradeLevel;
  token: string;
  hasVoted: boolean;
  votedAt?: string;
  votedCandidateId?: string;
}

export interface Candidate {
  id: string;
  nomorUrut: number;
  ketuaName: string;
  ketuaClass: string;
  wakilName: string;
  wakilClass: string;
  photoUrl: string;
  vision: string;
  missions: string[];
  programs?: string[];
  votes: number;
  accentColor: string;
}

export type AdminRole = 'SUPERADMIN' | 'ADMIN';

export interface AdminUser {
  id: string;
  username: string;
  password: string;
  fullName: string;
  role: AdminRole;
  whatsappNumber?: string;
  qrToken?: string;
  createdAt: string;
}

export type ThemeSurface = 'light' | 'warm' | 'cool';

export interface ThemeConfig {
  presetId: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  surfaceMode: ThemeSurface;
}

export type VoterLoginMode = 'NISN' | 'QR_CODE' | 'BOTH';

export interface ElectionSettings {
  schoolName: string;
  academicYear: string;
  electionTitle: string;
  logoUrl: string;
  isBoothOpen: boolean;
  startTime: string; // ISO local datetime string e.g. '2026-11-01T07:00'
  endTime: string;   // ISO local datetime string e.g. '2026-11-30T17:00'
  hideLiveResults: boolean;
  voterLoginMode?: VoterLoginMode;
  theme?: ThemeConfig;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: AdminRole | 'SYSTEM';
  action: string;
  detail: string;
}

export interface VoteReceipt {
  receiptCode: string;
  voterName: string;
  voterNis: string;
  voterClass: string;
  timestamp: string;
  offlinePending?: boolean;
}

export interface DatabaseState {
  voters: Voter[];
  candidates: Candidate[];
  admins: AdminUser[];
  settings: ElectionSettings;
  auditLogs: AuditLogEntry[];
  lastUpdated: number;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}
