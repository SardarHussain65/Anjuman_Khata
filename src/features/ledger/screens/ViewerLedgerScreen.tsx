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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import {
  formatDateShort,
  formatMonthYear,
  getKarachiCurrentMonthStart,
} from '@/core/dates';
import { useAppLanguage } from '@/core/i18n';
import { ComplianceBadge } from '@/core/ui/Badge';
import { Card } from '@/core/ui/Card';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { runSync } from '@/data/sync/syncEngine';
import { findCurrentFiscalYear, getMonthsForFiscalYear } from '@/core/rules/fiscalYear';
import {
  computeMemberFiscalYearSummary,
  MemberFiscalYearSummary,
  MonthComplianceResult,
} from '@/core/rules/compliance';
import {
  LedgerMemberCard,
  LedgerTableView,
  LedgerViewMode,
  MemberYearSheet,
  ViewModeToggle,
} from '@/features/ledger/components/LedgerViews';

type ViewerFilter = 'all' | 'paid' | 'arrears' | 'non_earning';

/**
 * Passwordless Read-Only Community Home & Contribution Register.
 * Defaults to a clean, scannable mobile card view with a 12-month visual strip per member
 * and tap-to-inspect full year breakdown, plus a labeled 1-tap toggle to the upgraded table.
 */
