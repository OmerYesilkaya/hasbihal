import { createContext, useContext, type ReactNode } from 'react';
import { createTranslator, resolveLocale, type Translate } from '@hasbihal/core';

const translate = createTranslator(resolveLocale(navigator.languages));
const I18nContext = createContext<Translate>(translate);

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nContext.Provider value={translate}>{children}</I18nContext.Provider>;
}

export function useT(): Translate {
  return useContext(I18nContext);
}
