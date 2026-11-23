import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import { formatDateShort, formatMonthYear } from '@/core/dates';
import { getCurrentLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { ContributionRow } from '@/data/db/types';
import { useAuthStore } from '@/features/auth/store/authStore';
import { isPeriodInFiscalYear } from '@/core/rules/fiscalYear';

export function UserHistoryScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const lang = getCurrentLanguage();
  const memberId = useAuthStore((s) => s.profile?.id ?? '');
  const { data, isLoading } = useRegisterSnapshot();
  const [selectedFyId, setSelectedFyId] = useState<string>('ALL');

  const fiscalYears = useMemo(() => data?.fiscalYears ?? [], [data]);

  const filtered = useMemo<ContributionRow[]>(() => {
    if (!data) return [];
    const fy = fiscalYears.find((f) => f.id === selectedFyId) ?? null;
    return data.contributions.filter((c) => {
      if (c.member_id !== memberId || c.deleted_at) return false;
      if (fy && !isPeriodInFiscalYear(c.period_start, fy)) return false;
      return true;
    });
  }, [data, fiscalYears, selectedFyId, memberId]);

  const totalAmount = useMemo(
    () => filtered.reduce((sum, item) => sum + item.amount, 0),
    [filtered],
  );

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsContent}
      >
        <Pressable
          onPress={() => setSelectedFyId('ALL')}
          style={[
            styles.chip,
            {
              backgroundColor: selectedFyId === 'ALL' ? colors.primary : colors.surface,
              borderColor: selectedFyId === 'ALL' ? colors.primary : colors.borderStrong,
              borderRadius: radius.pill,
            },
          ]}
        >
          <Text style={[styles.chipText, { color: selectedFyId === 'ALL' ? '#FFFFFF' : colors.text }]}>
            {t('common.all')}
          </Text>
        </Pressable>
        {fiscalYears.map((fy) => {
          const active = selectedFyId === fy.id;
          return (
            <Pressable
              key={fy.id}
              onPress={() => setSelectedFyId(fy.id)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.surface,
                  borderColor: active ? colors.primary : colors.borderStrong,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.text }]}>
                {fy.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.summaryBar}>
        <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
          {filtered.length} {t('tabs.history')}
        </Text>
        <Text style={[styles.summaryTotal, typography.numeric, { color: colors.primary }]}>
          {t('common.total')}: {formatPKR(totalAmount)}
        </Text>
      </View>

      <FlashList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyState icon="receipt-outline" />}
        renderItem={({ item }) => (
          <Card style={styles.itemCard}>
            <View style={styles.itemTop}>
              <View>
                <Text style={[styles.periodText, { color: colors.text }]}>
                  {formatMonthYear(item.period_start, lang)}
                </Text>
                <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                  {formatDateShort(item.paid_on, lang)} · {item.kind}
                </Text>
              </View>
              <Text style={[styles.amountText, typography.numeric, { color: colors.primary }]}>
                {formatPKR(item.amount)}
              </Text>
            </View>
            {item.remark ? (
              <Text style={[styles.remarkText, { color: colors.textSecondary }]}>
                {item.remark}
              </Text>
            ) : null}
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chipsScroll: { flexGrow: 0, maxHeight: 56 },
  chipsContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  summaryLabel: { fontSize: 13 },
  summaryTotal: { fontSize: 14, fontWeight: '700' },
  listContent: { padding: 16, paddingTop: 4 },
  itemCard: { marginBottom: 10, gap: 6 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  periodText: { fontSize: 15, fontWeight: '700' },
  metaText: { fontSize: 12, marginTop: 2 },
  amountText: { fontSize: 16, fontWeight: '800' },
  remarkText: { fontSize: 13, fontStyle: 'italic' },
});
