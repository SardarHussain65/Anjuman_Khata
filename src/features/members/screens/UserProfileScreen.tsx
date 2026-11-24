import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemePreference, useTheme, useThemePreferenceStore } from '@/core/theme/ThemeProvider';
import { switchLanguage, useAppLanguage } from '@/core/i18n';
import { formatDateShort } from '@/core/dates';
import { formatPKR } from '@/core/money';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { useRegisterSnapshot } from '@/data/db/queries';
import { useAuthStore } from '@/features/auth/store/authStore';
import { getMemberTierHistory } from '@/core/rules/tiers';
import { useSyncStatusStore } from '@/data/sync/statusStore';

export function UserProfileScreen() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const lang = useAppLanguage();
  const authProfile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const isOfflineSession = useAuthStore((s) => s.isOfflineSession);
  const themePref = useThemePreferenceStore((s) => s.preference);
  const setThemePref = useThemePreferenceStore((s) => s.setPreference);
  const setSyncDrawerOpen = useSyncStatusStore((s) => s.setDrawerOpen);
  const { data } = useRegisterSnapshot();

  const memberId = authProfile?.id ?? '';

  const tierHistory = useMemo(() => {
    if (!data || !memberId) return [];
    return getMemberTierHistory(memberId, data.memberTiers, data.tiers);
  }, [data, memberId]);

  const handleSignOut = () => {
    showAppAlert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const themes: ThemePreference[] = ['system', 'light', 'dark'];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <Card style={styles.card}>
        <Text style={[styles.memberNo, { color: colors.primary }]}>
          {authProfile?.member_no != null ? `#${authProfile.member_no} · ` : ''}
          {t(`memberStatus.${authProfile?.status ?? 'active'}`)}
        </Text>
        <Text style={[styles.name, { color: colors.text }]}>
          {lang === 'ur' && authProfile?.full_name_ur
            ? authProfile.full_name_ur
            : authProfile?.full_name}
        </Text>
        {authProfile?.designation ? (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {authProfile.designation}
          </Text>
        ) : null}
        {authProfile?.phone ? (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {authProfile.phone}
          </Text>
        ) : null}
        {authProfile?.personal_pledge ? (
          <Text style={[styles.meta, { color: colors.primary }]}>
            {t('members.personalPledge')}: {formatPKR(authProfile.personal_pledge)}
          </Text>
        ) : null}
        {isOfflineSession ? (
          <Text style={[styles.offlineNote, { color: colors.warning }]}>
            {t('auth.offlineSessionNotice')}
          </Text>
        ) : null}
      </Card>

      {/* Tier Assignment History */}
      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {t('members.tierHistory')}
        </Text>
        {tierHistory.length === 0 ? (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {t('dashboard.noTierExempt')}
          </Text>
        ) : (
          tierHistory.map((item) => (
            <View key={item.id} style={[styles.tierRow, { borderColor: colors.border }]}>
              <Text style={[styles.tierName, { color: colors.text }]}>
                {lang === 'ur' && item.tierNameUr ? item.tierNameUr : item.tierName}
              </Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {t('members.effectiveFrom')}: {formatDateShort(item.effective_from, lang)}
              </Text>
              {item.reason ? (
                <Text style={[styles.meta, { color: colors.textMuted }]}>{item.reason}</Text>
              ) : null}
            </View>
          ))
        )}
      </Card>

      {/* Preferences: Language & Theme */}
      <Card style={styles.card}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {t('settings.language')}
        </Text>
        <View style={styles.segmentRow}>
          {(['en', 'ur'] as const).map((code) => {
            const active = lang === code;
            return (
              <Pressable
                key={code}
                onPress={() => void switchLanguage(code)}
                style={[
                  styles.segmentBtn,
                  {
                    backgroundColor: active ? colors.primary : colors.surfaceSubtle,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={[styles.segmentText, { color: active ? '#FFFFFF' : colors.text }]}>
                  {code === 'en' ? 'English (LTR)' : 'اردو (RTL)'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 8 }]}>
          {t('settings.theme')}
        </Text>
        <View style={styles.segmentRow}>
          {themes.map((pref) => {
            const active = themePref === pref;
            return (
              <Pressable
                key={pref}
                onPress={() => setThemePref(pref)}
                style={[
                  styles.segmentBtn,
                  {
                    backgroundColor: active ? colors.primary : colors.surfaceSubtle,
                    borderRadius: radius.md,
                  },
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
      <Button variant="danger" label={t('auth.signOut')} onPress={handleSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { gap: 6 },
  memberNo: { fontSize: 13, fontWeight: '700' },
  name: { fontSize: 20, fontWeight: '800' },
  meta: { fontSize: 13 },
  offlineNote: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  tierRow: { borderTopWidth: 1, paddingTop: 8, marginTop: 4, gap: 2 },
  tierName: { fontSize: 14, fontWeight: '700' },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 13, fontWeight: '600' },
});
