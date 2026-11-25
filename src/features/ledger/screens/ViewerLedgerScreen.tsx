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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

type ViewerFilter = 'all' | 'paid' | 'arrears' | 'non_earning';
type ViewMode = 'cards' | 'table';

/**
 * Passwordless Read-Only Community Home & Contribution Register.
 * Defaults to a clean, scannable mobile card view with a 12-month visual strip per member
 * and tap-to-inspect full year breakdown, plus a 1-tap toggle to the classic register table.
 */
export function ViewerLedgerScreen() {
  const { colors, radius, typography, isDark } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const lang = useAppLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const [selectedFyId, setSelectedFyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ViewerFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [refreshing, setRefreshing] = useState(false);

  // Tap-a-card full member 12-month sheet
  const [selectedSummary, setSelectedSummary] = useState<MemberFiscalYearSummary | null>(null);
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

        {/* Search + View Mode Toggle (Cards vs Table) */}
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

          <View
            style={[
              styles.viewToggle,
              { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg },
            ]}
          >
            <Pressable
              accessibilityLabel="Cards view"
              onPress={() => setViewMode('cards')}
              style={[
                styles.viewToggleBtn,
                {
                  backgroundColor: viewMode === 'cards' ? colors.primary : 'transparent',
                  borderRadius: radius.md,
                },
              ]}
            >
              <Ionicons
                name="albums-outline"
                size={17}
                color={viewMode === 'cards' ? '#FFFFFF' : colors.textMuted}
              />
            </Pressable>
            <Pressable
              accessibilityLabel="Table view"
              onPress={() => setViewMode('table')}
              style={[
                styles.viewToggleBtn,
                {
                  backgroundColor: viewMode === 'table' ? colors.primary : 'transparent',
                  borderRadius: radius.md,
                },
              ]}
            >
              <Ionicons
                name="grid-outline"
                size={16}
                color={viewMode === 'table' ? '#FFFFFF' : colors.textMuted}
              />
            </Pressable>
          </View>
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

        {/* Member List: Spacious Cards (Default) OR Classic 12-Month Table */}
        {filteredSummaries.length === 0 ? (
          <EmptyState icon="people-outline" />
        ) : viewMode === 'cards' ? (
          <View style={styles.cardsList}>
            {filteredSummaries.map((item) => {
              const displayName =
                lang === 'ur' && item.member.full_name_ur
                  ? item.member.full_name_ur
                  : item.member.full_name;
              const effTier = item.currentMonthCompliance?.effectiveTier;
              const rowBadgeStatus =
                item.arrearsTotal > 0
                  ? item.unpaidCount > 0
                    ? 'unpaid'
                    : 'short'
                  : item.currentMonthCompliance?.status ?? 'exempt';
              const hasArrears = item.arrearsTotal > 0;

              return (
                <Pressable
                  key={item.member.id}
                  onPress={() => setSelectedSummary(item)}
                  style={({ pressed }) => [pressed && { opacity: 0.92 }]}
                >
                  <Card style={styles.memberCard}>
                    <View style={styles.cardHeaderRow}>
                      <View
                        style={[
                          styles.avatarCircle,
                          {
                            backgroundColor: hasArrears
                              ? colors.unpaidBg
                              : item.member.status === 'non_earning'
                                ? colors.surfaceSubtle
                                : colors.primarySoft,
                            borderColor: hasArrears
                              ? colors.danger
                              : item.member.status === 'non_earning'
                                ? colors.border
                                : colors.primaryBorder,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.avatarText,
                            typography.numeric,
                            {
                              color: hasArrears
                                ? colors.unpaidText
                                : item.member.status === 'non_earning'
                                  ? colors.textSecondary
                                  : colors.primary,
                            },
                          ]}
                        >
                          #{item.member.member_no}
                        </Text>
                      </View>

                      <View style={styles.flex1}>
                        <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                          {displayName}
                        </Text>
                        <Text style={[styles.cardSub, { color: colors.textSecondary }]} numberOfLines={1}>
                          {effTier
                            ? `${lang === 'ur' && effTier.tierNameUr ? effTier.tierNameUr : effTier.tierName} · ${formatPKR(effTier.minAmount)}/mo`
                            : t(`memberStatus.${item.member.status}`)}
                          {item.member.designation ? ` · ${item.member.designation}` : ''}
                        </Text>
                      </View>

                      <View style={styles.cardRightCol}>
                        <Text style={[styles.cardTotalAmt, typography.numeric, { color: colors.text }]}>
                          {formatPKR(item.yearlyCharityTotal)}
                        </Text>
                        <View style={styles.cardStatusRow}>
                          <ComplianceBadge status={rowBadgeStatus} compact />
                          {hasArrears ? (
                            <Text
                              style={[
                                styles.arrearsTag,
                                typography.numeric,
                                { backgroundColor: colors.unpaidBg, color: colors.unpaidText },
                              ]}
                            >
                              -{item.arrearsTotal}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </View>

                    {/* 12-Month Glanceable Mini Strip (no horizontal scroll needed!) */}
                    <View style={styles.miniMonthsStrip}>
                      {item.months.map((cell) => {
                        const pillBg =
                          cell.status === 'met'
                            ? colors.metBg
                            : cell.status === 'short'
                              ? colors.shortBg
                              : cell.status === 'unpaid'
                                ? colors.unpaidBg
                                : cell.status === 'advance'
                                  ? colors.advanceBg
                                  : colors.surfaceSubtle;
                        const pillFg =
                          cell.status === 'met'
                            ? colors.metText
                            : cell.status === 'short'
                              ? colors.shortText
                              : cell.status === 'unpaid'
                                ? colors.unpaidText
                                : cell.status === 'advance'
                                  ? colors.advanceText
                                  : colors.textMuted;
                        const shortLabel = formatMonthShort(cell.periodStart, 'en').slice(0, 1);

                        return (
                          <View
                            key={cell.periodStart}
                            style={[styles.miniMonthDot, { backgroundColor: pillBg }]}
                          >
                            <Text style={[styles.miniMonthText, { color: pillFg }]}>
                              {shortLabel}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </Card>
                </Pressable>
              );
            })}
          </View>
        ) : (
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
        )}
      </ScrollView>

      {/* Member Full Year Breakdown Bottom Sheet (on tapping any Member Card) */}
      <Modal
        visible={Boolean(selectedSummary)}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedSummary(null)}
      >
        <View style={styles.sheetBackdrop}>
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
            <View style={styles.sheetHeader}>
              <View style={styles.flex1}>
                <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                  #{selectedSummary?.member.member_no} ·{' '}
                  {lang === 'ur' && selectedSummary?.member.full_name_ur
                    ? selectedSummary.member.full_name_ur
                    : selectedSummary?.member.full_name}
                </Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {activeFy?.label} · {t(`memberStatus.${selectedSummary?.member.status ?? 'active'}`)}
                </Text>
              </View>
              <Pressable onPress={() => setSelectedSummary(null)} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={[
                styles.sheetBody,
                { paddingBottom: Math.max(insets.bottom + 20, 36) },
              ]}
            >
              {selectedSummary ? (
                <>
                  <View style={styles.sheetStatsRow}>
                    <Card variant="charity" style={styles.sheetStatCard}>
                      <Text style={[styles.meta, { color: colors.primary }]}>{t('ledger.collected')}</Text>
                      <Text style={[styles.sheetStatVal, typography.numeric, { color: colors.text }]}>
                        {formatPKR(selectedSummary.yearlyCharityTotal)}
                      </Text>
                    </Card>
                    <Card style={styles.sheetStatCard}>
                      <Text style={[styles.meta, { color: colors.textSecondary }]}>{t('ledger.arrears')}</Text>
                      <Text
                        style={[
                          styles.sheetStatVal,
                          typography.numeric,
                          { color: selectedSummary.arrearsTotal > 0 ? colors.danger : colors.metText },
                        ]}
                      >
                        {formatPKR(selectedSummary.arrearsTotal)}
                      </Text>
                    </Card>
                  </View>

                  <Text style={[styles.sheetSectionLabel, { color: colors.textSecondary }]}>
                    {lang === 'ur'
                      ? 'تفصیل دیکھنے کے لیے کسی بھی مہینے پر ٹیپ کریں'
                      : 'Tap any month to view receipt details'}
                  </Text>

                  <View style={styles.monthGrid}>
                    {selectedSummary.months.map((cell) => {
                      const bg =
                        cell.status === 'met'
                          ? colors.metBg
                          : cell.status === 'short'
                            ? colors.shortBg
                            : cell.status === 'unpaid'
                              ? colors.unpaidBg
                              : cell.status === 'advance'
                                ? colors.advanceBg
                                : colors.surfaceSubtle;
                      const fg =
                        cell.status === 'met'
                          ? colors.metText
                          : cell.status === 'short'
                            ? colors.shortText
                            : cell.status === 'unpaid'
                              ? colors.unpaidText
                              : cell.status === 'advance'
                                ? colors.advanceText
                                : colors.textMuted;

                      return (
                        <Pressable
                          key={cell.periodStart}
                          onPress={() => {
                            const memberName =
                              lang === 'ur' && selectedSummary.member.full_name_ur
                                ? selectedSummary.member.full_name_ur
                                : selectedSummary.member.full_name;
                            setInspectCell({
                              memberName,
                              memberNo: selectedSummary.member.member_no,
                              cell,
                            });
                          }}
                          style={[
                            styles.monthTile,
                            { backgroundColor: bg, borderRadius: radius.md },
                          ]}
                        >
                          <Text style={[styles.monthTileLabel, { color: fg }]}>
                            {formatMonthShort(cell.periodStart, lang)}
                          </Text>
                          <Text style={[styles.monthTileAmt, typography.numeric, { color: fg }]}>
                            {cell.paidAmount > 0 ? formatPKR(cell.paidAmount) : '—'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
  progressFill: { height: 7, borderRadius: 999, backgroundColor: '#E5B95C' },
  metricRow: { flexDirection: 'row', gap: 8 },
  metricTile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  metricLabel: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.72)' },
  metricVal: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  searchAndToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  viewToggle: {
    flexDirection: 'row',
    padding: 3,
    borderWidth: 1,
    gap: 2,
  },
  viewToggleBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: { gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1 },
  filterChipText: { fontSize: 12, fontWeight: '700' },
  cardsList: { gap: 10 },
  memberCard: { gap: 12 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '800' },
  cardName: { fontSize: 15, fontWeight: '700' },
  cardSub: { fontSize: 12, marginTop: 2 },
  cardRightCol: { alignItems: 'flex-end', gap: 4 },
  cardTotalAmt: { fontSize: 15, fontWeight: '800' },
  cardStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  arrearsTag: { fontSize: 10, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  miniMonthsStrip: { flexDirection: 'row', justifyContent: 'space-between', gap: 3 },
  miniMonthDot: {
    flex: 1,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniMonthText: { fontSize: 10, fontWeight: '800' },
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
  monthsHeaderRow: { flexDirection: 'row', alignItems: 'center' },
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
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '86%' },
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
  sheetBody: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  sheetStatsRow: { flexDirection: 'row', gap: 10 },
  sheetStatCard: { flex: 1, gap: 4 },
  sheetStatVal: { fontSize: 19, fontWeight: '800' },
  sheetSectionLabel: { fontSize: 12, fontWeight: '600' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthTile: { width: '31.3%', paddingVertical: 11, paddingHorizontal: 6, alignItems: 'center', gap: 3 },
  monthTileLabel: { fontSize: 11, fontWeight: '700' },
  monthTileAmt: { fontSize: 12, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modalCard: { gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  modalTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  meta: { fontSize: 12 },
  entryRow: { borderTopWidth: 1, paddingTop: 8, gap: 2 },
  entryAmt: { fontSize: 15, fontWeight: '800' },
});
