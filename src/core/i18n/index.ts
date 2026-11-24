import i18n, { changeLanguage, t as i18nT } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Alert, I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { create } from 'zustand';
import en from './en.json';
import ur from './ur.json';

export type AppLanguage = 'en' | 'ur';

const LANG_STORAGE_KEY = 'anjuman_khata_lang';

function normalizeLang(raw: string | undefined | null): AppLanguage {
  return raw && raw.toLowerCase().startsWith('ur') ? 'ur' : 'en';
}

interface LanguageState {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: I18nManager.isRTL ? 'ur' : 'en',
  setLanguage: (language) => set({ language }),
}));

if (!i18n.isInitialized) {
  const initialLang: AppLanguage = I18nManager.isRTL ? 'ur' : 'en';
  // eslint-disable-next-line import/no-named-as-default-member
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ur: { translation: ur },
    },
    lng: initialLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
  useLanguageStore.getState().setLanguage(initialLang);
}

// Keep reactive store synchronized whenever i18next changes language from anywhere
i18n.on('languageChanged', (lng) => {
  const normalized = normalizeLang(lng);
  if (useLanguageStore.getState().language !== normalized) {
    useLanguageStore.getState().setLanguage(normalized);
  }
});

export async function hydrateLanguagePreference(): Promise<AppLanguage> {
  try {
    const saved = await SecureStore.getItemAsync(LANG_STORAGE_KEY);
    const lang: AppLanguage = saved ? normalizeLang(saved) : normalizeLang(i18n.language);
    if (normalizeLang(i18n.language) !== lang) {
      await changeLanguage(lang);
    }
    useLanguageStore.getState().setLanguage(lang);
    const shouldBeRTL = lang === 'ur';
    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.allowRTL(shouldBeRTL);
      I18nManager.forceRTL(shouldBeRTL);
    }
    return lang;
  } catch {
    const fallback = normalizeLang(i18n.language);
    useLanguageStore.getState().setLanguage(fallback);
    return fallback;
  }
}

export async function switchLanguage(nextLang: AppLanguage): Promise<void> {
  try {
    await SecureStore.setItemAsync(LANG_STORAGE_KEY, nextLang);
  } catch {
    // Ignore secure store errors in test environments
  }
  useLanguageStore.getState().setLanguage(nextLang);
  await changeLanguage(nextLang);
  const shouldBeRTL = nextLang === 'ur';
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.allowRTL(shouldBeRTL);
    I18nManager.forceRTL(shouldBeRTL);
    try {
      await Updates.reloadAsync();
    } catch {
      Alert.alert(
        i18nT('settings.rtlRestartTitle'),
        i18nT('settings.rtlRestartMessage'),
      );
    }
  }
}

/** Reactive React hook (React Compiler safe) — always reflects the active UI language. */
export function useAppLanguage(): AppLanguage {
  return useLanguageStore((s) => s.language);
}

export function getCurrentLanguage(): AppLanguage {
  return useLanguageStore.getState().language;
}

export default i18n;
