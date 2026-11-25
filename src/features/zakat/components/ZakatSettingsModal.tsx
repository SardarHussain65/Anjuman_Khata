import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { parsePKR } from '@/core/money';
import { Button } from '@/core/ui/Button';
import { showAppAlert } from '@/core/ui/AppDialog';
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

const QUICK_RATES = [300, 350, 500, 1000];

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
  const insets = useSafeAreaInsets();
  const adminId = useAuthStore((s) => s.profile?.id ?? null);

  const [perPersonInput, setPerPersonInput] = useState(
    existingSetting && existingSetting.per_person_amount > 0
      ? String(existingSetting.per_person_amount)
      : '',
  );
  const [basisNote, setBasisNote] = useState(existingSetting?.basis_note ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    const perPerson = parsePKR(perPersonInput);
    if (perPerson == null || perPerson <= 0) {
      showAppAlert(t('common.required'), t('zakat.perPersonRate'));
      return;
    }

    setSaving(true);
    try {
      if (existingSetting) {
        await localUpdate(
          'zakat_settings',
          existingSetting.id,
          {
            per_person_amount: perPerson,
            basis_note: basisNote.trim(),
          },
          { actorId: adminId },
        );
      } else {
        await localInsert(
          'zakat_settings',
          {
            year,
            per_person_amount: perPerson,
            nisab_amount: 0,
            rate_bps: 250,
            basis_note: basisNote.trim(),
          },
          { actorId: adminId },
        );
      }
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
            {
              backgroundColor: colors.background,
              borderColor: colors.zakatBorder,
              borderWidth: 1,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            },
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

          <ScrollView
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 20, 36) }]}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.desc, { color: colors.textSecondary }]}>
              {t('zakat.perPersonHint')}
            </Text>

            <TextField
              label={t('zakat.perPersonRate')}
              keyboardType="number-pad"
              value={perPersonInput}
              onChangeText={setPerPersonInput}
              placeholder="e.g. 300"
              autoFocus
            />

            <View style={styles.quickRow}>
              {QUICK_RATES.map((amt) => {
                const active = perPersonInput === String(amt);
                return (
                  <Pressable
                    key={amt}
                    onPress={() => setPerPersonInput(String(amt))}
                    style={[
                      styles.quickChip,
                      {
                        backgroundColor: active ? colors.zakat : colors.surfaceSubtle,
                        borderColor: active ? colors.zakat : colors.border,
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Text style={[styles.quickText, { color: active ? '#FFFFFF' : colors.text }]}>
                      Rs {amt.toLocaleString()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextField
              label={`${t('zakat.ramazanNote')} (${t('common.optional')})`}
              value={basisNote}
              onChangeText={setBasisNote}
              placeholder="Ramazan 2026"
            />

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
  desc: { fontSize: 13, lineHeight: 19 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickChip: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
  quickText: { fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex1: { flex: 1 },
});
