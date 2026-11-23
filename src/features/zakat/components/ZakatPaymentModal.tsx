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
import { parsePKR } from '@/core/money';
import { getKarachiToday } from '@/core/dates';
import { getCurrentLanguage } from '@/core/i18n';
import { Button } from '@/core/ui/Button';
import { Card } from '@/core/ui/Card';
import { TextField } from '@/core/ui/TextField';
import { FiscalYearRow, ProfileRow, ZakatPaymentRow } from '@/data/db/types';
import { localInsert, localSoftDelete, localUpdate } from '@/data/sync/syncEngine';
import { findClosedFiscalYearForZakat } from '@/core/rules/fiscalYear';
import { useAuthStore } from '@/features/auth/store/authStore';

interface ZakatPaymentModalProps {
  visible: boolean;
  onClose: () => void;
  year: number;
  profiles: ProfileRow[];
  fiscalYears: FiscalYearRow[];
  editingPayment?: ZakatPaymentRow | null;
}

export function ZakatPaymentModal(props: ZakatPaymentModalProps) {
  if (!props.visible) return null;
  return (
    <ZakatPaymentModalInner
      key={props.editingPayment?.id ?? `new-${props.year}`}
      {...props}
    />
  );
}

function ZakatPaymentModalInner({
  visible,
  onClose,
  year,
  profiles,
  fiscalYears,
  editingPayment,
}: ZakatPaymentModalProps) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const lang = getCurrentLanguage();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const isEdit = Boolean(editingPayment);
  const [memberId, setMemberId] = useState(editingPayment?.member_id ?? profiles[0]?.id ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amountInput, setAmountInput] = useState(editingPayment ? String(editingPayment.amount) : '');
  const [paidOn, setPaidOn] = useState(editingPayment?.paid_on ?? getKarachiToday());
  const [remark, setRemark] = useState(editingPayment?.remark ?? '');
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedMember = useMemo(
    () => profiles.find((p) => p.id === memberId) ?? null,
    [profiles, memberId],
  );

  const closedFy = useMemo(
    () => findClosedFiscalYearForZakat(year, paidOn, fiscalYears),
    [year, paidOn, fiscalYears],
  );

  const handleSave = async () => {
    const amt = parsePKR(amountInput);
    if (!memberId || !amt || amt <= 0) {
      Alert.alert(t('common.required'), t('common.amount'));
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
            paid_on: paidOn,
            remark: remark.trim() || null,
          },
          { actorId: adminId },
        );
      } else {
        await localInsert(
          'zakat_payments',
          {
            member_id: memberId,
            assessment_id: null,
            year,
            amount: amt,
            paid_on: paidOn,
            collected_by: adminId,
            remark: remark.trim() || null,
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
            <View style={styles.group}>
              <Text style={[styles.label, { color: colors.text }]}>{t('members.title')}</Text>
              <Pressable
                disabled={isEdit}
                onPress={() => setPickerOpen((o) => !o)}
                style={[styles.pickerBtn, { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderRadius: radius.md }]}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  {selectedMember
                    ? `#${selectedMember.member_no} · ${lang === 'ur' && selectedMember.full_name_ur ? selectedMember.full_name_ur : selectedMember.full_name}`
                    : t('members.title')}
                </Text>
              </Pressable>
              {pickerOpen ? (
                <Card style={styles.pickerList} padded={false}>
                  <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
                    {profiles.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() => {
                          setMemberId(p.id);
                          setPickerOpen(false);
                        }}
                        style={[styles.pickerItem, { borderBottomColor: colors.border }]}
                      >
                        <Text style={{ color: colors.text }}>
                          #{p.member_no} · {p.full_name}
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

            <TextField
              label={t('common.amount')}
              keyboardType="number-pad"
              value={amountInput}
              onChangeText={setAmountInput}
              placeholder="5000"
            />
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
            />

            <View style={styles.actions}>
              <Button label={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flex1} />
              <Button label={t('common.save')} variant="zakat" loading={saving} onPress={handleSave} style={styles.flex1} />
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
  pickerBtn: { minHeight: 48, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center' },
  pickerList: { maxHeight: 160, overflow: 'hidden' },
  pickerItem: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex1: { flex: 1 },
});
