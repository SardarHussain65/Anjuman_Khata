import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/core/theme/ThemeProvider';
import { switchLanguage } from '@/core/i18n';
import { Button } from '@/core/ui/Button';
import { Card } from '@/core/ui/Card';
import { TextField } from '@/core/ui/TextField';
import { useAuthStore } from '../store/authStore';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginScreen() {
  const { colors, radius } = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const isSigningIn = useAuthStore((s) => s.isSigningIn);
  const authError = useAuthStore((s) => s.error);
  const devDetail = useAuthStore((s) => s.devDetail);
  const clearError = useAuthStore((s) => s.clearError);
  const currentLang = i18n.language === 'ur' ? 'ur' : 'en';

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    clearError();
    await signIn(values.email, values.password);
  };

  const errorMessage =
    authError === 'offline'
      ? t('auth.offlineLoginError')
      : authError === 'profile_missing'
        ? t('auth.profileMissing')
        : authError === 'invalid'
          ? t('auth.invalidCredentials')
          : authError
            ? t('common.errorGeneric')
            : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Top Row: Back to Register + EN | اردو Language Toggle */}
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(user)'))}
              style={[
                styles.backPill,
                { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderRadius: radius.pill },
              ]}
            >
              <Ionicons name="arrow-back" size={16} color={colors.text} />
              <Text style={[styles.langText, { color: colors.text }]}>
                {t('common.close')}
              </Text>
            </Pressable>

            <View
              style={[
                styles.langToggle,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderStrong,
                  borderRadius: radius.pill,
                },
              ]}
            >
              {(['en', 'ur'] as const).map((code) => {
                const active = currentLang === code;
                return (
                  <Pressable
                    key={code}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => void switchLanguage(code)}
                    style={[
                      styles.langOption,
                      {
                        backgroundColor: active ? colors.primary : 'transparent',
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.langText,
                        { color: active ? '#FFFFFF' : colors.textSecondary },
                      ]}
                    >
                      {code === 'en' ? 'English' : 'اردو'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Brand Emblem */}
          <View style={styles.brandBlock}>
            <View
              style={[
                styles.emblem,
                { backgroundColor: colors.primary, borderRadius: radius.xl },
              ]}
            >
              <Ionicons name="book" size={34} color="#FFFFFF" />
            </View>
            <Text style={[styles.brandTitle, { color: colors.text }]}>
              {t('app.name')}
            </Text>
            <Text style={[styles.brandSubtitle, { color: colors.textSecondary }]}>
              {t('app.subtitle')}
            </Text>
          </View>

          {/* Sign-In Card */}
          <Card style={styles.card}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {t('auth.signInTitle')}
            </Text>
            <Text style={[styles.cardSub, { color: colors.textSecondary }]}>
              {t('auth.signInSubtitle')}
            </Text>

            {errorMessage ? (
              <View
                style={[
                  styles.errorBanner,
                  { backgroundColor: colors.dangerSoft, borderRadius: radius.md },
                ]}
              >
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={[styles.errorText, { color: colors.danger }]}>
                  {errorMessage}
                  {__DEV__ && devDetail ? `\n[DEV] ${devDetail}` : ''}
                </Text>
              </View>
            ) : null}

            <View style={styles.fields}>
              <Controller
                control={control}
                name="email"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextField
                    label={t('auth.email')}
                    placeholder={t('auth.emailPlaceholder')}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={value}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    error={errors.email ? t('auth.invalidCredentials') : undefined}
                  />
                )}
              />

              <Controller
                control={control}
                name="password"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextField
                    label={t('auth.password')}
                    placeholder={t('auth.passwordPlaceholder')}
                    secureTextEntry
                    autoCapitalize="none"
                    value={value}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    error={errors.password ? t('auth.invalidCredentials') : undefined}
                  />
                )}
              />
            </View>

            <Button
              testID="login-submit-button"
              label={isSigningIn ? t('auth.signingIn') : t('auth.signInButton')}
              loading={isSigningIn}
              onPress={handleSubmit(onSubmit)}
              style={styles.submitBtn}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    padding: 20,
    justifyContent: 'center',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    minHeight: 40,
  },
  langToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderWidth: 1,
    gap: 4,
  },
  langOption: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langText: {
    fontSize: 13,
    fontWeight: '700',
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: 28,
    gap: 8,
  },
  emblem: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  brandTitle: {
    fontSize: 26,
    fontWeight: '800',
  },
  brandSubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    gap: 14,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '700',
  },
  cardSub: {
    fontSize: 13,
    marginTop: -6,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  fields: {
    gap: 14,
    marginTop: 4,
  },
  submitBtn: {
    marginTop: 8,
  },
});