export function ViewerLedgerScreen() {
  const { colors, radius, typography, isDark } = useTheme();
  const { t } = useTranslation();
  const lang = useAppLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const [selectedFyId, setSelectedFyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ViewerFilter>('all');
  const [viewMode, setViewMode] = useState<LedgerViewMode>('cards');
  const [refreshing, setRefreshing] = useState(false);

  // Tap-a-card full member 12-month sheet
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  // Tap-a-month receipt inspector modal (used in both card sheet and table view)
  const [inspectCell, setInspectCell] = useState<{
    memberName: string;
    memberNo: number;
    cell: MonthComplianceResult;
  } | null>(null);

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

  const counts = useMemo(() => {
    let paid = 0;
    let arrears = 0;
    let voluntary = 0;
    for (const r of allSummaries) {
      if (r.member.status === 'non_earning') {
        voluntary += 1;
      } else if (r.arrearsTotal > 0 || r.isBelowMinimumCurrentCycle) {
        arrears += 1;
      } else {
        paid += 1;
      }
    }
    return { total: allSummaries.length, paid, arrears, voluntary };
  }, [allSummaries]);

  const filteredSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSummaries.filter((row) => {
      if (q) {
        const hay = `${row.member.member_no} ${row.member.full_name} ${row.member.full_name_ur ?? ''} ${row.member.designation ?? ''} ${row.member.tag ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === 'paid') {
        return row.member.status !== 'non_earning' && row.arrearsTotal === 0 && !row.isBelowMinimumCurrentCycle;
      }
      if (filter === 'arrears') {
        return row.arrearsTotal > 0 || row.isBelowMinimumCurrentCycle;
      }
      if (filter === 'non_earning') {
        return row.member.status === 'non_earning';
      }
      return true;
    });
  }, [allSummaries, search, filter]);

  const totals = useMemo(() => {
    const perMonth = fyMonths.map(() => 0);
    let collected = 0;
    let expected = 0;
    let arrears = 0;
    for (const row of allSummaries) {
      collected += row.yearlyCharityTotal;
      expected += row.expectedTotalToDate;
      arrears += row.arrearsTotal;
      row.months.forEach((m, idx) => {
        perMonth[idx] = (perMonth[idx] ?? 0) + m.paidAmount;
      });
    }
    return { perMonth, collected, expected, arrears };
  }, [allSummaries, fyMonths]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await runSync();
    setRefreshing(false);
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

  const orgTitle =
    lang === 'ur' && data?.orgSettings?.org_name_ur
      ? data.orgSettings.org_name_ur
      : data?.orgSettings?.org_name ?? t('app.name');

  const openReceiptInspector = (item: MemberFiscalYearSummary, cell: MonthComplianceResult) => {
    const memberName =
      lang === 'ur' && item.member.full_name_ur
        ? item.member.full_name_ur
        : item.member.full_name;
    setInspectCell({
      memberName,
      memberNo: item.member.member_no,
      cell,
    });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={styles.pageContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {/* Modern Community Fund Overview Card */}
        <LinearGradient
          colors={isDark ? ['#144536', '#0A271E'] : ['#0F5D46', '#083729']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, { borderRadius: radius.xl }]}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.flex1}>
              <Text style={styles.heroOrg} numberOfLines={1}>
                {orgTitle}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.fyRow}
              >
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
                        <Ionicons name="lock-closed" size={10} color={active ? '#0C503C' : '#E2F3EC'} />
                      ) : null}
                      <Text style={[styles.fyPillText, { color: active ? '#0C503C' : '#FFFFFF' }]}>
                        {fy.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.pctRing}>
              <Text style={[styles.pctText, typography.numeric]}>{collectionPct}%</Text>
              <Text style={styles.pctSub}>{lang === 'ur' ? 'وصولی' : 'Funded'}</Text>
            </View>
          </View>

          <View style={styles.heroAmountBlock}>
            <Text style={styles.heroLabel}>{t('ledger.collected')}</Text>
            <Text style={[styles.heroBigNum, typography.numeric]}>
              {formatPKR(totals.collected)}
            </Text>
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
              <Text style={[styles.metricVal, typography.numeric]}>{counts.total}</Text>
            </Pressable>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>{t('ledger.expected')}</Text>
              <Text style={[styles.metricVal, typography.numeric]}>
                {formatPKR(totals.expected)}
              </Text>
            </View>
            <Pressable
              onPress={() => setFilter(filter === 'arrears' ? 'all' : 'arrears')}
              style={styles.metricTile}
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

        {/* Search + Labeled View Mode Toggle (Cards vs Table) */}
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

        {/* Clean Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {(
            [
              { key: 'all', label: `${t('common.all')} (${counts.total})` },
              { key: 'paid', label: `${t('compliance.met')} (${counts.paid})` },
              { key: 'arrears', label: `${t('ledger.arrears')} (${counts.arrears})` },
              { key: 'non_earning', label: `${t('memberStatus.non_earning')} (${counts.voluntary})` },
            ] as const
          ).map((chip) => {
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
          <EmptyState icon="people-outline" />
        ) : viewMode === 'cards' ? (
          <View style={styles.cardsList}>
            {filteredSummaries.map((item) => (
              <LedgerMemberCard
                key={item.member.id}
                item={item}
                lang={lang}
                currentMonth={currentMonth}
                onPress={() => setSelectedMemberId(item.member.id)}
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
            onPressMember={(item) => setSelectedMemberId(item.member.id)}
            onPressCell={openReceiptInspector}
          />
        )}
      </ScrollView>

      {/* Member Full Year Breakdown Bottom Sheet */}
      <MemberYearSheet
        summary={selectedSummary}
        fiscalYearLabel={activeFy?.label}
        currentMonth={currentMonth}
        lang={lang}
        onClose={() => setSelectedMemberId(null)}
        onPressMonth={openReceiptInspector}
      />

      {/* Read-Only Receipt Inspector Modal */}
      <Modal
        visible={Boolean(inspectCell)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setInspectCell(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setInspectCell(null)}>
          <Card style={styles.modalCard}>
            {inspectCell ? (
              <>
                <View style={styles.rowBetween}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    #{inspectCell.memberNo} · {inspectCell.memberName}
                  </Text>
                  <ComplianceBadge status={inspectCell.cell.status} compact />
                </View>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {formatMonthYear(inspectCell.cell.periodStart, lang)} · {t('ledger.collected')}:{' '}
                  {formatPKR(inspectCell.cell.paidAmount)}
                </Text>
                {inspectCell.cell.entries.length === 0 ? (
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    {t('common.emptyTitle')}
                  </Text>
                ) : (
                  inspectCell.cell.entries.map((entry) => (
                    <View key={entry.id} style={[styles.entryRow, { borderTopColor: colors.border }]}>
                      <Text style={[styles.entryAmt, typography.numeric, { color: colors.primary }]}>
                        {formatPKR(entry.amount)}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textSecondary }]}>
                        {formatDateShort(entry.paid_on, lang)} · {entry.kind}
                        {entry.remark ? ` · ${entry.remark}` : ''}
                      </Text>
                    </View>
                  ))
                )}
              </>
            ) : null}
          </Card>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex1: { flex: 1 },
  pageScroll: { flex: 1 },
  pageContent: { padding: 14, gap: 12, paddingBottom: 28 },
  heroCard: {
    padding: 18,
    gap: 12,
    elevation: 4,
    shadowColor: '#0C503C',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroOrg: { color: '#F6E2B3', fontSize: 12, fontWeight: '700', marginBottom: 6, letterSpacing: 0.2 },
  fyRow: { gap: 6 },
  fyPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingVertical: 4 },
  fyPillText: { fontSize: 12, fontWeight: '800' },
  pctRing: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(229, 185, 92, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(229, 185, 92, 0.45)',
    alignItems: 'center',
  },
  pctText: { color: '#F6E2B3', fontSize: 16, fontWeight: '800' },
  pctSub: { color: 'rgba(246, 226, 179, 0.85)', fontSize: 10, fontWeight: '600' },
  heroAmountBlock: { gap: 2 },
  heroLabel: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  heroBigNum: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#E5B95C',
  },
  metricRow: { flexDirection: 'row', gap: 8 },
  metricTile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { gap: 10, padding: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  modalTitle: { fontSize: 16, fontWeight: '800', flex: 1 },
  meta: { fontSize: 12.5 },
  entryRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 2 },
  entryAmt: { fontSize: 15, fontWeight: '800' },
});
