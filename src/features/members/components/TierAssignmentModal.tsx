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
import { formatDateShort, getKarachiToday } from '@/core/dates';
import { formatPKR } from '@/core/money';
import { getCurrentLanguage } from '@/core/i18n';
import { Button } from '@/core/ui/Button';
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
  const lang = getCurrentLanguage();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const [selectedTierId, setSelectedTierId] = useState<string>(tiers[0]?.id ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(getKarachiToday());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const history = useMemo(() => {
    return getMemberTierHistory(member.id, memberTiers, tiers);
  }, [member, memberTiers, tiers]);

  const handleAssign = async () => {
    if (!selectedTierId) return;
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

          <ScrollView contentContainerStyle={styles.body}>
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

            <TextField
              label={t('members.effectiveFrom')}
              value={effectiveFrom}
              onChangeText={setEffectiveFrom}
              placeholder="YYYY-MM-DD"
              helperText="Non-retroactive: past months keep their historical tier."
            />

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
  historyTitle: { fontSize: 15, fontWeight: '700', marginTop: 8 },
  histCard: { gap: 2 },
  histTier: { fontSize: 14, fontWeight: '700' },
  meta: { fontSize: 12 },
});
