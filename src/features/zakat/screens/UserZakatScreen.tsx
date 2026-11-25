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
import { useAuthStore } from '@/features/auth/store/authStore';
import { computeMemberZakatYearSummary } from '@/core/rules/zakat';

export function UserZakatScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const lang = getCurrentLanguage();
  const memberId = useAuthStore((s) => s.profile?.id ?? '');
  const { data, isLoading } = useRegisterSnapshot();

  const defaultYear = Number.parseInt(getKarachiToday().slice(0, 4), 10);

  const years = useMemo(() => {
    if (!data) return [defaultYear];
    const set = new Set<number>([defaultYear]);
    data.zakatSettings.forEach((s) => set.add(s.year));
    data.zakatAssessments
      .filter((a) => a.member_id === memberId && !a.deleted_at)
      .forEach((a) => set.add(a.year));
    data.zakatPayments
      .filter((p) => p.member_id === memberId && !p.deleted_at)
      .forEach((p) => set.add(p.year));
    return Array.from(set).sort((a, b) => b - a);
  }, [data, memberId, defaultYear]);

  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);

  const summary = useMemo(() => {
    if (!data) return null;
    return computeMemberZakatYearSummary(
      memberId,
      selectedYear,
      data.zakatAssessments,
      data.zakatPayments,
    );
  }, [data, memberId, selectedYear]);

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Year Selector */}
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
              <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.text }]}>
                {yr}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Dedicated Gold Summary Card */}
      <Card variant="zakat" style={styles.card}>
        <View style={styles.titleRow}>
          <Ionicons name="sparkles" size={18} color={colors.zakat} />
          <Text style={[styles.cardTitle, { color: colors.zakatText }]}>
            {t('zakat.title')} · {selectedYear}
          </Text>
        </View>
        <Text style={[styles.noteText, { color: colors.textSecondary }]}>
          {t('zakat.separateNote')}
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {t('dashboard.zakatDue')}
            </Text>
            <Text style={[styles.statVal, typography.numeric, { color: colors.text }]}>
              {formatPKR(summary?.dueAmount ?? 0)}
            </Text>
          </View>
          <View style={styles.statCol}>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {t('dashboard.zakatPaid')}
            </Text>
            <Text style={[styles.statVal, typography.numeric, { color: colors.metText }]}>
              {formatPKR(summary?.paidAmount ?? 0)}
            </Text>
          </View>
          <View style={styles.statCol}>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {t('dashboard.zakatBalance')}
            </Text>
            <Text style={[styles.statVal, typography.numeric, { color: colors.zakatText }]}>
              {formatPKR(summary?.balance ?? 0)}
            </Text>
          </View>
        </View>
      </Card>

      {/* Assessment Snapshot Breakdown (Private to Member & Admin via RLS) */}
      <Text style={[styles.sectionHeader, { color: colors.text }]}>
        {t('zakat.assessments')}
      </Text>
      {summary && summary.assessments.length > 0 ? (
        summary.assessments.map((ass) => (
          <Card key={ass.id} style={styles.card}>
            <View style={styles.kvRow}>
              <Text style={[styles.kvLabel, { color: colors.textSecondary }]}>
                {t('zakat.netZakatable')}
              </Text>
              <Text style={[styles.kvVal, typography.numeric, { color: colors.text }]}>
                {formatPKR(ass.net_zakatable)}
              </Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={[styles.kvLabel, { color: colors.textSecondary }]}>
                {t('zakat.nisabAmount')}
              </Text>
              <Text style={[styles.kvVal, typography.numeric, { color: colors.text }]}>
                {formatPKR(ass.nisab_used)}
              </Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={[styles.kvLabel, { color: colors.textSecondary }]}>
                {t('dashboard.zakatDue')} ({(ass.rate_bps / 100).toFixed(1)}%)
              </Text>
              <Text style={[styles.kvVal, typography.numeric, { color: colors.zakatText }]}>
                {formatPKR(ass.due_amount)}
              </Text>
            </View>
            {Object.entries(ass.assets ?? {}).map(([cat, val]) =>
              val ? (
                <View key={cat} style={styles.assetRow}>
                  <Text style={[styles.assetLabel, { color: colors.textMuted }]}>
                    · {t(`zakat.assets.${cat}`, { defaultValue: cat })}
                  </Text>
                  <Text style={[styles.assetVal, typography.numeric, { color: colors.textSecondary }]}>
                    {formatPKR(val)}
                  </Text>
                </View>
              ) : null,
            )}
            {ass.liabilities > 0 ? (
              <View style={styles.assetRow}>
                <Text style={[styles.assetLabel, { color: colors.textMuted }]}>
                  − {t('zakat.liabilities')}
                </Text>
                <Text style={[styles.assetVal, typography.numeric, { color: colors.danger }]}>
                  {formatPKR(ass.liabilities)}
                </Text>
              </View>
            ) : null}
          </Card>
        ))
      ) : (
        <EmptyState icon="calculator-outline" title={t('common.emptyTitle')} subtitle={t('zakat.separateNote')} />
      )}

      {/* Zakat Payments List */}
      <Text style={[styles.sectionHeader, { color: colors.text }]}>
        {t('zakat.payments')}
      </Text>
      {summary && summary.payments.length > 0 ? (
        summary.payments.map((pay) => (
          <Card key={pay.id} style={styles.card}>
            <View style={styles.kvRow}>
              <View>
                <Text style={[styles.kvVal, { color: colors.text }]}>
                  {formatDateShort(pay.paid_on, lang)}
                </Text>
                {pay.remark ? (
                  <Text style={[styles.assetLabel, { color: colors.textSecondary }]}>
                    {pay.remark}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.payAmount, typography.numeric, { color: colors.zakat }]}>
                {formatPKR(pay.amount)}
              </Text>
            </View>
          </Card>
        ))
      ) : (
        <Card>
          <Text style={[styles.noteText, { color: colors.textSecondary }]}>
            {t('common.emptySubtitle')}
          </Text>
        </Card>
      )}

      {/* Scholar Disclaimer Banner */}
      <Card style={{ backgroundColor: colors.surfaceSubtle }}>
        <Text style={[styles.scholarText, { color: colors.textSecondary }]}>
          {t('zakat.scholarNote')}
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  chips: { gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '700' },
  card: { gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  noteText: { fontSize: 13, lineHeight: 19 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  statCol: { flex: 1, gap: 2 },
  statLabel: { fontSize: 12 },
  statVal: { fontSize: 16, fontWeight: '800' },
  sectionHeader: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kvLabel: { fontSize: 13 },
  kvVal: { fontSize: 14, fontWeight: '700' },
  assetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingStart: 8 },
  assetLabel: { fontSize: 12 },
  assetVal: { fontSize: 12, fontWeight: '600' },
  payAmount: { fontSize: 16, fontWeight: '800' },
  scholarText: { fontSize: 12, lineHeight: 18 },
});
