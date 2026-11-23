import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { Button } from '@/core/ui/Button';
import { useAuthStore } from '@/features/auth/store/authStore';
import { getCurrentLanguage, switchLanguage } from '@/core/i18n';

export default function AdminMoreRoute() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const signOut = useAuthStore((s) => s.signOut);
  const lang = getCurrentLanguage();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
});
