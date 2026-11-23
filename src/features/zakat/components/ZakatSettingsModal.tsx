import React, { useState } from 'react';
import {
  Alert,
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
import { parsePKR } from '@/core/money';
import { Button } from '@/core/ui/Button';
import { TextField } from '@/core/ui/TextField';
import { ZakatSettingRow } from '@/data/db/types';
import { localInsert, localUpdate } from '@/data/sync/syncEngine';
import { useAuthStore } from '@/features/auth/store/authStore';

interface ZakatSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  year: number;
  existingSetting: ZakatSettingRow | null;
}

export function ZakatSettingsModal(props: ZakatSettingsModalProps) {
  if (!props.visible) return null;
  return (
    <ZakatSettingsModalInner
      key={`${props.year}-${props.existingSetting?.id ?? 'new'}`}
      {...props}
    />
  );
}

function ZakatSettingsModalInner({
  visible,
  onClose,
  year,
  existingSetting,
}: ZakatSettingsModalProps) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const [nisabInput, setNisabInput] = useState(
    existingSetting ? String(existingSetting.nisab_amount) : '',
  );
  const [rateBpsInput, setRateBpsInput] = useState(
    existingSetting ? String(existingSetting.rate_bps) : '250',
  );
  const [basisNote, setBasisNote] = useState(existingSetting?.basis_note ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const nisab = parsePKR(nisabInput);
    const rateBps = Number.parseInt(rateBpsInput, 10);
    if (nisab == null || nisab < 0) {
      Alert.alert(t('common.required'), t('zakat.nisabAmount'));
      return;
    }
    if (!Number.isInteger(rateBps) || rateBps <= 0 || rateBps > 10000) {
      Alert.alert(t('common.required'), t('zakat.rateBps'));
      return;
    }

    setSaving(true);
    try {
      if (existingSetting) {
        await localUpdate(
          'zakat_settings',
          existingSetting.id,
          {
            nisab_amount: nisab,
            rate_bps: rateBps,
            basis_note: basisNote.trim(),
          },
          { actorId: adminId },
        );
      } else {
        await localInsert(
          'zakat_settings',
          {
            year,
            nisab_amount: nisab,
            rate_bps: rateBps,
            basis_note: basisNote.trim(),
          },
          { actorId: adminId },
        );
      }
      onClose();
    } catch {
      Alert.alert(t('common.errorGeneric'));
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
              {t('zakat.settings')} · {year}
            </Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <TextField
              label={t('zakat.nisabAmount')}
              keyboardType="number-pad"
              value={nisabInput}
              onChangeText={setNisabInput}
              placeholder="e.g. 180000"
            />
            <TextField
              label={t('zakat.rateBps')}
              keyboardType="number-pad"
              value={rateBpsInput}
              onChangeText={setRateBpsInput}
              helperText="250 basis points = 2.5% (exact integer half-up rounding)"
            />
            <TextField
              label={t('zakat.basisNote')}
              value={basisNote}
              onChangeText={setBasisNote}
              placeholder="Silver basis (52.5 tola), price date YYYY-MM-DD"
              multiline
            />

            <Text style={[styles.note, { color: colors.textSecondary }]}>
              {t('zakat.scholarNote')}
            </Text>

            <View style={styles.actions}>
              <Button label={t('common.cancel')} variant="secondary" onPress={onClose} style={styles.flex1} />
              <Button label={t('common.save')} variant="zakat" loading={saving} onPress={handleSave} style={styles.flex1} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%' },
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
  body: { padding: 16, gap: 14, paddingBottom: 32 },
  note: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
});
