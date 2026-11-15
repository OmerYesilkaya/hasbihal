/**
 * The Saray palette (DECISIONS A46): Ottoman crimson, gold, Iznik turquoise,
 * on walnut (dark) or cream (light). Values match the approved prototype.
 */

export type ColorMode = 'light' | 'dark';

export interface ThemeColors {
  /** Main content background. */
  bg: string;
  /** Room list sidebar. */
  sidebar: string;
  /** User panel at the bottom of the sidebar. */
  sidebarFooter: string;
  /** Member list column. */
  members: string;
  /** Hangout (video grid) area. */
  stage: string;
  /** Video tiles and media placeholders. */
  tile: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  /** Crimson: primary actions, unread badges. */
  primary: string;
  /** Text and icons on `primary`. */
  onPrimary: string;
  /** Gold: decoration, active speaker, highlights. */
  accent: string;
  /** Gold for text (meets contrast on backgrounds). */
  accentText: string;
  /** Turquoise: live hangouts, screen shares. */
  secondary: string;
  border: string;
  selected: string;
  /** Translucent gold behind mentions of the current user. */
  mention: string;
  input: string;
  chip: string;
  statusOnline: string;
  statusBusy: string;
}

export const saray: Record<ColorMode, ThemeColors> = {
  dark: {
    bg: '#241A17',
    sidebar: '#1B1311',
    sidebarFooter: '#160F0D',
    members: '#1F1714',
    stage: '#2C201C',
    tile: '#382924',
    text: '#F3E9DA',
    textSecondary: '#CDBFAC',
    textMuted: '#A39380',
    primary: '#9E1B32',
    onPrimary: '#FFFFFF',
    accent: '#C8A04A',
    accentText: '#D9B45E',
    secondary: '#5FB8B5',
    border: '#3A2C27',
    selected: '#3B2522',
    mention: 'rgba(200, 160, 74, 0.14)',
    input: '#2E221E',
    chip: '#33241F',
    statusOnline: '#5FA866',
    statusBusy: '#E0606C',
  },
  light: {
    bg: '#FBF6EE',
    sidebar: '#F1E6D6',
    sidebarFooter: '#EADDCA',
    members: '#F6EEE2',
    stage: '#EFE3D0',
    tile: '#E6D7C0',
    text: '#2A1E1A',
    textSecondary: '#54453D',
    textMuted: '#6E5F55',
    primary: '#9E1B32',
    onPrimary: '#FFFFFF',
    accent: '#C8A04A',
    accentText: '#7E5E14',
    secondary: '#1F6F6F',
    border: '#E2D4C0',
    selected: '#EAD6CC',
    mention: 'rgba(200, 160, 74, 0.22)',
    input: '#FFFFFF',
    chip: '#EBDDC8',
    statusOnline: '#3E7D44',
    statusBusy: '#9E1B32',
  },
};

/** The 8 avatar colors for members without a photo (DECISIONS A40). White initials sit on them. */
export const AVATAR_COLORS = [
  '#9E1B32',
  '#1F4E8C',
  '#24706F',
  '#8A6516',
  '#6E1023',
  '#4A6B2A',
  '#7B3F61',
  '#2F4A5E',
] as const;

export function avatarColor(index: number): string {
  const i =
    ((Math.trunc(index) % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length;
  return AVATAR_COLORS[i] ?? AVATAR_COLORS[0];
}

/** Maps theme colors to CSS custom properties: `textSecondary` → `--hb-text-secondary`. */
export function toCssVariables(colors: ThemeColors): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of Object.keys(colors) as (keyof ThemeColors)[]) {
    vars[`--hb-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = colors[name];
  }
  return vars;
}
