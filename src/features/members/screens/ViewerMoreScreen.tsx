import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemePreference, useTheme, useThemePreferenceStore } from '@/core/theme/ThemeProvider';
import { switchLanguage, useAppLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { useSyncStatusStore } from '@/data/sync/statusStore';

const APP_LOGO = require('../../../../assets/images/logo.png');

/**
 * Community Viewer Settings & Admin Login entry point.
 * Normal users never need an account; Admins sign in here to unlock editing.
 */
export function ViewerMoreScreen() {
  const { colors, radius, isDark } = useTheme();
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
      {/* Branded Community Viewer Banner */}
      <LinearGradient
        colors={isDark ? ['#144536', '#0A271E'] : ['#0F5D46', '#093B2C']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.heroCard, { borderRadius: radius.xl }]}
      >
        <View style={styles.heroLogoWrap}>
          <Image source={APP_LOGO} style={styles.heroLogo} resizeMode="cover" />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>{t('app.name')}</Text>
          <Text style={styles.heroSub}>{t('app.subtitle')}</Text>
        </View>
      </LinearGradient>

      {/* Admin Login Card */}
      <Card variant="charity" style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.shieldBox, { backgroundColor: colors.primarySoft, borderRadius: radius.md }]}>
            <Ionicons name="shield-checkmark" size={22} color={colors.primary} />
          </View>
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
          onPress={() => router.push('/(auth)/login')}
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

        <Text style={[styles.title, { color: colors.text, marginTop: 8 }]}>{t('settings.theme')}</Text>
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
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 14,
    elevation: 4,
    shadowColor: '#0C503C',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  heroLogoWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(229, 185, 92, 0.55)',
  },
  heroLogo: { width: '100%', height: '100%' },
  heroCopy: { flex: 1, gap: 3 },
  heroTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.78)', fontSize: 12, lineHeight: 17 },
  card: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  shieldBox: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 19 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 13, fontWeight: '700' },
});
