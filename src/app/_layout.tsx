import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { hydrateLanguagePreference } from '@/core/i18n';
import { ThemeProvider, useTheme } from '@/core/theme/ThemeProvider';
import { AppErrorBoundary, LoadingState } from '@/core/ui/ScreenState';
import { useAuthStore } from '@/features/auth/store/authStore';

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

  if (!langReady || isHydrating) {
    return <LoadingState />;
  }

  const isAuthenticated = Boolean(session && profile);
  const isAdmin = isAuthenticated && profile?.role === 'admin';
  const isStandardUser = isAuthenticated && profile?.role === 'user';

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={isStandardUser}>
          <Stack.Screen name="(user)" />
        </Stack.Protected>
        <Stack.Protected guard={isAdmin}>
          <Stack.Screen name="(admin)" />
        </Stack.Protected>
      </Stack>
    </>
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
