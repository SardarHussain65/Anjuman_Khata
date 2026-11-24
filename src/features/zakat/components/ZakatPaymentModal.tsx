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
import { getKarachiToday } from '@/core/dates';
import { Button } from '@/core/ui/Button';
import { Card } from '@/core/ui/Card';
import { TextField } from '@/core/ui/TextField';
import { FiscalYearRow, ZakatMemberRow, ZakatPaymentRow } from '@/data/db/types';
import { localInsert, localSoftDelete, localUpdate } from '@/data/sync/syncEngine';
import { findClosedFiscalYearForZakat } from '@/core/rules/fiscalYear';
import { useAuthStore } from '@/features/auth/store/authStore';

type PaymentMethod = 'cash' | 'bank' | 'easypaisa';

function parsePaymentMethod(remark: string | null | undefined): PaymentMethod {
  const lower = (remark ?? '').trim().toLowerCase();
  if (lower.includes('bank') || lower.includes('بینک')) return 'bank';
  if (lower.includes('easypaisa') || lower.includes('ایزی پیسہ')) return 'easypaisa';
  return 'cash';
}

function methodToRemark(method: PaymentMethod): string {
  if (method === 'bank') return 'Bank';
  if (method === 'easypaisa') return 'Easypaisa';
  return 'Cash';
}

interface ZakatPaymentModalProps {
  visible: boolean;
  onClose: () => void;
  year: number;
  perPersonAmount: number;
  zakatMembers: ZakatMemberRow[];
  fiscalYears: FiscalYearRow[];
  initialZakatMemberId?: string | null;
  editingPayment?: ZakatPaymentRow | null;
}

export function ZakatPaymentModal(props: ZakatPaymentModalProps) {
  if (!props.visible) return null;
  return (
    <ZakatPaymentModalInner
      key={props.editingPayment?.id ?? `new-${props.year}-${props.initialZakatMemberId ?? 'none'}`}
      {...props}
    />
  );
}

