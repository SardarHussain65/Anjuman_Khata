/**
 * Heritage Emerald & Warm Ivory Design System Tokens for Anjuman Khata.
 * Zakat carries a dedicated Antique Gold accent palette so Charity and Zakat are
 * always visually distinct across every screen.
 */

export interface ThemeColors {
  // Surfaces
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceSubtle: string;
  border: string;
  borderStrong: string;

  // Text
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Brand (Charity — Deep Heritage Emerald)
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  primaryBorder: string;

  // Zakat Subsystem (Dedicated Antique Gold)
  zakat: string;
  zakatPressed: string;
  zakatSoft: string;
  zakatBorder: string;
  zakatText: string;

  // Edit Mode Guardrail
  editBannerBg: string;
  editBannerText: string;
  editBorder: string;

  // Semantic & Compliance Statuses
  metBg: string;
  metText: string;
  shortBg: string;
  shortText: string;
  unpaidBg: string;
  unpaidText: string;
  advanceBg: string;
  advanceText: string;
  exemptBg: string;
  exemptText: string;

  // General Feedback
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  info: string;
  infoSoft: string;
}

export const lightColors: ThemeColors = {
  background: '#F7F6F2',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceSubtle: '#EFECE4',
  border: '#E5E2D9',
  borderStrong: '#CFCAB9',

  text: '#15221E',
  textSecondary: '#4B5B55',
  textMuted: '#788580',
  textInverse: '#FFFFFF',

  primary: '#0F5C4A',
  primaryPressed: '#0A4235',
  primarySoft: '#E6F4F0',
  primaryBorder: '#B4DFD3',

  zakat: '#B7791F',
  zakatPressed: '#975A16',
  zakatSoft: '#FEF6E7',
  zakatBorder: '#F3D9A4',
  zakatText: '#7C4D12',

  editBannerBg: '#FEF3C7',
  editBannerText: '#92400E',
  editBorder: '#D97706',

  metBg: '#DCFCE7',
  metText: '#15803D',
  shortBg: '#FEF3C7',
  shortText: '#B45309',
  unpaidBg: '#FEE2E2',
  unpaidText: '#B91C1C',
  advanceBg: '#E0F2FE',
  advanceText: '#0369A1',
  exemptBg: '#F1F5F9',
  exemptText: '#64748B',

  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  info: '#0284C7',
  infoSoft: '#E0F2FE',
};

export const darkColors: ThemeColors = {
  background: '#0F1513',
  surface: '#17211E',
  surfaceElevated: '#1F2C28',
  surfaceSubtle: '#131C19',
  border: '#273832',
  borderStrong: '#385048',

  text: '#F1F5F3',
  textSecondary: '#B3C3BC',
  textMuted: '#7E9189',
  textInverse: '#0F1513',

  primary: '#2EA88A',
  primaryPressed: '#238A71',
  primarySoft: '#13312A',
  primaryBorder: '#1E5245',

  zakat: '#E3A947',
  zakatPressed: '#C78E2E',
  zakatSoft: '#2E2312',
  zakatBorder: '#5C431C',
  zakatText: '#F6D186',

  editBannerBg: '#3D2A0D',
  editBannerText: '#FCD34D',
  editBorder: '#F59E0B',

  metBg: '#133322',
  metText: '#6EE7B7',
  shortBg: '#3B280E',
  shortText: '#FCD34D',
  unpaidBg: '#3D1618',
  unpaidText: '#FCA5A5',
  advanceBg: '#112E42',
  advanceText: '#7DD3FC',
  exemptBg: '#1E293B',
  exemptText: '#94A3B8',

  danger: '#EF4444',
  dangerSoft: '#3D1618',
  warning: '#F59E0B',
  warningSoft: '#3B280E',
  success: '#22C55E',
  successSoft: '#133322',
  info: '#38BDF8',
  infoSoft: '#112E42',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  heading: { fontSize: 18, fontWeight: '700' as const, lineHeight: 24 },
  subheading: { fontSize: 15, fontWeight: '600' as const, lineHeight: 20 },
  body: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },
  micro: { fontSize: 11, fontWeight: '600' as const, lineHeight: 14 },
  numeric: { fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
};
