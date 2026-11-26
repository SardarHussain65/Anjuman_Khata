import React from 'react';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { SyncStatusPill } from '@/data/sync/SyncStatusUI';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function AdminStackLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerRight: () => <SyncStatusPill />,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="reports" options={{ title: t('reports.title') }} />
      <Stack.Screen name="history-viewer" options={{ title: t('history.title') }} />
      <Stack.Screen name="org-settings" options={{ title: t('settings.organization') }} />
      <Stack.Screen name="audit-log" options={{ title: t('settings.auditLog') }} />
      <Stack.Screen name="manage-admins" options={{ title: 'Manage Admins' }} />
    </Stack>
  );
}
