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
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import { getKarachiToday } from '@/core/dates';
import { Card } from '@/core/ui/Card';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { runSync } from '@/data/sync/syncEngine';
import { computeZakatMemberYearSummary } from '@/core/rules/zakat';

type ZakatFilter = 'all' | 'unpaid' | 'paid';

/** Passwordless Read-Only Community Annual Zakat Register (strictly separate from charity). */
export function ViewerZakatScreen() {
  const { colors, radius, typography, isDark } = useTheme();
  const { t } = useTranslation();
  const { data, isLoading } = useRegisterSnapshot();

  const defaultYear = Number.parseInt(getKarachiToday().slice(0, 4), 10);
  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const [filter, setFilter] = useState<ZakatFilter>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const years = useMemo(() => {
    const set = new Set<number>([defaultYear]);
    (data?.zakatSettings ?? []).forEach((s) => set.add(s.year));
    (data?.zakatPayments ?? []).forEach((p) => set.add(p.year));
    return Array.from(set).sort((a, b) => b - a);
  }, [data, defaultYear]);

  const activeSetting = useMemo(
    () => (data?.zakatSettings ?? []).find((s) => s.year === selectedYear) ?? null,
    [data, selectedYear],
  );
  const perPersonAmount = activeSetting?.per_person_amount ?? 0;

  const allSummaries = useMemo(() => {
    if (!data) return [];
    return (data.zakatMembers ?? []).map((zm) =>
      computeZakatMemberYearSummary({
        zakatMember: zm,
        year: selectedYear,
        perPersonAmount,
        payments: data.zakatPayments,
      }),
    );
  }, [data, selectedYear, perPersonAmount]);

  const filteredSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSummaries.filter((row) => {
      if (q) {
        const hay = `${row.zakatMember.member_no} ${row.zakatMember.payer_name} ${row.zakatMember.khandan_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === 'unpaid') return row.status === 'unpaid' || row.status === 'partial';
      if (filter === 'paid') return row.status === 'paid';
      return true;
    });
  }, [allSummaries, search, filter]);

  const totals = useMemo(() => {
    let people = 0;
    let due = 0;
    let paid = 0;
    let remaining = 0;
    let unpaidCount = 0;
    let paidCount = 0;
    for (const row of allSummaries) {
      if (row.zakatMember.status === 'active') people += row.peopleCount;
      due += row.dueAmount;
      paid += row.paidAmount;
      remaining += row.remaining;
      if (row.status === 'paid') paidCount += 1;
      else if (row.status === 'unpaid' || row.status === 'partial') unpaidCount += 1;
    }
    return { people, due, paid, remaining, unpaidCount, paidCount };
  }, [allSummaries]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await runSync();
    setRefreshing(false);
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.zakat} />
      }
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

      <LinearGradient
        colors={isDark ? ['#5E4014', '#33220A'] : ['#A66B17', '#73460B']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.heroCard, { borderRadius: radius.xl }]}
      >
        <View style={styles.titleRow}>
          <Ionicons name="sparkles" size={18} color="#FDE68A" />
          <Text style={styles.heroTitle}>
            {t('zakat.title')} · {selectedYear}
          </Text>
        </View>
        <Text style={styles.heroSub}>
          {perPersonAmount > 0
            ? `${t('zakat.rateSummaryLine', { rate: formatPKR(perPersonAmount), people: totals.people })}${activeSetting?.basis_note ? ` · ${activeSetting.basis_note}` : ''}`
            : t('zakat.separateNote')}
        </Text>
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statLabel}>{t('dashboard.zakatDue')}</Text>
            <Text style={[styles.heroStatVal, typography.numeric]}>{formatPKR(totals.due)}</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statLabel}>{t('dashboard.zakatPaid')}</Text>
            <Text style={[styles.heroStatVal, typography.numeric, { color: '#BBF7D0' }]}>{formatPKR(totals.paid)}</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={styles.statLabel}>{t('dashboard.zakatBalance')}</Text>
            <Text style={[styles.heroStatVal, typography.numeric, { color: totals.remaining > 0 ? '#FECACA' : '#FDE68A' }]}>
              {formatPKR(totals.remaining)}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {allSummaries.length > 0 ? (
        <View style={styles.filterBlock}>
          <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md }]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('zakat.searchPlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
          <View style={styles.filterRow}>
            {(
              [
                { key: 'all', label: `${t('common.all')} (${allSummaries.length})` },
                { key: 'unpaid', label: `${t('zakat.statusUnpaid')} (${totals.unpaidCount})` },
                { key: 'paid', label: `${t('zakat.statusPaid')} (${totals.paidCount})` },
              ] as const
            ).map((item) => {
              const active = filter === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setFilter(item.key)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? colors.zakatSoft : colors.surface,
                      borderColor: active ? colors.zakat : colors.border,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text style={[styles.filterText, { color: active ? colors.zakatText : colors.textSecondary }]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {filteredSummaries.length === 0 ? (
        <EmptyState icon="sparkles-outline" title={t('zakat.noMembersYet')} subtitle={t('zakat.separateNote')} />
      ) : (
        filteredSummaries.map((row) => {
          const zm = row.zakatMember;
          const badgeBg =
            row.status === 'paid'
              ? colors.metBg
              : row.status === 'partial'
                ? colors.shortBg
                : row.status === 'unpaid'
                  ? colors.unpaidBg
                  : colors.exemptBg;
          const badgeFg =
            row.status === 'paid'
              ? colors.metText
              : row.status === 'partial'
                ? colors.shortText
                : row.status === 'unpaid'
                  ? colors.unpaidText
                  : colors.exemptText;
          const statusLabel =
            row.status === 'paid'
              ? t('zakat.statusPaid')
              : row.status === 'partial'
                ? t('zakat.statusPartial')
                : row.status === 'unpaid'
                  ? t('zakat.statusUnpaid')
                  : t('compliance.exempt');

          return (
            <Card key={zm.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.flex1}>
                  <Text style={[styles.rowName, { color: colors.text }]}>
                    #{zm.member_no} · {zm.payer_name}
                  </Text>
                  <View style={styles.tagRow}>
                    {zm.khandan_name ? (
                      <Text style={[styles.meta, { color: colors.textSecondary }]}>{zm.khandan_name}</Text>
                    ) : null}
                    <View style={[styles.peoplePill, { backgroundColor: colors.zakatSoft, borderRadius: radius.pill }]}>
                      <Ionicons
                        name={zm.is_family ? 'people-outline' : 'person-outline'}
                        size={12}
                        color={colors.zakatText}
                      />
                      <Text style={[styles.peoplePillText, { color: colors.zakatText }]}>
                        {zm.is_family
                          ? t('zakat.familyBadge', { count: row.peopleCount })
                          : t('zakat.soloBadge')}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.rightCol}>
                  <View style={[styles.statusPill, { backgroundColor: badgeBg, borderRadius: radius.pill }]}>
                    <Text style={[styles.statusPillText, { color: badgeFg }]}>{statusLabel}</Text>
                  </View>
                  <Text style={[styles.statVal, typography.numeric, { color: row.paidAmount > 0 ? colors.metText : colors.text }]}>
                    {row.paidAmount > 0 ? formatPKR(row.paidAmount) : formatPKR(row.dueAmount)}
                  </Text>
                </View>
              </View>
            </Card>
          );
        })
      )}
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
  heroCard: {
    padding: 16,
    gap: 10,
    elevation: 4,
    shadowColor: '#73460B',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroTitle: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  heroSub: { fontSize: 12, lineHeight: 17, color: 'rgba(255,255,255,0.82)' },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  statPill: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  heroStatVal: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  statVal: { fontSize: 15, fontWeight: '800' },
  filterBlock: { gap: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 12, minHeight: 40 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 6 },
  filterRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
  filterText: { fontSize: 12, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  flex1: { flex: 1 },
  rowName: { fontSize: 14, fontWeight: '700' },
  tagRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  peoplePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2 },
  peoplePillText: { fontSize: 11, fontWeight: '700' },
  rightCol: { alignItems: 'flex-end', gap: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 12, lineHeight: 18 },
});
