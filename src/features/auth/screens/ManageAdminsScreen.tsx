import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { useAppLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import {
  invokeAdminResetPassword,
  invokeCreateAdminAccount,
  invokeListAdmins,
  invokeSetAdminStatus,
  ManagedAdminAccount,
} from '@/data/api/adminEdge';
import { useSyncStatusStore } from '@/data/sync/statusStore';

export function ManageAdminsScreen() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const lang = useAppLanguage();
  const insets = useSafeAreaInsets();
  const isOnline = useSyncStatusStore((s) => s.isOnline);

  const [admins, setAdmins] = useState<ManagedAdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add Admin modal
  const [addOpen, setAddOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [showAddPw, setShowAddPw] = useState(false);
  const [addBusy, setAddBusy] = useState(false);

  // Reset Password modal
  const [resetTarget, setResetTarget] = useState<ManagedAdminAccount | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const loadAdmins = useCallback(async () => {
    try {
      const list = await invokeListAdmins();
      setAdmins(list);
    } catch (err) {
      showAppAlert(
        t('common.errorGeneric'),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    invokeListAdmins()
      .then((list) => {
        if (active) setAdmins(list);
      })
      .catch((err) => {
        if (active) {
          showAppAlert(
            t('common.errorGeneric'),
            err instanceof Error ? err.message : undefined,
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      active = false;
    };
  }, [t]);

  const handleRefresh = () => {
    setRefreshing(true);
    void loadAdmins();
  };

  const handleCreateAdmin = async () => {
    if (!isOnline) {
      showAppAlert(
        t('common.offline'),
        lang === 'ur'
          ? 'نیا ایڈمن بنانے کے لیے انٹرنیٹ ضروری ہے۔'
          : 'Creating an admin requires an internet connection.',
      );
      return;
    }
    if (!fullName.trim() || !email.trim() || password.length < 6) {
      showAppAlert(
        t('common.required'),
        lang === 'ur'
          ? 'نام، ای میل، اور کم از کم 6 حروف کا پاس ورڈ درج کریں۔'
          : 'Please enter name, email, and a password of at least 6 characters.',
      );
      return;
    }

    setAddBusy(true);
    try {
      await invokeCreateAdminAccount({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        phone: phone.trim() || null,
      });
      setAddOpen(false);
      setFullName('');
      setEmail('');
      setPassword('');
      setPhone('');
      setShowAddPw(false);
      showAppAlert(
        t('common.confirm'),
        lang === 'ur'
          ? 'نیا ایڈمن اکاؤنٹ کامیابی سے بن گیا ہے۔'
          : 'New admin account created successfully.',
      );
      void loadAdmins();
    } catch (err) {
      showAppAlert(
        t('common.errorGeneric'),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setAddBusy(false);
    }
  };

  const handleResetAdminPassword = async () => {
    if (!resetTarget) return;
    if (!isOnline) {
      showAppAlert(
        t('common.offline'),
        lang === 'ur'
          ? 'پاس ورڈ تبدیل کرنے کے لیے انٹرنیٹ ضروری ہے۔'
          : 'Resetting a password requires an internet connection.',
      );
      return;
    }
    if (resetPassword.length < 6) {
      showAppAlert(
        t('common.required'),
        lang === 'ur'
          ? 'پاس ورڈ کم از کم 6 حروف کا ہونا چاہیے۔'
          : 'Password must be at least 6 characters.',
      );
      return;
    }
    setResetBusy(true);
    try {
      await invokeAdminResetPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword('');
      setShowResetPw(false);
      showAppAlert(
        t('common.confirm'),
        lang === 'ur' ? 'پاس ورڈ اپ ڈیٹ ہو گیا۔' : 'Admin password updated.',
      );
    } catch (err) {
      showAppAlert(
        t('common.errorGeneric'),
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setResetBusy(false);
    }
  };

  const handleToggleStatus = (account: ManagedAdminAccount) => {
    const willEnable = account.status !== 'active';
    showAppAlert(
      willEnable
        ? lang === 'ur'
          ? 'ایڈمن بحال کریں؟'
          : 'Re-enable Admin?'
        : lang === 'ur'
          ? 'ایڈمن رسائی معطل کریں؟'
          : 'Revoke Admin Access?',
      willEnable
        ? lang === 'ur'
          ? `${account.full_name} دوبارہ لاگ ان کر سکیں گے۔`
          : `${account.full_name} will be able to sign in and manage records again.`
        : lang === 'ur'
          ? `${account.full_name} اب لاگ ان یا تبدیلی نہیں کر سکیں گے۔`
          : `${account.full_name} will immediately lose admin sign-in and write access.`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: willEnable
            ? lang === 'ur'
              ? 'بحال کریں'
              : 'Re-enable'
            : lang === 'ur'
              ? 'معطل کریں'
              : 'Revoke',
          style: willEnable ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await invokeSetAdminStatus(account.id, willEnable);
              void loadAdmins();
            } catch (err) {
              showAppAlert(
                t('common.errorGeneric'),
                err instanceof Error ? err.message : undefined,
              );
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 88, 96) },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {/* Header Info Banner */}
        <Card variant="charity" style={styles.bannerCard}>
          <View style={styles.bannerRow}>
            <View style={[styles.bannerIcon, { backgroundColor: colors.primary }]}>
              <Ionicons name="shield-checkmark" size={20} color="#F6E2B3" />
            </View>
            <View style={styles.flex1}>
              <Text style={[styles.bannerTitle, { color: colors.text }]}>
                {lang === 'ur' ? 'سپر ایڈمن کنٹرول' : 'Super Admin Control'}
              </Text>
              <Text style={[styles.bannerSub, { color: colors.textSecondary }]}>
                {lang === 'ur'
                  ? 'یہاں سے آپ نئے ایڈمن شامل، پاس ورڈ ری سیٹ، یا رسائی معطل کر سکتے ہیں۔'
                  : 'Create new admins, reset passwords, or revoke access anytime. All actions are audited.'}
              </Text>
            </View>
          </View>
        </Card>

        {admins.length === 0 ? (
          <EmptyState icon="people-outline" />
        ) : (
          admins.map((account) => {
            const isSuper = account.role === 'super_admin';
            const isActive = account.status === 'active';
            return (
              <Card key={account.id} style={styles.adminCard}>
                <View style={styles.cardTopRow}>
                  <View
                    style={[
                      styles.avatar,
                      {
                        backgroundColor: isSuper
                          ? 'rgba(229, 185, 92, 0.22)'
                          : isActive
                            ? colors.primarySoft
                            : colors.unpaidBg,
                        borderColor: isSuper
                          ? '#E5B95C'
                          : isActive
                            ? colors.primaryBorder
                            : colors.danger,
                      },
                    ]}
                  >
                    <Ionicons
                      name={isSuper ? 'ribbon' : 'person-outline'}
                      size={20}
                      color={isSuper ? '#B68623' : isActive ? colors.primary : colors.danger}
                    />
                  </View>

                  <View style={styles.flex1}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.adminName, { color: colors.text }]} numberOfLines={1}>
                        {account.full_name}
                      </Text>
                      <View
                        style={[
                          styles.roleBadge,
                          {
                            backgroundColor: isSuper
                              ? 'rgba(229, 185, 92, 0.22)'
                              : colors.primarySoft,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleBadgeText,
                            { color: isSuper ? '#9A6D14' : colors.primary },
                          ]}
                        >
                          {isSuper
                            ? lang === 'ur'
                              ? 'سپر ایڈمن'
                              : 'Super Admin'
                            : lang === 'ur'
                              ? 'ایڈمن'
                              : 'Admin'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.emailText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {account.email || '—'}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.statusPill,
                      { backgroundColor: isActive ? colors.metBg : colors.unpaidBg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        { color: isActive ? colors.metText : colors.unpaidText },
                      ]}
                    >
                      {isActive
                        ? lang === 'ur'
                          ? 'فعال'
                          : 'Active'
                        : lang === 'ur'
                          ? 'معطل'
                          : 'Revoked'}
                    </Text>
                  </View>
                </View>

                {!isSuper ? (
                  <View style={[styles.actionsRow, { borderTopColor: colors.border }]}>
                    <Pressable
                      onPress={() => {
                        setResetTarget(account);
                        setResetPassword('');
                        setShowResetPw(false);
                      }}
                      style={[
                        styles.actionBtn,
                        { backgroundColor: colors.surfaceSubtle, borderRadius: radius.md },
                      ]}
                    >
                      <Ionicons name="key-outline" size={15} color={colors.text} />
                      <Text style={[styles.actionBtnText, { color: colors.text }]}>
                        {lang === 'ur' ? 'پاس ورڈ بدلیں' : 'Reset Password'}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => handleToggleStatus(account)}
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor: isActive ? colors.unpaidBg : colors.metBg,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <Ionicons
                        name={isActive ? 'ban-outline' : 'checkmark-circle-outline'}
                        size={15}
                        color={isActive ? colors.unpaidText : colors.metText}
                      />
                      <Text
                        style={[
                          styles.actionBtnText,
                          { color: isActive ? colors.unpaidText : colors.metText },
                        ]}
                      >
                        {isActive
                          ? lang === 'ur'
                            ? 'رسائی معطل'
                            : 'Revoke'
                          : lang === 'ur'
                            ? 'بحال کریں'
                            : 'Re-enable'}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Add Admin FAB */}
      <Pressable
        accessibilityRole="button"
        onPress={() => setAddOpen(true)}
        style={[
          styles.fab,
          { backgroundColor: colors.primary, borderRadius: radius.pill },
        ]}
      >
        <Ionicons name="person-add" size={20} color="#FFFFFF" />
        <Text style={styles.fabText}>
          {lang === 'ur' ? 'نیا ایڈمن شامل کریں' : 'Add Admin'}
        </Text>
      </Pressable>

      {/* Add Admin Modal */}
      <Modal
        visible={addOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {lang === 'ur' ? 'نیا ایڈمن اکاؤنٹ' : 'Create Admin Account'}
              </Text>
              <Pressable onPress={() => setAddOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {lang === 'ur' ? 'پورا نام' : 'Full Name'}
              </Text>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="e.g. Muhammad Aslam"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.textInput,
                  { color: colors.text, backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                ]}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('auth.email')}
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="admin@anjuman.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.textInput,
                  { color: colors.text, backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                ]}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('auth.password')}
              </Text>
              <View
                style={[
                  styles.pwRow,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                ]}
              >
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Min 6 characters"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showAddPw}
                  autoCapitalize="none"
                  style={[styles.pwInput, { color: colors.text }]}
                />
                <Pressable onPress={() => setShowAddPw((v) => !v)} hitSlop={8}>
                  <Ionicons
                    name={showAddPw ? 'eye-off-outline' : 'eye-outline'}
                    size={19}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {lang === 'ur' ? 'فون نمبر (اختیاری)' : 'Phone (Optional)'}
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="0300-1234567"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                style={[
                  styles.textInput,
                  { color: colors.text, backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                ]}
              />
            </View>

            <View style={styles.modalBtnRow}>
              <Button
                label={t('common.cancel')}
                variant="secondary"
                onPress={() => setAddOpen(false)}
                style={styles.flex1}
              />
              <Button
                label={t('common.save')}
                loading={addBusy}
                onPress={handleCreateAdmin}
                style={styles.flex1}
              />
            </View>
          </Card>
        </View>
      </Modal>

      {/* Reset Admin Password Modal */}
      <Modal
        visible={Boolean(resetTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setResetTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {lang === 'ur' ? 'ایڈمن پاس ورڈ ری سیٹ' : 'Reset Admin Password'}
            </Text>
            <Text style={[styles.emailText, { color: colors.textSecondary }]}>
              {resetTarget?.full_name} ({resetTarget?.email})
            </Text>

            <View
              style={[
                styles.pwRow,
                { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
              ]}
            >
              <TextInput
                value={resetPassword}
                onChangeText={setResetPassword}
                placeholder="New password (min 6 chars)"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showResetPw}
                autoCapitalize="none"
                style={[styles.pwInput, { color: colors.text }]}
              />
              <Pressable onPress={() => setShowResetPw((v) => !v)} hitSlop={8}>
                <Ionicons
                  name={showResetPw ? 'eye-off-outline' : 'eye-outline'}
                  size={19}
                  color={colors.textMuted}
                />
              </Pressable>
            </View>

            <View style={styles.modalBtnRow}>
              <Button
                label={t('common.cancel')}
                variant="secondary"
                onPress={() => setResetTarget(null)}
                style={styles.flex1}
              />
              <Button
                label={t('common.save')}
                loading={resetBusy}
                onPress={handleResetAdminPassword}
                style={styles.flex1}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex1: { flex: 1 },
  content: { padding: 16, gap: 12 },
  bannerCard: { padding: 14 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: { fontSize: 15, fontWeight: '800' },
  bannerSub: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  adminCard: { padding: 14, gap: 12 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  adminName: { fontSize: 15, fontWeight: '800' },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  roleBadgeText: { fontSize: 10.5, fontWeight: '800' },
  emailText: { fontSize: 12.5, marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  actionBtnText: { fontSize: 12.5, fontWeight: '700' },
  fab: {
    position: 'absolute',
    end: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    minHeight: 52,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { gap: 12, padding: 18 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  inputGroup: { gap: 5 },
  inputLabel: { fontSize: 12.5, fontWeight: '700' },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 14,
  },
  pwRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    gap: 8,
  },
  pwInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
