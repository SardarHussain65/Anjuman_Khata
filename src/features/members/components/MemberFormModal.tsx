import React, { useState } from 'react';
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
import { getKarachiToday } from '@/core/dates';
import { parsePKR } from '@/core/money';
import { getCurrentLanguage } from '@/core/i18n';
import { Button } from '@/core/ui/Button';
import { TextField } from '@/core/ui/TextField';
import { MemberStatus, ProfileRow, TierRow } from '@/data/db/types';
import { invokeAdminCreateMember } from '@/data/api/adminEdge';
import { localInsert, localUpdate } from '@/data/sync/syncEngine';
import { getLocalDb, notifyTablesChanged } from '@/data/db/database';
import { upsertServerRow } from '@/data/sync/sqliteSerializer';
import { useSyncStatusStore } from '@/data/sync/statusStore';
import { useAuthStore } from '@/features/auth/store/authStore';

interface MemberFormModalProps {
  visible: boolean;
  onClose: () => void;
  editingMember?: ProfileRow | null;
  tiers: TierRow[];
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
  nextMemberNo,
}: MemberFormModalProps) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const lang = getCurrentLanguage();
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const isEdit = Boolean(editingMember);
  const [memberNo, setMemberNo] = useState(
    editingMember ? String(editingMember.member_no) : String(nextMemberNo),
  );
  const [fullName, setFullName] = useState(editingMember?.full_name ?? '');
  const [fullNameUr, setFullNameUr] = useState(editingMember?.full_name_ur ?? '');
  const [phone, setPhone] = useState(editingMember?.phone ?? '');
  const [designation, setDesignation] = useState(editingMember?.designation ?? '');
  const [tag, setTag] = useState(editingMember?.tag ?? '');
  const [status, setStatus] = useState<MemberStatus>(editingMember?.status ?? 'active');
  const [role, setRole] = useState<'user' | 'admin'>(editingMember?.role ?? 'user');
  const [pledge, setPledge] = useState(
    editingMember?.personal_pledge ? String(editingMember.personal_pledge) : '',
  );
  const [notes, setNotes] = useState(editingMember?.notes ?? '');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [tierId, setTierId] = useState<string>(tiers[0]?.id ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(getKarachiToday());
  const [saving, setSaving] = useState(false);

  const isActivatingFromNonEarning =
    isEdit && editingMember?.status === 'non_earning' && status === 'active';
  const showTierAssignment =
    (!isEdit && status === 'active') || isActivatingFromNonEarning;

  const handleSave = async () => {
    const parsedNo = Number.parseInt(memberNo, 10);
    if (!fullName.trim() || !Number.isInteger(parsedNo) || parsedNo <= 0) {
      Alert.alert(t('common.required'), `${t('members.memberNo')} & ${t('members.fullName')}`);
      return;
    }

    if (showTierAssignment && !tierId) {
      Alert.alert(t('common.required'), t('members.activateRequiresTier'));
      return;
    }

    const parsedPledge = pledge.trim() ? parsePKR(pledge) : null;
    if (pledge.trim() && (!parsedPledge || parsedPledge <= 0)) {
      Alert.alert(t('common.required'), t('members.personalPledge'));
      return;
    }

    setSaving(true);
    try {
      if (isEdit && editingMember) {
        await localUpdate(
          'profiles',
          editingMember.id,
          {
            member_no: parsedNo,
            full_name: fullName.trim(),
            full_name_ur: fullNameUr.trim() || null,
            phone: phone.trim() || null,
            designation: designation.trim() || null,
            tag: tag.trim() || null,
            status,
            role,
            personal_pledge: parsedPledge,
            notes: notes.trim() || null,
          },
          { actorId: adminId },
        );

        // Rule 3.2: non_earning -> active requires assigning a tier with effective_from
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
      } else if (role === 'admin') {
        if (!isOnline) {
          Alert.alert(t('common.offline'), 'Creating a new Admin login account requires internet.');
          setSaving(false);
          return;
        }
        if (!email.trim() || password.trim().length < 6) {
          Alert.alert(t('common.required'), 'Admin accounts require an email and password (min 6 chars).');
          setSaving(false);
          return;
        }
        // Admin account creation via verified Edge Function (Auth user + admin profile atomically)
        const res = await invokeAdminCreateMember({
          email: email.trim(),
          password: password.trim(),
          member_no: parsedNo,
          full_name: fullName.trim(),
          full_name_ur: fullNameUr.trim() || null,
          phone: phone.trim() || null,
          designation: designation.trim() || null,
          tag: tag.trim() || null,
          status,
          role: 'admin',
          personal_pledge: parsedPledge,
          joined_on: getKarachiToday(),
          notes: notes.trim() || null,
          tier_id: status === 'active' ? tierId : null,
          effective_from: status === 'active' ? effectiveFrom : null,
        });

        const db = await getLocalDb();
        await db.withTransaction(async () => {
          await upsertServerRow(db, 'profiles', res.profile as unknown as Record<string, unknown>);
          if (res.member_tier) {
            await upsertServerRow(
              db,
              'member_tiers',
              res.member_tier as unknown as Record<string, unknown>,
            );
          }
        });
        notifyTablesChanged(['profiles', 'member_tiers']);
      } else {
        // Normal community member: NO email/password/auth account needed! Works 100% offline & online.
        const created = await localInsert(
          'profiles',
          {
            member_no: parsedNo,
            full_name: fullName.trim(),
            full_name_ur: fullNameUr.trim() || null,
            phone: phone.trim() || null,
            designation: designation.trim() || null,
            tag: tag.trim() || null,
            status,
            role: 'user',
            personal_pledge: parsedPledge,
            joined_on: getKarachiToday(),
            notes: notes.trim() || null,
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
      Alert.alert(t('common.errorGeneric'), err instanceof Error ? err.message : undefined);
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

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {!isEdit && !isOnline ? (
              <View style={[styles.notice, { backgroundColor: colors.warningSoft, borderRadius: radius.md }]}>
                <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
                <Text style={[styles.noticeText, { color: colors.shortText }]}>
                  {t('members.offlineCreateNotice')}
                </Text>
              </View>
            ) : null}

            <TextField
              label={t('members.memberNo')}
              keyboardType="number-pad"
              value={memberNo}
              onChangeText={setMemberNo}
            />
            <TextField
              label={t('members.fullName')}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Muhammad Tariq"
            />
            <TextField
              label={`${t('members.fullNameUr')} (${t('common.optional')})`}
              value={fullNameUr}
              onChangeText={setFullNameUr}
              placeholder="محمد طارق"
            />
            <TextField
              label={`${t('members.phone')} (${t('common.optional')})`}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <TextField
              label={`${t('members.designation')} (${t('common.optional')})`}
              value={designation}
              onChangeText={setDesignation}
              placeholder="Army / Navy / Teacher / Engineer"
            />
            <TextField
              label={`${t('members.tag')} (${t('common.optional')})`}
              value={tag}
              onChangeText={setTag}
              placeholder="Committee / Founder / Special"
            />

            {/* Status Switcher */}
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

            {/* Tier assignment (hidden when non_earning; required when activating!) */}
            {showTierAssignment ? (
              <View style={[styles.tierBox, { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder, borderRadius: radius.md }]}>
                <Text style={[styles.label, { color: colors.primary }]}>
                  {isActivatingFromNonEarning
                    ? t('members.activateRequiresTier')
                    : t('members.assignTier')}
                </Text>
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
                <TextField
                  label={t('members.effectiveFrom')}
                  value={effectiveFrom}
                  onChangeText={setEffectiveFrom}
                  placeholder="YYYY-MM-DD"
                />
              </View>
            ) : null}

            {/* Role selector (prevent admin from accidentally demoting themselves) */}
            <View style={styles.group}>
              <Text style={[styles.label, { color: colors.text }]}>Role</Text>
              <View style={styles.row}>
                {(['user', 'admin'] as const).map((r) => {
                  const active = role === r;
                  const isSelfDemote = isEdit && editingMember?.id === adminId && r === 'user';
                  return (
                    <Pressable
                      key={r}
                      disabled={isSelfDemote}
                      onPress={() => setRole(r)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.surface,
                          borderColor: active ? colors.primary : colors.borderStrong,
                          borderRadius: radius.md,
                          opacity: isSelfDemote ? 0.45 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.text }]}>
                        {r === 'admin' ? 'Admin' : 'Member (Read-Only)'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {isEdit && editingMember?.id === adminId ? (
                <Text style={[styles.helper, { color: colors.textMuted }]}>
                  You cannot remove your own admin role.
                </Text>
              ) : null}
            </View>

            <TextField
              label={`${t('members.personalPledge')} (${t('common.optional')})`}
              keyboardType="number-pad"
              value={pledge}
              onChangeText={setPledge}
              placeholder="1000"
            />

            {!isEdit && role === 'admin' ? (
              <>
                <TextField
                  label={t('auth.email')}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="admin@example.com"
                />
                <TextField
                  label={t('auth.password')}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Min 6 characters"
                />
              </>
            ) : null}

            <TextField
              label={`${t('common.remark')} (${t('common.optional')})`}
              value={notes}
              onChangeText={setNotes}
            />

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
  sheet: { maxHeight: '92%' },
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
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  noticeText: { flex: 1, fontSize: 12, fontWeight: '600' },
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
  tierBox: { padding: 12, borderWidth: 1, gap: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  flexBtn: { flex: 1 },
});
