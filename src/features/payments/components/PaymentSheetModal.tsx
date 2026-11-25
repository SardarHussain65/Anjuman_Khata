import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR, parsePKR } from '@/core/money';
import {
  formatMonthShort,
  formatMonthYear,
  getKarachiCurrentMonthStart,
  getKarachiToday,
} from '@/core/dates';
import { useAppLanguage } from '@/core/i18n';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { Card } from '@/core/ui/Card';
import { TextField } from '@/core/ui/TextField';
import {
  ContributionKind,
  ContributionRow,
  FiscalYearRow,
  MemberTierRow,
  ProfileRow,
  TierRateRow,
  TierRow,
} from '@/data/db/types';
import { localInsert, localSoftDelete, localUpdate } from '@/data/sync/syncEngine';
import { resolveEffectiveTierForMonth } from '@/core/rules/tiers';
import {
  findClosedFiscalYearForDate,
  getMonthsForFiscalYear,
} from '@/core/rules/fiscalYear';
import { useAuthStore } from '@/features/auth/store/authStore';

interface PaymentSheetModalProps {
  visible: boolean;
  onClose: () => void;
  fiscalYear: FiscalYearRow | null;
  profiles: ProfileRow[];
  tiers: TierRow[];
  tierRates: TierRateRow[];
  memberTiers: MemberTierRow[];
  fiscalYears: FiscalYearRow[];
  initialMemberId?: string;
  initialPeriodStart?: string;
  editingContribution?: ContributionRow | null;
}

export function PaymentSheetModal(props: PaymentSheetModalProps) {
  if (!props.visible) return null;
  const key = props.editingContribution?.id
    ?? `new-${props.initialMemberId ?? 'any'}-${props.initialPeriodStart ?? 'cur'}`;
  return <PaymentSheetModalInner key={key} {...props} />;
}

type PaymentMethod = 'Cash' | 'Bank' | 'Easypaisa';

function parsePaymentMethod(remark: string | null | undefined): PaymentMethod {
  const lower = (remark ?? '').toLowerCase();
  if (lower.includes('easypaisa')) return 'Easypaisa';
  if (lower.includes('bank')) return 'Bank';
  return 'Cash';
}

