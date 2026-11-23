import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View } from 'react-native';
import { hydrateLanguagePreference } from '@/core/i18n';
import { ThemeProvider, useTheme } from '@/core/theme/ThemeProvider';
import { AppErrorBoundary, LoadingState } from '@/core/ui/ScreenState';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useSyncScheduler } from '@/data/sync/scheduler';
import { InitialSyncBanner, SyncDrawerModal } from '@/data/sync/SyncStatusUI';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function RootNavigator() {
  const { isDark } = useTheme();
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
  const isAdmin = ready && Boolean(session && profile && profile.role === 'admin');

  // Sync runs in BOTH Read-Only Community Viewer mode (pull-only) and Admin mode (push + pull)
  useSyncScheduler(ready);

  return (
    <View style={styles.root}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <InitialSyncBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!isAdmin}>
          <Stack.Screen name="(user)" />
          <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={isAdmin}>
          <Stack.Screen name="(admin)" />
        </Stack.Protected>
      </Stack>
      {!ready ? (
        <View style={StyleSheet.absoluteFill}>
          <LoadingState />
        </View>
      ) : null}
      <SyncDrawerModal />
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
});
