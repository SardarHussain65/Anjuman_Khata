import React, { useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Href, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemePreference, useTheme, useThemePreferenceStore } from '@/core/theme/ThemeProvider';
import { switchLanguage, useAppLanguage } from '@/core/i18n';
import { isSuperAdminRole } from '@/core/permissions';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { updateOwnPassword } from '@/data/api/adminEdge';
import { checkForOtaUpdateManually, getOtaMeta } from '@/core/updates/appUpdates';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useSyncStatusStore } from '@/data/sync/statusStore';

const APP_LOGO = require('../../../../assets/images/logo.png');

export default function AdminMoreRoute() {
  const { colors, radius, isDark } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const lang = useAppLanguage();
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const themePref = useThemePreferenceStore((s) => s.preference);
  const setThemePref = useThemePreferenceStore((s) => s.setPreference);
  const setSyncDrawerOpen = useSyncStatusStore((s) => s.setDrawerOpen);
  const isOnline = useSyncStatusStore((s) => s.isOnline);

  const isSuperAdmin = isSuperAdminRole(profile?.role);
  const otaMeta = getOtaMeta();
  const [checkingOta, setCheckingOta] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const handleChangeOwnPassword = async () => {
    if (newPassword.length < 6) {
      showAppAlert(
        t('common.required'),
        lang === 'ur'
          ? 'پاس ورڈ کم از کم 6 حروف کا ہونا چاہیے۔'
          : 'Password must be at least 6 characters.',
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      showAppAlert(
        t('common.required'),
        lang === 'ur'
          ? 'دونوں پاس ورڈ ایک جیسے نہیں ہیں۔'
          : 'Passwords do not match.',
      );
      return;
    }
    if (!isOnline) {
      showAppAlert(
        t('common.offline'),
        lang === 'ur'
          ? 'پاس ورڈ تبدیل کرنے کے لیے انٹرنیٹ ضروری ہے۔'
          : 'Changing your password requires an internet connection.',
      );
      return;
    }
    setResetBusy(true);
    try {
      await updateOwnPassword(newPassword);
      showAppAlert(
        t('common.confirm'),
        lang === 'ur' ? 'پاس ورڈ کامیابی سے تبدیل ہو گیا۔' : 'Your password has been updated.',
      );
      setResetOpen(false);
      setNewPassword('');
      setConfirmPassword('');
      setShowPw(false);
    } catch (err) {
      showAppAlert(t('common.errorGeneric'), err instanceof Error ? err.message : undefined);
    } finally {
      setResetBusy(false);
    }
  };

  const navItems: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle: string;
    highlight?: boolean;
    onPress: () => void;
  }[] = [
    ...(isSuperAdmin
      ? [
          {
            icon: 'people-circle-outline' as const,
            title: lang === 'ur' ? 'ایڈمنز کا انتظام (سپر ایڈمن)' : 'Manage Admins',
            subtitle:
              lang === 'ur'
                ? 'نئے ایڈمن شامل کریں، پاس ورڈ ری سیٹ کریں یا رسائی معطل کریں'
                : 'Add new admins, reset passwords, or revoke admin access',
            highlight: true,
            onPress: () => router.push('/(admin)/manage-admins' as Href),
          },
        ]
      : []),
    {
      icon: 'archive-outline',
      title: t('history.title'),
      subtitle:
        lang === 'ur'
          ? 'پچھلے سالوں کا ریکارڈ اور مالی سال بند/دوبارہ کھولیں'
          : 'Multi-year archive, YoY totals, close/reopen fiscal years',
      onPress: () => router.push('/(admin)/history-viewer'),
    },
    {
      icon: 'document-text-outline',
      title: t('reports.title'),
      subtitle:
        lang === 'ur'
          ? 'آف لائن PDF رپورٹس (انگریزی اور اردو) اور CSV برآمد'
          : 'Offline PDF reports (EN & Urdu RTL) and CSV export',
      onPress: () => router.push('/(admin)/reports'),
    },
    {
      icon: 'settings-outline',
      title: `${t('settings.collectionSummary')} & ${t('settings.tiers')}`,
      subtitle:
        lang === 'ur'
          ? 'واٹس ایپ بقایا فہرست، چندہ درجات، اور تنظیم کی ترتیبات'
          : 'WhatsApp unpaid list, tier rates, organization settings',
      onPress: () => router.push('/(admin)/org-settings'),
    },
    {
      icon: 'shield-checkmark-outline',
      title: t('settings.auditLog'),
      subtitle:
        lang === 'ur'
          ? 'تمام ترامیم اور منسوخ اندراجات کا محفوظ ریکارڈ'
          : 'Tamper-evident record of edits, voids, and conflict losers',
      onPress: () => router.push('/(admin)/audit-log'),
    },
    {
      icon: 'cloud-outline',
      title: t('sync.drawerTitle'),
      subtitle:
        lang === 'ur'
          ? 'آف لائن محفوظ اندراجات، تازہ اپ ڈیٹ اور کیش صفائی'
          : 'Pending offline queue, quarantine inspector, manual sync',
      onPress: () => setSyncDrawerOpen(true),
    },
    {
      icon: 'download-outline',
      title: lang === 'ur' ? 'ایپ اپ ڈیٹ چیک کریں (OTA)' : 'Check for App Updates',
      subtitle: checkingOta
        ? lang === 'ur'
          ? 'اپ ڈیٹ چیک ہو رہی ہے...'
          : 'Checking for updates...'
        : `v${otaMeta.appVersion}${otaMeta.channel ? ` · ${otaMeta.channel}` : ''}${otaMeta.shortUpdateId ? ` · ${otaMeta.shortUpdateId}` : ''}`,
      onPress: async () => {
        if (checkingOta) return;
        setCheckingOta(true);
        try {
          await checkForOtaUpdateManually(lang);
        } finally {
          setCheckingOta(false);
        }
      },
    },
    {
      icon: 'key-outline',
      title: lang === 'ur' ? 'پاس ورڈ تبدیل کریں' : 'Change Password',
      subtitle:
        lang === 'ur'
          ? 'اپنے لاگ ان کا پاس ورڈ تبدیل کریں'
          : 'Update your login password anytime',
      onPress: () => {
        setNewPassword('');
        setConfirmPassword('');
        setShowPw(false);
        setResetOpen(true);
      },
    },
  ];

  const handleSignOut = () => {
    showAppAlert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Branded Heritage Emerald Admin / Super Admin Card */}
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
          <View
            style={[
              styles.rolePill,
              isSuperAdmin && {
                backgroundColor: 'rgba(229, 185, 92, 0.22)',
                borderWidth: 1,
                borderColor: 'rgba(229, 185, 92, 0.55)',
              },
            ]}
          >
            <Ionicons name={isSuperAdmin ? 'ribbon' : 'shield-checkmark'} size={12} color="#E5B95C" />
            <Text style={styles.roleText}>
              {isSuperAdmin
                ? lang === 'ur'
                  ? 'سپر ایڈمن'
                  : 'Super Admin'
                : lang === 'ur'
                  ? 'ایڈمن'
                  : 'Admin'}
            </Text>
          </View>
          <Text style={styles.heroName} numberOfLines={1}>
            {profile?.full_name}
          </Text>
          <Text style={styles.heroOrg}>{t('app.name')}</Text>
        </View>
      </LinearGradient>

      <Card padded={false}>
        {navItems.map((item, idx) => (
          <Pressable
            key={item.title}
            onPress={item.onPress}
            style={({ pressed }) => [
              styles.menuRow,
              idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
              pressed && { backgroundColor: colors.surfaceSubtle },
            ]}
          >
            <View
              style={[
                styles.iconWrap,
                {
                  backgroundColor: item.highlight
                    ? 'rgba(229, 185, 92, 0.22)'
                    : colors.primarySoft,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={item.highlight ? '#B68623' : colors.primary}
              />
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

        <Text style={[styles.menuTitle, { color: colors.text, marginTop: 8 }]}>{t('settings.theme')}</Text>
        <View style={styles.segmentRow}>
          {(['system', 'light', 'dark'] as ThemePreference[]).map((pref) => {
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

      <Button variant="danger" label={t('auth.signOut')} onPress={handleSignOut} />

      {/* Change Own Password Modal */}
      <Modal
        visible={resetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setResetOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.resetCard}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {lang === 'ur' ? 'پاس ورڈ تبدیل کریں' : 'Change Password'}
            </Text>

            <View style={styles.pwFieldGroup}>
              <Text style={[styles.pwLabel, { color: colors.textSecondary }]}>
                {lang === 'ur' ? 'نیا پاس ورڈ' : 'New Password'}
              </Text>
              <View
                style={[
                  styles.pwInputWrap,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                ]}
              >
                <TextInput
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Min 6 characters"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.pwInput, { color: colors.text }]}
                />
                <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8}>
                  <Ionicons
                    name={showPw ? 'eye-off-outline' : 'eye-outline'}
                    size={19}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.pwFieldGroup}>
              <Text style={[styles.pwLabel, { color: colors.textSecondary }]}>
                {lang === 'ur' ? 'نئے پاس ورڈ کی تصدیق' : 'Confirm Password'}
              </Text>
              <View
                style={[
                  styles.pwInputWrap,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                ]}
              >
                <TextInput
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter new password"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.pwInput, { color: colors.text }]}
                />
              </View>
            </View>

            <View style={styles.segmentRow}>
              <Button
                label={t('common.cancel')}
                variant="secondary"
                onPress={() => setResetOpen(false)}
                style={styles.flexBtn}
              />
              <Button
                label={t('common.save')}
                loading={resetBusy}
                onPress={handleChangeOwnPassword}
                style={styles.flexBtn}
              />
            </View>
          </Card>
        </View>
      </Modal>
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
    width: 58,
    height: 58,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(229, 185, 92, 0.55)',
  },
  heroLogo: { width: '100%', height: '100%' },
  heroCopy: { flex: 1, gap: 3 },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  roleText: { color: '#F6E2B3', fontSize: 11, fontWeight: '700' },
  heroName: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginTop: 2 },
  heroOrg: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
  menuRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, minHeight: 64 },
  iconWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  menuCopy: { flex: 1, gap: 2 },
  menuTitle: { fontSize: 14, fontWeight: '700' },
  menuSub: { fontSize: 12, lineHeight: 16 },
  prefCard: { gap: 8 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 13, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  resetCard: { gap: 12, padding: 18 },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  pwFieldGroup: { gap: 5 },
  pwLabel: { fontSize: 12.5, fontWeight: '700' },
  pwInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    gap: 8,
  },
  pwInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  flexBtn: { flex: 1 },
});
