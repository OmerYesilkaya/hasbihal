import { createContext, useContext, type ReactNode } from 'react';
import { createTranslator, resolveLocale, TIME_ZONE, type Translate } from '@hasbihal/core';

export const locale = resolveLocale(navigator.languages);
const translate = createTranslator(locale);
const I18nContext = createContext<Translate>(translate);

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nContext.Provider value={translate}>{children}</I18nContext.Provider>;
}

export function useT(): Translate {
  return useContext(I18nContext);
}

// Everyone is in Turkey (A17): times show in Istanbul time, whatever the computer is set to.
const timeFormat = new Intl.DateTimeFormat(locale, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});
const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: TIME_ZONE });
const fullFormat = new Intl.DateTimeFormat(locale, {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: TIME_ZONE,
});

/** "14:05". */
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));
/** "15 Kasım 2026 Pazar", for day separators. */
export const formatDay = (iso: string) => dayFormat.format(new Date(iso));
/** "15 Kasım 2026 14:05", for tooltips. */
export const formatDateTime = (iso: string) => fullFormat.format(new Date(iso));
/** A key that is equal for two timestamps on the same Istanbul day. */
export const dayKey = (iso: string) => dayFormat.format(new Date(iso));

const weekdayFormat = new Intl.DateTimeFormat(locale, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: TIME_ZONE,
});

/**
 * When an event happens, as people say it: "Bugün 09:00", "Yarın 09:00", "Pzt 23 Kas 09:00".
 * `today` and `tomorrow` are the translated words.
 */
export function formatWhen(iso: string, words: { today: string; tomorrow: string }): string {
  const key = dayKey(iso);
  const now = Date.now();
  const day =
    key === dayKey(new Date(now).toISOString())
      ? words.today
      : key === dayKey(new Date(now + 86_400_000).toISOString())
        ? words.tomorrow
        : weekdayFormat.format(new Date(iso));
  return `${day} ${formatTime(iso)}`;
}
