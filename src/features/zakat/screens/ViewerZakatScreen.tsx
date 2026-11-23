import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import { formatDateShort, getKarachiToday } from '@/core/dates';
import { getCurrentLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { computeMemberZakatYearSummary } from '@/core/rules/zakat';

/** Passwordless Read-Only Community Zakat Register (strictly separate from charity). */
export function ViewerZakatScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const lang = getCurrentLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const defaultYear = Number.parseInt(getKarachiToday().slice(0, 4), 10);
  const [selectedYear, setSelectedYear] = useState(defaultYear);

  const years = useMemo(() => {
    const set = new Set<number>([defaultYear]);
    (data?.zakatSettings ?? []).forEach((s) => set.add(s.year));
    (data?.zakatPayments ?? []).forEach((p) => set.add(p.year));
    (data?.zakatAssessments ?? []).forEach((a) => set.add(a.year));
    return Array.from(set).sort((a, b) => b - a);
  }, [data, defaultYear]);

  const activeSetting = useMemo(
    () => (data?.zakatSettings ?? []).find((s) => s.year === selectedYear) ?? null,
    [data, selectedYear],
  );

  const profileMap = useMemo(
    () => new Map((data?.profiles ?? []).map((p) => [p.id, p])),
    [data],
  );

  const balances = useMemo(() => {
    if (!data) return [];
    return data.profiles
      .map((member) => ({
        member,
        summary: computeMemberZakatYearSummary(
          member.id,
          selectedYear,
          data.zakatAssessments,
          data.zakatPayments,
        ),
      }))
      .filter((r) => r.summary.dueAmount > 0 || r.summary.paidAmount > 0);
  }, [data, selectedYear]);

  const totals = useMemo(() => {
    let due = 0;
    let paid = 0;
    for (const r of balances) {
      due += r.summary.dueAmount;
      paid += r.summary.paidAmount;
    }
    return { due, paid, balance: due - paid };
  }, [balances]);

  const yearPayments = useMemo(
    () => (data?.zakatPayments ?? []).filter((p) => p.year === selectedYear && !p.deleted_at),
    [data, selectedYear],
  );

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {years.map((yr) => {
          const active = yr === selectedYear;
          return (
            <Pressable
              key={yr}
              onPress={() => setSelectedYear(yr)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.zakat : colors.surface,
                  borderColor: active ? colors.zakat : colors.zakatBorder,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.text }]}>{yr}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Card variant="zakat" style={styles.card}>
        <View style={styles.titleRow}>
          <Ionicons name="sparkles" size={18} color={colors.zakat} />
          <Text style={[styles.cardTitle, { color: colors.zakatText }]}>
            {t('zakat.title')} · {selectedYear}
          </Text>
        </View>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {activeSetting
            ? `${t('zakat.nisabAmount')}: ${formatPKR(activeSetting.nisab_amount)} · ${(activeSetting.rate_bps / 100).toFixed(1)}%`
            : t('zakat.separateNote')}
        </Text>
        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{t('dashboard.zakatDue')}</Text>
            <Text style={[styles.statVal, typography.numeric, { color: colors.text }]}>{formatPKR(totals.due)}</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{t('dashboard.zakatPaid')}</Text>
            <Text style={[styles.statVal, typography.numeric, { color: colors.metText }]}>{formatPKR(totals.paid)}</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{t('dashboard.zakatBalance')}</Text>
            <Text style={[styles.statVal, typography.numeric, { color: colors.zakatText }]}>{formatPKR(totals.balance)}</Text>
          </View>
        </View>
      </Card>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('zakat.payments')}</Text>
      {yearPayments.length === 0 ? (
        <EmptyState icon="sparkles-outline" title={t('common.emptyTitle')} subtitle={t('zakat.separateNote')} />
      ) : (
        yearPayments.map((pay) => {
          const member = profileMap.get(pay.member_id);
          return (
            <Card key={pay.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: colors.text }]}>
                    #{member?.member_no ?? '?'} · {member?.full_name ?? ''}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {formatDateShort(pay.paid_on, lang)}
                    {pay.remark ? ` · ${pay.remark}` : ''}
                  </Text>
                </View>
                <Text style={[styles.statVal, typography.numeric, { color: colors.zakat }]}>
                  {formatPKR(pay.amount)}
                </Text>
              </View>
            </Card>
          );
        })
      )}

      <Card style={{ backgroundColor: colors.surfaceSubtle }}>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{t('zakat.scholarNote')}</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 14, gap: 12, paddingBottom: 32 },
  chips: { gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '700' },
  card: { gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  statCol: { flex: 1, gap: 2 },
  statVal: { fontSize: 15, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowName: { fontSize: 14, fontWeight: '700' },
  meta: { fontSize: 12, lineHeight: 18 },
});
