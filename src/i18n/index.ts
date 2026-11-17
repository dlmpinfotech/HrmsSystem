import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ta from './locales/ta.json';
import { storage } from '@/lib/utils';
import type { Language } from '@shared/constants';

export const LANGUAGE_STORAGE_KEY = 'hrms.lang';

/**
 * To add a language: create locales/<code>.json with the same keys as en.json,
 * register it in `resources` and SUPPORTED_LANGUAGES, and add the code to the
 * `language` check constraints in the database.
 */
export const SUPPORTED_LANGUAGES: { code: Language; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ta', label: 'தமிழ்', short: 'த' },
];

export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.some((l) => l.code === value);
}

/** The language the user explicitly chose, if any. */
export function storedLanguage(): Language | null {
  const v = typeof window === 'undefined' ? null : storage.get(LANGUAGE_STORAGE_KEY);
  return isLanguage(v) ? v : null;
}

function initialLanguage(): Language {
  const saved = storedLanguage();
  if (saved) return saved;
  const nav = typeof navigator !== 'undefined' ? navigator.language?.toLowerCase() : '';
  return nav?.startsWith('ta') ? 'ta' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ta: { translation: ta } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

function applyLang(lng: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}
applyLang(i18n.language);
i18n.on('languageChanged', applyLang);

/** Switches language instantly (no reload). `persist` records it as the user's explicit choice. */
export async function setLanguage(lng: Language, persist = true) {
  if (persist) storage.set(LANGUAGE_STORAGE_KEY, lng);
  if (i18n.language !== lng) await i18n.changeLanguage(lng);
}

export default i18n;
