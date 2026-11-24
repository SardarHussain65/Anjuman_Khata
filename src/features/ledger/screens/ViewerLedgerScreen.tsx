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
  formatMonthShort,
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

const STICKY_NAME_WIDTH = 136;
const MONTH_COL_WIDTH = 66;
const TOTAL_COL_WIDTH = 82;

/**
 * Passwordless Read-Only Community Ledger.
 * Any community member can view all rows, monthly totals, and payment remarks
 * online or offline — zero write controls exist here.
 */
export function ViewerLedgerScreen() {
  const { colors, radius, typography, isDark } = useTheme();
  const { t } = useTranslation();
  const lang = useAppLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const [selectedFyId, setSelectedFyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'not_meeting' | 'arrears' | 'non_earning'>('all');
  const [refreshing, setRefreshing] = useState(false);
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

  const filteredSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSummaries.filter((row) => {
      if (q) {
        const hay = `${row.member.member_no} ${row.member.full_name} ${row.member.full_name_ur ?? ''} ${row.member.designation ?? ''} ${row.member.tag ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === 'not_meeting') return row.isBelowMinimumCurrentCycle;
      if (filter === 'arrears') return row.arrearsTotal > 0;
      if (filter === 'non_earning') return row.member.status === 'non_earning';
      return true;
    });
  }, [allSummaries, search, filter]);

  const totals = useMemo(() => {
    const perMonth = fyMonths.map(() => 0);
    let collected = 0;
    let expected = 0;
    let arrears = 0;
    for (const row of filteredSummaries) {
      collected += row.yearlyCharityTotal;
      expected += row.expectedTotalToDate;
      arrears += row.arrearsTotal;
      row.months.forEach((m, idx) => {
        perMonth[idx] = (perMonth[idx] ?? 0) + m.paidAmount;
      });
    }
    return { perMonth, collected, expected, arrears };
  }, [filteredSummaries, fyMonths]);

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

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topControls, { backgroundColor: colors.background }]}>
        <LinearGradient
          colors={isDark ? ['#144536', '#0A271E'] : ['#0F5D46', '#093B2C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, { borderRadius: radius.xl }]}
        >
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

          <View style={styles.summaryStrip}>
            <View style={styles.stripPill}>
              <Text style={styles.stripLabel}>{t('ledger.expected')}</Text>
              <Text style={[styles.stripVal, typography.numeric]}>{formatPKR(totals.expected)}</Text>
            </View>
            <View style={styles.stripPill}>
              <Text style={styles.stripLabel}>{t('ledger.arrears')}</Text>
              <Text
                style={[
                  styles.stripVal,
                  typography.numeric,
                  { color: totals.arrears > 0 ? '#FCA5A5' : '#A7F3D0' },
                ]}
              >
                {formatPKR(totals.arrears)}
              </Text>
            </View>
          </View>
        </LinearGradient>

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
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {(
            [
              { key: 'all', label: `${t('common.all')} (${allSummaries.length})` },
              { key: 'not_meeting', label: t('ledger.filterNotMeeting') },
              { key: 'arrears', label: t('ledger.filterArrears') },
              { key: 'non_earning', label: t('memberStatus.non_earning') },
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

      {filteredSummaries.length === 0 ? (
        <EmptyState icon="grid-outline" />
      ) : (
        <ScrollView
          style={styles.gridScroll}
          contentContainerStyle={styles.gridScrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
        >
          <View style={styles.splitTable}>
            <View style={[styles.leftColumn, { borderEndColor: colors.borderStrong }]}>
              <View style={[styles.headerRowBox, { backgroundColor: colors.surfaceSubtle, borderBottomColor: colors.borderStrong }]}>
                <Text style={[styles.headerCellText, { color: colors.text }]}>{t('members.title')}</Text>
              </View>
              {filteredSummaries.map((item) => {
                const displayName =
                  lang === 'ur' && item.member.full_name_ur ? item.member.full_name_ur : item.member.full_name;
                const rowBadgeStatus =
                  item.arrearsTotal > 0
                    ? item.unpaidCount > 0
                      ? 'unpaid'
                      : 'short'
                    : item.currentMonthCompliance?.status ?? null;
                return (
                  <View
                    key={item.member.id}
                    style={[styles.memberRowBox, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
                  >
                    <Text style={[styles.memberTitle, { color: colors.text }]} numberOfLines={1}>
                      #{item.member.member_no} {displayName}
                    </Text>
                    <View style={styles.memberMetaRow}>
                      {rowBadgeStatus ? (
                        <ComplianceBadge status={rowBadgeStatus} compact />
                      ) : null}
                      {item.arrearsTotal > 0 ? (
                        <Text style={[styles.arrearsPill, typography.numeric, { backgroundColor: colors.unpaidBg, color: colors.unpaidText }]}>
                          -{item.arrearsTotal}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
              <View style={[styles.footerRowBox, { backgroundColor: colors.primarySoft, borderTopColor: colors.primaryBorder }]}>
                <Text style={[styles.footerLabel, { color: colors.primary }]}>{t('common.total')}</Text>
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                <View style={[styles.monthsHeaderRow, styles.headerRowBox, { backgroundColor: colors.surfaceSubtle, borderBottomColor: colors.borderStrong }]}>
                  {fyMonths.map((m) => (
                    <View key={m} style={styles.monthHeaderCell}>
                      <Text style={[styles.headerCellText, { color: colors.textSecondary }]}>
                        {formatMonthShort(m, lang)}
                      </Text>
                    </View>
                  ))}
                  <View style={styles.totalHeaderCell}>
                    <Text style={[styles.headerCellText, { color: colors.primary }]}>{t('common.total')}</Text>
                  </View>
                </View>

                {filteredSummaries.map((item) => {
                  const displayName =
                    lang === 'ur' && item.member.full_name_ur ? item.member.full_name_ur : item.member.full_name;
                  return (
                    <View
                      key={item.member.id}
                      style={[styles.monthsRow, styles.dataRowHeight, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
                    >
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
                              setInspectCell({
                                memberName: displayName,
                                memberNo: item.member.member_no,
                                cell,
                              })
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
                      </View>
                    </View>
                  );
                })}

                <View style={[styles.monthsHeaderRow, styles.footerRowBox, { backgroundColor: colors.primarySoft, borderTopColor: colors.primaryBorder }]}>
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
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {/* Read-Only Receipt Inspector Modal */}
      <Modal
        visible={Boolean(inspectCell)}
        transparent
        animationType="fade"
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
  topControls: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 9 },
  heroCard: {
    padding: 15,
    gap: 9,
    elevation: 4,
    shadowColor: '#0C503C',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fyRow: { gap: 6 },
  fyPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 5 },
  fyPillText: { fontSize: 12, fontWeight: '800' },
  heroMainRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  heroLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.78)' },
  heroBigNum: { fontSize: 25, fontWeight: '800', color: '#FFFFFF', marginTop: 1 },
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
  progressFill: { height: 6, borderRadius: 999, backgroundColor: '#E5B95C' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 42,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  summaryStrip: { flexDirection: 'row', gap: 8 },
  stripPill: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stripLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  stripVal: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  filterRow: { gap: 6 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
  filterChipText: { fontSize: 12, fontWeight: '600' },
  gridScroll: { flex: 1 },
  gridScrollContent: { paddingHorizontal: 14, paddingBottom: 24 },
  splitTable: {
    flexDirection: 'row',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(12, 80, 60, 0.14)',
  },
  leftColumn: { width: STICKY_NAME_WIDTH, borderEndWidth: 1 },
  headerRowBox: { height: 38, borderBottomWidth: 1, justifyContent: 'center', paddingHorizontal: 10 },
  memberRowBox: { height: 58, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center', gap: 4 },
  dataRowHeight: { height: 58, borderBottomWidth: StyleSheet.hairlineWidth },
  footerRowBox: { height: 44, borderTopWidth: 1, justifyContent: 'center', paddingHorizontal: 10 },
  headerCellText: { fontSize: 11, fontWeight: '700' },
  monthsHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 0 },
  monthHeaderCell: { width: MONTH_COL_WIDTH + 4, alignItems: 'center', justifyContent: 'center' },
  totalHeaderCell: { width: TOTAL_COL_WIDTH, alignItems: 'center', justifyContent: 'center' },
  memberTitle: { fontSize: 12, fontWeight: '700' },
  memberMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  arrearsPill: { fontSize: 10, fontWeight: '700', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  monthsRow: { flexDirection: 'row', alignItems: 'center' },
  monthCell: { width: MONTH_COL_WIDTH, height: 46, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2, borderRadius: 6 },
  cellValue: { fontSize: 12, fontWeight: '700' },
  totalCell: { width: TOTAL_COL_WIDTH, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  totalValue: { fontSize: 12, fontWeight: '800' },
  footerLabel: { fontSize: 12, fontWeight: '800' },
  footerNum: { fontSize: 11, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modalCard: { gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  modalTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  meta: { fontSize: 12 },
  entryRow: { borderTopWidth: 1, paddingTop: 8, gap: 2 },
  entryAmt: { fontSize: 15, fontWeight: '800' },
});
