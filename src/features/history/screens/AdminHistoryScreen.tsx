import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { BarChart } from 'react-native-gifted-charts';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR, parsePKR } from '@/core/money';
import {
  buildFiscalYearDefinition,
  formatDateShort,
  formatMonthYear,
  getKarachiToday,
} from '@/core/dates';
import { useAppLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { TextField } from '@/core/ui/TextField';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { AuditLogRow, ContributionKind, ContributionRow, FiscalYearRow } from '@/data/db/types';
import { localInsert, localUpdate } from '@/data/sync/syncEngine';
import { isPeriodInFiscalYear } from '@/core/rules/fiscalYear';
import { resolveEffectiveTierForMonth } from '@/core/rules/tiers';
import { fetchRecordAuditTimeline } from '@/data/api/auditApi';
import { useAuthStore } from '@/features/auth/store/authStore';

export function AdminHistoryScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const lang = useAppLanguage();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);
  const { data, isLoading } = useRegisterSnapshot();

  const [selectedFyId, setSelectedFyId] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | ContributionKind>('all');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [minAmtInput, setMinAmtInput] = useState('');
  const [maxAmtInput, setMaxAmtInput] = useState('');
  const [showVoided, setShowVoided] = useState(false);

  // Reopen fiscal year modal
  const [reopenTarget, setReopenTarget] = useState<FiscalYearRow | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [fyBusy, setFyBusy] = useState(false);

  // Add new fiscal year modal
  const [addFyOpen, setAddFyOpen] = useState(false);
  const [newFyStartYear, setNewFyStartYear] = useState(
    String(Number.parseInt(getKarachiToday().slice(0, 4), 10) + 1),
  );

  // Per-record audit timeline modal
  const [timelineTarget, setTimelineTarget] = useState<ContributionRow | null>(null);
  const [timelineRows, setTimelineRows] = useState<AuditLogRow[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const profileMap = useMemo(
    () => new Map((data?.profiles ?? []).map((p) => [p.id, p])),
    [data],
  );

  // Year-over-Year totals (strictly charity contributions, excluding voided)
  const yoyData = useMemo(() => {
    if (!data) return [];
    const sortedFys = [...data.fiscalYears].sort((a, b) => a.start_date.localeCompare(b.start_date));
    return sortedFys.map((fy) => {
      const total = data.contributions
        .filter((c) => !c.deleted_at && isPeriodInFiscalYear(c.period_start, fy))
        .reduce((sum, c) => sum + c.amount, 0);
      return {
        fy,
        total,
        chartItem: {
          value: total,
          label: fy.label,
          frontColor: fy.status === 'closed' ? colors.textMuted : colors.primary,
        },
      };
    });
  }, [data, colors.primary, colors.textMuted]);

  const filteredEntries = useMemo(() => {
    if (!data) return [];
    const selectedFy =
      selectedFyId === 'ALL'
        ? null
        : data.fiscalYears.find((f) => f.id === selectedFyId) ?? null;
    const minAmt = minAmtInput.trim() ? parsePKR(minAmtInput) : null;
    const maxAmt = maxAmtInput.trim() ? parsePKR(maxAmtInput) : null;
    const q = search.trim().toLowerCase();

    return data.contributions.filter((c) => {
      if (!showVoided && c.deleted_at) return false;
      if (selectedFy && !isPeriodInFiscalYear(c.period_start, selectedFy)) return false;
      if (kindFilter !== 'all' && c.kind !== kindFilter) return false;
      if (minAmt != null && c.amount < minAmt) return false;
      if (maxAmt != null && c.amount > maxAmt) return false;

      if (tierFilter !== 'all') {
        const eff = resolveEffectiveTierForMonth(
          c.member_id,
          c.period_start,
          data.memberTiers,
          data.tiers,
          data.tierRates,
        );
        if (eff?.tierId !== tierFilter) return false;
      }

      if (q) {
        const member = profileMap.get(c.member_id);
        const hay = `${member?.member_no ?? ''} ${member?.full_name ?? ''} ${member?.full_name_ur ?? ''} ${c.remark ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [data, selectedFyId, minAmtInput, maxAmtInput, search, showVoided, kindFilter, tierFilter, profileMap]);

  const filteredActiveTotal = useMemo(
    () =>
      filteredEntries
        .filter((e) => !e.deleted_at)
        .reduce((sum, e) => sum + e.amount, 0),
    [filteredEntries],
  );

  const handleCloseYear = (fy: FiscalYearRow) => {
    Alert.alert(
      `${t('history.closeYear')} ${fy.label}`,
      'Closing this year locks all contribution and Zakat edits for this period.',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('history.closeYear'),
          style: 'destructive',
          onPress: async () => {
            setFyBusy(true);
            try {
              await localUpdate(
                'fiscal_years',
                fy.id,
                {
                  status: 'closed',
                  closed_by: adminId,
                  closed_at: new Date().toISOString(),
                },
                { actorId: adminId },
              );
            } finally {
              setFyBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleReopenYear = async () => {
    if (!reopenTarget) return;
    if (!reopenReason.trim()) {
      Alert.alert(t('common.required'), t('history.reopenReasonLabel'));
      return;
    }
    setFyBusy(true);
    try {
      await localUpdate(
        'fiscal_years',
        reopenTarget.id,
        {
          status: 'open',
          reopen_reason: reopenReason.trim(),
          closed_at: null,
          closed_by: null,
        },
        { actorId: adminId },
      );
      setReopenTarget(null);
      setReopenReason('');
    } finally {
      setFyBusy(false);
    }
  };

  const handleCreateFiscalYear = async () => {
    const startYear = Number.parseInt(newFyStartYear, 10);
    if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100) {
      Alert.alert(t('common.required'), 'Enter a valid 4-digit year (e.g. 2027).');
      return;
    }
    const startMonth = data?.orgSettings?.fiscal_year_start_month ?? 1;
    const def = buildFiscalYearDefinition(startYear, startMonth);
    setFyBusy(true);
    try {
      await localInsert(
        'fiscal_years',
        {
          label: def.label,
          start_date: def.startDate,
          end_date: def.endDate,
          status: 'open',
          closed_by: null,
          closed_at: null,
          reopen_reason: null,
        },
        { actorId: adminId },
      );
      setAddFyOpen(false);
    } finally {
      setFyBusy(false);
    }
  };

  const openTimeline = async (entry: ContributionRow) => {
    setTimelineTarget(entry);
    setTimelineLoading(true);
    const res = await fetchRecordAuditTimeline(entry.id);
    setTimelineRows(res.rows);
    setTimelineLoading(false);
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlashList
        data={filteredEntries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyState icon="archive-outline" />}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {/* Year-over-Year Chart */}
            {yoyData.length > 0 ? (
              <Card style={styles.card}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {t('history.yoyTotals')}
                </Text>
                <BarChart
                  data={yoyData.map((d) => d.chartItem)}
                  barWidth={32}
                  spacing={20}
                  roundedTop
                  hideRules
                  height={130}
                  xAxisColor={colors.border}
                  yAxisColor={colors.border}
                  yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 11 }}
                  noOfSections={4}
                  isAnimated={false}
                />
              </Card>
            ) : null}

            {/* Fiscal Years Close / Reopen Management */}
            <Card style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {t('history.fiscalYears')}
                </Text>
                <Pressable
                  onPress={() => setAddFyOpen(true)}
                  style={[styles.smallAction, { backgroundColor: colors.primarySoft, borderRadius: radius.pill }]}
                >
                  <Ionicons name="add" size={14} color={colors.primary} />
                  <Text style={[styles.smallActionText, { color: colors.primary }]}>
                    {t('common.year')}
                  </Text>
                </Pressable>
              </View>

              {(data?.fiscalYears ?? []).map((fy) => {
                const yoy = yoyData.find((d) => d.fy.id === fy.id);
                const isClosed = fy.status === 'closed';
                return (
                  <View key={fy.id} style={[styles.fyItem, { borderTopColor: colors.border }]}>
                    <View style={styles.fyInfo}>
                      <View style={styles.fyTitleRow}>
                        <Ionicons
                          name={isClosed ? 'lock-closed' : 'lock-open-outline'}
                          size={15}
                          color={isClosed ? colors.danger : colors.metText}
                        />
                        <Text style={[styles.fyLabel, { color: colors.text }]}>{fy.label}</Text>
                        <Text style={[styles.fyDates, { color: colors.textMuted }]}>
                          ({fy.start_date} → {fy.end_date})
                        </Text>
                      </View>
                      <Text style={[styles.fyTotal, typography.numeric, { color: colors.primary }]}>
                        {formatPKR(yoy?.total ?? 0)}
                      </Text>
                    </View>
                    <Pressable
                      disabled={fyBusy}
                      onPress={() =>
                        isClosed
                          ? (setReopenTarget(fy), setReopenReason(''))
                          : handleCloseYear(fy)
                      }
                      style={[
                        styles.fyBtn,
                        {
                          borderColor: isClosed ? colors.warning : colors.danger,
                          borderRadius: radius.sm,
                        },
                      ]}
                    >
                      <Text style={[styles.fyBtnText, { color: isClosed ? colors.warning : colors.danger }]}>
                        {isClosed ? t('history.reopenYear') : t('history.closeYear')}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </Card>

            {/* Advanced Filters */}
            <Card style={styles.card}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Pressable
                  onPress={() => setSelectedFyId('ALL')}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selectedFyId === 'ALL' ? colors.primary : colors.surfaceSubtle,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: selectedFyId === 'ALL' ? '#FFFFFF' : colors.text }]}>
                    {t('common.all')}
                  </Text>
                </Pressable>
                {(data?.fiscalYears ?? []).map((fy) => {
                  const active = selectedFyId === fy.id;
                  return (
                    <Pressable
                      key={fy.id}
                      onPress={() => setSelectedFyId(fy.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.surfaceSubtle,
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

              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t('ledger.searchPlaceholder')}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { borderColor: colors.borderStrong, color: colors.text, borderRadius: radius.md }]}
              />

              <View style={styles.rangeRow}>
                <TextInput
                  value={minAmtInput}
                  onChangeText={setMinAmtInput}
                  keyboardType="number-pad"
                  placeholder="Min PKR"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.flex1, { borderColor: colors.borderStrong, color: colors.text, borderRadius: radius.md }]}
                />
                <TextInput
                  value={maxAmtInput}
                  onChangeText={setMaxAmtInput}
                  keyboardType="number-pad"
                  placeholder="Max PKR"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.flex1, { borderColor: colors.borderStrong, color: colors.text, borderRadius: radius.md }]}
                />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {(['all', 'monthly', 'special', 'advance'] as const).map((k) => {
                  const active = kindFilter === k;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => setKindFilter(k)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primarySoft : colors.background,
                          borderColor: active ? colors.primary : colors.border,
                          borderWidth: 1,
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? colors.primary : colors.textSecondary }]}>
                        {k}
                      </Text>
                    </Pressable>
                  );
                })}
                {(data?.tiers ?? []).map((tier) => {
                  const active = tierFilter === tier.id;
                  return (
                    <Pressable
                      key={tier.id}
                      onPress={() => setTierFilter(active ? 'all' : tier.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primarySoft : colors.background,
                          borderColor: active ? colors.primary : colors.border,
                          borderWidth: 1,
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? colors.primary : colors.textSecondary }]}>
                        {lang === 'ur' && tier.name_ur ? tier.name_ur : tier.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.rowBetween}>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {t('history.showVoided')}
                </Text>
                <Switch value={showVoided} onValueChange={setShowVoided} />
              </View>

              <View style={styles.rowBetween}>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {filteredEntries.length} rows
                </Text>
                <Text style={[styles.fyTotal, typography.numeric, { color: colors.primary }]}>
                  {t('common.total')}: {formatPKR(filteredActiveTotal)}
                </Text>
              </View>
            </Card>
          </View>
        }
        renderItem={({ item }) => {
          const member = profileMap.get(item.member_id);
          const isVoid = Boolean(item.deleted_at);
          return (
            <Pressable onPress={() => void openTimeline(item)}>
              <Card style={[styles.entryCard, isVoid && { opacity: 0.65, borderColor: colors.danger }]}>
                <View style={styles.rowBetween}>
                  <View style={styles.flex1}>
                    <Text style={[styles.entryName, { color: colors.text }]}>
                      #{member?.member_no ?? '?'} · {member?.full_name ?? item.member_id.slice(0, 8)}
                    </Text>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>
                      {formatMonthYear(item.period_start, lang)} · {formatDateShort(item.paid_on, lang)} · {item.kind}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.entryAmt,
                      typography.numeric,
                      {
                        color: isVoid ? colors.danger : colors.primary,
                        textDecorationLine: isVoid ? 'line-through' : 'none',
                      },
                    ]}
                  >
                    {formatPKR(item.amount)}
                  </Text>
                </View>
                {item.remark ? (
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>{item.remark}</Text>
                ) : null}
                {isVoid && item.void_reason ? (
                  <Text style={[styles.meta, { color: colors.danger }]}>
                    Voided: {item.void_reason}
                  </Text>
                ) : null}
              </Card>
            </Pressable>
          );
        }}
      />

      {/* Reopen Fiscal Year Modal (Reason Required + Audited) */}
      <Modal visible={Boolean(reopenTarget)} transparent animationType="fade" onRequestClose={() => setReopenTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('history.reopenYear')} · {reopenTarget?.label}
            </Text>
            <TextField
              label={t('history.reopenReasonLabel')}
              value={reopenReason}
              onChangeText={setReopenReason}
              placeholder="Audit correction approved by committee"
            />
            <View style={styles.rangeRow}>
              <Button label={t('common.cancel')} variant="secondary" onPress={() => setReopenTarget(null)} style={styles.flex1} />
              <Button label={t('common.confirm')} loading={fyBusy} onPress={handleReopenYear} style={styles.flex1} />
            </View>
          </Card>
        </View>
      </Modal>

      {/* Add Fiscal Year Modal */}
      <Modal visible={addFyOpen} transparent animationType="fade" onRequestClose={() => setAddFyOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Add Fiscal Year (Start Month: {data?.orgSettings?.fiscal_year_start_month ?? 1})
            </Text>
            <TextField
              label="Start Year"
              keyboardType="number-pad"
              value={newFyStartYear}
              onChangeText={setNewFyStartYear}
              placeholder="2027"
            />
            <View style={styles.rangeRow}>
              <Button label={t('common.cancel')} variant="secondary" onPress={() => setAddFyOpen(false)} style={styles.flex1} />
              <Button label={t('common.save')} loading={fyBusy} onPress={handleCreateFiscalYear} style={styles.flex1} />
            </View>
          </Card>
        </View>
      </Modal>

      {/* Per-Record Audit Timeline Modal */}
      <Modal visible={Boolean(timelineTarget)} transparent animationType="slide" onRequestClose={() => setTimelineTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Card style={[styles.modalCard, { maxHeight: '75%' }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('history.changeTimeline')}
              </Text>
              <Pressable onPress={() => setTimelineTarget(null)}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: 8 }}>
              {timelineLoading ? (
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{t('common.loading')}</Text>
              ) : timelineRows.length === 0 ? (
                <Text style={[styles.meta, { color: colors.textSecondary }]}>{t('common.emptySubtitle')}</Text>
              ) : (
                timelineRows.map((row) => (
                  <View key={row.id} style={[styles.timelineItem, { borderColor: colors.border }]}>
                    <Text style={[styles.entryName, { color: colors.primary }]}>{row.action}</Text>
                    <Text style={[styles.meta, { color: colors.textMuted }]}>
                      {row.created_at.slice(0, 19).replace('T', ' ')}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: { padding: 14, paddingBottom: 32 },
  headerBlock: { gap: 14, marginBottom: 14 },
  card: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  smallAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5 },
  smallActionText: { fontSize: 12, fontWeight: '700' },
  fyItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 10, gap: 8 },
  fyInfo: { flex: 1, gap: 2 },
  fyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  fyLabel: { fontSize: 14, fontWeight: '700' },
  fyDates: { fontSize: 11 },
  fyTotal: { fontSize: 14, fontWeight: '800' },
  fyBtn: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  fyBtnText: { fontSize: 12, fontWeight: '700' },
  chips: { gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  rangeRow: { flexDirection: 'row', gap: 8 },
  flex1: { flex: 1 },
  meta: { fontSize: 12 },
  entryCard: { marginBottom: 10, gap: 4 },
  entryName: { fontSize: 14, fontWeight: '700' },
  entryAmt: { fontSize: 15, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modalCard: { gap: 12 },
  timelineItem: { borderTopWidth: 1, paddingTop: 8, gap: 2 },
});
