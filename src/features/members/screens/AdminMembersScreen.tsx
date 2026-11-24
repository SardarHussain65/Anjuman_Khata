import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import { getKarachiCurrentMonthStart } from '@/core/dates';
import { useAppLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { TextField } from '@/core/ui/TextField';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { MemberStatus, ProfileRow } from '@/data/db/types';
import { resolveEffectiveTierForMonth } from '@/core/rules/tiers';
import { invokeAdminResetPassword } from '@/data/api/adminEdge';
import { useSyncStatusStore } from '@/data/sync/statusStore';
import { MemberFormModal } from '../components/MemberFormModal';
import { TierAssignmentModal } from '../components/TierAssignmentModal';

export function AdminMembersScreen() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const lang = useAppLanguage();
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const { data, isLoading } = useRegisterSnapshot();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MemberStatus>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<ProfileRow | null>(null);
  const [tierMember, setTierMember] = useState<ProfileRow | null>(null);
  const [resetMember, setResetMember] = useState<ProfileRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const currentMonth = getKarachiCurrentMonthStart();

  const nextMemberNo = useMemo(() => {
    const maxNo = (data?.profiles ?? []).reduce((m, p) => Math.max(m, p.member_no), 0);
    return maxNo + 1;
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.profiles ?? []).filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${p.member_no} ${p.full_name} ${p.full_name_ur ?? ''} ${p.phone ?? ''} ${p.designation ?? ''} ${p.tag ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, search, statusFilter]);

  const handleResetPassword = async () => {
    if (!resetMember || newPassword.length < 6) {
      Alert.alert(t('common.required'), 'Password must be at least 6 characters.');
      return;
    }
    if (!isOnline) {
      Alert.alert(t('common.offline'), 'Password reset requires an internet connection.');
      return;
    }
    setResetBusy(true);
    try {
      await invokeAdminResetPassword(resetMember.id, newPassword);
      Alert.alert(t('common.confirm'), 'Password updated.');
      setResetMember(null);
      setNewPassword('');
    } catch (err) {
      Alert.alert(t('common.errorGeneric'), err instanceof Error ? err.message : undefined);
    } finally {
      setResetBusy(false);
    }
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.controls, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radius.md }]}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('ledger.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
        <View style={styles.filterRow}>
          {(['all', 'active', 'non_earning', 'inactive'] as const).map((st) => {
            const active = statusFilter === st;
            return (
              <Pressable
                key={st}
                onPress={() => setStatusFilter(st)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.primarySoft : colors.background,
                    borderColor: active ? colors.primary : colors.border,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[styles.filterText, { color: active ? colors.primary : colors.textSecondary }]}>
                  {st === 'all' ? t('common.all') : t(`memberStatus.${st}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlashList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState icon="people-outline" />}
        renderItem={({ item }) => {
          const eff = resolveEffectiveTierForMonth(
            item.id,
            currentMonth,
            data?.memberTiers ?? [],
            data?.tiers ?? [],
            data?.tierRates ?? [],
          );
          const displayName =
            lang === 'ur' && item.full_name_ur ? item.full_name_ur : item.full_name;
          return (
            <Card style={styles.memberCard}>
              <View style={styles.cardTop}>
                <View style={styles.cardInfo}>
                  <Text style={[styles.memberName, { color: colors.text }]}>
                    #{item.member_no} · {displayName}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {item.designation ? `${item.designation} · ` : ''}
                    {t(`memberStatus.${item.status}`)}
                    {item.role === 'admin' ? ' · Admin' : ''}
                  </Text>
                  <Text style={[styles.tierMeta, { color: colors.primary }]}>
                    {item.status === 'non_earning'
                      ? t('dashboard.noTierExempt')
                      : eff
                        ? `${lang === 'ur' && eff.tierNameUr ? eff.tierNameUr : eff.tierName} (${formatPKR(eff.minAmount)}/mo)`
                        : t('dashboard.noTierExempt')}
                  </Text>
                </View>
                {item.tag ? (
                  <View style={[styles.tagChip, { backgroundColor: colors.surfaceSubtle, borderRadius: radius.pill }]}>
                    <Text style={[styles.tagText, { color: colors.textSecondary }]}>{item.tag}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.cardActions}>
                <Pressable
                  onPress={() => {
                    setEditingMember(item);
                    setFormOpen(true);
                  }}
                  style={[styles.miniBtn, { borderColor: colors.borderStrong, borderRadius: radius.sm }]}
                >
                  <Ionicons name="create-outline" size={14} color={colors.text} />
                  <Text style={[styles.miniBtnText, { color: colors.text }]}>{t('common.edit')}</Text>
                </Pressable>

                {item.status !== 'non_earning' ? (
                  <Pressable
                    onPress={() => setTierMember(item)}
                    style={[styles.miniBtn, { borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft, borderRadius: radius.sm }]}
                  >
                    <Ionicons name="layers-outline" size={14} color={colors.primary} />
                    <Text style={[styles.miniBtnText, { color: colors.primary }]}>{t('members.assignTier')}</Text>
                  </Pressable>
                ) : null}

                {item.role === 'admin' ? (
                  <Pressable
                    onPress={() => {
                      setResetMember(item);
                      setNewPassword('');
                    }}
                    style={[styles.miniBtn, { borderColor: colors.border, borderRadius: radius.sm }]}
                  >
                    <Ionicons name="key-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.miniBtnText, { color: colors.textSecondary }]}>{t('members.resetPassword')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          );
        }}
      />

      <Pressable
        onPress={() => {
          setEditingMember(null);
          setFormOpen(true);
        }}
        style={[styles.fab, { backgroundColor: colors.primary, borderRadius: radius.pill }]}
      >
        <Ionicons name="person-add" size={20} color="#FFFFFF" />
        <Text style={styles.fabText}>{t('members.addMember')}</Text>
      </Pressable>

      <MemberFormModal
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        editingMember={editingMember}
        tiers={data?.tiers ?? []}
        nextMemberNo={nextMemberNo}
      />

      <TierAssignmentModal
        visible={Boolean(tierMember)}
        onClose={() => setTierMember(null)}
        member={tierMember}
        tiers={data?.tiers ?? []}
        memberTiers={data?.memberTiers ?? []}
      />

      {/* Reset Password Modal */}
      <Modal
        visible={Boolean(resetMember)}
        transparent
        animationType="fade"
        onRequestClose={() => setResetMember(null)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.resetCard}>
            <Text style={[styles.memberName, { color: colors.text }]}>
              {t('members.resetPassword')} · #{resetMember?.member_no}
            </Text>
            <TextField
              label={t('auth.password')}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Min 6 characters"
            />
            <View style={styles.cardActions}>
              <Button label={t('common.cancel')} variant="secondary" onPress={() => setResetMember(null)} style={styles.flexBtn} />
              <Button label={t('common.save')} loading={resetBusy} onPress={handleResetPassword} style={styles.flexBtn} />
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { padding: 12, gap: 8, borderBottomWidth: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 42,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
  filterText: { fontSize: 12, fontWeight: '600' },
  list: { padding: 14, paddingBottom: 90 },
  memberCard: { marginBottom: 10, gap: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardInfo: { flex: 1, gap: 2 },
  memberName: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12 },
  tierMeta: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  tagChip: { paddingHorizontal: 8, paddingVertical: 4 },
  tagText: { fontSize: 11, fontWeight: '600' },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  miniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    minHeight: 36,
  },
  miniBtnText: { fontSize: 12, fontWeight: '600' },
  fab: {
    position: 'absolute',
    end: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    minHeight: 52,
    elevation: 4,
  },
  fabText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  resetCard: { gap: 12 },
  flexBtn: { flex: 1 },
});
