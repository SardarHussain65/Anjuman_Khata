import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { useAuthStore } from '@/features/auth/store/authStore';
import { getCurrentLanguage, switchLanguage } from '@/core/i18n';

export default function UserProfileRoute() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const lang = getCurrentLanguage();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Card>
        <Text style={[styles.name, { color: colors.text }]}>{profile?.full_name}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          #{profile?.member_no} · {profile?.designation ?? t(`memberStatus.${profile?.status ?? 'active'}`)}
        </Text>
      </Card>
      <Button
        variant="secondary"
        label={lang === 'en' ? 'Switch to اردو (RTL)' : 'Switch to English (LTR)'}
        onPress={() => switchLanguage(lang === 'en' ? 'ur' : 'en')}
      />
      <Button variant="danger" label={t('auth.signOut')} onPress={signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 14 },
  name: { fontSize: 18, fontWeight: '700' },
  meta: { fontSize: 14, marginTop: 4 },
});
