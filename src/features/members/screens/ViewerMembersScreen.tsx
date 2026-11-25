import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import { formatMonthShort, getKarachiCurrentMonthStart } from '@/core/dates';
import { useAppLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { ComplianceBadge } from '@/core/ui/Badge';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { MemberStatus, ProfileRow } from '@/data/db/types';
import { runSync } from '@/data/sync/syncEngine';
import { findCurrentFiscalYear } from '@/core/rules/fiscalYear';
import {
  computeLifetimeCharityTotal,
  computeMemberFiscalYearSummary,
} from '@/core/rules/compliance';
import { resolveEffectiveTierForMonth } from '@/core/rules/tiers';

/** Passwordless Read-Only Community Member Directory & Detail Inspector. */
export function ViewerMembersScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const lang = useAppLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MemberStatus>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMember, setSelectedMember] = useState<ProfileRow | null>(null);
  const currentMonth = getKarachiCurrentMonthStart();

  const activeFy = useMemo(
    () => (data ? findCurrentFiscalYear(data.fiscalYears) : null),
    [data],
  );

  const counts = useMemo(() => {
    const profiles = data?.profiles ?? [];
    return {
      total: profiles.length,
      active: profiles.filter((p) => p.status === 'active').length,
      voluntary: profiles.filter((p) => p.status === 'non_earning').length,
      inactive: profiles.filter((p) => p.status === 'inactive').length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.profiles ?? []).filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${p.member_no} ${p.full_name} ${p.full_name_ur ?? ''} ${p.designation ?? ''} ${p.tag ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, search, statusFilter]);

  const selectedSummary = useMemo(() => {
    if (!selectedMember || !data || !activeFy) return null;
    return computeMemberFiscalYearSummary({
      profile: selectedMember,
      fiscalYear: activeFy,
      contributions: data.contributions,
      memberTiers: data.memberTiers,
      tiers: data.tiers,
      tierRates: data.tierRates,
      currentMonthStart: currentMonth,
    });
  }, [selectedMember, data, activeFy, currentMonth]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await runSync();
    setRefreshing(false);
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlashList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {/* Directory Stats Strip */}
            <View style={styles.statsStrip}>
              <Card style={styles.statBox}>
                <Text style={[styles.statNum, typography.numeric, { color: colors.text }]}>
                  {counts.total}
                </Text>
                <Text style={[styles.statLbl, { color: colors.textSecondary }]}>{t('common.all')}</Text>
              </Card>
              <Card variant="charity" style={styles.statBox}>
                <Text style={[styles.statNum, typography.numeric, { color: colors.primary }]}>
                  {counts.active}
                </Text>
                <Text style={[styles.statLbl, { color: colors.primary }]}>{t('memberStatus.active')}</Text>
              </Card>
              <Card style={styles.statBox}>
                <Text style={[styles.statNum, typography.numeric, { color: colors.text }]}>
                  {counts.voluntary}
                </Text>
                <Text style={[styles.statLbl, { color: colors.textSecondary }]}>
                  {t('memberStatus.non_earning')}
                </Text>
              </Card>
            </View>

            {/* Search Bar */}
            <View
              style={[
                styles.searchBox,
                { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg },
              ]}
            >
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t('ledger.searchPlaceholder')}
                placeholderTextColor={colors.textMuted}
                style={[styles.searchInput, { color: colors.text }]}
              />
              {search ? (
                <Pressable onPress={() => setSearch('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={17} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            {/* Status Filter Pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {(['all', 'active', 'non_earning', 'inactive'] as const).map((st) => {
                const active = statusFilter === st;
                return (
                  <Pressable
                    key={st}
                    onPress={() => setStatusFilter(st)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active ? colors.primary : colors.surface,
                        borderColor: active ? colors.primary : colors.border,
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Text style={[styles.filterText, { color: active ? '#FFFFFF' : colors.textSecondary }]}>
                      {st === 'all' ? t('common.all') : t(`memberStatus.${st}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="people-outline" />}
        renderItem={({ item }) => {
          const eff = resolveEffectiveTierForMonth(
            item.id,
            currentMonth,
            data?.memberTiers ?? [],
            data?.tiers ?? [],
            data?.tierRates ?? [],
          );
          const lifetime = computeLifetimeCharityTotal(item.id, data?.contributions ?? []);
          const displayName = lang === 'ur' && item.full_name_ur ? item.full_name_ur : item.full_name;
          return (
            <Pressable
              onPress={() => setSelectedMember(item)}
              style={({ pressed }) => [pressed && { opacity: 0.92 }]}
            >
              <Card style={styles.memberCard}>
                <View style={styles.rowBetween}>
                  <View
                    style={[
                      styles.avatarCircle,
                      {
                        backgroundColor:
                          item.status === 'active' ? colors.primarySoft : colors.surfaceSubtle,
                        borderColor:
                          item.status === 'active' ? colors.primaryBorder : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.avatarText,
                        typography.numeric,
                        { color: item.status === 'active' ? colors.primary : colors.textSecondary },
                      ]}
                    >
                      #{item.member_no}
                    </Text>
                  </View>
                  <View style={styles.flex1}>
                    <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {item.designation ? `${item.designation} · ` : ''}
                      {t(`memberStatus.${item.status}`)}
                    </Text>
                    <View
                      style={[
                        styles.tierPill,
                        { backgroundColor: colors.primarySoft, borderRadius: radius.pill },
                      ]}
                    >
                      <Text style={[styles.tierMeta, { color: colors.primary }]} numberOfLines={1}>
                        {item.status === 'non_earning'
                          ? t('dashboard.noTierExempt')
                          : eff
                            ? `${lang === 'ur' && eff.tierNameUr ? eff.tierNameUr : eff.tierName} · ${formatPKR(eff.minAmount)}/mo`
                            : t('dashboard.noTierExempt')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.rightCol}>
                    <Text style={[styles.lifetimeVal, typography.numeric, { color: colors.primary }]}>
                      {formatPKR(lifetime)}
                    </Text>
                    <View style={styles.chevronRow}>
                      <Text style={[styles.meta, { color: colors.textMuted }]}>{t('common.total')}</Text>
                      <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                    </View>
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />

      {/* Read-Only Member 12-Month Record Modal */}
      <Modal
        visible={Boolean(selectedMember)}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedMember(null)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.flex1}>
                <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                  #{selectedMember?.member_no} · {selectedMember?.full_name}
                </Text>
                {selectedMember?.designation ? (
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {selectedMember.designation}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => setSelectedMember(null)} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.sheetBody, { paddingBottom: Math.max(insets.bottom + 20, 36) }]}>
              {selectedSummary ? (
                <>
                  <Card variant="charity" style={{ gap: 6 }}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.meta, { color: colors.primary }]}>
                        {activeFy?.label} {t('ledger.collected')}
                      </Text>
                      {selectedSummary.currentMonthCompliance ? (
                        <ComplianceBadge status={selectedSummary.currentMonthCompliance.status} compact />
                      ) : null}
                    </View>
                    <Text style={[styles.heroAmt, typography.numeric, { color: colors.text }]}>
                      {formatPKR(selectedSummary.yearlyCharityTotal)}
                    </Text>
                  </Card>

                  <View style={styles.monthGrid}>
                    {selectedSummary.months.map((cell) => {
                      const bg =
                        cell.status === 'met'
                          ? colors.metBg
                          : cell.status === 'short'
                            ? colors.shortBg
                            : cell.status === 'unpaid'
                              ? colors.unpaidBg
                              : colors.surfaceSubtle;
                      const fg =
                        cell.status === 'met'
                          ? colors.metText
                          : cell.status === 'short'
                            ? colors.shortText
                            : cell.status === 'unpaid'
                              ? colors.unpaidText
                              : colors.textMuted;
                      return (
                        <View
                          key={cell.periodStart}
                          style={[styles.monthTile, { backgroundColor: bg, borderRadius: radius.md }]}
                        >
                          <Text style={[styles.meta, { color: fg, fontWeight: '700' }]}>
                            {formatMonthShort(cell.periodStart, lang)}
                          </Text>
                          <Text style={[styles.tileAmt, typography.numeric, { color: fg }]}>
                            {cell.paidAmount > 0 ? formatPKR(cell.paidAmount) : '—'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerBlock: { gap: 10, marginBottom: 12 },
  statsStrip: { flexDirection: 'row', gap: 8 },
  statBox: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, gap: 2 },
  statNum: { fontSize: 18, fontWeight: '800' },
  statLbl: { fontSize: 11, fontWeight: '600' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  filterRow: { gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1 },
  filterText: { fontSize: 12, fontWeight: '700' },
  list: { padding: 14, paddingBottom: 28 },
  memberCard: { marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '800' },
  flex1: { flex: 1, gap: 2 },
  memberName: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12 },
  tierPill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  tierMeta: { fontSize: 11, fontWeight: '700' },
  rightCol: { alignItems: 'flex-end', gap: 2 },
  chevronRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  lifetimeVal: { fontSize: 15, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%' },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    gap: 10,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  closeBtn: { padding: 6 },
  sheetBody: { padding: 16, gap: 14 },
  heroAmt: { fontSize: 24, fontWeight: '800' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthTile: { width: '31.3%', paddingVertical: 11, paddingHorizontal: 6, alignItems: 'center', gap: 3 },
  tileAmt: { fontSize: 12, fontWeight: '800' },
});
