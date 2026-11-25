import React, { useState } from 'react';
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
import { formatPKR } from '@/core/money';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { TextField } from '@/core/ui/TextField';
import { ZakatMemberRow, ZakatMemberStatus } from '@/data/db/types';
import { localInsert, localUpdate } from '@/data/sync/syncEngine';
import { useAuthStore } from '@/features/auth/store/authStore';

interface ZakatMemberFormModalProps {
  visible: boolean;
  onClose: () => void;
  editingMember?: ZakatMemberRow | null;
  nextMemberNo: number;
  perPersonAmount: number;
}

export function ZakatMemberFormModal(props: ZakatMemberFormModalProps) {
  if (!props.visible) return null;
  return (
    <ZakatMemberFormModalInner
      key={props.editingMember?.id ?? `new-zm-${props.nextMemberNo}`}
      {...props}
    />
  );
}

function ZakatMemberFormModalInner({
  visible,
  onClose,
  editingMember,
  nextMemberNo,
  perPersonAmount,
}: ZakatMemberFormModalProps) {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const isEdit = Boolean(editingMember);

  const [memberNo, setMemberNo] = useState(
    editingMember ? String(editingMember.member_no) : String(nextMemberNo),
  );
  const [payerName, setPayerName] = useState(editingMember?.payer_name ?? '');
  const [khandanName, setKhandanName] = useState(editingMember?.khandan_name ?? '');
  const [isFamily, setIsFamily] = useState(Boolean(editingMember?.is_family));
  const [familyCountInput, setFamilyCountInput] = useState(
    editingMember && editingMember.is_family ? String(Math.max(2, editingMember.family_count)) : '2',
  );
  const [status, setStatus] = useState<ZakatMemberStatus>(editingMember?.status ?? 'active');
  const [saving, setSaving] = useState(false);

  const parsedFamilyCount = isFamily
    ? Math.max(1, Number.parseInt(familyCountInput, 10) || 1)
    : 1;
  const estimatedDue = parsedFamilyCount * Math.max(0, perPersonAmount);

  const stepPeople = (delta: number) => {
    const next = Math.max(2, Math.min(200, parsedFamilyCount + delta));
    setFamilyCountInput(String(next));
  };

  const handleSave = async () => {
    if (saving) return;
    const parsedNo = Number.parseInt(memberNo, 10);
    if (!payerName.trim() || !Number.isInteger(parsedNo) || parsedNo <= 0) {
      showAppAlert(t('common.required'), `${t('members.memberNo')} & ${t('zakat.payerName')}`);
      return;
    }

    const finalCount = isFamily ? Number.parseInt(familyCountInput, 10) : 1;
    if (isFamily && (!Number.isInteger(finalCount) || finalCount < 1 || finalCount > 200)) {
      showAppAlert(t('common.required'), t('zakat.peopleCount'));
      return;
    }

    setSaving(true);
    try {
      if (isEdit && editingMember) {
        await localUpdate(
          'zakat_members',
          editingMember.id,
          {
            member_no: parsedNo,
            payer_name: payerName.trim(),
            khandan_name: khandanName.trim(),
            is_family: isFamily,
            family_count: finalCount,
            status,
          },
          { actorId: adminId },
        );
      } else {
        await localInsert(
          'zakat_members',
          {
            member_no: parsedNo,
            payer_name: payerName.trim(),
            khandan_name: khandanName.trim(),
            is_family: isFamily,
            family_count: finalCount,
            status: 'active',
            notes: null,
          },
          { actorId: adminId },
        );
      }
      onClose();
    } catch (err) {
      showAppAlert(t('common.errorGeneric'), err instanceof Error ? err.message : undefined);
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
              borderColor: colors.zakatBorder,
              borderWidth: 1,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.zakatText }]}>
              {isEdit ? t('common.edit') : t('zakat.addMember')}
            </Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 20, 36) }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* Serial # + Payer Name */}
            <View style={styles.nameRow}>
              <View style={styles.noCol}>
                <TextField
                  label={t('members.memberNo')}
                  keyboardType="number-pad"
                  value={memberNo}
                  onChangeText={setMemberNo}
                />
              </View>
              <View style={styles.nameCol}>
                <TextField
                  label={t('zakat.payerName')}
                  value={payerName}
                  onChangeText={setPayerName}
                  placeholder="Haji Aslam"
                  autoFocus={!isEdit}
                />
              </View>
            </View>

            {/* Khandan / Family Name */}
            <TextField
              label={t('zakat.khandanName')}
              value={khandanName}
              onChangeText={setKhandanName}
              placeholder="e.g. Sardar Khel / Malik"
            />

            {/* Solo or Family Toggle */}
            <View style={styles.group}>
              <Text style={[styles.label, { color: colors.text }]}>{t('zakat.payerType')}</Text>
              <View style={styles.row}>
                {[
                  { val: false, label: t('zakat.soloOption'), icon: 'person-outline' as const },
                  { val: true, label: t('zakat.familyOption'), icon: 'people-outline' as const },
                ].map((opt) => {
                  const active = isFamily === opt.val;
                  return (
                    <Pressable
                      key={String(opt.val)}
                      onPress={() => setIsFamily(opt.val)}
                      style={[
                        styles.typeChip,
                        {
                          backgroundColor: active ? colors.zakat : colors.surface,
                          borderColor: active ? colors.zakat : colors.borderStrong,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <Ionicons name={opt.icon} size={18} color={active ? '#FFFFFF' : colors.text} />
                      <Text style={[styles.typeText, { color: active ? '#FFFFFF' : colors.text }]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Family Members Count (when Family selected) */}
            {isFamily ? (
              <View
                style={[
                  styles.familyBox,
                  {
                    backgroundColor: colors.zakatSoft,
                    borderColor: colors.zakatBorder,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={[styles.label, { color: colors.zakatText }]}>
                  {t('zakat.peopleCount')}
                </Text>
                <View style={styles.stepperRow}>
                  <Pressable
                    onPress={() => stepPeople(-1)}
                    style={[styles.stepBtn, { backgroundColor: colors.surface, borderColor: colors.zakatBorder, borderRadius: radius.md }]}
                  >
                    <Ionicons name="remove" size={20} color={colors.zakatText} />
                  </Pressable>
                  <View style={styles.countInputWrap}>
                    <TextField
                      label=""
                      keyboardType="number-pad"
                      value={familyCountInput}
                      onChangeText={setFamilyCountInput}
                    />
                  </View>
                  <Pressable
                    onPress={() => stepPeople(1)}
                    style={[styles.stepBtn, { backgroundColor: colors.surface, borderColor: colors.zakatBorder, borderRadius: radius.md }]}
                  >
                    <Ionicons name="add" size={20} color={colors.zakatText} />
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* Live Annual Due Preview */}
            {perPersonAmount > 0 ? (
              <View
                style={[
                  styles.previewBox,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.zakatBorder,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>
                  {t('zakat.annualDuePreview')}
                </Text>
                <Text style={[styles.previewVal, typography.numeric, { color: colors.zakatText }]}>
                  {parsedFamilyCount} × {formatPKR(perPersonAmount)} = {formatPKR(estimatedDue)}
                </Text>
              </View>
            ) : null}

            {/* Active / Inactive (Edit mode only) */}
            {isEdit ? (
              <View style={styles.group}>
                <Text style={[styles.label, { color: colors.text }]}>{t('common.status')}</Text>
                <View style={styles.row}>
                  {(['active', 'inactive'] as const).map((st) => {
                    const active = status === st;
                    return (
                      <Pressable
                        key={st}
                        onPress={() => setStatus(st)}
                        style={[
                          styles.typeChip,
                          {
                            backgroundColor: active ? colors.zakat : colors.surface,
                            borderColor: active ? colors.zakat : colors.borderStrong,
                            borderRadius: radius.md,
                          },
                        ]}
                      >
                        <Text style={[styles.typeText, { color: active ? '#FFFFFF' : colors.text }]}>
                          {t(`memberStatus.${st}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Button label={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flex1} />
              <Button label={t('common.save')} variant="zakat" loading={saving} onPress={handleSave} style={styles.flex1} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%' },
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
  nameRow: { flexDirection: 'row', gap: 10 },
  noCol: { width: 88 },
  nameCol: { flex: 1 },
  group: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  typeChip: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  typeText: { fontSize: 13, fontWeight: '700' },
  familyBox: { padding: 12, borderWidth: 1, gap: 8 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 46, height: 46, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  countInputWrap: { flex: 1 },
  previewBox: { padding: 12, borderWidth: 1, gap: 2 },
  previewLabel: { fontSize: 12 },
  previewVal: { fontSize: 16, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex1: { flex: 1 },
});
