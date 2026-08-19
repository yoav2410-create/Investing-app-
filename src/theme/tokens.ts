/**
 * Design tokens.
 *
 * Two palettes, same keys. Semantic names only — nothing in a screen should
 * reference a hex value or ask which mode is active.
 */

export interface Palette {
  bg: string;
  bgElevated: string;
  card: string;
  cardMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentMuted: string;
  up: string;
  upMuted: string;
  down: string;
  downMuted: string;
  flat: string;
  flatMuted: string;
  warn: string;
  warnMuted: string;
  overlay: string;
  chartGrid: string;
  /** Series colours for multi-series charts, ordered for contrast. */
  series: string[];
}

export const lightPalette: Palette = {
  bg: '#F4F6F9',
  bgElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardMuted: '#EEF1F6',
  border: '#DFE4EC',
  borderStrong: '#C3CBD8',
  text: '#0E1620',
  textMuted: '#5A6577',
  textFaint: '#8A93A3',
  accent: '#2D5BD7',
  accentMuted: '#E4EAFB',
  up: '#0F7B4F',
  upMuted: '#DFF3E9',
  down: '#C0392B',
  downMuted: '#FBE6E3',
  flat: '#5A6577',
  flatMuted: '#EEF1F6',
  warn: '#B26A00',
  warnMuted: '#FDF0DC',
  overlay: 'rgba(14, 22, 32, 0.45)',
  chartGrid: '#E4E8EF',
  series: ['#2D5BD7', '#0F7B4F', '#B26A00', '#7A3FBF', '#C0392B', '#0E7490'],
};

export const darkPalette: Palette = {
  bg: '#0B0F14',
  bgElevated: '#121820',
  card: '#141C26',
  cardMuted: '#1B2532',
  border: '#233043',
  borderStrong: '#33455D',
  text: '#E9EDF3',
  textMuted: '#9AA7B8',
  textFaint: '#6C7A8C',
  accent: '#6C93F5',
  accentMuted: '#1B2A4A',
  up: '#3DD68C',
  upMuted: '#12331F',
  down: '#FF6B5E',
  downMuted: '#3A1A18',
  flat: '#9AA7B8',
  flatMuted: '#1B2532',
  warn: '#F0B44C',
  warnMuted: '#3A2C12',
  overlay: 'rgba(0, 0, 0, 0.6)',
  chartGrid: '#1E2A38',
  series: ['#6C93F5', '#3DD68C', '#F0B44C', '#B98BF0', '#FF6B5E', '#4CC7D8'],
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
  pill: 999,
} as const;

/**
 * Base sizes only. Every Text in the app allows Dynamic Type to scale these,
 * so nothing here is a fixed pixel promise.
 */
export const type = {
  display: { size: 34, weight: '700' as const, spacing: -0.5 },
  title: { size: 22, weight: '700' as const, spacing: -0.2 },
  heading: { size: 17, weight: '600' as const, spacing: 0 },
  body: { size: 15, weight: '400' as const, spacing: 0 },
  label: { size: 13, weight: '500' as const, spacing: 0 },
  caption: { size: 12, weight: '400' as const, spacing: 0.1 },
  mono: { size: 14, weight: '600' as const, spacing: 0 },
} as const;

export type Tone = 'up' | 'down' | 'flat' | 'warn' | 'accent';

export function toneColors(p: Palette, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'up':
      return { fg: p.up, bg: p.upMuted };
    case 'down':
      return { fg: p.down, bg: p.downMuted };
    case 'warn':
      return { fg: p.warn, bg: p.warnMuted };
    case 'accent':
      return { fg: p.accent, bg: p.accentMuted };
    default:
      return { fg: p.flat, bg: p.flatMuted };
  }
}
