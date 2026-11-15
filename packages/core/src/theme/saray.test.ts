import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.ts';
import { AVATAR_COLORS, avatarColor, saray, toCssVariables, type ColorMode } from './saray.ts';

const AA_TEXT = 4.5;

describe.each<ColorMode>(['light', 'dark'])('saray %s', (mode) => {
  const c = saray[mode];
  const surfaces = { bg: c.bg, sidebar: c.sidebar, members: c.members, stage: c.stage };

  it.each(Object.entries(surfaces))('text colors are readable on %s', (_name, surface) => {
    expect(contrastRatio(c.text, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(c.textSecondary, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(c.textMuted, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(c.accentText, surface)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('text on primary is readable', () => {
    expect(contrastRatio(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('avatar colors', () => {
  it.each(AVATAR_COLORS)('white initials are readable on %s', (color) => {
    expect(contrastRatio('#FFFFFF', color)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('wraps any integer index into the palette', () => {
    expect(avatarColor(0)).toBe(AVATAR_COLORS[0]);
    expect(avatarColor(8)).toBe(AVATAR_COLORS[0]);
    expect(avatarColor(-1)).toBe(AVATAR_COLORS[7]);
  });
});

describe('toCssVariables', () => {
  it('kebab-cases names under the --hb- prefix', () => {
    const vars = toCssVariables(saray.dark);
    expect(vars['--hb-text-secondary']).toBe(saray.dark.textSecondary);
    expect(vars['--hb-bg']).toBe(saray.dark.bg);
  });
});
