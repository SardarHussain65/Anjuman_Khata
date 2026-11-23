import i18n, { changeLanguage, t as i18nT } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Alert, I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import en from './en.json';
import ur from './ur.json';

export type AppLanguage = 'en' | 'ur';

const LANG_STORAGE_KEY = 'anjuman_khata_lang';

if (!i18n.isInitialized) {
  // eslint-disable-next-line import/no-named-as-default-member
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ur: { translation: ur },
    },
    lng: I18nManager.isRTL ? 'ur' : 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
}

export async function hydrateLanguagePreference(): Promise<AppLanguage> {
  try {
    const saved = await SecureStore.getItemAsync(LANG_STORAGE_KEY);
    const lang: AppLanguage = saved === 'ur' ? 'ur' : 'en';
    if (i18n.language !== lang) {
      await changeLanguage(lang);
    }
    const shouldBeRTL = lang === 'ur';
    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.allowRTL(shouldBeRTL);
      I18nManager.forceRTL(shouldBeRTL);
    }
    return lang;
  } catch {
    return i18n.language === 'ur' ? 'ur' : 'en';
  }
}

export async function switchLanguage(nextLang: AppLanguage): Promise<void> {
  try {
    await SecureStore.setItemAsync(LANG_STORAGE_KEY, nextLang);
  } catch {
    // Ignore secure store errors in test environments
  }
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

export function getCurrentLanguage(): AppLanguage {
  return i18n.language === 'ur' ? 'ur' : 'en';
}

export default i18n;
