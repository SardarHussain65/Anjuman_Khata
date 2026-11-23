import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import { formatDateShort, formatMonthShort, getKarachiCurrentMonthStart } from '@/core/dates';
import { getCurrentLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { ComplianceBadge } from '@/core/ui/Badge';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { runSync } from '@/data/sync/syncEngine';
import { useAuthStore } from '@/features/auth/store/authStore';
import { findCurrentFiscalYear } from '@/core/rules/fiscalYear';
import {
  computeLifetimeCharityTotal,
  computeMemberFiscalYearSummary,
} from '@/core/rules/compliance';
import { resolveEffectiveTierForMonth } from '@/core/rules/tiers';
import { computeMemberZakatYearSummary } from '@/core/rules/zakat';

export function UserDashboardScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const lang = getCurrentLanguage();
  const authProfile = useAuthStore((s) => s.profile);
  const { data, isLoading } = useRegisterSnapshot();
  const [refreshing, setRefreshing] = useState(false);

  const memberId = authProfile?.id ?? '';
  const currentMonth = getKarachiCurrentMonthStart();
  const currentYearNum = Number.parseInt(currentMonth.slice(0, 4), 10);

  const computed = useMemo(() => {
    if (!data || !memberId) return null;
    const profile =
      data.profiles.find((p) => p.id === memberId) ??
      (authProfile
        ? {
            ...authProfile,
            notes: null,
            created_at: '',
            updated_at: '',
            deleted_at: null,
            updated_by: null,
            version: 1,
          }
        : null);
    if (!profile) return null;

    const fy = findCurrentFiscalYear(data.fiscalYears);
    const fySummary = fy
      ? computeMemberFiscalYearSummary({
          profile,
          fiscalYear: fy,
          contributions: data.contributions,
          memberTiers: data.memberTiers,
          tiers: data.tiers,
          tierRates: data.tierRates,
          currentMonthStart: currentMonth,
        })
      : null;

    const lifetimeTotal = computeLifetimeCharityTotal(memberId, data.contributions);
    const activeTier = resolveEffectiveTierForMonth(
      memberId,
      currentMonth,
      data.memberTiers,
      data.tiers,
      data.tierRates,
    );

    const lastPayment = data.contributions.find(
      (c) => c.member_id === memberId && !c.deleted_at,
    );

    const zakatSummary = computeMemberZakatYearSummary(
      memberId,
      currentYearNum,
      data.zakatAssessments,
      data.zakatPayments,
    );

    return {
      profile,
      fy,
      fySummary,
      lifetimeTotal,
      activeTier,
      lastPayment,
      zakatSummary,
    };
  }, [data, memberId, authProfile, currentMonth, currentYearNum]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await runSync();
    setRefreshing(false);
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  if (!computed) {
    return <EmptyState />;
  }

  const { profile, fy, fySummary, lifetimeTotal, activeTier, lastPayment, zakatSummary } = computed;
  const displayName = lang === 'ur' && profile.full_name_ur ? profile.full_name_ur : profile.full_name;
  const tierName = activeTier
    ? lang === 'ur' && activeTier.tierNameUr
      ? activeTier.tierNameUr
      : activeTier.tierName
    : null;

  const chartData =
    fySummary?.months.map((m) => ({
      value: m.paidAmount,
      label: formatMonthShort(m.periodStart, lang).slice(0, 3),
      frontColor:
        m.status === 'met' || m.status === 'advance'
          ? colors.primary
          : m.status === 'short'
            ? colors.warning
            : colors.borderStrong,
    })) ?? [];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
      }
    >
      {/* Member Identity Header */}
      <View style={styles.greetingRow}>
        <View style={styles.greetingCopy}>
          <Text style={[styles.memberNo, { color: colors.primary }]}>
            #{profile.member_no}
            {profile.designation ? ` · ${profile.designation}` : ''}
          </Text>
          <Text style={[styles.name, { color: colors.text }]}>{displayName}</Text>
        </View>
        {fySummary?.currentMonthCompliance ? (
          <ComplianceBadge status={fySummary.currentMonthCompliance.status} />
        ) : null}
      </View>

      {/* Charity Hero Card (Emerald — strictly excludes Zakat) */}
      <Card variant="charity" style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View>
            <Text style={[styles.heroLabel, { color: colors.primary }]}>
              {t('dashboard.thisYearTotal')} ({fy?.label ?? currentYearNum})
            </Text>
            <Text style={[styles.heroAmount, typography.numeric, { color: colors.text }]}>
              {formatPKR(fySummary?.yearlyCharityTotal ?? 0)}
            </Text>
          </View>
          <View style={styles.heroRight}>
            <Text style={[styles.heroSubLabel, { color: colors.textSecondary }]}>
              {t('dashboard.lifetimeTotal')}
            </Text>
            <Text style={[styles.heroSubAmount, typography.numeric, { color: colors.text }]}>
              {formatPKR(lifetimeTotal)}
            </Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.primaryBorder }]} />

        <View style={styles.metricsRow}>
          <View style={styles.metricCell}>
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
              {t('dashboard.currentTier')}
            </Text>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {profile.status === 'non_earning'
                ? t('memberStatus.non_earning')
                : tierName ?? t('dashboard.noTierExempt')}
            </Text>
            {profile.status === 'active' && activeTier ? (
              <Text style={[styles.metricHint, typography.numeric, { color: colors.primary }]}>
                {t('dashboard.monthlyMin')}: {formatPKR(activeTier.minAmount)}
              </Text>
            ) : null}
          </View>

          <View style={styles.metricCell}>
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
              {t('dashboard.lastPayment')}
            </Text>
            <Text style={[styles.metricValue, typography.numeric, { color: colors.text }]}>
              {lastPayment ? formatPKR(lastPayment.amount) : '—'}
            </Text>
            <Text style={[styles.metricHint, { color: colors.textSecondary }]}>
              {lastPayment ? formatDateShort(lastPayment.paid_on, lang) : t('common.none')}
            </Text>
          </View>
        </View>
      </Card>

      {/* 12-Month Compliance Grid */}
      {fySummary ? (
        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('dashboard.twelveMonthGrid')} · {fy?.label}
          </Text>
          <View style={styles.monthGrid}>
            {fySummary.months.map((cell) => {
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
                <View
                  key={cell.periodStart}
                  style={[
                    styles.monthTile,
                    { backgroundColor: bg, borderRadius: radius.md },
                  ]}
                >
                  <Text style={[styles.monthLabel, { color: fg }]}>
                    {formatMonthShort(cell.periodStart, lang)}
                  </Text>
                  <Text
                    style={[styles.monthAmount, typography.numeric, { color: fg }]}
                    numberOfLines={1}
                  >
                    {cell.paidAmount > 0 ? formatPKR(cell.paidAmount) : '—'}
                  </Text>
                  <Text style={[styles.monthStatus, { color: fg }]}>
                    {t(`compliance.${cell.status}`)}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>
      ) : null}

      {/* Monthly Contributions Bar Chart */}
      {chartData.length > 0 ? (
        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('dashboard.monthlyChart')}
          </Text>
          <View style={styles.chartWrap}>
            <BarChart
              data={chartData}
              barWidth={16}
              spacing={10}
              roundedTop
              hideRules
              xAxisColor={colors.border}
              yAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
              xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
              noOfSections={4}
              height={150}
              isAnimated={false}
            />
          </View>
        </Card>
      ) : null}

      {/* Dedicated Separate Zakat Summary Card (Gold Accent) */}
      <Pressable onPress={() => router.push('/(user)/zakat')}>
        <Card variant="zakat" style={styles.sectionCard}>
          <View style={styles.zakatHeader}>
            <View style={styles.zakatTitleRow}>
              <Ionicons name="sparkles" size={18} color={colors.zakat} />
              <Text style={[styles.zakatTitle, { color: colors.zakatText }]}>
                {t('dashboard.zakatSeparateCard')} ({currentYearNum})
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.zakat} />
          </View>

          <View style={styles.zakatRow}>
            <View style={styles.zakatStat}>
              <Text style={[styles.zakatLabel, { color: colors.textSecondary }]}>
                {t('dashboard.zakatDue')}
              </Text>
              <Text style={[styles.zakatVal, typography.numeric, { color: colors.text }]}>
                {formatPKR(zakatSummary.dueAmount)}
              </Text>
            </View>
            <View style={styles.zakatStat}>
              <Text style={[styles.zakatLabel, { color: colors.textSecondary }]}>
                {t('dashboard.zakatPaid')}
              </Text>
              <Text style={[styles.zakatVal, typography.numeric, { color: colors.metText }]}>
                {formatPKR(zakatSummary.paidAmount)}
              </Text>
            </View>
            <View style={styles.zakatStat}>
              <Text style={[styles.zakatLabel, { color: colors.textSecondary }]}>
                {t('dashboard.zakatBalance')}
              </Text>
              <Text style={[styles.zakatVal, typography.numeric, { color: colors.zakatText }]}>
                {formatPKR(zakatSummary.balance)}
              </Text>
            </View>
          </View>
        </Card>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  greetingCopy: { flex: 1 },
  memberNo: { fontSize: 13, fontWeight: '700' },
  name: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  heroCard: { gap: 12 },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroLabel: { fontSize: 12, fontWeight: '700' },
  heroAmount: { fontSize: 28, fontWeight: '800', marginTop: 2 },
  heroRight: { alignItems: 'flex-end' },
  heroSubLabel: { fontSize: 12 },
  heroSubAmount: { fontSize: 17, fontWeight: '700', marginTop: 2 },
  divider: { height: 1 },
  metricsRow: { flexDirection: 'row', gap: 12 },
  metricCell: { flex: 1, gap: 2 },
  metricLabel: { fontSize: 12 },
  metricValue: { fontSize: 15, fontWeight: '700' },
  metricHint: { fontSize: 12, fontWeight: '500' },
  sectionCard: { gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  monthTile: {
    width: '31.3%',
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 2,
  },
  monthLabel: { fontSize: 12, fontWeight: '700' },
  monthAmount: { fontSize: 13, fontWeight: '800' },
  monthStatus: { fontSize: 10, fontWeight: '600' },
  chartWrap: { paddingTop: 8, overflow: 'hidden' },
  zakatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  zakatTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  zakatTitle: { fontSize: 15, fontWeight: '700' },
  zakatRow: { flexDirection: 'row', gap: 8 },
  zakatStat: { flex: 1, gap: 2 },
  zakatLabel: { fontSize: 12 },
  zakatVal: { fontSize: 15, fontWeight: '700' },
});
