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
import { formatDateShort, formatMonthShort, getKarachiCurrentMonthStart, getKarachiToday } from '@/core/dates';
import { formatPKR } from '@/core/money';
import { useAppLanguage } from '@/core/i18n';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { Card } from '@/core/ui/Card';
import { TextField } from '@/core/ui/TextField';
import { MemberTierRow, ProfileRow, TierRow } from '@/data/db/types';
import { localInsert } from '@/data/sync/syncEngine';
import { getMemberTierHistory } from '@/core/rules/tiers';
import { useAuthStore } from '@/features/auth/store/authStore';

interface TierAssignmentModalProps {
  visible: boolean;
  onClose: () => void;
  member: ProfileRow | null;
  tiers: TierRow[];
  memberTiers: MemberTierRow[];
}

export function TierAssignmentModal(props: TierAssignmentModalProps) {
  if (!props.visible || !props.member) return null;
  return <TierAssignmentModalInner key={props.member.id} {...props} member={props.member} />;
}

function TierAssignmentModalInner({
  visible,
  onClose,
  member,
  tiers,
  memberTiers,
}: TierAssignmentModalProps & { member: ProfileRow }) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const lang = useAppLanguage();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const today = getKarachiToday();
  const currentYear = Number.parseInt(today.slice(0, 4), 10);
  const currentMonthStart = getKarachiCurrentMonthStart();
  const yearStart = `${currentYear}-01-01`;

  const history = useMemo(() => {
    return getMemberTierHistory(member.id, memberTiers, tiers);
  }, [member, memberTiers, tiers]);

  const [selectedTierId, setSelectedTierId] = useState<string>(tiers[0]?.id ?? '');
  const [startYear, setStartYear] = useState(currentYear);
  const [effectiveFrom, setEffectiveFrom] = useState(
    history.length === 0 ? yearStart : currentMonthStart,
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const monthOptions = Array.from({ length: 12 }, (_, idx) => {
    const mm = String(idx + 1).padStart(2, '0');
    return `${startYear}-${mm}-01`;
  });

  const handleAssign = async () => {
    if (saving || !selectedTierId) return;
    setSaving(true);
    try {
      await localInsert(
        'member_tiers',
        {
          member_id: member.id,
          tier_id: selectedTierId,
          effective_from: effectiveFrom,
          reason: reason.trim() || null,
        },
        { actorId: adminId },
      );
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
            { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('members.assignTier')} · #{member.member_no}
            </Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 20, 36) }]}>
            <Text style={[styles.memberName, { color: colors.text }]}>{member.full_name}</Text>

            <View style={styles.tierRow}>
              {tiers.map((tier) => {
                const active = selectedTierId === tier.id;
                return (
                  <Pressable
                    key={tier.id}
                    onPress={() => setSelectedTierId(tier.id)}
                    style={[
                      styles.tierChip,
                      {
                        backgroundColor: active ? colors.primary : colors.surface,
                        borderColor: active ? colors.primary : colors.borderStrong,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <Text style={[styles.tierChipText, { color: active ? '#FFFFFF' : colors.text }]}>
                      {lang === 'ur' && tier.name_ur ? tier.name_ur : tier.name}
                    </Text>
                    <Text style={[styles.tierMin, { color: active ? '#E6F4F0' : colors.textSecondary }]}>
                      {formatPKR(tier.min_amount)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.monthHeaderRow}>
              <Text style={[styles.label, { color: colors.text }]}>{t('members.effectiveFrom')}</Text>
              <View style={styles.yearStepper}>
                <Pressable
                  onPress={() => {
                    const nextYr = startYear - 1;
                    setStartYear(nextYr);
                    setEffectiveFrom(`${nextYr}-${effectiveFrom.slice(5, 7)}-01`);
                  }}
                  style={[styles.yearBtn, { borderColor: colors.borderStrong, backgroundColor: colors.surface, borderRadius: radius.sm }]}
                >
                  <Ionicons name="chevron-back" size={14} color={colors.text} />
                </Pressable>
                <Text style={[styles.yearText, { color: colors.text }]}>{startYear}</Text>
                <Pressable
                  onPress={() => {
                    const nextYr = startYear + 1;
                    setStartYear(nextYr);
                    setEffectiveFrom(`${nextYr}-${effectiveFrom.slice(5, 7)}-01`);
                  }}
                  style={[styles.yearBtn, { borderColor: colors.borderStrong, backgroundColor: colors.surface, borderRadius: radius.sm }]}
                >
                  <Ionicons name="chevron-forward" size={14} color={colors.text} />
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
                        borderColor: active ? colors.primary : colors.borderStrong,
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

            <TextField
              label={`${t('common.reason')} (${t('common.optional')})`}
              value={reason}
              onChangeText={setReason}
              placeholder="Business expansion / Request"
            />

            <Button label={t('members.assignTier')} loading={saving} onPress={handleAssign} />

            <Text style={[styles.historyTitle, { color: colors.text }]}>
              {t('members.tierHistory')} ({history.length})
            </Text>

            {history.length === 0 ? (
              <Card>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {t('common.emptySubtitle')}
                </Text>
              </Card>
            ) : (
              history.map((item) => (
                <Card key={item.id} style={styles.histCard}>
                  <Text style={[styles.histTier, { color: colors.text }]}>
                    {lang === 'ur' && item.tierNameUr ? item.tierNameUr : item.tierName}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {t('members.effectiveFrom')}: {formatDateShort(item.effective_from, lang)}
                  </Text>
                  {item.reason ? (
                    <Text style={[styles.meta, { color: colors.textMuted }]}>{item.reason}</Text>
                  ) : null}
                </Card>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%' },
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
  memberName: { fontSize: 16, fontWeight: '700' },
  tierRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tierChip: {
    flex: 1,
    minWidth: 130,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  tierChipText: { fontSize: 13, fontWeight: '700' },
  tierMin: { fontSize: 12, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600' },
  monthHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  yearStepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  yearBtn: { width: 26, height: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  yearText: { fontSize: 13, fontWeight: '700' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  monthChip: {
    width: '23%',
    minHeight: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthChipText: { fontSize: 12, fontWeight: '600' },
  historyTitle: { fontSize: 15, fontWeight: '700', marginTop: 8 },
  histCard: { gap: 2 },
  histTier: { fontSize: 14, fontWeight: '700' },
  meta: { fontSize: 12 },
});
