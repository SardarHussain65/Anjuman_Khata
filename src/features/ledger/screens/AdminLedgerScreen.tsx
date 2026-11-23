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
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import { formatMonthShort, getKarachiCurrentMonthStart } from '@/core/dates';
import { getCurrentLanguage } from '@/core/i18n';
import { ComplianceBadge } from '@/core/ui/Badge';
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

type LedgerFilter =
  | 'all'
  | 'not_meeting'
  | 'arrears'
  | 'unpaid_current'
  | 'non_earning'
  | string; // tier:<tierId>

const STICKY_NAME_WIDTH = 136;
const MONTH_COL_WIDTH = 66;
const TOTAL_COL_WIDTH = 82;

export function AdminLedgerScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const lang = getCurrentLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const [selectedFyId, setSelectedFyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

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

  const filteredSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSummaries.filter((row) => {
      if (q) {
        const hay = `${row.member.member_no} ${row.member.full_name} ${row.member.full_name_ur ?? ''} ${row.member.designation ?? ''} ${row.member.tag ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === 'not_meeting') return row.isBelowMinimumCurrentCycle;
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
      if (row.isBelowMinimumCurrentCycle) belowMinCount += 1;
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

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Fiscal Year Pills + Search */}
      <View style={[styles.topControls, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
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
                      backgroundColor: active ? colors.primary : colors.surfaceSubtle,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  {fy.status === 'closed' ? (
                    <Ionicons name="lock-closed" size={12} color={active ? '#FFFFFF' : colors.textMuted} />
                  ) : null}
                  <Text style={[styles.fyPillText, { color: active ? '#FFFFFF' : colors.text }]}>
                    {fy.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(admin)/reports')}
            style={[styles.exportChip, { backgroundColor: colors.primarySoft, borderRadius: radius.pill }]}
          >
            <Ionicons name="document-text-outline" size={14} color={colors.primary} />
            <Text style={[styles.fyPillText, { color: colors.primary }]}>PDF</Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radius.md },
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
            <Pressable onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Summary Strip */}
        <View style={styles.summaryStrip}>
          <View style={styles.stripStat}>
            <Text style={[styles.stripLabel, { color: colors.textMuted }]}>{t('ledger.collected')}</Text>
            <Text style={[styles.stripVal, typography.numeric, { color: colors.primary }]}>
              {formatPKR(totals.collected)}
            </Text>
          </View>
          <View style={styles.stripStat}>
            <Text style={[styles.stripLabel, { color: colors.textMuted }]}>{t('ledger.expected')}</Text>
            <Text style={[styles.stripVal, typography.numeric, { color: colors.text }]}>
              {formatPKR(totals.expected)}
            </Text>
          </View>
          <Pressable
            style={styles.stripStat}
            onPress={() => setFilter(filter === 'arrears' ? 'all' : 'arrears')}
          >
            <Text style={[styles.stripLabel, { color: colors.textMuted }]}>{t('ledger.arrears')}</Text>
            <Text style={[styles.stripVal, typography.numeric, { color: totals.arrears > 0 ? colors.danger : colors.metText }]}>
              {formatPKR(totals.arrears)}
            </Text>
          </Pressable>
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
                    backgroundColor: active ? colors.primarySoft : colors.background,
                    borderColor: active ? colors.primary : colors.border,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[styles.filterChipText, { color: active ? colors.primary : colors.textSecondary }]}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Master Paper-Register Grid (Sticky Member Column + Horizontal Months) */}
      <FlashList
        data={filteredSummaries}
        keyExtractor={(item) => item.member.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={<EmptyState icon="grid-outline" />}
        ListHeaderComponent={
          filteredSummaries.length > 0 ? (
            <View style={[styles.gridHeader, { backgroundColor: colors.surfaceSubtle, borderBottomColor: colors.borderStrong }]}>
              <View style={[styles.stickyCol, { borderEndColor: colors.borderStrong }]}>
                <Text style={[styles.headerCellText, { color: colors.text }]}>
                  {t('members.title')}
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.monthsHeaderRow}>
                  {fyMonths.map((m) => (
                    <View key={m} style={styles.monthHeaderCell}>
                      <Text style={[styles.headerCellText, { color: colors.textSecondary }]}>
                        {formatMonthShort(m, lang)}
                      </Text>
                    </View>
                  ))}
                  <View style={styles.totalHeaderCell}>
                    <Text style={[styles.headerCellText, { color: colors.primary }]}>
                      {t('common.total')}
                    </Text>
                  </View>
                </View>
              </ScrollView>
            </View>
          ) : null
        }
        ListFooterComponent={
          filteredSummaries.length > 0 ? (
            <View style={[styles.gridFooter, { backgroundColor: colors.primarySoft, borderTopColor: colors.primaryBorder }]}>
              <View style={[styles.stickyCol, { borderEndColor: colors.primaryBorder }]}>
                <Text style={[styles.footerLabel, { color: colors.primary }]}>
                  {t('common.total')}
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.monthsHeaderRow}>
                  {totals.perMonth.map((amt, idx) => (
                    <View key={fyMonths[idx] ?? idx} style={styles.monthHeaderCell}>
                      <Text style={[styles.footerNum, typography.numeric, { color: colors.primary }]}>
                        {amt > 0 ? amt.toLocaleString() : '—'}
                      </Text>
                    </View>
                  ))}
                  <View style={styles.totalHeaderCell}>
                    <Text style={[styles.footerNum, typography.numeric, { color: colors.primary }]}>
                      {formatPKR(totals.collected)}
                    </Text>
                  </View>
                </View>
              </ScrollView>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const displayName =
            lang === 'ur' && item.member.full_name_ur
              ? item.member.full_name_ur
              : item.member.full_name;
          return (
            <View style={[styles.ledgerRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
              {/* Sticky Member Name + Tag + Compliance Badge */}
              <View style={[styles.stickyCol, { borderEndColor: colors.border }]}>
                <Text style={[styles.memberTitle, { color: colors.text }]} numberOfLines={1}>
                  #{item.member.member_no} {displayName}
                </Text>
                <View style={styles.memberMetaRow}>
                  {item.currentMonthCompliance ? (
                    <ComplianceBadge status={item.currentMonthCompliance.status} compact />
                  ) : null}
                  {item.member.tag ? (
                    <Text style={[styles.tagPill, { backgroundColor: colors.surfaceSubtle, color: colors.textSecondary }]} numberOfLines={1}>
                      {item.member.tag}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* Scrollable 12 Month Cells + Yearly Total */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.monthsRow}>
                  {item.months.map((cell) => {
                    const bg =
                      cell.status === 'met'
                        ? colors.metBg
                        : cell.status === 'short'
                          ? colors.shortBg
                          : cell.status === 'unpaid'
                            ? colors.unpaidBg
                            : cell.status === 'advance'
                              ? colors.advanceBg
                              : colors.exemptBg;
                    const fg =
                      cell.status === 'met'
                        ? colors.metText
                        : cell.status === 'short'
                          ? colors.shortText
                          : cell.status === 'unpaid'
                            ? colors.unpaidText
                            : cell.status === 'advance'
                              ? colors.advanceText
                              : colors.exemptText;

                    return (
                      <Pressable
                        key={cell.periodStart}
                        onPress={() =>
                          openQuickCollect(
                            item.member.id,
                            cell.periodStart,
                            cell.entries[0] ?? null,
                          )
                        }
                        style={[styles.monthCell, { backgroundColor: bg }]}
                      >
                        <Text style={[styles.cellValue, typography.numeric, { color: fg }]}>
                          {cell.paidAmount > 0 ? cell.paidAmount : '—'}
                        </Text>
                      </Pressable>
                    );
                  })}

                  <View style={[styles.totalCell, { backgroundColor: colors.surfaceSubtle }]}>
                    <Text style={[styles.totalValue, typography.numeric, { color: colors.text }]}>
                      {formatPKR(item.yearlyCharityTotal)}
                    </Text>
                    {item.arrearsTotal > 0 ? (
                      <Text style={[styles.arrearsMini, typography.numeric, { color: colors.danger }]}>
                        -{item.arrearsTotal}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </ScrollView>
            </View>
          );
        }}
      />

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
  topControls: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
    borderBottomWidth: 1,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  fyRow: { gap: 8 },
  fyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  fyPillText: { fontSize: 13, fontWeight: '700' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 42,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  summaryStrip: { flexDirection: 'row', gap: 8 },
  stripStat: { flex: 1 },
  stripLabel: { fontSize: 11, fontWeight: '600' },
  stripVal: { fontSize: 14, fontWeight: '800' },
  filterRow: { gap: 6 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 12, fontWeight: '600' },
  gridHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    minHeight: 36,
    alignItems: 'center',
  },
  gridFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    marginBottom: 88,
  },
  stickyCol: {
    width: STICKY_NAME_WIDTH,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderEndWidth: 1,
    justifyContent: 'center',
    gap: 4,
  },
  headerCellText: { fontSize: 11, fontWeight: '700' },
  monthsHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  monthHeaderCell: { width: MONTH_COL_WIDTH, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  totalHeaderCell: { width: TOTAL_COL_WIDTH, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  ledgerRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 58 },
  memberTitle: { fontSize: 12, fontWeight: '700' },
  memberMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  tagPill: { fontSize: 10, fontWeight: '600', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  monthsRow: { flexDirection: 'row', alignItems: 'stretch' },
  monthCell: {
    width: MONTH_COL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 2,
    borderRadius: 6,
    minHeight: 48,
  },
  cellValue: { fontSize: 12, fontWeight: '700' },
  totalCell: {
    width: TOTAL_COL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  totalValue: { fontSize: 12, fontWeight: '800' },
  arrearsMini: { fontSize: 10, fontWeight: '700' },
  footerLabel: { fontSize: 12, fontWeight: '800' },
  footerNum: { fontSize: 11, fontWeight: '800' },
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
