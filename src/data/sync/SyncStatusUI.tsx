import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { Button } from '@/core/ui/Button';
import { Card } from '@/core/ui/Card';
import { QuarantineRow } from '../db/types';
import { useSyncStatusStore } from './statusStore';
import { refreshQueueCounts, resetSyncBackoff, runSync } from './syncEngine';
import {
  dismissQuarantinedRow,
  exportPendingQueueFile,
  getQuarantinedRows,
} from './quarantine';
import { mapQuarantineErrorKey } from './conflict';

/** Compact header status pill — never blocks UI; tap to open Sync & Quarantine Drawer. */
export function SyncStatusPill() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const status = useSyncStatusStore((s) => s.status);
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const pendingCount = useSyncStatusStore((s) => s.pendingCount);
  const quarantinedCount = useSyncStatusStore((s) => s.quarantinedCount);
  const setDrawerOpen = useSyncStatusStore((s) => s.setDrawerOpen);

  let bg = colors.primarySoft;
  let fg = colors.primary;
  let icon: keyof typeof Ionicons.glyphMap = 'cloud-done-outline';
  let label = t('sync.synced');

  if (quarantinedCount > 0) {
    bg = colors.dangerSoft;
    fg = colors.danger;
    icon = 'alert-circle-outline';
    label = t('sync.quarantinedCount', { count: quarantinedCount });
  } else if (!isOnline || status === 'offline') {
    bg = colors.warningSoft;
    fg = colors.warning;
    icon = 'cloud-offline-outline';
    label =
      pendingCount > 0
        ? `${t('sync.offline')} · ${pendingCount}`
        : t('sync.offline');
  } else if (status === 'syncing') {
    bg = colors.infoSoft;
    fg = colors.info;
    icon = 'sync-outline';
    label = t('sync.syncing');
  } else if (status === 'error') {
    bg = colors.dangerSoft;
    fg = colors.danger;
    icon = 'warning-outline';
    label = t('sync.error');
  } else if (pendingCount > 0) {
    bg = colors.warningSoft;
    fg = colors.warning;
    icon = 'time-outline';
    label = t('sync.pendingCount', { count: pendingCount });
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => setDrawerOpen(true)}
      style={[
        styles.pill,
        { backgroundColor: bg, borderRadius: radius.pill },
      ]}
    >
      {status === 'syncing' ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Ionicons name={icon} size={14} color={fg} />
      )}
      <Text style={[styles.pillText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Non-blocking banner shown during first-login full pull. */
export function InitialSyncBanner() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const active = useSyncStatusStore((s) => s.isInitialPulling);
  const done = useSyncStatusStore((s) => s.initialPullDoneTables);
  const total = useSyncStatusStore((s) => s.initialPullTotalTables);

  if (!active) return null;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <View style={[styles.initialBanner, { backgroundColor: colors.primary }]}>
      <ActivityIndicator size="small" color="#FFFFFF" />
      <View style={styles.initialBannerCopy}>
        <Text style={styles.initialTitle}>{t('sync.initialSyncTitle')} ({pct}%)</Text>
        <Text style={styles.initialSub}>{t('sync.initialSyncSubtitle')}</Text>
      </View>
      <View style={[styles.progressTrack, { borderRadius: radius.pill }]}>
        <View style={[styles.progressFill, { width: `${pct}%`, borderRadius: radius.pill }]} />
      </View>
    </View>
  );
}

