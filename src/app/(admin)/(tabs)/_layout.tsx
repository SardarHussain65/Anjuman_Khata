import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { SyncStatusPill } from '@/data/sync/SyncStatusUI';

const APP_LOGO = require('../../../../assets/images/logo.png');

function BrandedHeaderTitle({ title, textColor }: { title: string; textColor: string }) {
  return (
    <View style={styles.headerTitleRow}>
      <Image source={APP_LOGO} style={styles.headerLogo} resizeMode="cover" />
      <Text style={[styles.headerTitleText, { color: textColor }]} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

function TabIcon({
  name,
  focused,
  color,
  activeBg,
}: {
  name: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  color: string;
  activeBg: string;
}) {
  return (
    <View style={[styles.iconPill, focused && { backgroundColor: activeBg }]}>
      <Ionicons name={name} size={21} color={color} />
    </View>
  );
}

export default function AdminTabsLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerRight: () => <SyncStatusPill />,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 60 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 8,
          elevation: 10,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -2 },
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginTop: 2,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.ledger'),
          headerTitle: () => <BrandedHeaderTitle title={t('tabs.ledger')} textColor={colors.text} />,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? 'grid' : 'grid-outline'}
              focused={focused}
              color={typeof color === 'string' ? color : colors.textMuted}
              activeBg={colors.primarySoft}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: t('tabs.members'),
          headerTitle: () => <BrandedHeaderTitle title={t('tabs.members')} textColor={colors.text} />,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? 'people' : 'people-outline'}
              focused={focused}
              color={typeof color === 'string' ? color : colors.textMuted}
              activeBg={colors.primarySoft}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="zakat"
        options={{
          title: t('tabs.zakat'),
          headerTitle: () => <BrandedHeaderTitle title={t('tabs.zakat')} textColor={colors.zakatText} />,
          tabBarActiveTintColor: colors.zakat,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? 'sparkles' : 'sparkles-outline'}
              focused={focused}
              color={typeof color === 'string' ? color : colors.textMuted}
              activeBg={colors.zakatSoft}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('tabs.more'),
          headerTitle: () => <BrandedHeaderTitle title={t('tabs.more')} textColor={colors.text} />,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name={focused ? 'menu' : 'menu-outline'}
              focused={focused}
              color={typeof color === 'string' ? color : colors.textMuted}
              activeBg={colors.primarySoft}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerLogo: {
    width: 28,
    height: 28,
    borderRadius: 7,
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  iconPill: {
    width: 44,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
