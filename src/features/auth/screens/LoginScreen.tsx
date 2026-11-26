import React, { useState } from 'react';
import { switchLanguage, useAppLanguage } from '@/core/i18n';
import { useTheme } from '@/core/theme/ThemeProvider';
import { Button } from '@/core/ui/Button';
import { Card } from '@/core/ui/Card';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';
import { useAuthStore } from '../store/authStore';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const APP_LOGO = require('../../../../assets/images/logo.png');

export function LoginScreen() {
  const { colors, radius, isDark } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const isSigningIn = useAuthStore((s) => s.isSigningIn);
  const authError = useAuthStore((s) => s.error);
  const devDetail = useAuthStore((s) => s.devDetail);
  const clearError = useAuthStore((s) => s.clearError);
  const currentLang = useAppLanguage();

  const [showPassword, setShowPassword] = useState(false);

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
    <View style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom + 28, 36) },
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* Heritage Emerald Hero Header */}
          <LinearGradient
            colors={isDark ? ['#144536', '#0A271E'] : ['#0F5D46', '#083729']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.heroHeader,
              { paddingTop: Math.max(insets.top + 14, 24) },
            ]}
          >
            {/* Top Controls: Back + Language */}
            <View style={styles.topRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/(user)'))}
                style={[styles.backPill, { borderRadius: radius.pill }]}
              >
                <Ionicons name="arrow-back" size={16} color="#FFFFFF" />
                <Text style={styles.backPillText}>
                  {currentLang === 'ur' ? 'واپس' : 'Back'}
                </Text>
              </Pressable>

              <View style={[styles.langToggle, { borderRadius: radius.pill }]}>
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
                          backgroundColor: active ? '#FFFFFF' : 'transparent',
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.langText,
                          { color: active ? '#0C503C' : 'rgba(255,255,255,0.85)' },
                        ]}
                      >
                        {code === 'en' ? 'English' : 'اردو'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Brand Emblem & Title */}
            <View style={styles.brandBlock}>
              <View style={styles.emblem}>
                <Image source={APP_LOGO} style={styles.logoImg} resizeMode="cover" />
              </View>
              <Text style={styles.brandTitle}>{t('app.name')}</Text>
              <View style={styles.portalPill}>
                <Ionicons name="shield-checkmark" size={13} color="#E5B95C" />
                <Text style={styles.portalPillText}>
                  {currentLang === 'ur'
                    ? 'ایڈمن اور سپر ایڈمن پورٹل'
                    : 'Admin & Super Admin Portal'}
                </Text>
              </View>
            </View>
          </LinearGradient>

          {/* Overlapping Floating Sign-In Card */}
          <View style={styles.cardWrap}>
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {t('auth.signInTitle')}
                </Text>
                <Text style={[styles.cardSub, { color: colors.textSecondary }]}>
                  {t('auth.signInSubtitle')}
                </Text>
              </View>

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
                {/* Email Field */}
                <Controller
                  control={control}
                  name="email"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                        {t('auth.email')}
                      </Text>
                      <View
                        style={[
                          styles.inputWrap,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: errors.email ? colors.danger : colors.border,
                            borderRadius: radius.lg,
                          },
                        ]}
                      >
                        <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
                        <TextInput
                          placeholder={t('auth.emailPlaceholder')}
                          placeholderTextColor={colors.textMuted}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          autoCorrect={false}
                          value={value}
                          onBlur={onBlur}
                          onChangeText={onChange}
                          style={[styles.input, { color: colors.text }]}
                        />
                      </View>
                      {errors.email ? (
                        <Text style={[styles.fieldError, { color: colors.danger }]}>
                          {t('auth.invalidCredentials')}
                        </Text>
                      ) : null}
                    </View>
                  )}
                />

                {/* Password Field with Eye Toggle */}
                <Controller
                  control={control}
                  name="password"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                        {t('auth.password')}
                      </Text>
                      <View
                        style={[
                          styles.inputWrap,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: errors.password ? colors.danger : colors.border,
                            borderRadius: radius.lg,
                          },
                        ]}
                      >
                        <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
                        <TextInput
                          placeholder={t('auth.passwordPlaceholder')}
                          placeholderTextColor={colors.textMuted}
                          secureTextEntry={!showPassword}
                          autoCapitalize="none"
                          value={value}
                          onBlur={onBlur}
                          onChangeText={onChange}
                          style={[styles.input, { color: colors.text }]}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                          onPress={() => setShowPassword((v) => !v)}
                          hitSlop={10}
                        >
                          <Ionicons
                            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                            size={19}
                            color={colors.textMuted}
                          />
                        </Pressable>
                      </View>
                      {errors.password ? (
                        <Text style={[styles.fieldError, { color: colors.danger }]}>
                          {t('auth.invalidCredentials')}
                        </Text>
                      ) : null}
                    </View>
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

            {/* Helpful Public Viewer Note */}
            <View style={styles.footerNote}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Text style={[styles.footerNoteText, { color: colors.textMuted }]}>
                {currentLang === 'ur'
                  ? 'عام اراکین کو لاگ ان کی ضرورت نہیں — رجسٹر دیکھنے کے لیے واپس جائیں۔'
                  : 'Community members do not need to sign in — tap Back to view the public register.'}
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  heroHeader: {
    paddingHorizontal: 18,
    paddingBottom: 52,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
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
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.14)',
    minHeight: 38,
  },
  backPillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  langToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    backgroundColor: 'rgba(255,255,255,0.14)',
    gap: 3,
  },
  langOption: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  brandBlock: {
    alignItems: 'center',
    gap: 8,
  },
  emblem: {
    width: 84,
    height: 84,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(229, 185, 92, 0.6)',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  logoImg: {
    width: '100%',
    height: '100%',
  },
  brandTitle: {
    fontSize: 25,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  portalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(229, 185, 92, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(229, 185, 92, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  portalPillText: {
    color: '#F6E2B3',
    fontSize: 12,
    fontWeight: '700',
  },
  cardWrap: {
    paddingHorizontal: 18,
    marginTop: -28,
    gap: 16,
  },
  card: {
    padding: 20,
    gap: 16,
    elevation: 5,
    shadowColor: '#0C503C',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  cardHeader: { gap: 4 },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  cardSub: {
    fontSize: 13,
    lineHeight: 18,
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
    fontWeight: '600',
  },
  fields: {
    gap: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 13,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  fieldError: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  submitBtn: {
    marginTop: 4,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
  },
  footerNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
});
