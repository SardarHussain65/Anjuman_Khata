import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/core/theme/ThemeProvider';
import { Card } from '@/core/ui/Card';
import { EmptyState, LoadingState } from '@/core/ui/ScreenState';
import { fetchAuditLog } from '@/data/api/auditApi';

const ACTION_FILTERS = [
  'ALL',
  'INSERT',
  'UPDATE',
  'VOID',
  'CONFLICT_LOSER',
  'FISCAL_YEAR_CLOSE',
  'FISCAL_YEAR_REOPEN',
] as const;

export function AdminAuditLogScreen() {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['audit_log'],
    queryFn: () => fetchAuditLog(200),
  });

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    if (actionFilter === 'ALL') return rows;
    return rows.filter((r) => r.action === actionFilter);
  }, [data, actionFilter]);

  if (isLoading && !data) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {data?.fromCache ? (
        <View style={[styles.cacheBanner, { backgroundColor: colors.warningSoft }]}>
          <Text style={[styles.cacheText, { color: colors.shortText }]}>
            {t('common.offline')} — showing cached audit log
          </Text>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsContent}
      >
        {ACTION_FILTERS.map((act) => {
          const active = actionFilter === act;
          return (
            <Pressable
              key={act}
              onPress={() => setActionFilter(act)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.surface,
                  borderColor: active ? colors.primary : colors.borderStrong,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.text }]}>
                {act}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlashList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        ListEmptyComponent={<EmptyState icon="shield-checkmark-outline" />}
        renderItem={({ item }) => {
          const expanded = expandedId === item.id;
          const badgeColor =
            item.action === 'VOID' || item.action === 'CONFLICT_LOSER'
              ? colors.danger
              : item.action === 'FISCAL_YEAR_REOPEN'
                ? colors.warning
                : colors.primary;

          return (
            <Pressable onPress={() => setExpandedId(expanded ? null : item.id)}>
              <Card style={styles.rowCard}>
                <View style={styles.rowTop}>
                  <Text style={[styles.actionText, { color: badgeColor }]}>{item.action}</Text>
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    {item.created_at.slice(0, 19).replace('T', ' ')}
                  </Text>
                </View>
                <Text style={[styles.tableText, { color: colors.text }]}>
                  {item.table_name} · {item.record_id.slice(0, 8)}
                </Text>
                {expanded ? (
                  <View style={[styles.jsonBox, { backgroundColor: colors.surfaceSubtle, borderRadius: radius.sm }]}>
                    {item.old_data ? (
                      <Text style={[styles.jsonText, { color: colors.textSecondary }]}>
                        OLD: {JSON.stringify(item.old_data, null, 2)}
                      </Text>
                    ) : null}
                    {item.new_data ? (
                      <Text style={[styles.jsonText, { color: colors.text }]}>
                        NEW: {JSON.stringify(item.new_data, null, 2)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </Card>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  cacheBanner: { paddingHorizontal: 14, paddingVertical: 8 },
  cacheText: { fontSize: 12, fontWeight: '700' },
  chipsScroll: { flexGrow: 0, maxHeight: 54 },
  chipsContent: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
  chipText: { fontSize: 11, fontWeight: '700' },
  list: { padding: 14, paddingTop: 4, paddingBottom: 32 },
  rowCard: { marginBottom: 10, gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionText: { fontSize: 12, fontWeight: '800' },
  tableText: { fontSize: 13, fontWeight: '600' },
  meta: { fontSize: 11 },
  jsonBox: { padding: 8, marginTop: 6, gap: 6 },
  jsonText: { fontSize: 10, fontFamily: 'monospace' },
});
