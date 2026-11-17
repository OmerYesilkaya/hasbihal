import type { CSSProperties } from 'react';

/**
 * The style that fills a range slider's track up to its thumb. Sliders are drawn by our own CSS
 * (global.css, "Native controls") so they look the same on macOS and Windows, and CSS alone
 * can't know how far along the thumb is.
 */
export function rangeFill(value: number, min: number, max: number): CSSProperties {
  const ratio = max > min ? (value - min) / (max - min) : 0;
  const percent = Math.min(Math.max(ratio, 0), 1) * 100;
  return { '--range-fill': `${String(percent)}%` } as CSSProperties;
}
