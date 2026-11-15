import { saray, toCssVariables, type ColorMode } from '@hasbihal/core';

/** Follows the OS light/dark setting (DECISIONS A35). */
export function watchColorScheme(onChange: (mode: ColorMode) => void): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const emit = () => {
    onChange(query.matches ? 'dark' : 'light');
  };
  query.addEventListener('change', emit);
  emit();
}

export function applyTheme(mode: ColorMode): void {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(toCssVariables(saray[mode]))) {
    style.setProperty(name, value);
  }
  document.documentElement.dataset.mode = mode;
}
