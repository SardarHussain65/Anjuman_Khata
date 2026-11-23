import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { SyncStatusPill } from '@/data/sync/SyncStatusUI';

export default function AdminTabsLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerRight: () => <SyncStatusPill />,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.ledger'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={typeof color === 'string' ? color : colors.textMuted} />
          ),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: t('tabs.members'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={typeof color === 'string' ? color : colors.textMuted} />
          ),
        }}
      />
      <Tabs.Screen
        name="zakat"
        options={{
          title: t('tabs.zakat'),
          tabBarActiveTintColor: colors.zakat,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="sparkles-outline" size={size} color={typeof color === 'string' ? color : colors.textMuted} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('tabs.more'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="menu-outline" size={size} color={typeof color === 'string' ? color : colors.textMuted} />
          ),
        }}
      />
    </Tabs>
  );
}
