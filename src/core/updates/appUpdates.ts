import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import NetInfo from '@react-native-community/netinfo';
import { showAppAlert } from '@/core/ui/AppDialog';

const AUTO_CHECK_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export interface OtaMeta {
  appVersion: string;
  runtimeVersion: string | null;
  channel: string | null;
  shortUpdateId: string | null;
  isEnabled: boolean;
}

export function getOtaMeta(): OtaMeta {
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const shortUpdateId = Updates.updateId ? Updates.updateId.slice(0, 8) : null;
  return {
    appVersion,
    runtimeVersion: Updates.runtimeVersion ?? appVersion,
    channel: Updates.channel ?? null,
    shortUpdateId,
    isEnabled: Boolean(Updates.isEnabled && !__DEV__),
  };
}

/**
 * Silently checks for an EAS OTA update on startup and when returning to foreground.
 * Never blocks offline launch (fallbackToCacheTimeout = 0). Prompts user before reloading.
 */
export function useOtaAutoCheck(ready: boolean, lang: 'en' | 'ur') {
  const lastCheckAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const promptedRef = useRef(false);

  useEffect(() => {
    if (!ready || __DEV__ || !Updates.isEnabled) return;

    const runCheck = async () => {
      const now = Date.now();
      if (inFlightRef.current || promptedRef.current) return;
      if (now - lastCheckAtRef.current < AUTO_CHECK_COOLDOWN_MS) return;

      const net = await NetInfo.fetch().catch(() => ({ isConnected: false }));
      if (!net.isConnected) return;

      inFlightRef.current = true;
      lastCheckAtRef.current = now;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;

        const fetched = await Updates.fetchUpdateAsync();
        if (!fetched.isNew) return;

        promptedRef.current = true;
        showAppAlert(
          lang === 'ur' ? 'نئی اپ ڈیٹ دستیاب ہے' : 'App Update Ready',
          lang === 'ur'
            ? 'تازہ ترین بہتری کے لیے ایپ کو ابھی ری اسٹارٹ کریں؟'
            : 'A new update has been downloaded. Restart now to apply it?',
          [
            {
              text: lang === 'ur' ? 'بعد میں' : 'Later',
              style: 'cancel',
            },
            {
              text: lang === 'ur' ? 'ابھی ری اسٹارٹ کریں' : 'Restart Now',
              onPress: () => {
                Updates.reloadAsync().catch(() => {});
              },
            },
          ],
        );
      } catch {
        // Silent in background — never disturb offline/flaky users
      } finally {
        inFlightRef.current = false;
      }
    };

    void runCheck();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void runCheck();
      }
    });

    return () => {
      sub.remove();
    };
  }, [ready, lang]);
}

/**
 * Manual "Check for App Updates" trigger for Admin & Client More screens.
 */
export async function checkForOtaUpdateManually(lang: 'en' | 'ur'): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) {
    showAppAlert(
      lang === 'ur' ? 'اپ ڈیٹ کی جانچ' : 'App Updates',
      lang === 'ur'
        ? 'او ٹی اے اپ ڈیٹس صرف انسٹال شدہ APK بلڈ میں کام کرتی ہیں۔'
        : 'Over-the-air updates are active in installed release/preview APK builds.',
    );
    return;
  }

  const net = await NetInfo.fetch().catch(() => ({ isConnected: false }));
  if (!net.isConnected) {
    showAppAlert(
      lang === 'ur' ? 'آف لائن' : 'Offline',
      lang === 'ur'
        ? 'اپ ڈیٹ چیک کرنے کے لیے انٹرنیٹ کنکشن ضروری ہے۔'
        : 'An internet connection is required to check for updates.',
    );
    return;
  }

  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      showAppAlert(
        lang === 'ur' ? 'ایپ اپ ٹو ڈیٹ ہے' : 'Up to Date',
        lang === 'ur'
          ? 'آپ پہلے ہی تازہ ترین ورژن استعمال کر رہے ہیں۔'
          : 'You are already running the latest version of Anjuman Khata.',
      );
      return;
    }

    const fetched = await Updates.fetchUpdateAsync();
    if (fetched.isNew) {
      showAppAlert(
        lang === 'ur' ? 'اپ ڈیٹ ڈاؤن لوڈ ہو گئی' : 'Update Downloaded',
        lang === 'ur'
          ? 'نئی اپ ڈیٹ لاگو کرنے کے لیے ابھی ری اسٹارٹ کریں۔'
          : 'Restart the app now to apply the latest update.',
        [
          { text: lang === 'ur' ? 'بعد میں' : 'Later', style: 'cancel' },
          {
            text: lang === 'ur' ? 'ری اسٹارٹ کریں' : 'Restart Now',
            onPress: () => {
              Updates.reloadAsync().catch(() => {});
            },
          },
        ],
      );
    }
  } catch (err) {
    showAppAlert(
      lang === 'ur' ? 'اپ ڈیٹ چیک ناکام' : 'Update Check Failed',
      err instanceof Error ? err.message : undefined,
    );
  }
}
