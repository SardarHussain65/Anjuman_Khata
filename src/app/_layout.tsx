import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { hydrateLanguagePreference, useAppLanguage } from '@/core/i18n';
import { useOtaAutoCheck } from '@/core/updates/appUpdates';
import { ThemeProvider, useTheme } from '@/core/theme/ThemeProvider';
import { AppErrorBoundary } from '@/core/ui/ScreenState';
import { AppDialogHost } from '@/core/ui/AppDialog';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useSyncScheduler } from '@/data/sync/scheduler';
import { InitialSyncBanner, SyncDrawerModal } from '@/data/sync/SyncStatusUI';

SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  anchor: '(user)',
};

const APP_LOGO = require('../../assets/images/logo.png');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function BrandedSplashOverlay() {
  return (
    <LinearGradient
      colors={['#0F5D46', '#0C503C', '#073326']}
      style={[StyleSheet.absoluteFill, styles.splash]}
    >
      <View style={styles.splashLogoWrap}>
        <Image source={APP_LOGO} style={styles.splashLogo} resizeMode="contain" />
      </View>
      <Text style={styles.splashTitle}>Anjuman Khata</Text>
      <Text style={styles.splashTitleUr}>انجمن کھاتہ</Text>
      <ActivityIndicator size="small" color="#E5B95C" style={styles.splashSpinner} />
    </LinearGradient>
  );
}

function RootNavigator() {
  const { isDark } = useTheme();
  const lang = useAppLanguage();
  const [langReady, setLangReady] = useState(false);
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    Promise.all([hydrateLanguagePreference(), hydrate()]).finally(() => {
      setLangReady(true);
    });
  }, [hydrate]);

  const ready = langReady && !isHydrating;
  const isAdmin =
    ready &&
    Boolean(
      session &&
        profile &&
        (profile.role === 'admin' || profile.role === 'super_admin') &&
        profile.status === 'active',
    );

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  // Sync runs in BOTH Read-Only Community Viewer mode (pull-only) and Admin mode (push + pull)
  useSyncScheduler(ready);
  // Silently check for EAS OTA updates in release/preview builds when online
  useOtaAutoCheck(ready, lang);

  return (
    <View style={styles.root}>
      <StatusBar style={!ready ? 'light' : isDark ? 'light' : 'dark'} />
      <InitialSyncBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!isAdmin} redirectTo="/(admin)/(tabs)">
          <Stack.Screen name="(user)" />
          <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={isAdmin} redirectTo="/(user)">
          <Stack.Screen name="(admin)" />
        </Stack.Protected>
      </Stack>
      {!ready ? <BrandedSplashOverlay /> : null}
      <SyncDrawerModal />
      <AppDialogHost />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AppErrorBoundary>
              <RootNavigator />
            </AppErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  splash: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  splashLogoWrap: {
    width: 112,
    height: 112,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#0C503C',
    borderWidth: 2,
    borderColor: 'rgba(229, 185, 92, 0.45)',
    marginBottom: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  splashLogo: {
    width: '100%',
    height: '100%',
  },
  splashTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  splashTitleUr: {
    color: '#E5B95C',
    fontSize: 20,
    fontWeight: '700',
  },
  splashSpinner: {
    marginTop: 18,
  },
});
