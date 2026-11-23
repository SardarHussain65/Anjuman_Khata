import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR, parsePKR } from '@/core/money';
import {
  formatMonthShort,
  formatMonthYear,
  getKarachiCurrentMonthStart,
  getKarachiToday,
} from '@/core/dates';
import { getCurrentLanguage } from '@/core/i18n';
import { Button } from '@/core/ui/Button';
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
  const lang = getCurrentLanguage();
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
  const [kind, setKind] = useState<ContributionKind>(
    editingContribution?.kind ?? (initPeriod > getKarachiCurrentMonthStart() ? 'advance' : 'monthly'),
  );
  const [remark, setRemark] = useState<string>(editingContribution?.remark ?? '');
  const [showVoidBox, setShowVoidBox] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
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

  const handleSave = async () => {
    if (!memberId) {
      Alert.alert(t('common.required'), t('members.title'));
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      Alert.alert(t('common.required'), t('common.amount'));
      return;
    }
    if (selectedMonths.length === 0) {
      Alert.alert(t('common.required'), t('common.month'));
      return;
    }

    setSaving(true);
    try {
      const currentMonth = getKarachiCurrentMonthStart();
      if (isEditMode && editingContribution) {
        await localUpdate(
          'contributions',
          editingContribution.id,
          {
            amount: parsedAmount,
            period_start: selectedMonths[0],
            kind,
            paid_on: paidOn,
            remark: remark.trim() || null,
          },
          { actorId: adminId },
        );
      } else {
        // Multi-month entry splits cleanly into one append-only ledger row per month
        for (const periodStart of selectedMonths) {
          const computedKind: ContributionKind =
            kind === 'special'
              ? 'special'
              : periodStart > currentMonth
                ? 'advance'
                : 'monthly';
          await localInsert(
            'contributions',
            {
              member_id: memberId,
              amount: parsedAmount,
              period_start: periodStart,
              kind: computedKind,
              paid_on: paidOn,
              collected_by: adminId,
              remark: remark.trim() || null,
              void_reason: null,
              client_created_at: new Date().toISOString(),
            },
            { actorId: adminId },
          );
        }
      }
      onClose();
    } catch {
      Alert.alert(t('common.errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async () => {
    if (!editingContribution) return;
    if (!voidReason.trim()) {
      Alert.alert(t('common.required'), t('ledger.voidPrompt'));
      return;
    }
    setSaving(true);
    try {
      await localSoftDelete('contributions', editingContribution.id, voidReason.trim(), {
        actorId: adminId,
      });
      onClose();
    } catch {
      Alert.alert(t('common.errorGeneric'));
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

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* Member Picker */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.text }]}>{t('members.title')}</Text>
              <Pressable
                disabled={isEditMode}
                onPress={() => setMemberPickerOpen((o) => !o)}
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

            {/* Quick Amount Chips */}
            <View style={styles.quickAmounts}>
              {[effectiveTier?.minAmount, 200, 500, 1000]
                .filter((v, idx, arr): v is number => Boolean(v) && arr.indexOf(v) === idx)
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

            {/* Closed fiscal year warning */}
            {closedWarningYear ? (
              <View style={[styles.warnBox, { backgroundColor: colors.dangerSoft, borderRadius: radius.md }]}>
                <Ionicons name="lock-closed" size={18} color={colors.danger} />
                <Text style={[styles.warnText, { color: colors.danger }]}>
                  {t('history.closedNotice')} ({closedWarningYear.label})
                </Text>
              </View>
            ) : null}

            {/* Month(s) Selector */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.text }]}>{t('common.month')}</Text>
              {!isEditMode ? (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>
                  {t('ledger.multiMonthHint')}
                </Text>
              ) : null}
              <View style={styles.monthGrid}>
                {fyMonths.map((m) => {
                  const selected = selectedMonths.includes(m);
                  return (
                    <Pressable
                      key={m}
                      onPress={() => toggleMonth(m)}
                      style={[
                        styles.monthChip,
                        {
                          backgroundColor: selected ? colors.primary : colors.surface,
                          borderColor: selected ? colors.primary : colors.borderStrong,
                          borderRadius: radius.sm,
                        },
                      ]}
                    >
                      <Text style={[styles.monthChipText, { color: selected ? '#FFFFFF' : colors.text }]}>
                        {formatMonthShort(m, lang)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {!isEditMode && selectedMonths.length > 1 && parsedAmount ? (
                <Text style={[styles.splitPreview, typography.numeric, { color: colors.primary }]}>
                  {selectedMonths.length} × {formatPKR(parsedAmount)} ={' '}
                  {formatPKR(selectedMonths.length * parsedAmount)} (
                  {selectedMonths.map((m) => formatMonthYear(m, lang)).join(', ')})
                </Text>
              ) : null}
            </View>

            {/* Kind Selector (monthly / special / advance — NO zakat!) */}
            <View style={styles.kindRow}>
              {(['monthly', 'special', 'advance'] as const).map((k) => {
                const active = kind === k;
                return (
                  <Pressable
                    key={k}
                    onPress={() => setKind(k)}
                    style={[
                      styles.kindChip,
                      {
                        backgroundColor: active ? colors.primarySoft : colors.surface,
                        borderColor: active ? colors.primary : colors.border,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <Text style={[styles.kindText, { color: active ? colors.primary : colors.textSecondary }]}>
                      {k}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextField
              label={t('common.date')}
              value={paidOn}
              onChangeText={setPaidOn}
              placeholder="YYYY-MM-DD"
            />

            <TextField
              label={`${t('common.remark')} (${t('common.optional')})`}
              value={remark}
              onChangeText={setRemark}
              placeholder="Cash / Bank / Note"
            />

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
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthChip: {
    width: '23%',
    minHeight: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthChipText: { fontSize: 13, fontWeight: '600' },
  splitPreview: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  kindRow: { flexDirection: 'row', gap: 8 },
  kindChip: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindText: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flexBtn: { flex: 1 },
  voidSection: { marginTop: 6 },
  voidHint: { fontSize: 12, fontWeight: '600' },
});
