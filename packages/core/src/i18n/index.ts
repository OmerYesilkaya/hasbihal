import { IntlMessageFormat } from 'intl-messageformat';
import { en } from './en.ts';
import { tr, type MessageKey } from './tr.ts';

export type { MessageKey } from './tr.ts';

export const LOCALES = ['tr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'tr';

const catalogs: Record<Locale, Record<MessageKey, string>> = { tr, en };

export type MessageValues = Record<string, string | number>;
export type Translate = (key: MessageKey, values?: MessageValues) => string;

/** Picks the first supported locale from the user's preferences (e.g. navigator.languages). */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const language = tag.toLowerCase().split('-')[0];
    const match = LOCALES.find((locale) => locale === language);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

export function createTranslator(locale: Locale): Translate {
  const catalog = catalogs[locale];
  const compiled = new Map<MessageKey, IntlMessageFormat>();
  return (key, values) => {
    let format = compiled.get(key);
    if (!format) {
      format = new IntlMessageFormat(catalog[key], locale);
      compiled.set(key, format);
    }
    return String(format.format(values));
  };
}