function PaymentSheetModalInner({
  visible,
  onClose,
  fiscalYear,
  profiles,
  tiers,
  tierRates,
  memberTiers,
  fiscalYears,
  initialMemberId,
  initialPeriodStart,
  editingContribution,
}: PaymentSheetModalProps) {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const lang = useAppLanguage();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const isEditMode = Boolean(editingContribution);
  const initMemberId = editingContribution?.member_id ?? initialMemberId ?? profiles[0]?.id ?? '';
  const initPeriod = editingContribution?.period_start ?? initialPeriodStart ?? getKarachiCurrentMonthStart();
  const initEff = !editingContribution && initMemberId
    ? resolveEffectiveTierForMonth(initMemberId, initPeriod, memberTiers, tiers, tierRates)
    : null;

  const [memberId, setMemberId] = useState<string>(initMemberId);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([initPeriod]);
  const [amountInput, setAmountInput] = useState<string>(
    editingContribution ? String(editingContribution.amount) : initEff ? String(initEff.minAmount) : '',
  );
  const [paidOn, setPaidOn] = useState<string>(editingContribution?.paid_on ?? getKarachiToday());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    editingContribution ? parsePaymentMethod(editingContribution.remark) : 'Cash',
  );
  const [showVoidBox, setShowVoidBox] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fyMonths = useMemo(
    () => (fiscalYear ? getMonthsForFiscalYear(fiscalYear) : [getKarachiCurrentMonthStart()]),
    [fiscalYear],
  );

  const selectedMember = useMemo(
    () => profiles.find((p) => p.id === memberId) ?? null,
    [profiles, memberId],
  );

  const primaryMonth = selectedMonths[0] ?? getKarachiCurrentMonthStart();
  const effectiveTier = useMemo(() => {
    if (!memberId) return null;
    return resolveEffectiveTierForMonth(memberId, primaryMonth, memberTiers, tiers, tierRates);
  }, [memberId, primaryMonth, memberTiers, tiers, tierRates]);

  const parsedAmount = parsePKR(amountInput);
  const isBelowMin =
    selectedMember?.status === 'active' &&
    effectiveTier != null &&
    parsedAmount != null &&
    parsedAmount > 0 &&
    parsedAmount < effectiveTier.minAmount;

  const extraAmount =
    selectedMember?.status === 'active' &&
    effectiveTier != null &&
    parsedAmount != null &&
    parsedAmount > effectiveTier.minAmount
      ? parsedAmount - effectiveTier.minAmount
      : 0;

  const closedWarningYear = useMemo(() => {
    for (const m of selectedMonths) {
      const closed = findClosedFiscalYearForDate(m, fiscalYears);
      if (closed) return closed;
    }
    return null;
  }, [selectedMonths, fiscalYears]);

  const toggleMonth = (month: string) => {
    if (isEditMode) {
      setSelectedMonths([month]);
      setMonthPickerOpen(false);
      return;
    }
    setSelectedMonths((prev) =>
      prev.includes(month)
        ? prev.length > 1
          ? prev.filter((x) => x !== month)
          : prev
        : [...prev, month].sort(),
    );
  };

  const selectedMonthsLabel = useMemo(() => {
    if (selectedMonths.length === 0) return t('common.month');
    if (selectedMonths.length === 1) {
      return formatMonthYear(selectedMonths[0], lang);
    }
    const shortList = selectedMonths.map((m) => formatMonthShort(m, lang)).join(', ');
    return `${shortList} (${selectedMonths.length})`;
  }, [selectedMonths, lang, t]);

  const handleSave = async () => {
    if (saving) return;
    if (!memberId) {
      showAppAlert(t('common.required'), t('members.title'));
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      showAppAlert(t('common.required'), t('common.amount'));
      return;
    }
    if (selectedMonths.length === 0) {
      showAppAlert(t('common.required'), t('common.month'));
      return;
    }
    if (closedWarningYear) {
      showAppAlert(t('history.closedNotice'), closedWarningYear.label);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn.trim())) {
      showAppAlert(t('common.required'), `${t('common.date')} (YYYY-MM-DD)`);
      return;
    }

    setSaving(true);
    try {
      const currentMonth = getKarachiCurrentMonthStart();
      if (isEditMode && editingContribution) {
        const periodStart = selectedMonths[0];
        const computedKind: ContributionKind =
          editingContribution.kind === 'special'
            ? 'special'
            : periodStart > currentMonth
              ? 'advance'
              : 'monthly';
        await localUpdate(
          'contributions',
          editingContribution.id,
          {
            amount: parsedAmount,
            period_start: periodStart,
            kind: computedKind,
            paid_on: paidOn,
            remark: paymentMethod,
          },
          { actorId: adminId },
        );
      } else {
        // Multi-month entry splits cleanly into one append-only ledger row per month
        for (const periodStart of selectedMonths) {
          const computedKind: ContributionKind =
            periodStart > currentMonth ? 'advance' : 'monthly';
          await localInsert(
            'contributions',
            {
              member_id: memberId,
              amount: parsedAmount,
              period_start: periodStart,
              kind: computedKind,
              paid_on: paidOn,
              collected_by: adminId,
              remark: paymentMethod,
              void_reason: null,
              client_created_at: new Date().toISOString(),
            },
            { actorId: adminId },
          );
        }
      }
      onClose();
    } catch {
      showAppAlert(t('common.errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async () => {
    if (!editingContribution) return;
    if (!voidReason.trim()) {
      showAppAlert(t('common.required'), t('ledger.voidPrompt'));
      return;
    }
    setSaving(true);
    try {
      await localSoftDelete('contributions', editingContribution.id, voidReason.trim(), {
        actorId: adminId,
      });
      onClose();
    } catch {
      showAppAlert(t('common.errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: isEditMode ? colors.editBorder : colors.border,
              borderWidth: isEditMode ? 2 : 1,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            },
          ]}
        >
          {/* Edit Mode Guardrail Banner */}
          {isEditMode ? (
            <View style={[styles.editBanner, { backgroundColor: colors.editBannerBg }]}>
              <View style={[styles.editChip, { backgroundColor: colors.editBorder, borderRadius: radius.pill }]}>
                <Text style={styles.editChipText}>{t('common.editing')}</Text>
              </View>
              <Text style={[styles.editBannerText, { color: colors.editBannerText }]} numberOfLines={2}>
                {t('ledger.editBanner')}
              </Text>
            </View>
          ) : null}

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {isEditMode ? t('common.edit') : t('ledger.recordPayment')}
            </Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 20, 36) }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* Member Picker */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.text }]}>{t('members.title')}</Text>
              <Pressable
                disabled={isEditMode}
                onPress={() => {
                  setMonthPickerOpen(false);
                  setMemberPickerOpen((o) => !o);
                }}
                style={[
                  styles.pickerBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderStrong,
                    borderRadius: radius.md,
                    opacity: isEditMode ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.pickerText, { color: colors.text }]}>
                  {selectedMember
                    ? `#${selectedMember.member_no} · ${lang === 'ur' && selectedMember.full_name_ur ? selectedMember.full_name_ur : selectedMember.full_name}`
                    : t('members.title')}
                </Text>
                {!isEditMode ? (
                  <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                ) : null}
              </Pressable>

              {memberPickerOpen ? (
                <Card style={styles.memberListCard} padded={false}>
                  <ScrollView style={styles.memberListScroll} nestedScrollEnabled>
                    {profiles.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() => {
                          setMemberId(p.id);
                          setMemberPickerOpen(false);
                          const eff = resolveEffectiveTierForMonth(
                            p.id,
                            primaryMonth,
                            memberTiers,
                            tiers,
                            tierRates,
                          );
                          if (eff && !amountInput) setAmountInput(String(eff.minAmount));
                        }}
                        style={[
                          styles.memberRow,
                          {
                            borderBottomColor: colors.border,
                            backgroundColor: p.id === memberId ? colors.primarySoft : 'transparent',
                          },
                        ]}
                      >
                        <Text style={[styles.memberRowText, { color: colors.text }]}>
                          #{p.member_no} · {lang === 'ur' && p.full_name_ur ? p.full_name_ur : p.full_name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </Card>
              ) : null}
            </View>

            {/* Amount per month */}
            <TextField
              label={`${t('common.amount')}${!isEditMode && selectedMonths.length > 1 ? ` (× ${selectedMonths.length})` : ''}`}
              keyboardType="number-pad"
              value={amountInput}
              onChangeText={setAmountInput}
              placeholder={effectiveTier ? String(effectiveTier.minAmount) : '200'}
            />

            {/* Quick Amount Chips (includes 2x tier minimum for easy voluntary extra!) */}
            <View style={styles.quickAmounts}>
              {[
                effectiveTier?.minAmount,
                effectiveTier ? effectiveTier.minAmount * 2 : undefined,
                200,
                400,
                500,
                1000,
              ]
                .filter((v, idx, arr): v is number => Boolean(v) && arr.indexOf(v) === idx)
                .slice(0, 5)
                .map((amt) => (
                  <Pressable
                    key={amt}
                    onPress={() => setAmountInput(String(amt))}
                    style={[
                      styles.amtChip,
                      {
                        backgroundColor: parsedAmount === amt ? colors.primary : colors.surfaceSubtle,
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.amtChipText,
                        typography.numeric,
                        { color: parsedAmount === amt ? '#FFFFFF' : colors.text },
                      ]}
                    >
                      {formatPKR(amt)}
                    </Text>
                  </Pressable>
                ))}
            </View>

            {/* Below-minimum warning (allowed — records as short!) */}
            {isBelowMin && effectiveTier ? (
              <View style={[styles.warnBox, { backgroundColor: colors.warningSoft, borderRadius: radius.md }]}>
                <Ionicons name="alert-circle" size={18} color={colors.warning} />
                <Text style={[styles.warnText, { color: colors.shortText }]}>
                  {t('ledger.belowMinWarning', { min: formatPKR(effectiveTier.minAmount) })}
                </Text>
              </View>
            ) : null}

            {/* Voluntary extra amount confirmation (flexible generosity!) */}
            {extraAmount > 0 && effectiveTier ? (
              <View style={[styles.warnBox, { backgroundColor: colors.metBg, borderRadius: radius.md }]}>
                <Ionicons name="checkmark-circle" size={18} color={colors.metText} />
                <Text style={[styles.warnText, { color: colors.metText }]}>
                  {t('ledger.extraAmountNote', {
                    min: formatPKR(effectiveTier.minAmount),
                    extra: formatPKR(extraAmount),
                  })}
                </Text>
              </View>
            ) : null}

            {/* Closed fiscal year warning */}
            {closedWarningYear ? (
              <View style={[styles.warnBox, { backgroundColor: colors.dangerSoft, borderRadius: radius.md }]}>
                <Ionicons name="lock-closed" size={18} color={colors.danger} />
                <Text style={[styles.warnText, { color: colors.danger }]}>
                  {t('history.closedNotice')} ({closedWarningYear.label})
                </Text>
              </View>
            ) : null}

            {/* Month(s) Dropdown Selector */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.text }]}>{t('common.month')}</Text>
              <Pressable
                onPress={() => {
                  setMemberPickerOpen(false);
                  setMonthPickerOpen((o) => !o);
                }}
                style={[
                  styles.pickerBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: monthPickerOpen ? colors.primary : colors.borderStrong,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={[styles.pickerText, { color: colors.text }]} numberOfLines={1}>
                  {selectedMonthsLabel}
                </Text>
                <Ionicons
                  name={monthPickerOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>

              {monthPickerOpen ? (
                <Card style={styles.monthListCard} padded={false}>
                  {!isEditMode ? (
                    <View
                      style={[
                        styles.monthDropdownHeader,
                        { backgroundColor: colors.surfaceSubtle, borderBottomColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.hint, { color: colors.textSecondary, flex: 1 }]}>
                        {t('ledger.multiMonthHint')}
                      </Text>
                      <Pressable onPress={() => setMonthPickerOpen(false)} hitSlop={8}>
                        <Text style={[styles.doneLink, { color: colors.primary }]}>
                          {t('common.confirm')}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                  <ScrollView style={styles.monthListScroll} nestedScrollEnabled>
                    {fyMonths.map((m) => {
                      const selected = selectedMonths.includes(m);
                      return (
                        <Pressable
                          key={m}
                          onPress={() => toggleMonth(m)}
                          style={[
                            styles.monthDropdownRow,
                            {
                              borderBottomColor: colors.border,
                              backgroundColor: selected ? colors.primarySoft : 'transparent',
                            },
                          ]}
                        >
                          <Ionicons
                            name={selected ? 'checkbox' : 'square-outline'}
                            size={18}
                            color={selected ? colors.primary : colors.textMuted}
                          />
                          <Text
                            style={[
                              styles.memberRowText,
                              {
                                color: selected ? colors.primary : colors.text,
                                fontWeight: selected ? '700' : '500',
                              },
                            ]}
                          >
                            {formatMonthYear(m, lang)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </Card>
              ) : null}

              {!isEditMode && selectedMonths.length > 1 && parsedAmount ? (
                <Text style={[styles.splitPreview, typography.numeric, { color: colors.primary }]}>
                  {selectedMonths.length} × {formatPKR(parsedAmount)} ={' '}
                  {formatPKR(selectedMonths.length * parsedAmount)}
                </Text>
              ) : null}
            </View>

            <TextField
              label={t('common.date')}
              value={paidOn}
              onChangeText={setPaidOn}
              placeholder="YYYY-MM-DD"
            />

            {/* Payment Method Checkboxes: Cash / Bank / Easypaisa */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {t('ledger.paymentMethod')}
              </Text>
              <View style={styles.methodRow}>
                {(
                  [
                    { key: 'Cash', label: t('ledger.methodCash') },
                    { key: 'Bank', label: t('ledger.methodBank') },
                    { key: 'Easypaisa', label: t('ledger.methodEasypaisa') },
                  ] as const
                ).map(({ key, label }) => {
                  const checked = paymentMethod === key;
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      onPress={() => setPaymentMethod(key)}
                      style={[
                        styles.methodBox,
                        {
                          backgroundColor: checked ? colors.primarySoft : colors.surface,
                          borderColor: checked ? colors.primary : colors.borderStrong,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <Ionicons
                        name={checked ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={checked ? colors.primary : colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.methodText,
                          { color: checked ? colors.primary : colors.text },
                        ]}
                        numberOfLines={1}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.actionsRow}>
              <Button
                label={t('common.cancel')}
                variant="secondary"
                onPress={onClose}
                style={styles.flexBtn}
              />
              <Button
                label={t('common.save')}
                loading={saving}
                onPress={handleSave}
                style={styles.flexBtn}
              />
            </View>

            {/* Void (Soft Delete with Required Reason) */}
            {isEditMode ? (
              <View style={styles.voidSection}>
                {!showVoidBox ? (
                  <Button
                    label={t('common.void')}
                    variant="danger"
                    onPress={() => setShowVoidBox(true)}
                  />
                ) : (
                  <Card style={{ borderColor: colors.danger, gap: 10 }}>
                    <Text style={[styles.voidHint, { color: colors.danger }]}>
                      {t('ledger.voidPrompt')}
                    </Text>
                    <TextField
                      label={t('common.reason')}
                      value={voidReason}
                      onChangeText={setVoidReason}
                      placeholder="Duplicate entry / Wrong member"
                    />
                    <Button
                      label={t('common.confirm')}
                      variant="danger"
                      loading={saving}
                      onPress={handleVoid}
                    />
                  </Card>
                )}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '90%',
    overflow: 'hidden',
  },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  editChip: { paddingHorizontal: 10, paddingVertical: 3 },
  editChipText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  editBannerText: { flex: 1, fontSize: 12, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '700' },
  closeBtn: { padding: 6 },
  body: { padding: 16, gap: 14, paddingBottom: 32 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  hint: { fontSize: 12 },
  pickerBtn: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerText: { fontSize: 15, fontWeight: '600' },
  memberListCard: { maxHeight: 180, overflow: 'hidden' },
  memberListScroll: { maxHeight: 180 },
  memberRow: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  memberRowText: { fontSize: 14 },
  quickAmounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amtChip: { paddingHorizontal: 14, paddingVertical: 8 },
  amtChipText: { fontSize: 13, fontWeight: '700' },
  warnBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  warnText: { flex: 1, fontSize: 12, fontWeight: '600' },
  monthListCard: { maxHeight: 220, overflow: 'hidden' },
  monthListScroll: { maxHeight: 184 },
  monthDropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  doneLink: { fontSize: 13, fontWeight: '700' },
  monthDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  splitPreview: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodBox: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  methodText: { fontSize: 12, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flexBtn: { flex: 1 },
  voidSection: { marginTop: 6 },
  voidHint: { fontSize: 12, fontWeight: '600' },
});
