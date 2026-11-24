import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  createTranslator,
  resolveLocale,
  TIME_ZONE,
  type Locale,
  type Translate,
} from '@hasbihal/core';

/** The computer's language, when it's one we have (Turkish otherwise). */
export const systemLocale = (): Locale => resolveLocale(navigator.languages);

function formatsFor(locale: Locale) {
  // Everyone is in Turkey (A17): times show in Istanbul time, whatever the computer is set to.
  return {
    time: new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TIME_ZONE,
    }),
    day: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: TIME_ZONE }),
    full: new Intl.DateTimeFormat(locale, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: TIME_ZONE,
    }),
    weekday: new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: TIME_ZONE,
    }),
    shortDate: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: TIME_ZONE,
    }),
    list: new Intl.ListFormat(locale, { type: 'conjunction' }),
    locale,
  };
}

/**
 * The language in use, for the plain formatting functions below. Changing the language (Settings,
 * A18) swaps it and, in the same step, re-renders everything that translates (`useT`), so
 * nothing on screen is left in the old language.
 */
let current = { choice: null as Locale | null, locale: systemLocale() };
let formats = formatsFor(current.locale);

function applyLanguage(choice: Locale | null) {
  const locale = choice ?? systemLocale();
  current = { choice, locale };
  formats = formatsFor(locale);
  document.documentElement.lang = locale;
}

/** At startup, before the first render: the language saved in Settings (null: the computer's). */
export function startI18n(choice: Locale | null): void {
  applyLanguage(choice);
}

/** The language in use, e.g. for number formatting. */
export const currentLocale = (): Locale => current.locale;

interface I18n {
  t: Translate;
  locale: Locale;
  /** What Settings shows: a language, or null for "same as the computer". */
  choice: Locale | null;
  setChoice: (choice: Locale | null) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState(current.choice);
  const locale = choice ?? systemLocale();
  const value = useMemo(
    (): I18n => ({
      t: createTranslator(locale),
      locale,
      choice,
      setChoice: (next) => {
        applyLanguage(next);
        setChoiceState(next);
        void window.hasbihal.system.setLanguage(next);
      },
    }),
    [locale, choice],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useT outside I18nProvider');
  return value;
}

export function useT(): Translate {
  return useI18n().t;
}

/** The language setting, for the Settings page. */
export function useLanguage(): Pick<I18n, 'locale' | 'choice' | 'setChoice'> {
  const { locale, choice, setChoice } = useI18n();
  return { locale, choice, setChoice };
}

/** "14:05". */
export const formatTime = (iso: string) => formats.time.format(new Date(iso));
/** "15 Kasım 2026 Pazar", for day separators. */
export const formatDay = (iso: string) => formats.day.format(new Date(iso));
/** "15 Kasım 2026 14:05", for tooltips. */
export const formatDateTime = (iso: string) => formats.full.format(new Date(iso));
/** Day keys don't depend on the language: "2026-11-15". */
const keyFormat = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone: TIME_ZONE });
/** A key that is equal for two timestamps on the same Istanbul day. */
export const dayKey = (iso: string) => keyFormat.format(new Date(iso));

/** A calendar page's parts, in Istanbul time: { month: 'ARA', day: '1', weekday: 'Sal' }. */
export function formatDateParts(iso: string): { month: string; day: string; weekday: string } {
  const parts = formats.weekday.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value.replace(/\.$/, '') ?? '';
  return {
    month: toUpper(part('month')),
    day: part('day'),
    weekday: part('weekday'),
  };
}

/** Upper case by the language's rules ("Bugün" → "BUGÜN", with the dotted İ in Turkish). */
export const toUpper = (text: string) => text.toLocaleUpperCase(formats.locale);

/** "1 Ara". */
export const formatShortDate = (iso: string) => formats.shortDate.format(new Date(iso));

/** "Ahmet, Zeynep ve Elif", in the language in use. */
export const formatList = (items: string[]) => formats.list.format(items);

/** Whether a time falls on today, or tomorrow, in Istanbul. */
export function relativeDay(iso: string): 'today' | 'tomorrow' | null {
  const key = dayKey(iso);
  const now = Date.now();
  if (key === dayKey(new Date(now).toISOString())) return 'today';
  if (key === dayKey(new Date(now + 86_400_000).toISOString())) return 'tomorrow';
  return null;
}

/**
 * When an event happens, as people say it: "Bugün 09:00", "Yarın 09:00", "Pzt 23 Kas 09:00".
 * `today` and `tomorrow` are the translated words.
 */
export function formatWhen(iso: string, words: { today: string; tomorrow: string }): string {
  const relative = relativeDay(iso);
  const day = relative ? words[relative] : formats.weekday.format(new Date(iso));
  return `${day} ${formatTime(iso)}`;
}
