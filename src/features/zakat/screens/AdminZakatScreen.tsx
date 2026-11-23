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
import { Button } from '@/core/ui/Button';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { ZakatPaymentRow } from '@/data/db/types';
import { computeMemberZakatYearSummary } from '@/core/rules/zakat';
import { ZakatSettingsModal } from '../components/ZakatSettingsModal';
import { ZakatCalculatorModal } from '../components/ZakatCalculatorModal';
import { ZakatPaymentModal } from '../components/ZakatPaymentModal';

type ZakatTab = 'balances' | 'assessments' | 'payments';

export function AdminZakatScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const lang = getCurrentLanguage();
  const { data, isLoading } = useRegisterSnapshot();

  const defaultYear = Number.parseInt(getKarachiToday().slice(0, 4), 10);
  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const [subTab, setSubTab] = useState<ZakatTab>('balances');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [editingPay, setEditingPay] = useState<ZakatPaymentRow | null>(null);

  const years = useMemo(() => {
    const set = new Set<number>([defaultYear]);
    (data?.zakatSettings ?? []).forEach((s) => set.add(s.year));
    (data?.zakatAssessments ?? []).forEach((a) => set.add(a.year));
    (data?.zakatPayments ?? []).forEach((p) => set.add(p.year));
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

  const memberBalances = useMemo(() => {
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
      .filter((row) => row.summary.dueAmount > 0 || row.summary.paidAmount > 0);
  }, [data, selectedYear]);

  const totals = useMemo(() => {
    let due = 0;
    let paid = 0;
    for (const row of memberBalances) {
      due += row.summary.dueAmount;
      paid += row.summary.paidAmount;
    }
    return { due, paid, balance: due - paid };
  }, [memberBalances]);

  const yearAssessments = useMemo(
    () =>
      (data?.zakatAssessments ?? []).filter(
        (a) => a.year === selectedYear && !a.deleted_at,
      ),
    [data, selectedYear],
  );

  const yearPayments = useMemo(
    () =>
      (data?.zakatPayments ?? []).filter(
        (p) => p.year === selectedYear && !p.deleted_at,
      ),
    [data, selectedYear],
  );

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Year selector + Settings button */}
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
              {t('zakat.settings')}
            </Text>
          </Pressable>
        </View>

        {/* Gold Hero Summary Card — Strictly Isolated from Charity Totals */}
        <Card variant="zakat" style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <Ionicons name="sparkles" size={18} color={colors.zakat} />
            <Text style={[styles.heroTitle, { color: colors.zakatText }]}>
              {t('zakat.title')} · {selectedYear}
            </Text>
          </View>
          <Text style={[styles.subNote, { color: colors.textSecondary }]}>
            {activeSetting
              ? `${t('zakat.nisabAmount')}: ${formatPKR(activeSetting.nisab_amount)} · ${(activeSetting.rate_bps / 100).toFixed(1)}%${activeSetting.basis_note ? ` (${activeSetting.basis_note})` : ''}`
              : t('zakat.separateNote')}
          </Text>

          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{t('dashboard.zakatDue')}</Text>
              <Text style={[styles.statVal, typography.numeric, { color: colors.text }]}>
                {formatPKR(totals.due)}
              </Text>
            </View>
            <View style={styles.statCol}>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{t('dashboard.zakatPaid')}</Text>
              <Text style={[styles.statVal, typography.numeric, { color: colors.metText }]}>
                {formatPKR(totals.paid)}
              </Text>
            </View>
            <View style={styles.statCol}>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{t('dashboard.zakatBalance')}</Text>
              <Text style={[styles.statVal, typography.numeric, { color: colors.zakatText }]}>
                {formatPKR(totals.balance)}
              </Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Button
              label={t('zakat.newAssessment')}
              variant="zakat"
              onPress={() => setCalcOpen(true)}
              style={styles.flex1}
            />
            <Button
              label={t('zakat.recordPayment')}
              variant="secondary"
              onPress={() => {
                setEditingPay(null);
                setPayOpen(true);
              }}
              style={styles.flex1}
            />
          </View>
        </Card>

        {/* Sub-tabs: Balances / Assessments / Zakat Ledger */}
        <View style={styles.segmentRow}>
          {(['balances', 'assessments', 'payments'] as const).map((tab) => {
            const active = subTab === tab;
            return (
              <Pressable
                key={tab}
                onPress={() => setSubTab(tab)}
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
                  {t(`zakat.${tab}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {subTab === 'balances' ? (
          memberBalances.length === 0 ? (
            <EmptyState icon="sparkles-outline" title={t('common.emptyTitle')} subtitle={t('zakat.separateNote')} />
          ) : (
            memberBalances.map(({ member, summary }) => (
              <Card key={member.id} style={styles.rowCard}>
                <Text style={[styles.rowName, { color: colors.text }]}>
                  #{member.member_no} · {lang === 'ur' && member.full_name_ur ? member.full_name_ur : member.full_name}
                </Text>
                <View style={styles.statsRow}>
                  <Text style={[styles.meta, typography.numeric, { color: colors.textSecondary }]}>
                    {t('dashboard.zakatDue')}: {formatPKR(summary.dueAmount)}
                  </Text>
                  <Text style={[styles.meta, typography.numeric, { color: colors.metText }]}>
                    {t('dashboard.zakatPaid')}: {formatPKR(summary.paidAmount)}
                  </Text>
                  <Text style={[styles.metaBold, typography.numeric, { color: colors.zakatText }]}>
                    {t('dashboard.zakatBalance')}: {formatPKR(summary.balance)}
                  </Text>
                </View>
              </Card>
            ))
          )
        ) : subTab === 'assessments' ? (
          yearAssessments.length === 0 ? (
            <EmptyState icon="calculator-outline" />
          ) : (
            yearAssessments.map((ass) => {
              const member = profileMap.get(ass.member_id);
              return (
                <Card key={ass.id} style={styles.rowCard}>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.rowName, { color: colors.text }]}>
                      #{member?.member_no ?? '?'} · {member?.full_name ?? ass.member_id.slice(0, 8)}
                    </Text>
                    <Text style={[styles.amountVal, typography.numeric, { color: colors.zakat }]}>
                      {formatPKR(ass.due_amount)}
                    </Text>
                  </View>
                  <Text style={[styles.meta, typography.numeric, { color: colors.textSecondary }]}>
                    {t('zakat.netZakatable')}: {formatPKR(ass.net_zakatable)} · {t('zakat.nisabAmount')}: {formatPKR(ass.nisab_used)} ({(ass.rate_bps / 100).toFixed(1)}%)
                  </Text>
                </Card>
              );
            })
          )
        ) : yearPayments.length === 0 ? (
          <EmptyState icon="receipt-outline" />
        ) : (
          yearPayments.map((pay) => {
            const member = profileMap.get(pay.member_id);
            return (
              <Pressable
                key={pay.id}
                onPress={() => {
                  setEditingPay(pay);
                  setPayOpen(true);
                }}
              >
                <Card style={styles.rowCard}>
                  <View style={styles.rowBetween}>
                    <View style={styles.flex1}>
                      <Text style={[styles.rowName, { color: colors.text }]}>
                        #{member?.member_no ?? '?'} · {member?.full_name ?? pay.member_id.slice(0, 8)}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textSecondary }]}>
                        {formatDateShort(pay.paid_on, lang)}
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

        {/* Scholar Disclaimer */}
        <Card style={{ backgroundColor: colors.surfaceSubtle }}>
          <Text style={[styles.scholarText, { color: colors.textSecondary }]}>
            {t('zakat.scholarNote')}
          </Text>
        </Card>
      </ScrollView>

      <ZakatSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        year={selectedYear}
        existingSetting={activeSetting}
      />

      <ZakatCalculatorModal
        visible={calcOpen}
        onClose={() => setCalcOpen(false)}
        year={selectedYear}
        setting={activeSetting}
        profiles={data?.profiles ?? []}
      />

      <ZakatPaymentModal
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        year={selectedYear}
        profiles={data?.profiles ?? []}
        fiscalYears={data?.fiscalYears ?? []}
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
  settingsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1 },
  settingsBtnText: { fontSize: 12, fontWeight: '700' },
  heroCard: { gap: 10 },
  heroHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroTitle: { fontSize: 16, fontWeight: '800' },
  subNote: { fontSize: 12, lineHeight: 17 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  statCol: { flex: 1, gap: 2 },
  statLabel: { fontSize: 11 },
  statVal: { fontSize: 15, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  flex1: { flex: 1 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, minHeight: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 12, fontWeight: '700' },
  rowCard: { gap: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowName: { fontSize: 14, fontWeight: '700' },
  amountVal: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 12 },
  metaBold: { fontSize: 12, fontWeight: '700' },
  scholarText: { fontSize: 12, lineHeight: 18 },
});
