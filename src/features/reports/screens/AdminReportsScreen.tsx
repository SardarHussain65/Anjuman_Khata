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
import { getKarachiCurrentMonthStart, getKarachiToday } from '@/core/dates';
import { getCurrentLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { useSyncStatusStore } from '@/data/sync/statusStore';
import { findCurrentFiscalYear } from '@/core/rules/fiscalYear';
import { computeMemberFiscalYearSummary } from '@/core/rules/compliance';
import { computeMemberZakatYearSummary, computeZakatMemberYearSummary } from '@/core/rules/zakat';
import { ReportLang } from '../templates/htmlBase';
import {
  buildAnnualLedgerHtml,
  buildFinancialSummaryHtml,
  buildLedgerCsv,
  buildMemberStatementHtml,
  buildUnpaidShortListHtml,
  buildZakatReportHtml,
} from '../templates/reportTemplates';
import {
  downloadPdfToDevice,
  exportAndShareCsv,
  generateAndSharePdf,
  loadOfflineUrduFontBase64,
} from '../exportService';

export function AdminReportsScreen() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const { data, isLoading } = useRegisterSnapshot();
  const pendingCount = useSyncStatusStore((s) => s.pendingCount);

  const [reportLang, setReportLang] = useState<ReportLang>(getCurrentLanguage());
  const [selectedFyId, setSelectedFyId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const currentMonth = getKarachiCurrentMonthStart();
  const currentYearNum = Number.parseInt(getKarachiToday().slice(0, 4), 10);

  const activeFy = useMemo(() => {
    if (!data?.fiscalYears.length) return null;
    if (selectedFyId) {
      const found = data.fiscalYears.find((f) => f.id === selectedFyId);
      if (found) return found;
    }
    return findCurrentFiscalYear(data.fiscalYears);
  }, [data, selectedFyId]);

  const activeMember = useMemo(() => {
    if (!data?.profiles.length) return null;
    if (selectedMemberId) {
      return data.profiles.find((p) => p.id === selectedMemberId) ?? data.profiles[0];
    }
    return data.profiles[0];
  }, [data, selectedMemberId]);

  const summaries = useMemo(() => {
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

  const zakatYear = activeFy ? Number.parseInt(activeFy.start_date.slice(0, 4), 10) : currentYearNum;

  const runExport = async (key: string, fn: (urduFontBase64: string) => Promise<void>) => {
    setBusyKey(key);
    try {
      const fontB64 = reportLang === 'ur' ? await loadOfflineUrduFontBase64() : '';
      await fn(fontB64);
    } catch (err) {
      const msg = err instanceof Error ? err.message : undefined;
      showAppAlert(t('common.errorGeneric'), msg);
    } finally {
      setBusyKey(null);
    }
  };

  const handleDownloadPdf = async (html: string, fileName: string) => {
    const res = await downloadPdfToDevice(html, fileName);
    if (res.saved) {
      showAppAlert(
        t('common.confirm'),
        reportLang === 'ur' ? `فائل محفوظ ہو گئی: ${res.fileName}` : `Saved ${res.fileName}`,
      );
    }
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Pending unsynced changes banner */}
      {pendingCount > 0 ? (
        <View style={[styles.warnBox, { backgroundColor: colors.warningSoft, borderRadius: radius.md }]}>
          <Ionicons name="alert-circle" size={18} color={colors.warning} />
          <Text style={[styles.warnText, { color: colors.shortText }]}>
            {t('reports.offlineWarning', { count: pendingCount })}
          </Text>
        </View>
      ) : null}

      {/* Language & Fiscal Year Controls */}
      <Card style={styles.card}>
        <Text style={[styles.label, { color: colors.text }]}>{t('reports.language')}</Text>
        <View style={styles.row}>
          {(['en', 'ur'] as const).map((code) => {
            const active = reportLang === code;
            return (
              <Pressable
                key={code}
                onPress={() => setReportLang(code)}
                style={[
                  styles.segBtn,
                  {
                    backgroundColor: active ? colors.primary : colors.surfaceSubtle,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text style={[styles.segText, { color: active ? '#FFFFFF' : colors.text }]}>
                  {code === 'en' ? 'English (LTR)' : 'اردو (RTL Offline Font)'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, { color: colors.text, marginTop: 6 }]}>{t('common.year')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {(data?.fiscalYears ?? []).map((fy) => {
            const active = fy.id === activeFy?.id;
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
      </Card>

      {/* Report 1: Annual Contribution Ledger (PDF Landscape + CSV) */}
      <Card style={styles.card}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{t('reports.annualLedger')}</Text>
        <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>{t('reports.annualLedgerDesc')}</Text>
        <View style={styles.row}>
          <Button
            label={reportLang === 'ur' ? 'PDF محفوظ کریں' : 'Download PDF'}
            loading={busyKey === 'ledger-dl'}
            disabled={!activeFy}
            onPress={() =>
              activeFy &&
              void runExport('ledger-dl', async (urduFontBase64) => {
                const html = buildAnnualLedgerHtml({
                  orgSettings: data?.orgSettings ?? null,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  fiscalYear: activeFy,
                  summaries,
                });
                await handleDownloadPdf(html, `ledger-${activeFy.label}.pdf`);
              })
            }
            style={styles.flex1}
          />
          <Button
            label={reportLang === 'ur' ? 'شیئر PDF' : 'Share PDF'}
            variant="secondary"
            loading={busyKey === 'ledger-pdf'}
            disabled={!activeFy}
            onPress={() =>
              activeFy &&
              void runExport('ledger-pdf', async (urduFontBase64) => {
                const html = buildAnnualLedgerHtml({
                  orgSettings: data?.orgSettings ?? null,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  fiscalYear: activeFy,
                  summaries,
                });
                await generateAndSharePdf(html, `ledger-${activeFy.label}.pdf`);
              })
            }
            style={styles.flex1}
          />
        </View>
        <Button
          label={t('reports.exportCsv')}
          variant="secondary"
          loading={busyKey === 'ledger-csv'}
          disabled={!activeFy}
          onPress={() =>
            activeFy &&
            void runExport('ledger-csv', async () => {
              const csv = buildLedgerCsv(activeFy, summaries);
              await exportAndShareCsv(csv, `ledger-${activeFy.label}.csv`);
            })
          }
        />
      </Card>

      {/* Report 2: Financial Summary */}
      <Card style={styles.card}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{t('reports.financialSummary')}</Text>
        <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>{t('reports.financialSummaryDesc')}</Text>
        <View style={styles.row}>
          <Button
            label={reportLang === 'ur' ? 'PDF محفوظ کریں' : 'Download PDF'}
            loading={busyKey === 'summary-dl'}
            disabled={!activeFy}
            onPress={() =>
              activeFy &&
              data &&
              void runExport('summary-dl', async (urduFontBase64) => {
                let zakatDueTotal = 0;
                let zakatPaidTotal = 0;
                const zakatSetting = data.zakatSettings.find((s) => s.year === zakatYear) ?? null;
                if (data.zakatMembers.length > 0) {
                  for (const zm of data.zakatMembers) {
                    const z = computeZakatMemberYearSummary({
                      zakatMember: zm,
                      year: zakatYear,
                      perPersonAmount: zakatSetting?.per_person_amount ?? 0,
                      payments: data.zakatPayments,
                    });
                    zakatDueTotal += z.dueAmount;
                    zakatPaidTotal += z.paidAmount;
                  }
                } else {
                  for (const m of data.profiles) {
                    const z = computeMemberZakatYearSummary(m.id, zakatYear, data.zakatAssessments, data.zakatPayments);
                    zakatDueTotal += z.dueAmount;
                    zakatPaidTotal += z.paidAmount;
                  }
                }
                const html = buildFinancialSummaryHtml({
                  orgSettings: data.orgSettings,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  fiscalYear: activeFy,
                  summaries,
                  zakatYear,
                  zakatDueTotal,
                  zakatPaidTotal,
                });
                await handleDownloadPdf(html, `summary-${activeFy.label}.pdf`);
              })
            }
            style={styles.flex1}
          />
          <Button
            label={reportLang === 'ur' ? 'شیئر PDF' : 'Share PDF'}
            variant="secondary"
            loading={busyKey === 'summary-pdf'}
            disabled={!activeFy}
            onPress={() =>
              activeFy &&
              data &&
              void runExport('summary-pdf', async (urduFontBase64) => {
                let zakatDueTotal = 0;
                let zakatPaidTotal = 0;
                const zakatSetting = data.zakatSettings.find((s) => s.year === zakatYear) ?? null;
                if (data.zakatMembers.length > 0) {
                  for (const zm of data.zakatMembers) {
                    const z = computeZakatMemberYearSummary({
                      zakatMember: zm,
                      year: zakatYear,
                      perPersonAmount: zakatSetting?.per_person_amount ?? 0,
                      payments: data.zakatPayments,
                    });
                    zakatDueTotal += z.dueAmount;
                    zakatPaidTotal += z.paidAmount;
                  }
                } else {
                  for (const m of data.profiles) {
                    const z = computeMemberZakatYearSummary(m.id, zakatYear, data.zakatAssessments, data.zakatPayments);
                    zakatDueTotal += z.dueAmount;
                    zakatPaidTotal += z.paidAmount;
                  }
                }
                const html = buildFinancialSummaryHtml({
                  orgSettings: data.orgSettings,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  fiscalYear: activeFy,
                  summaries,
                  zakatYear,
                  zakatDueTotal,
                  zakatPaidTotal,
                });
                await generateAndSharePdf(html, `summary-${activeFy.label}.pdf`);
              })
            }
            style={styles.flex1}
          />
        </View>
      </Card>

      {/* Report 3: Individual Member Statement */}
      <Card style={styles.card}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{t('reports.memberStatement')}</Text>
        <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>{t('reports.memberStatementDesc')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {(data?.profiles ?? []).slice(0, 30).map((m) => {
            const active = m.id === activeMember?.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => setSelectedMemberId(m.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primarySoft : colors.surfaceSubtle,
                    borderColor: active ? colors.primary : 'transparent',
                    borderWidth: 1,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? colors.primary : colors.text }]}>
                  #{m.member_no} {m.full_name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.row}>
          <Button
            label={reportLang === 'ur' ? 'PDF محفوظ کریں' : 'Download PDF'}
            loading={busyKey === 'statement-dl'}
            disabled={!activeFy || !activeMember}
            onPress={() =>
              activeFy &&
              activeMember &&
              data &&
              void runExport('statement-dl', async (urduFontBase64) => {
                const html = buildMemberStatementHtml({
                  orgSettings: data.orgSettings,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  member: activeMember,
                  fiscalYear: activeFy,
                  contributions: data.contributions,
                  memberTiers: data.memberTiers,
                  tiers: data.tiers,
                  tierRates: data.tierRates,
                  zakatAssessments: data.zakatAssessments,
                  zakatPayments: data.zakatPayments,
                  zakatYear,
                  currentMonthStart: currentMonth,
                });
                await handleDownloadPdf(html, `statement-${activeMember.member_no}-${activeFy.label}.pdf`);
              })
            }
            style={styles.flex1}
          />
          <Button
            label={reportLang === 'ur' ? 'شیئر PDF' : 'Share PDF'}
            variant="secondary"
            loading={busyKey === 'statement-pdf'}
            disabled={!activeFy || !activeMember}
            onPress={() =>
              activeFy &&
              activeMember &&
              data &&
              void runExport('statement-pdf', async (urduFontBase64) => {
                const html = buildMemberStatementHtml({
                  orgSettings: data.orgSettings,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  member: activeMember,
                  fiscalYear: activeFy,
                  contributions: data.contributions,
                  memberTiers: data.memberTiers,
                  tiers: data.tiers,
                  tierRates: data.tierRates,
                  zakatAssessments: data.zakatAssessments,
                  zakatPayments: data.zakatPayments,
                  zakatYear,
                  currentMonthStart: currentMonth,
                });
                await generateAndSharePdf(html, `statement-${activeMember.member_no}-${activeFy.label}.pdf`);
              })
            }
            style={styles.flex1}
          />
        </View>
      </Card>

      {/* Report 4: Zakat Report (Gold-accented) */}
      <Card variant="zakat" style={styles.card}>
        <Text style={[styles.cardTitle, { color: colors.zakatText }]}>{t('reports.zakatReport')}</Text>
        <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>{t('reports.zakatReportDesc')}</Text>
        <View style={styles.row}>
          <Button
            label={reportLang === 'ur' ? 'PDF محفوظ کریں' : 'Download PDF'}
            variant="zakat"
            loading={busyKey === 'zakat-dl'}
            disabled={!data}
            onPress={() =>
              data &&
              void runExport('zakat-dl', async (urduFontBase64) => {
                const setting = data.zakatSettings.find((s) => s.year === zakatYear) ?? null;
                const html = buildZakatReportHtml({
                  orgSettings: data.orgSettings,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  year: zakatYear,
                  setting,
                  profiles: data.profiles,
                  zakatMembers: data.zakatMembers,
                  assessments: data.zakatAssessments,
                  payments: data.zakatPayments,
                });
                await handleDownloadPdf(html, `zakat-${zakatYear}.pdf`);
              })
            }
            style={styles.flex1}
          />
          <Button
            label={reportLang === 'ur' ? 'شیئر PDF' : 'Share PDF'}
            variant="secondary"
            loading={busyKey === 'zakat-pdf'}
            disabled={!data}
            onPress={() =>
              data &&
              void runExport('zakat-pdf', async (urduFontBase64) => {
                const setting = data.zakatSettings.find((s) => s.year === zakatYear) ?? null;
                const html = buildZakatReportHtml({
                  orgSettings: data.orgSettings,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  year: zakatYear,
                  setting,
                  profiles: data.profiles,
                  zakatMembers: data.zakatMembers,
                  assessments: data.zakatAssessments,
                  payments: data.zakatPayments,
                });
                await generateAndSharePdf(html, `zakat-${zakatYear}.pdf`);
              })
            }
            style={styles.flex1}
          />
        </View>
      </Card>

      {/* Report 5: Unpaid / Short Members List */}
      <Card style={styles.card}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{t('reports.unpaidList')}</Text>
        <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>{t('reports.unpaidListDesc')}</Text>
        <View style={styles.row}>
          <Button
            label={reportLang === 'ur' ? 'PDF محفوظ کریں' : 'Download PDF'}
            loading={busyKey === 'unpaid-dl'}
            disabled={!activeFy}
            onPress={() =>
              activeFy &&
              void runExport('unpaid-dl', async (urduFontBase64) => {
                const html = buildUnpaidShortListHtml({
                  orgSettings: data?.orgSettings ?? null,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  fiscalYear: activeFy,
                  summaries,
                  currentMonthStart: currentMonth,
                });
                await handleDownloadPdf(html, `unpaid-${activeFy.label}.pdf`);
              })
            }
            style={styles.flex1}
          />
          <Button
            label={reportLang === 'ur' ? 'شیئر PDF' : 'Share PDF'}
            variant="secondary"
            loading={busyKey === 'unpaid-pdf'}
            disabled={!activeFy}
            onPress={() =>
              activeFy &&
              void runExport('unpaid-pdf', async (urduFontBase64) => {
                const html = buildUnpaidShortListHtml({
                  orgSettings: data?.orgSettings ?? null,
                  lang: reportLang,
                  pendingSyncCount: pendingCount,
                  urduFontBase64,
                  fiscalYear: activeFy,
                  summaries,
                  currentMonthStart: currentMonth,
                });
                await generateAndSharePdf(html, `unpaid-${activeFy.label}.pdf`);
              })
            }
            style={styles.flex1}
          />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 14, gap: 12, paddingBottom: 32 },
  warnBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  warnText: { flex: 1, fontSize: 12, fontWeight: '700' },
  card: { gap: 10 },
  label: { fontSize: 13, fontWeight: '700' },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardDesc: { fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8 },
  flex1: { flex: 1 },
  segBtn: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  chips: { gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: '600' },
});
