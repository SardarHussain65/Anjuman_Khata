import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR, parsePKR } from '@/core/money';
import { getKarachiCurrentMonthStart, getKarachiToday } from '@/core/dates';
import { useAppLanguage } from '@/core/i18n';
import { Card } from '@/core/ui/Card';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { TextField } from '@/core/ui/TextField';
import { LoadingState } from '@/core/ui/ScreenState';
import { useRegisterSnapshot } from '@/data/db/queries';
import { TierRow } from '@/data/db/types';
import { localInsert, localUpdate } from '@/data/sync/syncEngine';
import { findCurrentFiscalYear } from '@/core/rules/fiscalYear';
import { computeMemberFiscalYearSummary } from '@/core/rules/compliance';
import { useAuthStore } from '@/features/auth/store/authStore';

export function AdminSettingsScreen() {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const lang = useAppLanguage();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);
  const { data, isLoading } = useRegisterSnapshot();

  const org = data?.orgSettings;
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgNameUr, setOrgNameUr] = useState<string | null>(null);
  const [fyStartMonth, setFyStartMonth] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState<string | null>(null);
  const [savingOrg, setSavingOrg] = useState(false);

  // Non-retroactive tier minimum editor modal
  const [editingTier, setEditingTier] = useState<TierRow | null>(null);
  const [newTierMin, setNewTierMin] = useState('');
  const [tierEffectiveFrom, setTierEffectiveFrom] = useState(getKarachiCurrentMonthStart());
  const [savingTier, setSavingTier] = useState(false);

  const currentMonth = getKarachiCurrentMonthStart();

  const collectionSummary = useMemo(() => {
    if (!data) return null;
    const fy = findCurrentFiscalYear(data.fiscalYears);
    if (!fy) return null;

    const summaries = data.profiles.map((profile) =>
      computeMemberFiscalYearSummary({
        profile,
        fiscalYear: fy,
        contributions: data.contributions,
        memberTiers: data.memberTiers,
        tiers: data.tiers,
        tierRates: data.tierRates,
        currentMonthStart: currentMonth,
      }),
    );

    const unpaidOrShort = summaries.filter(
      (s) => s.isBelowMinimumCurrentCycle || s.arrearsTotal > 0,
    );
    const byTier = new Map<string, { name: string; total: number; count: number }>();
    for (const s of summaries) {
      const tier = s.currentMonthCompliance?.effectiveTier;
      const key = tier?.tierId ?? 'exempt';
      const label = tier
        ? lang === 'ur' && tier.tierNameUr
          ? tier.tierNameUr
          : tier.tierName
        : t('compliance.exempt');
      const existing = byTier.get(key) ?? { name: label, total: 0, count: 0 };
      existing.total += s.yearlyCharityTotal;
      existing.count += 1;
      byTier.set(key, existing);
    }

    return {
      fy,
      totalCollected: summaries.reduce((sum, s) => sum + s.yearlyCharityTotal, 0),
      totalArrears: summaries.reduce((sum, s) => sum + s.arrearsTotal, 0),
      unpaidOrShort,
      byTier: Array.from(byTier.values()),
    };
  }, [data, currentMonth, lang, t]);

  const handleSaveOrg = async () => {
    if (!org) return;
    const startM = Number.parseInt(fyStartMonth ?? String(org.fiscal_year_start_month), 10);
    const grace = Number.parseInt(graceDays ?? String(org.grace_days), 10);
    if (startM < 1 || startM > 12 || grace < 0 || grace > 31) {
      showAppAlert(t('common.required'), 'Start month must be 1–12 and grace days 0–31.');
      return;
    }
    setSavingOrg(true);
    try {
      await localUpdate(
        'org_settings',
        org.id,
        {
          org_name: (orgName ?? org.org_name).trim(),
          org_name_ur: (orgNameUr ?? org.org_name_ur).trim(),
          fiscal_year_start_month: startM,
          grace_days: grace,
        },
        { actorId: adminId },
      );
      showAppAlert(t('common.confirm'), 'Organization settings saved.');
    } finally {
      setSavingOrg(false);
    }
  };

  const handleUpdateTierRate = async () => {
    if (!editingTier) return;
    const minVal = parsePKR(newTierMin);
    if (!minVal || minVal <= 0) {
      showAppAlert(t('common.required'), t('common.amount'));
      return;
    }
    setSavingTier(true);
    try {
      // Insert new effective-dated tier_rate so past months are NEVER altered retroactively!
      await localInsert(
        'tier_rates',
        {
          tier_id: editingTier.id,
          min_amount: minVal,
          effective_from: tierEffectiveFrom,
        },
        { actorId: adminId },
      );
      await localUpdate(
        'tiers',
        editingTier.id,
        { min_amount: minVal },
        { actorId: adminId },
      );
      setEditingTier(null);
    } finally {
      setSavingTier(false);
    }
  };

  const handleShareWhatsAppUnpaid = async () => {
    if (!collectionSummary) return;
    const orgTitle = org?.org_name ?? 'Anjuman Khata';
    const lines = [
      `*${orgTitle} — Unpaid / Short (${currentMonth.slice(0, 7)})*`,
      `Date: ${getKarachiToday()}`,
      '',
      ...collectionSummary.unpaidOrShort.map((s) => {
        const shortfall = s.currentMonthCompliance?.shortfall ?? 0;
        return `#${s.member.member_no} ${s.member.full_name} — ${t(`compliance.${s.currentMonthCompliance?.status ?? 'unpaid'}`)} (${formatPKR(shortfall)})`;
      }),
      '',
      `Total members below min: ${collectionSummary.unpaidOrShort.length}`,
    ];
    await Share.share({ message: lines.join('\n') });
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Collection Summary + WhatsApp Share */}
      {collectionSummary ? (
        <Card variant="charity" style={styles.card}>
          <Text style={[styles.title, { color: colors.primary }]}>
            {t('settings.collectionSummary')} · {collectionSummary.fy.label}
          </Text>
          <View style={styles.rowBetween}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('ledger.collected')}</Text>
            <Text style={[styles.val, typography.numeric, { color: colors.text }]}>
              {formatPKR(collectionSummary.totalCollected)}
            </Text>
          </View>
          <View style={styles.rowBetween}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('ledger.arrears')}</Text>
            <Text style={[styles.val, typography.numeric, { color: colors.danger }]}>
              {formatPKR(collectionSummary.totalArrears)}
            </Text>
          </View>

          {collectionSummary.byTier.map((row) => (
            <View key={row.name} style={styles.rowBetween}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {row.name} ({row.count})
              </Text>
              <Text style={[styles.metaVal, typography.numeric, { color: colors.text }]}>
                {formatPKR(row.total)}
              </Text>
            </View>
          ))}

          <Button
            label={`${t('ledger.shareUnpaid')} (${collectionSummary.unpaidOrShort.length})`}
            onPress={() => void handleShareWhatsAppUnpaid()}
          />
        </Card>
      ) : null}

      {/* Contribution Tiers (Effective-Dated Non-Retroactive) */}
      <Card style={styles.card}>
        <Text style={[styles.title, { color: colors.text }]}>{t('settings.tiers')}</Text>
        {(data?.tiers ?? []).map((tier) => (
          <View key={tier.id} style={[styles.tierRow, { borderTopColor: colors.border }]}>
            <View style={styles.flex1}>
              <Text style={[styles.val, { color: colors.text }]}>
                {lang === 'ur' && tier.name_ur ? tier.name_ur : tier.name}
              </Text>
              <Text style={[styles.meta, typography.numeric, { color: colors.primary }]}>
                {formatPKR(tier.min_amount)} / month
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setEditingTier(tier);
                setNewTierMin(String(tier.min_amount));
                setTierEffectiveFrom(getKarachiCurrentMonthStart());
              }}
              style={[styles.editBtn, { borderColor: colors.borderStrong, borderRadius: radius.sm }]}
            >
              <Ionicons name="create-outline" size={14} color={colors.text} />
              <Text style={[styles.metaVal, { color: colors.text }]}>{t('common.edit')}</Text>
            </Pressable>
          </View>
        ))}
      </Card>

      {/* Organization Settings */}
      {org ? (
        <Card style={styles.card}>
          <Text style={[styles.title, { color: colors.text }]}>{t('settings.organization')}</Text>
          <TextField
            label="Organization Name (EN)"
            value={orgName ?? org.org_name}
            onChangeText={setOrgName}
          />
          <TextField
            label="Organization Name (Urdu)"
            value={orgNameUr ?? org.org_name_ur}
            onChangeText={setOrgNameUr}
          />
          <TextField
            label="Fiscal Year Start Month (1 = Jan, 7 = Jul)"
            keyboardType="number-pad"
            value={fyStartMonth ?? String(org.fiscal_year_start_month)}
            onChangeText={setFyStartMonth}
          />
          <TextField
            label="Grace Days"
            keyboardType="number-pad"
            value={graceDays ?? String(org.grace_days)}
            onChangeText={setGraceDays}
          />
          <Button label={t('common.save')} loading={savingOrg} onPress={handleSaveOrg} />
        </Card>
      ) : null}

      {/* Non-retroactive Tier Minimum Modal */}
      <Modal
        visible={Boolean(editingTier)}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingTier(null)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            <Text style={[styles.title, { color: colors.text }]}>
              {editingTier?.name} — Update Minimum
            </Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              Past months remain evaluated against their historical minimum rate.
            </Text>
            <TextField
              label={t('common.amount')}
              keyboardType="number-pad"
              value={newTierMin}
              onChangeText={setNewTierMin}
            />
            <TextField
              label={t('members.effectiveFrom')}
              value={tierEffectiveFrom}
              onChangeText={setTierEffectiveFrom}
              placeholder="YYYY-MM-01"
            />
            <View style={styles.rowBetween}>
              <Button label={t('common.cancel')} variant="secondary" onPress={() => setEditingTier(null)} style={styles.flex1} />
              <Button label={t('common.save')} loading={savingTier} onPress={handleUpdateTierRate} style={styles.flex1} />
            </View>
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { gap: 10 },
  title: { fontSize: 16, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  label: { fontSize: 13 },
  val: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12 },
  metaVal: { fontSize: 13, fontWeight: '700' },
  tierRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingTop: 10, gap: 8 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  flex1: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modalCard: { gap: 12 },
});
