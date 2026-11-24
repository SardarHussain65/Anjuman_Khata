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
import { formatDateShort, getKarachiToday } from '@/core/dates';
import { useAppLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { ZakatMemberRow, ZakatPaymentRow } from '@/data/db/types';
import { runSync } from '@/data/sync/syncEngine';
import { computeZakatMemberYearSummary } from '@/core/rules/zakat';
import { ZakatSettingsModal } from '../components/ZakatSettingsModal';
import { ZakatMemberFormModal } from '../components/ZakatMemberFormModal';
import { ZakatPaymentModal } from '../components/ZakatPaymentModal';

type ZakatViewTab = 'register' | 'payments';
type ZakatFilter = 'all' | 'unpaid' | 'paid';

export function AdminZakatScreen() {
  const { colors, radius, typography, isDark } = useTheme();
  const { t } = useTranslation();
  const lang = useAppLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const defaultYear = Number.parseInt(getKarachiToday().slice(0, 4), 10);
  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const [viewTab, setViewTab] = useState<ZakatViewTab>('register');
  const [filter, setFilter] = useState<ZakatFilter>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memberFormOpen, setMemberFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<ZakatMemberRow | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payMemberId, setPayMemberId] = useState<string | null>(null);
  const [editingPay, setEditingPay] = useState<ZakatPaymentRow | null>(null);

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

  const zakatMembers = useMemo(() => data?.zakatMembers ?? [], [data]);
  const zakatMemberMap = useMemo(
    () => new Map(zakatMembers.map((m) => [m.id, m])),
    [zakatMembers],
  );

  const nextMemberNo = useMemo(() => {
    const maxNo = zakatMembers.reduce((max, m) => Math.max(max, m.member_no), 0);
    return maxNo + 1;
  }, [zakatMembers]);

  const allSummaries = useMemo(() => {
    if (!data) return [];
    return zakatMembers.map((zm) =>
      computeZakatMemberYearSummary({
        zakatMember: zm,
        year: selectedYear,
        perPersonAmount,
        payments: data.zakatPayments,
      }),
    );
  }, [data, zakatMembers, selectedYear, perPersonAmount]);

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
      if (row.zakatMember.status === 'active') {
        people += row.peopleCount;
      }
      due += row.dueAmount;
      paid += row.paidAmount;
      remaining += row.remaining;
      if (row.status === 'paid') paidCount += 1;
      else if (row.status === 'unpaid' || row.status === 'partial') unpaidCount += 1;
    }
    return { people, due, paid, remaining, unpaidCount, paidCount };
  }, [allSummaries]);

  const yearPayments = useMemo(
    () =>
      (data?.zakatPayments ?? []).filter(
        (p) => p.year === selectedYear && !p.deleted_at,
      ),
    [data, selectedYear],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await runSync();
    setRefreshing(false);
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.zakat} />
        }
      >
        {/* Year selector + Set Per-Person Rate button */}
        <View style={styles.topBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {years.map((yr) => {
              const active = yr === selectedYear;
              return (
                <Pressable
                  key={yr}
                  onPress={() => setSelectedYear(yr)}
                  style={[
                    styles.yearChip,
                    {
                      backgroundColor: active ? colors.zakat : colors.surface,
                      borderColor: active ? colors.zakat : colors.zakatBorder,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text style={[styles.yearChipText, { color: active ? '#FFFFFF' : colors.text }]}>
                    {yr}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={() => setSettingsOpen(true)}
            style={[
              styles.settingsBtn,
              { backgroundColor: colors.zakatSoft, borderColor: colors.zakatBorder, borderRadius: radius.pill },
            ]}
          >
            <Ionicons name="settings-outline" size={16} color={colors.zakat} />
            <Text style={[styles.settingsBtnText, { color: colors.zakatText }]}>
              {perPersonAmount > 0
                ? `${t('zakat.perPersonShort')}: ${formatPKR(perPersonAmount)}`
                : t('zakat.setRate')}
            </Text>
          </Pressable>
        </View>

        {/* Antique Gold Gradient Hero Summary Card — Strictly Isolated from Monthly Charity */}
        <LinearGradient
          colors={isDark ? ['#5E4014', '#33220A'] : ['#A66B17', '#73460B']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, { borderRadius: radius.xl }]}
        >
          <View style={styles.heroHeader}>
            <Ionicons name="sparkles" size={18} color="#FDE68A" />
            <Text style={styles.heroTitle}>
              {t('zakat.title')} · {selectedYear}
            </Text>
          </View>

          {perPersonAmount > 0 ? (
            <Text style={styles.subNote}>
              {t('zakat.rateSummaryLine', {
                rate: formatPKR(perPersonAmount),
                people: totals.people,
              })}
              {activeSetting?.basis_note ? ` · ${activeSetting.basis_note}` : ''}
            </Text>
          ) : (
            <Pressable
              onPress={() => setSettingsOpen(true)}
              style={[styles.ratePrompt, { borderRadius: radius.md }]}
            >
              <Ionicons name="alert-circle-outline" size={16} color="#FDE68A" />
              <Text style={styles.ratePromptText}>
                {t('zakat.setRatePrompt', { year: selectedYear })}
              </Text>
            </Pressable>
          )}

          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>{t('dashboard.zakatDue')}</Text>
              <Text style={[styles.statVal, typography.numeric]}>
                {formatPKR(totals.due)}
              </Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>{t('dashboard.zakatPaid')}</Text>
              <Text style={[styles.statVal, typography.numeric, { color: '#BBF7D0' }]}>
                {formatPKR(totals.paid)}
              </Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>{t('dashboard.zakatBalance')}</Text>
              <Text style={[styles.statVal, typography.numeric, { color: totals.remaining > 0 ? '#FECACA' : '#FDE68A' }]}>
                {formatPKR(totals.remaining)}
              </Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              onPress={() => {
                setEditingMember(null);
                setMemberFormOpen(true);
              }}
              style={[styles.heroBtnPrimary, { borderRadius: radius.md }]}
            >
              <Ionicons name="person-add-outline" size={16} color="#73460B" />
              <Text style={styles.heroBtnPrimaryText}>{t('zakat.addMember')}</Text>
            </Pressable>
            <Pressable
              disabled={zakatMembers.length === 0}
              onPress={() => {
                setEditingPay(null);
                setPayMemberId(zakatMembers[0]?.id ?? null);
                setPayOpen(true);
              }}
              style={[
                styles.heroBtnGhost,
                { borderRadius: radius.md, opacity: zakatMembers.length === 0 ? 0.5 : 1 },
              ]}
            >
              <Ionicons name="cash-outline" size={16} color="#FFFFFF" />
              <Text style={styles.heroBtnGhostText}>{t('zakat.recordPayment')}</Text>
            </Pressable>
          </View>
        </LinearGradient>

        {/* Sub-tabs: Registered Families / Payments Log */}
        <View style={styles.segmentRow}>
          {(['register', 'payments'] as const).map((tab) => {
            const active = viewTab === tab;
            return (
              <Pressable
                key={tab}
                onPress={() => setViewTab(tab)}
                style={[
                  styles.segmentBtn,
                  {
                    backgroundColor: active ? colors.zakat : colors.surface,
                    borderColor: active ? colors.zakat : colors.border,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={[styles.segmentText, { color: active ? '#FFFFFF' : colors.textSecondary }]}>
                  {tab === 'register'
                    ? `${t('zakat.membersList')} (${zakatMembers.length})`
                    : `${t('zakat.payments')} (${yearPayments.length})`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {viewTab === 'register' ? (
          <>
            {/* Search + All/Unpaid/Paid filter */}
            {zakatMembers.length > 0 ? (
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
              <EmptyState
                icon="people-outline"
                title={t('zakat.noMembersYet')}
                subtitle={t('zakat.separateRegisterHint')}
              />
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
                  <Pressable
                    key={zm.id}
                    onPress={() => {
                      setEditingPay(row.payments[0] ?? null);
                      setPayMemberId(zm.id);
                      setPayOpen(true);
                    }}
                  >
                    <Card style={styles.rowCard}>
                      <View style={styles.rowBetween}>
                        <View style={styles.flex1}>
                          <Text style={[styles.rowName, { color: colors.text }]}>
                            #{zm.member_no} · {zm.payer_name}
                          </Text>
                          <View style={styles.tagRow}>
                            {zm.khandan_name ? (
                              <Text style={[styles.khandanText, { color: colors.textSecondary }]}>
                                {zm.khandan_name}
                              </Text>
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
                          <Text style={[styles.amountVal, typography.numeric, { color: row.paidAmount > 0 ? colors.metText : colors.text }]}>
                            {row.paidAmount > 0 ? formatPKR(row.paidAmount) : formatPKR(row.dueAmount)}
                          </Text>
                          {row.remaining > 0 ? (
                            <Text style={[styles.remText, typography.numeric, { color: colors.danger }]}>
                              -{formatPKR(row.remaining)}
                            </Text>
                          ) : row.extra > 0 ? (
                            <Text style={[styles.remText, typography.numeric, { color: colors.metText }]}>
                              +{formatPKR(row.extra)}
                            </Text>
                          ) : null}
                        </View>

                        <Pressable
                          accessibilityLabel="Edit zakat member"
                          onPress={() => {
                            setEditingMember(zm);
                            setMemberFormOpen(true);
                          }}
                          style={[styles.editIconBtn, { borderColor: colors.border, borderRadius: radius.sm }]}
                        >
                          <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
                        </Pressable>
                      </View>
                    </Card>
                  </Pressable>
                );
              })
            )}
          </>
        ) : yearPayments.length === 0 ? (
          <EmptyState icon="receipt-outline" />
        ) : (
          yearPayments.map((pay) => {
            const zm = pay.zakat_member_id ? zakatMemberMap.get(pay.zakat_member_id) : null;
            return (
              <Pressable
                key={pay.id}
                onPress={() => {
                  setEditingPay(pay);
                  setPayMemberId(pay.zakat_member_id);
                  setPayOpen(true);
                }}
              >
                <Card style={styles.rowCard}>
                  <View style={styles.rowBetween}>
                    <View style={styles.flex1}>
                      <Text style={[styles.rowName, { color: colors.text }]}>
                        {zm
                          ? `#${zm.member_no} · ${zm.payer_name}${zm.khandan_name ? ` (${zm.khandan_name})` : ''}`
                          : t('zakat.title')}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textSecondary }]}>
                        {formatDateShort(pay.paid_on, lang)}
                        {pay.family_count_snapshot
                          ? ` · ${pay.family_count_snapshot} ${t('zakat.peopleUnit')}`
                          : ''}
                        {pay.remark ? ` · ${pay.remark}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.amountVal, typography.numeric, { color: colors.zakat }]}>
                      {formatPKR(pay.amount)}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <ZakatSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        year={selectedYear}
        existingSetting={activeSetting}
      />

      <ZakatMemberFormModal
        visible={memberFormOpen}
        onClose={() => setMemberFormOpen(false)}
        editingMember={editingMember}
        nextMemberNo={nextMemberNo}
        perPersonAmount={perPersonAmount}
      />

      <ZakatPaymentModal
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        year={selectedYear}
        perPersonAmount={perPersonAmount}
        zakatMembers={zakatMembers}
        fiscalYears={data?.fiscalYears ?? []}
        initialZakatMemberId={payMemberId}
        editingPayment={editingPay}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 14, gap: 12, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { gap: 6 },
  yearChip: { paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1 },
  yearChipText: { fontSize: 13, fontWeight: '700' },
  settingsBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1 },
  settingsBtnText: { fontSize: 12, fontWeight: '700' },
  heroCard: {
    padding: 16,
    gap: 10,
    elevation: 4,
    shadowColor: '#73460B',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  heroHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroTitle: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  subNote: { fontSize: 12, lineHeight: 17, color: 'rgba(255,255,255,0.82)' },
  ratePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  ratePromptText: { flex: 1, fontSize: 12, fontWeight: '700', color: '#FEF3C7' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  statPill: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  statVal: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  heroBtnPrimary: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  heroBtnPrimaryText: { color: '#73460B', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  heroBtnGhost: {
    flex: 1,
    minHeight: 44,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  heroBtnGhostText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  flex1: { flex: 1 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, minHeight: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 12, fontWeight: '700' },
  filterBlock: { gap: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 12, minHeight: 40 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 6 },
  filterRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
  filterText: { fontSize: 12, fontWeight: '600' },
  rowCard: { gap: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { fontSize: 14, fontWeight: '700' },
  tagRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  khandanText: { fontSize: 12, fontWeight: '500' },
  peoplePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2 },
  peoplePillText: { fontSize: 11, fontWeight: '700' },
  rightCol: { alignItems: 'flex-end', gap: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  amountVal: { fontSize: 14, fontWeight: '800' },
  remText: { fontSize: 11, fontWeight: '700' },
  editIconBtn: { width: 32, height: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  meta: { fontSize: 12, marginTop: 2 },
});
