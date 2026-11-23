import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR } from '@/core/money';
import { formatMonthShort, getKarachiCurrentMonthStart } from '@/core/dates';
import { getCurrentLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { ComplianceBadge } from '@/core/ui/Badge';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { ProfileRow } from '@/data/db/types';
import { findCurrentFiscalYear } from '@/core/rules/fiscalYear';
import {
  computeLifetimeCharityTotal,
  computeMemberFiscalYearSummary,
} from '@/core/rules/compliance';
import { resolveEffectiveTierForMonth } from '@/core/rules/tiers';

/** Passwordless Read-Only Community Member Directory & Detail Inspector. */
export function ViewerMembersScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const lang = getCurrentLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const [search, setSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<ProfileRow | null>(null);
  const currentMonth = getKarachiCurrentMonthStart();

  const activeFy = useMemo(
    () => (data ? findCurrentFiscalYear(data.fiscalYears) : null),
    [data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.profiles ?? []).filter((p) => {
      if (!q) return true;
      const hay = `${p.member_no} ${p.full_name} ${p.full_name_ur ?? ''} ${p.designation ?? ''} ${p.tag ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, search]);

  const selectedSummary = useMemo(() => {
    if (!selectedMember || !data || !activeFy) return null;
    return computeMemberFiscalYearSummary({
      profile: selectedMember,
      fiscalYear: activeFy,
      contributions: data.contributions,
      memberTiers: data.memberTiers,
      tiers: data.tiers,
      tierRates: data.tierRates,
      currentMonthStart: currentMonth,
    });
  }, [selectedMember, data, activeFy, currentMonth]);

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.controls, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radius.md }]}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('ledger.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
      </View>

      <FlashList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState icon="people-outline" />}
        renderItem={({ item }) => {
          const eff = resolveEffectiveTierForMonth(
            item.id,
            currentMonth,
            data?.memberTiers ?? [],
            data?.tiers ?? [],
            data?.tierRates ?? [],
          );
          const lifetime = computeLifetimeCharityTotal(item.id, data?.contributions ?? []);
          const displayName = lang === 'ur' && item.full_name_ur ? item.full_name_ur : item.full_name;
          return (
            <Pressable onPress={() => setSelectedMember(item)}>
              <Card style={styles.memberCard}>
                <View style={styles.rowBetween}>
                  <View style={styles.flex1}>
                    <Text style={[styles.memberName, { color: colors.text }]}>
                      #{item.member_no} · {displayName}
                    </Text>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>
                      {item.designation ? `${item.designation} · ` : ''}
                      {t(`memberStatus.${item.status}`)}
                    </Text>
                    <Text style={[styles.tierMeta, { color: colors.primary }]}>
                      {item.status === 'non_earning'
                        ? t('dashboard.noTierExempt')
                        : eff
                          ? `${lang === 'ur' && eff.tierNameUr ? eff.tierNameUr : eff.tierName} (${formatPKR(eff.minAmount)}/mo)`
                          : t('dashboard.noTierExempt')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.lifetimeVal, typography.numeric, { color: colors.primary }]}>
                      {formatPKR(lifetime)}
                    </Text>
                    <Text style={[styles.meta, { color: colors.textMuted }]}>
                      {t('common.total')}
                    </Text>
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />

      {/* Read-Only Member 12-Month Record Modal */}
      <Modal
        visible={Boolean(selectedMember)}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedMember(null)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                #{selectedMember?.member_no} · {selectedMember?.full_name}
              </Text>
              <Pressable onPress={() => setSelectedMember(null)} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              {selectedSummary ? (
                <>
                  <Card variant="charity" style={{ gap: 6 }}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.meta, { color: colors.primary }]}>
                        {activeFy?.label} {t('ledger.collected')}
                      </Text>
                      {selectedSummary.currentMonthCompliance ? (
                        <ComplianceBadge status={selectedSummary.currentMonthCompliance.status} compact />
                      ) : null}
                    </View>
                    <Text style={[styles.heroAmt, typography.numeric, { color: colors.text }]}>
                      {formatPKR(selectedSummary.yearlyCharityTotal)}
                    </Text>
                  </Card>

                  <View style={styles.monthGrid}>
                    {selectedSummary.months.map((cell) => (
                      <View
                        key={cell.periodStart}
                        style={[
                          styles.monthTile,
                          {
                            backgroundColor:
                              cell.status === 'met'
                                ? colors.metBg
                                : cell.status === 'short'
                                  ? colors.shortBg
                                  : cell.status === 'unpaid'
                                    ? colors.unpaidBg
                                    : colors.exemptBg,
                            borderRadius: radius.md,
                          },
                        ]}
                      >
                        <Text style={[styles.meta, { color: colors.text }]}>
                          {formatMonthShort(cell.periodStart, lang)}
                        </Text>
                        <Text style={[styles.tileAmt, typography.numeric, { color: colors.text }]}>
                          {cell.paidAmount > 0 ? formatPKR(cell.paidAmount) : '—'}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { padding: 12, borderBottomWidth: 1 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: 1, minHeight: 42 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  list: { padding: 14, paddingBottom: 24 },
  memberCard: { marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  flex1: { flex: 1, gap: 2 },
  memberName: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12 },
  tierMeta: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  lifetimeVal: { fontSize: 15, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  closeBtn: { padding: 6 },
  sheetBody: { padding: 16, gap: 14, paddingBottom: 32 },
  heroAmt: { fontSize: 24, fontWeight: '800' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthTile: { width: '31.2%', paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 2 },
  tileAmt: { fontSize: 12, fontWeight: '700' },
});
