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
import { formatMonthShort, getKarachiCurrentMonthStart, getKarachiToday } from '@/core/dates';
import { useAppLanguage } from '@/core/i18n';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { TextField } from '@/core/ui/TextField';
import { MemberStatus, ProfileRow, TierRow } from '@/data/db/types';
import { computeSerialReorderPlan } from '@/core/rules/serialOrder';
import { localInsert, localUpdate } from '@/data/sync/syncEngine';
import { useAuthStore } from '@/features/auth/store/authStore';

interface MemberFormModalProps {
  visible: boolean;
  onClose: () => void;
  editingMember?: ProfileRow | null;
  tiers: TierRow[];
  existingProfiles?: ProfileRow[];
  nextMemberNo: number;
}

export function MemberFormModal(props: MemberFormModalProps) {
  if (!props.visible) return null;
  return (
    <MemberFormModalInner
      key={props.editingMember?.id ?? `new-${props.nextMemberNo}`}
      {...props}
    />
  );
}

function MemberFormModalInner({
  visible,
  onClose,
  editingMember,
  tiers,
  existingProfiles = [],
  nextMemberNo,
}: MemberFormModalProps) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const lang = useAppLanguage();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const isEdit = Boolean(editingMember);

  const today = getKarachiToday();
  const currentYear = Number.parseInt(today.slice(0, 4), 10);
  const currentMonthStart = getKarachiCurrentMonthStart();
  const yearStart = `${currentYear}-01-01`;

  const [memberNo, setMemberNo] = useState(
    editingMember ? String(editingMember.member_no) : String(nextMemberNo),
  );
  const [fullName, setFullName] = useState(editingMember?.full_name ?? '');
  const [phone, setPhone] = useState(editingMember?.phone ?? '');
  const [designation, setDesignation] = useState(editingMember?.designation ?? '');
  const [status, setStatus] = useState<MemberStatus>(editingMember?.status ?? 'active');
  const [tierId, setTierId] = useState<string>(tiers[0]?.id ?? '');
  const [startYear, setStartYear] = useState(currentYear);
  const [effectiveFrom, setEffectiveFrom] = useState(
    isEdit && editingMember?.status === 'non_earning' ? currentMonthStart : yearStart,
  );
  const [saving, setSaving] = useState(false);

  const monthOptions = Array.from({ length: 12 }, (_, idx) => {
    const mm = String(idx + 1).padStart(2, '0');
    return `${startYear}-${mm}-01`;
  });

  const isActivatingFromNonEarning =
    isEdit && editingMember?.status === 'non_earning' && status === 'active';
  const showTierAssignment =
    (!isEdit && status === 'active') || isActivatingFromNonEarning;

  const handleSave = async () => {
    if (saving) return;
    const parsedNo = Number.parseInt(memberNo, 10);
    if (!fullName.trim() || !Number.isInteger(parsedNo) || parsedNo <= 0) {
      showAppAlert(t('common.required'), `${t('members.memberNo')} & ${t('members.fullName')}`);
      return;
    }

    if (showTierAssignment && !tierId) {
      showAppAlert(t('common.required'), t('members.activateRequiresTier'));
      return;
    }

    if (showTierAssignment && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom.trim())) {
      showAppAlert(t('common.required'), `${t('members.effectiveFrom')} (YYYY-MM-DD)`);
      return;
    }

    setSaving(true);
    try {
      // Auto-shift conflicting serial numbers so the member lands at exact position `parsedNo`
      // without duplicate serial numbers locally or during Supabase sync.
      const shifts = computeSerialReorderPlan(
        existingProfiles,
        isEdit && editingMember ? editingMember.id : null,
        parsedNo,
      );
      for (const shift of shifts) {
        await localUpdate(
          'profiles',
          shift.id,
          { member_no: shift.nextMemberNo },
          { actorId: adminId },
        );
      }

      if (isEdit && editingMember) {
        await localUpdate(
          'profiles',
          editingMember.id,
          {
            member_no: parsedNo,
            full_name: fullName.trim(),
            phone: phone.trim() || null,
            designation: designation.trim() || null,
            status,
          },
          { actorId: adminId },
        );

        if (isActivatingFromNonEarning && tierId) {
          await localInsert(
            'member_tiers',
            {
              member_id: editingMember.id,
              tier_id: tierId,
              effective_from: effectiveFrom,
              reason: 'Activated from non-earning',
            },
            { actorId: adminId },
          );
        }
      } else {
        const created = await localInsert(
          'profiles',
          {
            member_no: parsedNo,
            full_name: fullName.trim(),
            full_name_ur: null,
            phone: phone.trim() || null,
            designation: designation.trim() || null,
            tag: null,
            status,
            role: 'user',
            personal_pledge: null,
            joined_on: getKarachiToday(),
            notes: null,
          },
          { actorId: adminId },
        );

        if (status === 'active' && tierId) {
          await localInsert(
            'member_tiers',
            {
              member_id: created.id,
              tier_id: tierId,
              effective_from: effectiveFrom,
              reason: 'Initial tier assignment',
            },
            { actorId: adminId },
          );
        }
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
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {isEdit ? t('common.edit') : t('members.addMember')}
            </Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 20, 36) }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* Serial # + Full Name */}
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
                  label={t('members.fullName')}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Ahmad"
                  autoFocus={!isEdit}
                />
              </View>
            </View>

            {/* Phone + Designation (compact side-by-side, optional) */}
            <View style={styles.nameRow}>
              <View style={styles.halfCol}>
                <TextField
                  label={`${t('members.phone')} (${t('common.optional')})`}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="0300..."
                />
              </View>
              <View style={styles.halfCol}>
                <TextField
                  label={`${t('members.designation')} (${t('common.optional')})`}
                  value={designation}
                  onChangeText={setDesignation}
                  placeholder="Teacher / Navy"
                />
              </View>
            </View>

            {/* Status */}
            <View style={styles.group}>
              <Text style={[styles.label, { color: colors.text }]}>{t('common.status')}</Text>
              <View style={styles.row}>
                {(['active', 'non_earning', 'inactive'] as const).map((st) => {
                  const active = status === st;
                  return (
                    <Pressable
                      key={st}
                      onPress={() => setStatus(st)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.surface,
                          borderColor: active ? colors.primary : colors.borderStrong,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.text }]}>
                        {t(`memberStatus.${st}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {status === 'non_earning' ? (
                <Text style={[styles.helper, { color: colors.textSecondary }]}>
                  {t('members.nonEarningHint')}
                </Text>
              ) : null}
            </View>

            {/* Tier (shown only when Active) */}
            {showTierAssignment ? (
              <View
                style={[
                  styles.tierBox,
                  {
                    backgroundColor: colors.primarySoft,
                    borderColor: colors.primaryBorder,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={[styles.label, { color: colors.primary }]}>
                  {isActivatingFromNonEarning
                    ? t('members.activateRequiresTier')
                    : t('members.assignTier')}
                </Text>
                {tiers.length === 0 ? (
                  <Text style={[styles.helper, { color: colors.warning }]}>
                    {lang === 'ur'
                      ? 'چندہ درجات لوڈ نہیں ہوئے۔ انٹرنیٹ سے منسلک ہو کر Sync کریں، یا فی الحال رضاکارانہ منتخب کریں۔'
                      : 'No contribution tiers loaded yet. Connect to the internet and tap Sync, or choose Voluntary for now.'}
                  </Text>
                ) : (
                  <View style={styles.row}>
                    {tiers.map((tier) => {
                      const selected = tierId === tier.id;
                      return (
                        <Pressable
                          key={tier.id}
                          onPress={() => setTierId(tier.id)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: selected ? colors.primary : colors.surface,
                              borderColor: selected ? colors.primary : colors.primaryBorder,
                              borderRadius: radius.md,
                            },
                          ]}
                        >
                          <Text style={[styles.chipText, { color: selected ? '#FFFFFF' : colors.text }]}>
                            {lang === 'ur' && tier.name_ur ? tier.name_ur : tier.name} (Rs {tier.min_amount})
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {/* Month-only Effective From picker (Jan default, tap any month if started mid-year) */}
                <View style={styles.group}>
                  <View style={styles.monthHeaderRow}>
                    <Text style={[styles.label, { color: colors.primary }]}>
                      {t('members.effectiveFrom')}
                    </Text>
                    <View style={styles.yearStepper}>
                      <Pressable
                        onPress={() => {
                          const nextYr = startYear - 1;
                          setStartYear(nextYr);
                          setEffectiveFrom(`${nextYr}-${effectiveFrom.slice(5, 7)}-01`);
                        }}
                        style={[styles.yearBtn, { borderColor: colors.primaryBorder, backgroundColor: colors.surface, borderRadius: radius.sm }]}
                      >
                        <Ionicons name="chevron-back" size={14} color={colors.primary} />
                      </Pressable>
                      <Text style={[styles.yearText, { color: colors.primary }]}>{startYear}</Text>
                      <Pressable
                        onPress={() => {
                          const nextYr = startYear + 1;
                          setStartYear(nextYr);
                          setEffectiveFrom(`${nextYr}-${effectiveFrom.slice(5, 7)}-01`);
                        }}
                        style={[styles.yearBtn, { borderColor: colors.primaryBorder, backgroundColor: colors.surface, borderRadius: radius.sm }]}
                      >
                        <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.monthGrid}>
                    {monthOptions.map((m) => {
                      const active = effectiveFrom.slice(0, 7) === m.slice(0, 7);
                      return (
                        <Pressable
                          key={m}
                          onPress={() => setEffectiveFrom(m)}
                          style={[
                            styles.monthChip,
                            {
                              backgroundColor: active ? colors.primary : colors.surface,
                              borderColor: active ? colors.primary : colors.primaryBorder,
                              borderRadius: radius.sm,
                            },
                          ]}
                        >
                          <Text style={[styles.monthChipText, { color: active ? '#FFFFFF' : colors.text }]}>
                            {formatMonthShort(m, lang)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Button label={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flexBtn} />
              <Button label={t('common.save')} loading={saving} onPress={handleSave} style={styles.flexBtn} />
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
  halfCol: { flex: 1 },
  group: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  helper: { fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flex: 1,
    minWidth: 92,
    minHeight: 42,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  monthHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  yearStepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  yearBtn: { width: 26, height: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  yearText: { fontSize: 13, fontWeight: '700' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  monthChip: {
    width: '23%',
    minHeight: 34,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthChipText: { fontSize: 12, fontWeight: '600' },
  tierBox: { padding: 12, borderWidth: 1, gap: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flexBtn: { flex: 1 },
});
