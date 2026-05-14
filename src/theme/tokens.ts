/**
 * Design tokens. The single source of truth for all visual values.
 * Components must consume these via useTheme(). No raw hex anywhere else.
 */

export type ColorScheme = 'light' | 'dark';

const palette = {
  // brand
  brand500: '#FF5A1F',
  brand600: '#E04A12',

  // neutral – dark
  neutral950: '#070A0E',
  neutral900: '#0B0F14',
  neutral800: '#121821',
  neutral700: '#1B232E',
  neutral600: '#2A3340',
  neutral500: '#475160',
  neutral400: '#6A7585',
  neutral300: '#A1ABBA',
  neutral200: '#D5DCE5',
  neutral100: '#EEF1F5',
  neutral50: '#F8FAFC',
  white: '#FFFFFF',

  // semantic
  ring10: '#22C55E',
  ring9: '#84CC16',
  ring8: '#EAB308',
  ring7: '#F59E0B',
  ring6: '#F97316',
  ringLow: '#EF4444',
  innerTen: '#06B6D4',

  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
};

export type Theme = {
  scheme: ColorScheme;
  colors: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    border: string;
    text: string;
    textMuted: string;
    textInverse: string;
    primary: string;
    primaryPressed: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
    ringPalette: Record<number, string>;
    innerTen: string;
  };
  spacing: (n: number) => number; // 4pt grid
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
  typography: {
    h1: { fontSize: number; lineHeight: number; fontWeight: '700' };
    h2: { fontSize: number; lineHeight: number; fontWeight: '700' };
    h3: { fontSize: number; lineHeight: number; fontWeight: '600' };
    body: { fontSize: number; lineHeight: number; fontWeight: '400' };
    bodyBold: { fontSize: number; lineHeight: number; fontWeight: '600' };
    caption: { fontSize: number; lineHeight: number; fontWeight: '500' };
    mono: { fontSize: number; lineHeight: number; fontWeight: '600' };
  };
  hitSlop: { top: number; bottom: number; left: number; right: number };
};

const ringPalette: Record<number, string> = {
  10: palette.ring10,
  9: palette.ring9,
  8: palette.ring8,
  7: palette.ring7,
  6: palette.ring6,
  5: palette.ringLow,
  4: palette.ringLow,
  3: palette.ringLow,
  2: palette.ringLow,
  1: palette.ringLow,
  0: palette.neutral500,
};

const shared = {
  spacing: (n: number) => n * 4,
  radius: { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 },
  typography: {
    h1: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const },
    h2: { fontSize: 24, lineHeight: 30, fontWeight: '700' as const },
    h3: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
    body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
    bodyBold: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
    mono: { fontSize: 14, lineHeight: 18, fontWeight: '600' as const },
  },
  hitSlop: { top: 12, bottom: 12, left: 12, right: 12 },
};

export const lightTheme: Theme = {
  ...shared,
  scheme: 'light',
  colors: {
    bg: palette.neutral50,
    surface: palette.white,
    surfaceAlt: palette.neutral100,
    border: palette.neutral200,
    text: palette.neutral900,
    textMuted: palette.neutral500,
    textInverse: palette.white,
    primary: palette.brand500,
    primaryPressed: palette.brand600,
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
    info: palette.info,
    ringPalette,
    innerTen: palette.innerTen,
  },
};

export const darkTheme: Theme = {
  ...shared,
  scheme: 'dark',
  colors: {
    bg: palette.neutral900,
    surface: palette.neutral800,
    surfaceAlt: palette.neutral700,
    border: palette.neutral700,
    text: palette.neutral100,
    textMuted: palette.neutral300,
    textInverse: palette.neutral900,
    primary: palette.brand500,
    primaryPressed: palette.brand600,
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
    info: palette.info,
    ringPalette,
    innerTen: palette.innerTen,
  },
};
