import React from 'react';
import {
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
import { switchLanguage, useAppLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { useSyncStatusStore } from '@/data/sync/statusStore';

/**
 * Community Viewer Settings & Admin Login entry point.
 * Normal users never need an account; Admins sign in here to unlock editing.
 */
export function ViewerMoreScreen() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const lang = useAppLanguage();
  const themePref = useThemePreferenceStore((s) => s.preference);
  const setThemePref = useThemePreferenceStore((s) => s.setPreference);
  const setSyncDrawerOpen = useSyncStatusStore((s) => s.setDrawerOpen);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Admin Login Card */}
      <Card variant="charity" style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="shield-checkmark" size={22} color={colors.primary} />
          <View style={styles.flex1}>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('auth.adminLogin', { defaultValue: 'Admin Login' })}
            </Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {t('auth.adminLoginSubtitle', {
                defaultValue:
                  'Only committee admins need to sign in to record payments or manage members.',
              })}
            </Text>
          </View>
        </View>
        <Button
          label={t('auth.adminLogin', { defaultValue: 'Admin Login' })}
          onPress={() => router.push('/(auth)')}
        />
      </Card>

      {/* Language & Theme */}
      <Card style={styles.card}>
        <Text style={[styles.title, { color: colors.text }]}>{t('settings.language')}</Text>
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

        <Text style={[styles.title, { color: colors.text, marginTop: 6 }]}>{t('settings.theme')}</Text>
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

      <Button
        variant="secondary"
        label={t('sync.drawerTitle')}
        onPress={() => setSyncDrawerOpen(true)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  flex1: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 19 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 13, fontWeight: '600' },
});
