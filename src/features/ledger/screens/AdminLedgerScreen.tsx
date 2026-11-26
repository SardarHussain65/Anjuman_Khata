import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import { getKarachiCurrentMonthStart } from '@/core/dates';
import { useAppLanguage } from '@/core/i18n';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { ContributionRow } from '@/data/db/types';
import { runSync } from '@/data/sync/syncEngine';
import { findCurrentFiscalYear, getMonthsForFiscalYear } from '@/core/rules/fiscalYear';
import {
  computeMemberFiscalYearSummary,
  MemberFiscalYearSummary,
} from '@/core/rules/compliance';
import { PaymentSheetModal } from '@/features/payments/components/PaymentSheetModal';
import {
  LedgerMemberCard,
  LedgerTableView,
  LedgerViewMode,
  MemberYearSheet,
  ViewModeToggle,
} from '@/features/ledger/components/LedgerViews';

type LedgerFilter =
  | 'all'
  | 'not_meeting'
  | 'arrears'
  | 'unpaid_current'
  | 'non_earning'
  | string; // tier:<tierId>

export function AdminLedgerScreen() {
  const { colors, radius, typography, isDark } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const lang = useAppLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const [selectedFyId, setSelectedFyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [viewMode, setViewMode] = useState<LedgerViewMode>('cards');
  const [refreshing, setRefreshing] = useState(false);

  // Member 12-month breakdown sheet
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  // Payment / Edit modal state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMemberId, setSheetMemberId] = useState<string | undefined>(undefined);
  const [sheetPeriod, setSheetPeriod] = useState<string | undefined>(undefined);
  const [editingEntry, setEditingEntry] = useState<ContributionRow | null>(null);

  const currentMonth = getKarachiCurrentMonthStart();

  const activeFy = useMemo(() => {
    if (!data?.fiscalYears.length) return null;
    if (selectedFyId) {
      const found = data.fiscalYears.find((f) => f.id === selectedFyId);
      if (found) return found;
    }
    return findCurrentFiscalYear(data.fiscalYears);
  }, [data, selectedFyId]);

  const fyMonths = useMemo(
    () => (activeFy ? getMonthsForFiscalYear(activeFy) : []),
    [activeFy],
  );

  const allSummaries = useMemo<MemberFiscalYearSummary[]>(() => {
    if (!data || !activeFy) return [];
    return data.profiles.map((profile) =>
      computeMemberFiscalYearSummary({
        profile,
        fiscalYear: activeFy,
        contributions: data.contributions,
        memberTiers: data.memberTiers,
        tiers: data.tiers,
        tierRates: data.tierRates,
        currentMonthStart: currentMonth,
      }),
    );
  }, [data, activeFy, currentMonth]);

  const selectedSummary = useMemo(
    () => (selectedMemberId ? allSummaries.find((s) => s.member.id === selectedMemberId) ?? null : null),
    [allSummaries, selectedMemberId],
  );

  const filteredSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSummaries.filter((row) => {
      if (q) {
        const hay = `${row.member.member_no} ${row.member.full_name} ${row.member.full_name_ur ?? ''} ${row.member.designation ?? ''} ${row.member.tag ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === 'not_meeting') return row.isBelowMinimumCurrentCycle || row.arrearsTotal > 0;
      if (filter === 'arrears') return row.arrearsTotal > 0;
      if (filter === 'unpaid_current') return row.currentMonthCompliance?.status === 'unpaid';
      if (filter === 'non_earning') return row.member.status === 'non_earning';
      if (filter.startsWith('tier:')) {
        const tierId = filter.slice(5);
        return row.currentMonthCompliance?.effectiveTier?.tierId === tierId;
      }
      return true;
    });
  }, [allSummaries, search, filter]);

  const totals = useMemo(() => {
    const perMonth = fyMonths.map(() => 0);
    let collected = 0;
    let expected = 0;
    let arrears = 0;
    let belowMinCount = 0;

    for (const row of filteredSummaries) {
      collected += row.yearlyCharityTotal;
      expected += row.expectedTotalToDate;
      arrears += row.arrearsTotal;
      if (row.isBelowMinimumCurrentCycle || row.arrearsTotal > 0) belowMinCount += 1;
      row.months.forEach((m, idx) => {
        perMonth[idx] = (perMonth[idx] ?? 0) + m.paidAmount;
      });
    }
    return { perMonth, collected, expected, arrears, belowMinCount };
  }, [filteredSummaries, fyMonths]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await runSync();
    setRefreshing(false);
  };

  const openQuickCollect = (memberId?: string, periodStart?: string, entry?: ContributionRow | null) => {
    setSheetMemberId(memberId);
    setSheetPeriod(periodStart);
    setEditingEntry(entry ?? null);
    setSheetOpen(true);
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  const collectionPct =
    totals.expected > 0
      ? Math.min(100, Math.round((totals.collected / totals.expected) * 100))
      : totals.collected > 0
        ? 100
        : 0;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.gridScroll}
        contentContainerStyle={styles.gridScrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {/* Heritage Emerald Hero Card */}
        <LinearGradient
          colors={isDark ? ['#144536', '#0A271E'] : ['#0F5D46', '#083729']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, { borderRadius: radius.xl }]}
        >
          <View style={styles.topRowWithExport}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fyRow}>
              {(data?.fiscalYears ?? []).map((fy) => {
                const active = fy.id === activeFy?.id;
                return (
                  <Pressable
                    key={fy.id}
                    onPress={() => setSelectedFyId(fy.id)}
                    style={[
                      styles.fyPill,
                      {
                        backgroundColor: active ? '#FFFFFF' : 'rgba(255,255,255,0.14)',
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    {fy.status === 'closed' ? (
                      <Ionicons name="lock-closed" size={11} color={active ? '#0C503C' : '#E2F3EC'} />
                    ) : null}
                    <Text style={[styles.fyPillText, { color: active ? '#0C503C' : '#FFFFFF' }]}>
                      {fy.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(admin)/reports')}
              style={[styles.exportChip, { borderRadius: radius.pill }]}
            >
              <Ionicons name="document-text-outline" size={14} color="#F6E2B3" />
              <Text style={styles.exportChipText}>PDF</Text>
            </Pressable>
          </View>

          <View style={styles.heroMainRow}>
            <View>
              <Text style={styles.heroLabel}>{t('ledger.collected')}</Text>
              <Text style={[styles.heroBigNum, typography.numeric]}>
                {formatPKR(totals.collected)}
              </Text>
            </View>
            <View style={styles.pctBadge}>
              <Text style={[styles.pctText, typography.numeric]}>{collectionPct}%</Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${collectionPct}%` }]} />
          </View>

          <View style={styles.metricRow}>
            <Pressable
              onPress={() => setFilter('all')}
              style={styles.metricTile}
            >
              <Text style={styles.metricLabel}>{t('members.title')}</Text>
              <Text style={[styles.metricVal, typography.numeric]}>
                {allSummaries.length}
              </Text>
            </Pressable>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>{t('ledger.expected')}</Text>
              <Text style={[styles.metricVal, typography.numeric]}>
                {formatPKR(totals.expected)}
              </Text>
            </View>
            <Pressable
              style={styles.metricTile}
              onPress={() => setFilter(filter === 'arrears' ? 'all' : 'arrears')}
            >
              <Text style={styles.metricLabel}>{t('ledger.arrears')}</Text>
              <Text
                style={[
                  styles.metricVal,
                  typography.numeric,
                  { color: totals.arrears > 0 ? '#FCA5A5' : '#A7F3D0' },
                ]}
              >
                {formatPKR(totals.arrears)}
              </Text>
            </Pressable>
          </View>
        </LinearGradient>

        {/* Search + Labeled Cards / Table View Toggle */}
        <View style={styles.searchAndToggle}>
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

          <ViewModeToggle value={viewMode} onChange={setViewMode} lang={lang} />
        </View>

        {/* Filter Chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {[
            { key: 'all', label: `${t('common.all')} (${allSummaries.length})` },
            { key: 'not_meeting', label: `${t('ledger.filterNotMeeting')} (${totals.belowMinCount})` },
            { key: 'unpaid_current', label: t('ledger.filterUnpaidMonth') },
            { key: 'arrears', label: t('ledger.filterArrears') },
            { key: 'non_earning', label: t('memberStatus.non_earning') },
            ...(data?.tiers ?? []).map((tier) => ({
              key: `tier:${tier.id}`,
              label: lang === 'ur' && tier.name_ur ? tier.name_ur : tier.name,
            })),
          ].map((chip) => {
            const active = filter === chip.key;
            return (
              <Pressable
                key={chip.key}
                onPress={() => setFilter(chip.key)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[styles.filterChipText, { color: active ? '#FFFFFF' : colors.textSecondary }]}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Member List: Spacious Cards (Default) OR Upgraded Register Table */}
        {filteredSummaries.length === 0 ? (
          <EmptyState icon="grid-outline" />
        ) : viewMode === 'cards' ? (
          <View style={styles.cardsList}>
            {filteredSummaries.map((item) => (
              <LedgerMemberCard
                key={item.member.id}
                item={item}
                lang={lang}
                currentMonth={currentMonth}
                isAdmin
                onPress={() => setSelectedMemberId(item.member.id)}
                onQuickCollect={() => openQuickCollect(item.member.id, currentMonth, null)}
              />
            ))}
          </View>
        ) : (
          <LedgerTableView
            summaries={filteredSummaries}
            fyMonths={fyMonths}
            perMonthTotals={totals.perMonth}
            grandCollected={totals.collected}
            currentMonth={currentMonth}
            lang={lang}
            isAdmin
            onPressMember={(item) => setSelectedMemberId(item.member.id)}
            onPressCell={(item, cell) =>
              openQuickCollect(item.member.id, cell.periodStart, cell.entries[0] ?? null)
            }
          />
        )}
      </ScrollView>

      {/* Thumb-Zone Record Payment FAB */}
      <Pressable
        accessibilityRole="button"
        onPress={() => openQuickCollect(undefined, currentMonth, null)}
        style={[
          styles.fab,
          { backgroundColor: colors.primary, borderRadius: radius.pill },
        ]}
      >
        <Ionicons name="add" size={24} color="#FFFFFF" />
        <Text style={styles.fabText}>{t('ledger.recordPayment')}</Text>
      </Pressable>

      {/* Interactive 12-Month Breakdown Sheet (tap any month to collect/edit) */}
      <MemberYearSheet
        summary={selectedSummary}
        fiscalYearLabel={activeFy?.label}
        currentMonth={currentMonth}
        lang={lang}
        isAdmin
        onClose={() => setSelectedMemberId(null)}
        onPressMonth={(summary, cell) => {
          setSelectedMemberId(null);
          openQuickCollect(summary.member.id, cell.periodStart, cell.entries[0] ?? null);
        }}
        onQuickCollect={(summary) => {
          setSelectedMemberId(null);
          openQuickCollect(summary.member.id, currentMonth, null);
        }}
      />

      <PaymentSheetModal
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        fiscalYear={activeFy}
        profiles={data?.profiles ?? []}
        tiers={data?.tiers ?? []}
        tierRates={data?.tierRates ?? []}
        memberTiers={data?.memberTiers ?? []}
        fiscalYears={data?.fiscalYears ?? []}
        initialMemberId={sheetMemberId}
        initialPeriodStart={sheetPeriod}
        editingContribution={editingEntry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  gridScroll: { flex: 1 },
  gridScrollContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 104,
    gap: 12,
  },
  heroCard: {
    padding: 16,
    gap: 10,
    elevation: 4,
    shadowColor: '#0C503C',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  topRowWithExport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exportChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  exportChipText: { fontSize: 12, fontWeight: '700', color: '#F6E2B3' },
  fyRow: { gap: 6, flexGrow: 1 },
  fyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  fyPillText: { fontSize: 12, fontWeight: '800' },
  heroMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  heroLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.78)' },
  heroBigNum: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', marginTop: 1 },
  pctBadge: {
    backgroundColor: 'rgba(229, 185, 92, 0.22)',
    borderColor: 'rgba(229, 185, 92, 0.5)',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pctText: { color: '#F6E2B3', fontSize: 12, fontWeight: '800' },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#E5B95C',
  },
  metricRow: { flexDirection: 'row', gap: 8 },
  metricTile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  metricLabel: { fontSize: 10.5, fontWeight: '600', color: 'rgba(255,255,255,0.74)' },
  metricVal: { fontSize: 13.5, fontWeight: '800', color: '#FFFFFF' },
  searchAndToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  filterRow: { gap: 7 },
  filterChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 12, fontWeight: '700' },
  cardsList: { gap: 10 },
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
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
