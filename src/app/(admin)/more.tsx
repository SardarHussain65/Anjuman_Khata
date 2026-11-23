import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemePreference, useTheme, useThemePreferenceStore } from '@/core/theme/ThemeProvider';
import { getCurrentLanguage, switchLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useSyncStatusStore } from '@/data/sync/statusStore';

export default function AdminMoreRoute() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const lang = getCurrentLanguage();
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const themePref = useThemePreferenceStore((s) => s.preference);
  const setThemePref = useThemePreferenceStore((s) => s.setPreference);
  const setSyncDrawerOpen = useSyncStatusStore((s) => s.setDrawerOpen);

  const navItems: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle: string;
    onPress: () => void;
  }[] = [
    {
      icon: 'archive-outline',
      title: t('history.title'),
      subtitle: 'Multi-year archive, YoY totals, close/reopen fiscal years',
      onPress: () => router.push('/(admin)/history-viewer'),
    },
    {
      icon: 'document-text-outline',
      title: t('reports.title'),
      subtitle: 'Offline PDF reports (EN & Urdu RTL) and CSV export',
      onPress: () => router.push('/(admin)/reports'),
    },
    {
      icon: 'settings-outline',
      title: `${t('settings.collectionSummary')} & ${t('settings.tiers')}`,
      subtitle: 'WhatsApp unpaid list, tier rates, organization settings',
      onPress: () => router.push('/(admin)/org-settings'),
    },
    {
      icon: 'shield-checkmark-outline',
      title: t('settings.auditLog'),
      subtitle: 'Tamper-evident record of edits, voids, and conflict losers',
      onPress: () => router.push('/(admin)/audit-log'),
    },
    {
      icon: 'cloud-outline',
      title: t('sync.drawerTitle'),
      subtitle: 'Pending offline queue, quarantine inspector, manual sync',
      onPress: () => setSyncDrawerOpen(true),
    },
  ];

  const handleSignOut = () => {
    Alert.alert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <Card variant="charity" style={styles.headerCard}>
        <Text style={[styles.roleBadge, { color: colors.primary }]}>
          Admin · #{profile?.member_no}
        </Text>
        <Text style={[styles.name, { color: colors.text }]}>{profile?.full_name}</Text>
      </Card>

      <Card padded={false}>
        {navItems.map((item, idx) => (
          <Pressable
            key={item.title}
            onPress={item.onPress}
            style={[
              styles.menuRow,
              idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.primarySoft, borderRadius: radius.md }]}>
              <Ionicons name={item.icon} size={20} color={colors.primary} />
            </View>
            <View style={styles.menuCopy}>
              <Text style={[styles.menuTitle, { color: colors.text }]}>{item.title}</Text>
              <Text style={[styles.menuSub, { color: colors.textSecondary }]}>{item.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </Card>

      <Card style={styles.prefCard}>
        <Text style={[styles.menuTitle, { color: colors.text }]}>{t('settings.language')}</Text>
        <View style={styles.segmentRow}>
          {(['en', 'ur'] as const).map((code) => {
            const active = lang === code;
            return (
              <Pressable
                key={code}
                onPress={() => void switchLanguage(code)}
                style={[
                  styles.segmentBtn,
                  { backgroundColor: active ? colors.primary : colors.surfaceSubtle, borderRadius: radius.md },
                ]}
              >
                <Text style={[styles.segmentText, { color: active ? '#FFFFFF' : colors.text }]}>
                  {code === 'en' ? 'English (LTR)' : 'اردو (RTL)'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.menuTitle, { color: colors.text, marginTop: 6 }]}>{t('settings.theme')}</Text>
        <View style={styles.segmentRow}>
          {(['system', 'light', 'dark'] as ThemePreference[]).map((pref) => {
            const active = themePref === pref;
            return (
              <Pressable
                key={pref}
                onPress={() => setThemePref(pref)}
                style={[
                  styles.segmentBtn,
                  { backgroundColor: active ? colors.primary : colors.surfaceSubtle, borderRadius: radius.md },
                ]}
              >
                <Text style={[styles.segmentText, { color: active ? '#FFFFFF' : colors.text }]}>
                  {t(`settings.theme${pref.charAt(0).toUpperCase()}${pref.slice(1)}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Button variant="danger" label={t('auth.signOut')} onPress={handleSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  headerCard: { gap: 2 },
  roleBadge: { fontSize: 12, fontWeight: '700' },
  name: { fontSize: 19, fontWeight: '800' },
  menuRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, minHeight: 62 },
  iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  menuCopy: { flex: 1, gap: 2 },
  menuTitle: { fontSize: 14, fontWeight: '700' },
  menuSub: { fontSize: 12 },
  prefCard: { gap: 8 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 13, fontWeight: '600' },
});
