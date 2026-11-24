import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { formatPKR, parsePKR } from '@/core/money';
import { getCurrentLanguage } from '@/core/i18n';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
import { Card } from '@/core/ui/Card';
import { TextField } from '@/core/ui/TextField';
import { ProfileRow, ZakatAssetsBreakdown, ZakatSettingRow } from '@/data/db/types';
import { localInsert } from '@/data/sync/syncEngine';
import {
  DEFAULT_ZAKAT_ASSET_CATEGORIES,
  previewZakatCalculation,
} from '@/core/rules/zakat';
import { useAuthStore } from '@/features/auth/store/authStore';

interface ZakatCalculatorModalProps {
  visible: boolean;
  onClose: () => void;
  year: number;
  setting: ZakatSettingRow | null;
  profiles: ProfileRow[];
}

export function ZakatCalculatorModal(props: ZakatCalculatorModalProps) {
  if (!props.visible) return null;
  return (
    <ZakatCalculatorModalInner
      key={`${props.year}-${props.setting?.id ?? 'none'}`}
      {...props}
    />
  );
}

function ZakatCalculatorModalInner({
  visible,
  onClose,
  year,
  setting,
  profiles,
}: ZakatCalculatorModalProps) {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const lang = getCurrentLanguage();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const [memberId, setMemberId] = useState(profiles[0]?.id ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assetInputs, setAssetInputs] = useState<Record<string, string>>({
    cash: '',
    gold: '',
    silver: '',
    business_inventory: '',
    receivables: '',
    other: '',
  });
  const [liabilitiesInput, setLiabilitiesInput] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedMember = useMemo(
    () => profiles.find((p) => p.id === memberId) ?? null,
    [profiles, memberId],
  );

  const parsedAssets = useMemo<ZakatAssetsBreakdown>(() => {
    const out: ZakatAssetsBreakdown = {};
    for (const cat of DEFAULT_ZAKAT_ASSET_CATEGORIES) {
      const val = parsePKR(assetInputs[cat] ?? '');
      if (val && val > 0) {
        out[cat] = val;
      }
    }
    return out;
  }, [assetInputs]);

  const parsedLiabilities = parsePKR(liabilitiesInput) ?? 0;

  const preview = useMemo(() => {
    if (!setting) return null;
    return previewZakatCalculation({
      assets: parsedAssets,
      liabilities: parsedLiabilities,
      nisabAmount: setting.nisab_amount,
      rateBps: setting.rate_bps,
    });
  }, [setting, parsedAssets, parsedLiabilities]);

  const handleSave = async () => {
    if (!setting || !preview) {
      showAppAlert(t('common.required'), 'Configure Zakat nisab settings for this year first.');
      return;
    }
    if (!memberId) {
      showAppAlert(t('common.required'), t('members.title'));
      return;
    }

    setSaving(true);
    try {
      // Stores immutable snapshot of nisab_used, rate_bps, assets, liabilities, net_zakatable, due_amount
      await localInsert(
        'zakat_assessments',
        {
          member_id: memberId,
          year,
          assets: parsedAssets,
          liabilities: parsedLiabilities,
          net_zakatable: preview.netZakatable,
          nisab_used: setting.nisab_amount,
          rate_bps: setting.rate_bps,
          due_amount: preview.dueAmount,
          assessed_by: adminId,
          notes: notes.trim() || null,
        },
        { actorId: adminId },
      );
      onClose();
    } catch {
      showAppAlert(t('common.errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.zakatText }]}>
              {t('zakat.calculator')} · {year}
            </Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {!setting ? (
              <Card style={{ borderColor: colors.danger }}>
                <Text style={[styles.warnText, { color: colors.danger }]}>
                  No Zakat nisab setting found for {year}. Open Zakat Settings to configure nisab before assessing.
                </Text>
              </Card>
            ) : null}

            {/* Member Picker */}
            <View style={styles.group}>
              <Text style={[styles.label, { color: colors.text }]}>{t('members.title')}</Text>
              <Pressable
                onPress={() => setPickerOpen((o) => !o)}
                style={[styles.pickerBtn, { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderRadius: radius.md }]}
              >
                <Text style={[styles.pickerText, { color: colors.text }]}>
                  {selectedMember
                    ? `#${selectedMember.member_no} · ${lang === 'ur' && selectedMember.full_name_ur ? selectedMember.full_name_ur : selectedMember.full_name}`
                    : t('members.title')}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </Pressable>
              {pickerOpen ? (
                <Card style={styles.pickerList} padded={false}>
                  <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
                    {profiles.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() => {
                          setMemberId(p.id);
                          setPickerOpen(false);
                        }}
                        style={[
                          styles.pickerItem,
                          {
                            borderBottomColor: colors.border,
                            backgroundColor: p.id === memberId ? colors.zakatSoft : 'transparent',
                          },
                        ]}
                      >
                        <Text style={{ color: colors.text }}>
                          #{p.member_no} · {lang === 'ur' && p.full_name_ur ? p.full_name_ur : p.full_name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </Card>
              ) : null}
            </View>

            {/* Eligible Asset Categories */}
            {DEFAULT_ZAKAT_ASSET_CATEGORIES.map((cat) => (
              <TextField
                key={cat}
                label={t(`zakat.assets.${cat}`)}
                keyboardType="number-pad"
                value={assetInputs[cat] ?? ''}
                onChangeText={(txt) =>
                  setAssetInputs((prev) => ({ ...prev, [cat]: txt }))
                }
                placeholder="0"
              />
            ))}

            <TextField
              label={t('zakat.liabilities')}
              keyboardType="number-pad"
              value={liabilitiesInput}
              onChangeText={setLiabilitiesInput}
              placeholder="0"
            />

            {/* Live Integer Calculation Preview */}
            {preview && setting ? (
              <Card variant="zakat" style={styles.previewCard}>
                <View style={styles.kvRow}>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>Total Assets</Text>
                  <Text style={[styles.kvVal, typography.numeric, { color: colors.text }]}>
                    {formatPKR(preview.assetsTotal)}
                  </Text>
                </View>
                <View style={styles.kvRow}>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>{t('zakat.liabilities')}</Text>
                  <Text style={[styles.kvVal, typography.numeric, { color: colors.danger }]}>
                    − {formatPKR(preview.liabilities)}
                  </Text>
                </View>
                <View style={styles.kvRow}>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>{t('zakat.netZakatable')}</Text>
                  <Text style={[styles.kvVal, typography.numeric, { color: colors.text }]}>
                    {formatPKR(preview.netZakatable)}
                  </Text>
                </View>
                <View style={styles.kvRow}>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {t('zakat.nisabAmount')} ({year})
                  </Text>
                  <Text style={[styles.kvVal, typography.numeric, { color: colors.textSecondary }]}>
                    {formatPKR(setting.nisab_amount)}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.nisabStatus,
                    { color: preview.meetsNisab ? colors.zakatText : colors.metText },
                  ]}
                >
                  {preview.meetsNisab ? t('zakat.aboveNisab') : t('zakat.belowNisab')}
                </Text>
                <View style={[styles.dueBox, { backgroundColor: colors.surface, borderRadius: radius.md }]}>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {t('dashboard.zakatDue')} ({(setting.rate_bps / 100).toFixed(1)}%)
                  </Text>
                  <Text style={[styles.dueAmount, typography.numeric, { color: colors.zakat }]}>
                    {formatPKR(preview.dueAmount)}
                  </Text>
                </View>
              </Card>
            ) : null}

            <TextField
              label={`${t('common.remark')} (${t('common.optional')})`}
              value={notes}
              onChangeText={setNotes}
            />

            <Text style={[styles.scholarNote, { color: colors.textSecondary }]}>
              {t('zakat.scholarNote')}
            </Text>

            <View style={styles.actions}>
              <Button label={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flex1} />
              <Button
                label={t('common.save')}
                variant="zakat"
                disabled={!setting}
                loading={saving}
                onPress={handleSave}
                style={styles.flex1}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '700' },
  closeBtn: { padding: 6 },
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  group: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  pickerBtn: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerText: { fontSize: 14, fontWeight: '600' },
  pickerList: { maxHeight: 160, overflow: 'hidden' },
  pickerItem: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  previewCard: { gap: 6 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meta: { fontSize: 12 },
  kvVal: { fontSize: 13, fontWeight: '700' },
  nisabStatus: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  dueBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    marginTop: 4,
  },
  dueAmount: { fontSize: 20, fontWeight: '800' },
  scholarNote: { fontSize: 12, lineHeight: 18 },
  warnText: { fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex1: { flex: 1 },
});