function ZakatPaymentModalInner({
  visible,
  onClose,
  year,
  perPersonAmount,
  zakatMembers,
  fiscalYears,
  initialZakatMemberId,
  editingPayment,
}: ZakatPaymentModalProps) {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const isEdit = Boolean(editingPayment);
  const defaultMemberId =
    editingPayment?.zakat_member_id ?? initialZakatMemberId ?? zakatMembers[0]?.id ?? '';
  const initialMember = zakatMembers.find((m) => m.id === defaultMemberId) ?? null;
  const initialPeople =
    editingPayment?.family_count_snapshot ??
    (initialMember ? (initialMember.is_family ? Math.max(1, initialMember.family_count) : 1) : 1);
  const initialExpected = initialPeople * Math.max(0, perPersonAmount);

  const [zakatMemberId, setZakatMemberId] = useState(defaultMemberId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [peopleInput, setPeopleInput] = useState(String(initialPeople));
  const [amountInput, setAmountInput] = useState(
    editingPayment
      ? String(editingPayment.amount)
      : initialExpected > 0
        ? String(initialExpected)
        : '',
  );
  const [paidOn, setPaidOn] = useState(editingPayment?.paid_on ?? getKarachiToday());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    parsePaymentMethod(editingPayment?.remark),
  );
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedMember = useMemo(
    () => zakatMembers.find((m) => m.id === zakatMemberId) ?? null,
    [zakatMembers, zakatMemberId],
  );

  const peopleCount = Math.max(1, Number.parseInt(peopleInput, 10) || 1);
  const expectedAmount = peopleCount * Math.max(0, perPersonAmount);
  const parsedAmount = parsePKR(amountInput);
  const extraAmount =
    parsedAmount != null && expectedAmount > 0 && parsedAmount > expectedAmount
      ? parsedAmount - expectedAmount
      : 0;

  const closedFy = useMemo(
    () => findClosedFiscalYearForZakat(year, paidOn, fiscalYears),
    [year, paidOn, fiscalYears],
  );

  const handleSelectMember = (m: ZakatMemberRow) => {
    setZakatMemberId(m.id);
    const count = m.is_family ? Math.max(1, m.family_count) : 1;
    setPeopleInput(String(count));
    if (!isEdit && perPersonAmount > 0) {
      setAmountInput(String(count * perPersonAmount));
    }
    setPickerOpen(false);
  };

  const handlePeopleChange = (val: string) => {
    setPeopleInput(val);
    const n = Number.parseInt(val, 10);
    if (!isEdit && Number.isInteger(n) && n >= 1 && perPersonAmount > 0) {
      setAmountInput(String(n * perPersonAmount));
    }
  };

  const handleSave = async () => {
    if (saving) return;
    const amt = parsePKR(amountInput);
    if (!zakatMemberId || !amt || amt <= 0) {
      Alert.alert(t('common.required'), t('common.amount'));
      return;
    }
    if (closedFy) {
      Alert.alert(t('history.closedNotice'), closedFy.label);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn.trim())) {
      Alert.alert(t('common.required'), `${t('common.date')} (YYYY-MM-DD)`);
      return;
    }
    setSaving(true);
    try {
      if (isEdit && editingPayment) {
        await localUpdate(
          'zakat_payments',
          editingPayment.id,
          {
            amount: amt,
            family_count_snapshot: peopleCount,
            paid_on: paidOn,
            remark: methodToRemark(paymentMethod),
          },
          { actorId: adminId },
        );
      } else {
        await localInsert(
          'zakat_payments',
          {
            member_id: null,
            zakat_member_id: zakatMemberId,
            family_count_snapshot: peopleCount,
            assessment_id: null,
            year,
            amount: amt,
            paid_on: paidOn,
            collected_by: adminId,
            remark: methodToRemark(paymentMethod),
            void_reason: null,
          },
          { actorId: adminId },
        );
      }
      onClose();
    } catch {
      Alert.alert(t('common.errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async () => {
    if (!editingPayment || !voidReason.trim()) {
      Alert.alert(t('common.required'), t('ledger.voidPrompt'));
      return;
    }
    setSaving(true);
    try {
      await localSoftDelete('zakat_payments', editingPayment.id, voidReason.trim(), {
        actorId: adminId,
      });
      onClose();
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
              borderColor: isEdit ? colors.editBorder : colors.zakatBorder,
              borderWidth: isEdit ? 2 : 1,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            },
          ]}
        >
          {isEdit ? (
            <View style={[styles.editBanner, { backgroundColor: colors.editBannerBg }]}>
              <Text style={[styles.editText, { color: colors.editBannerText }]}>
                {t('common.editing')} · {t('ledger.editBanner')}
              </Text>
            </View>
          ) : null}

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.zakatText }]}>
              {isEdit ? t('common.edit') : t('zakat.recordPayment')} · {year}
            </Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* Zakat Payer / Family Picker */}
            <View style={styles.group}>
              <Text style={[styles.label, { color: colors.text }]}>{t('zakat.payerName')}</Text>
              <Pressable
                disabled={isEdit}
                onPress={() => setPickerOpen((o) => !o)}
                style={[
                  styles.pickerBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderStrong,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {selectedMember
                    ? `#${selectedMember.member_no} · ${selectedMember.payer_name}${selectedMember.khandan_name ? ` (${selectedMember.khandan_name})` : ''}`
                    : t('zakat.noMembersYet')}
                </Text>
                {!isEdit ? <Ionicons name="chevron-down" size={18} color={colors.textMuted} /> : null}
              </Pressable>
              {pickerOpen ? (
                <Card style={styles.pickerList} padded={false}>
                  <ScrollView style={{ maxHeight: 170 }} nestedScrollEnabled>
                    {zakatMembers.map((m) => (
                      <Pressable
                        key={m.id}
                        onPress={() => handleSelectMember(m)}
                        style={[styles.pickerItem, { borderBottomColor: colors.border }]}
                      >
                        <Text style={{ color: colors.text, fontWeight: '600' }}>
                          #{m.member_no} · {m.payer_name}
                          {m.khandan_name ? ` (${m.khandan_name})` : ''}
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                          {m.is_family
                            ? `${t('zakat.familyBadge', { count: m.family_count })}`
                            : t('zakat.soloBadge')}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </Card>
              ) : null}
            </View>

            {closedFy ? (
              <Card style={{ borderColor: colors.danger }}>
                <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '600' }}>
                  {t('history.closedNotice')} ({closedFy.label})
                </Text>
              </Card>
            ) : null}

            {/* People Count + Expected Breakdown */}
            <View style={styles.splitRow}>
              <View style={styles.smallCol}>
                <TextField
                  label={t('zakat.peopleCount')}
                  keyboardType="number-pad"
                  value={peopleInput}
                  onChangeText={handlePeopleChange}
                />
              </View>
              <View style={styles.amountCol}>
                <TextField
                  label={t('common.amount')}
                  keyboardType="number-pad"
                  value={amountInput}
                  onChangeText={setAmountInput}
                  placeholder={expectedAmount > 0 ? String(expectedAmount) : '300'}
                />
              </View>
            </View>

            {perPersonAmount > 0 ? (
              <Text style={[styles.calcNote, typography.numeric, { color: colors.textSecondary }]}>
                {peopleCount} × {formatPKR(perPersonAmount)} = {formatPKR(expectedAmount)}
              </Text>
            ) : null}

            {extraAmount > 0 ? (
              <View style={[styles.extraBadge, { backgroundColor: colors.metBg, borderRadius: radius.md }]}>
                <Ionicons name="heart-outline" size={16} color={colors.metText} />
                <Text style={[styles.extraText, { color: colors.metText }]}>
                  {t('ledger.extraContributionNote', {
                    extra: formatPKR(extraAmount),
                    required: formatPKR(expectedAmount),
                  })}
                </Text>
              </View>
            ) : null}

            <TextField
              label={t('common.date')}
              value={paidOn}
              onChangeText={setPaidOn}
              placeholder="YYYY-MM-DD"
            />

            {/* Payment Method Checkboxes (Cash / Bank / Easypaisa) */}
            <View style={styles.group}>
              <Text style={[styles.label, { color: colors.text }]}>{t('ledger.paymentMethod')}</Text>
              <View style={styles.methodRow}>
                {(
                  [
                    { key: 'cash', labelKey: 'ledger.methodCash' },
                    { key: 'bank', labelKey: 'ledger.methodBank' },
                    { key: 'easypaisa', labelKey: 'ledger.methodEasypaisa' },
                  ] as const
                ).map(({ key: method, labelKey }) => {
                  const checked = paymentMethod === method;
                  return (
                    <Pressable
                      key={method}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      onPress={() => setPaymentMethod(method)}
                      style={[
                        styles.methodBtn,
                        {
                          backgroundColor: checked ? colors.zakatSoft : colors.surface,
                          borderColor: checked ? colors.zakat : colors.borderStrong,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <Ionicons
                        name={checked ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={checked ? colors.zakat : colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.methodText,
                          { color: checked ? colors.zakatText : colors.text },
                        ]}
                      >
                        {t(labelKey)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.actions}>
              <Button label={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flex1} />
              <Button
                label={t('common.save')}
                variant="zakat"
                loading={saving}
                disabled={Boolean(closedFy) || !zakatMemberId}
                onPress={handleSave}
                style={styles.flex1}
              />
            </View>

            {isEdit ? (
              showVoid ? (
                <Card style={{ borderColor: colors.danger, gap: 10 }}>
                  <TextField
                    label={t('common.reason')}
                    value={voidReason}
                    onChangeText={setVoidReason}
                    placeholder="Duplicate / Error"
                  />
                  <Button label={t('common.confirm')} variant="danger" loading={saving} onPress={handleVoid} />
                </Card>
              ) : (
                <Button label={t('common.void')} variant="danger" onPress={() => setShowVoid(true)} />
              )
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', overflow: 'hidden' },
  editBanner: { padding: 10 },
  editText: { fontSize: 12, fontWeight: '700' },
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
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  group: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  pickerBtn: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerList: { maxHeight: 170, overflow: 'hidden' },
  pickerItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  splitRow: { flexDirection: 'row', gap: 10 },
  smallCol: { width: 112 },
  amountCol: { flex: 1 },
  calcNote: { fontSize: 12, marginTop: -4 },
  extraBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  extraText: { flex: 1, fontSize: 12, fontWeight: '600' },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodBtn: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  methodText: { fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex1: { flex: 1 },
});
