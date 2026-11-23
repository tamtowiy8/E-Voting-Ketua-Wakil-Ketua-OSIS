import type { ThemeConfig, ThemeSurface } from '../types/evoting.ts';

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'navy',
    name: 'Biru Navy Klasik',
    description: 'Formal pendidikan dengan aksen emas.',
    primaryColor: '#0F1E3D',
    secondaryColor: '#1E3A5F',
    accentColor: '#D97706',
  },
  {
    id: 'emerald',
    name: 'Zamrud Pendidikan',
    description: 'Hijau zamrud segar dan berwibawa.',
    primaryColor: '#064E3B',
    secondaryColor: '#047857',
    accentColor: '#D97706',
  },
  {
    id: 'maroon',
    name: 'Marun Nusantara',
    description: 'Merah marun tegas dengan aksen hangat.',
    primaryColor: '#581C1C',
    secondaryColor: '#7F1D1D',
    accentColor: '#D97706',
  },
  {
    id: 'indigo',
    name: 'Indigo Modern',
    description: 'Ungu tua akademik dengan aksen biru cerah.',
    primaryColor: '#1E1B4B',
    secondaryColor: '#312E81',
    accentColor: '#0284C7',
  },
  {
    id: 'slate',
    name: 'Slate Minimalis',
    description: 'Gelap netral dengan aksen hijau mint.',
    primaryColor: '#0F172A',
    secondaryColor: '#334155',
    accentColor: '#10B981',
  },
];

export const THEME_SURFACES: { id: ThemeSurface; label: string; bgHex: string; cardHex: string }[] = [
  { id: 'light', label: 'Terang Bersih', bgHex: '#F8FAFC', cardHex: '#FFFFFF' },
  { id: 'warm', label: 'Krem Hangat', bgHex: '#FAF7F0', cardHex: '#FFFDF9' },
  { id: 'cool', label: 'Abu Sejuk', bgHex: '#EFF4F9', cardHex: '#FFFFFF' },
];

export const DEFAULT_THEME: ThemeConfig = {
  presetId: 'navy',
  primaryColor: '#0F1E3D',
  secondaryColor: '#1E3A5F',
  accentColor: '#D97706',
  surfaceMode: 'light',
};

export function resolveTheme(theme?: ThemeConfig): ThemeConfig {
  if (!theme) return DEFAULT_THEME;
  return {
    presetId: theme.presetId || DEFAULT_THEME.presetId,
    primaryColor: theme.primaryColor || DEFAULT_THEME.primaryColor,
    secondaryColor: theme.secondaryColor || DEFAULT_THEME.secondaryColor,
    accentColor: theme.accentColor || DEFAULT_THEME.accentColor,
    surfaceMode: theme.surfaceMode || DEFAULT_THEME.surfaceMode,
  };
}

export function applyThemeToDocument(theme?: ThemeConfig): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(theme);
  const surface = THEME_SURFACES.find((s) => s.id === resolved.surfaceMode) || THEME_SURFACES[0];

  const root = document.documentElement;
  root.style.setProperty('--app-primary', resolved.primaryColor);
  root.style.setProperty('--app-secondary', resolved.secondaryColor);
  root.style.setProperty('--app-accent', resolved.accentColor);
  root.style.setProperty('--app-bg', surface.bgHex);
  root.style.setProperty('--app-surface', surface.cardHex);
}
