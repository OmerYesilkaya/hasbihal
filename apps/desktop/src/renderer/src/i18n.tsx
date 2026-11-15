import { createContext, useContext, type ReactNode } from 'react';
import { createTranslator, resolveLocale, type Translate } from '@hasbihal/core';

export const locale = resolveLocale(navigator.languages);
const translate = createTranslator(locale);
const I18nContext = createContext<Translate>(translate);

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nContext.Provider value={translate}>{children}</I18nContext.Provider>;
}

export function useT(): Translate {
  return useContext(I18nContext);
}

/** Everyone is in Turkey (A17): times show in Istanbul time, whatever the computer is set to. */
const TIME_ZONE = 'Europe/Istanbul';
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
