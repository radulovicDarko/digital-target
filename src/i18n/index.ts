import i18n from 'i18next';
import { NativeModules, Platform } from 'react-native';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import sr from './locales/sr-Latn.json';

const fallback = 'en';

/** Detect the device locale without expo-localization. */
const detectLocale = (): string => {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings as
        | { AppleLocale?: string; AppleLanguages?: string[] }
        | undefined;
      const tag = settings?.AppleLocale ?? settings?.AppleLanguages?.[0];
      if (tag) return tag.replace('_', '-');
    } else if (Platform.OS === 'android') {
      const tag = NativeModules.I18nManager?.localeIdentifier as string | undefined;
      if (tag) return tag.replace('_', '-');
    }
    // Hermes ships Intl; this works in tests too.
    return new Intl.DateTimeFormat().resolvedOptions().locale ?? fallback;
  } catch {
    return fallback;
  }
};

const detected = detectLocale();
const supported = ['en', 'sr-Latn'] as const;
const lng =
  supported.find((s) => s === detected) ??
  supported.find((s) => detected.startsWith(s.split('-')[0]!)) ??
  fallback;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'sr-Latn': { translation: sr },
  },
  lng,
  fallbackLng: fallback,
  interpolation: { escapeValue: false },
  returnNull: false,
  compatibilityJSON: 'v3',
});

export default i18n;