/** Modal drawer showing sync state, retry, queue export, and quarantined items. */
export function SyncDrawerModal() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const open = useSyncStatusStore((s) => s.drawerOpen);
  const setDrawerOpen = useSyncStatusStore((s) => s.setDrawerOpen);
  const status = useSyncStatusStore((s) => s.status);
  const isOnline = useSyncStatusStore((s) => s.isOnline);
  const lastSyncedAt = useSyncStatusStore((s) => s.lastSyncedAt);
  const pendingCount = useSyncStatusStore((s) => s.pendingCount);
  const lastError = useSyncStatusStore((s) => s.lastError);

  const [quarantine, setQuarantine] = useState<QuarantineRow[]>([]);
  const [busy, setBusy] = useState(false);

  const loadQuarantine = async () => {
    const rows = await getQuarantinedRows();
    setQuarantine(rows);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getQuarantinedRows()
      .then((rows) => {
        if (!cancelled) setQuarantine(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, status]);

  const handleSyncNow = async () => {
    setBusy(true);
    resetSyncBackoff();
    await runSync();
    await loadQuarantine();
    setBusy(false);
  };

  const handleDismiss = async (id: string) => {
    await dismissQuarantinedRow(id);
    await refreshQueueCounts();
    await loadQuarantine();
  };

  const handleExport = async () => {
    await exportPendingQueueFile();
  };

  return (
    <Modal
      visible={open}
      animationType="slide"
      transparent
      onRequestClose={() => setDrawerOpen(false)}
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
              {t('sync.drawerTitle')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDrawerOpen(false)}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Card>
              <View style={styles.rowBetween}>
                <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
                  {t('common.status')}
                </Text>
                <Text style={[styles.metaValue, { color: colors.text }]}>
                  {isOnline ? t('common.online') : t('common.offline')} · {t(`sync.${status === 'idle' ? 'synced' : status}`)}
                </Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
                  {t('sync.pendingCount', { count: pendingCount })}
                </Text>
                <Text style={[styles.metaValue, { color: colors.textSecondary }]}>
                  {lastSyncedAt
                    ? t('sync.lastSynced', { time: lastSyncedAt.slice(0, 16).replace('T', ' ') })
                    : t('sync.neverSynced')}
                </Text>
              </View>
              {lastError ? (
                <Text style={[styles.errorLine, { color: colors.danger }]}>
                  {t('common.errorGeneric')}
                </Text>
              ) : null}

              <View style={styles.actionsRow}>
                <Button
                  label={t('sync.syncNow')}
                  loading={busy || status === 'syncing'}
                  onPress={handleSyncNow}
                  style={styles.flexBtn}
                />
                <Button
                  label={t('sync.exportQueue')}
                  variant="secondary"
                  onPress={handleExport}
                  style={styles.flexBtn}
                />
              </View>
            </Card>

            <Text style={[styles.sectionHeader, { color: colors.text }]}>
              {t('sync.quarantineTitle')} ({quarantine.length})
            </Text>

            {quarantine.length === 0 ? (
              <Card>
                <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
                  {t('sync.quarantineEmpty')}
                </Text>
              </Card>
            ) : (
              quarantine.map((item) => (
                <Card key={item.id} style={{ borderColor: colors.danger }}>
                  <Text style={[styles.qTitle, { color: colors.danger }]}>
                    {item.table_name} · {item.op} ({item.error_code})
                  </Text>
                  <Text style={[styles.qReason, { color: colors.text }]}>
                    {t(mapQuarantineErrorKey(item.error_code))}
                  </Text>
                  <Button
                    label={t('sync.dismiss')}
                    variant="secondary"
                    onPress={() => handleDismiss(item.id)}
                    style={styles.dismissBtn}
                  />
                </Card>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginEnd: 12,
    maxWidth: 160,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  initialBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  initialBannerCopy: { flex: 1 },
  initialTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  initialSub: { color: '#E2F5EF', fontSize: 11 },
  progressTrack: {
    width: 56,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    backgroundColor: '#FFFFFF',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
    paddingTop: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  closeBtn: { padding: 6 },
  sheetBody: { paddingHorizontal: 16, paddingBottom: 32, gap: 14 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  metaLabel: { fontSize: 13 },
  metaValue: { fontSize: 13, fontWeight: '600' },
  errorLine: { fontSize: 12, marginTop: 4 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  flexBtn: { flex: 1 },
  sectionHeader: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  qTitle: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  qReason: { fontSize: 13, marginBottom: 10 },
  dismissBtn: { minHeight: 40 },
});
