import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';

export type ComplianceStatus = 'met' | 'short' | 'unpaid' | 'advance' | 'exempt';

const ICON_MAP: Record<ComplianceStatus, keyof typeof Ionicons.glyphMap> = {
  met: 'checkmark-circle',
  short: 'alert-circle',
  unpaid: 'close-circle',
  advance: 'arrow-forward-circle',
  exempt: 'remove-circle-outline',
};

interface ComplianceBadgeProps {
  status: ComplianceStatus;
  compact?: boolean;
}

export function ComplianceBadge({ status, compact = false }: ComplianceBadgeProps) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation();

  const palette =
    status === 'met'
      ? { bg: colors.metBg, fg: colors.metText }
      : status === 'short'
        ? { bg: colors.shortBg, fg: colors.shortText }
        : status === 'unpaid'
          ? { bg: colors.unpaidBg, fg: colors.unpaidText }
          : status === 'advance'
            ? { bg: colors.advanceBg, fg: colors.advanceText }
            : { bg: colors.exemptBg, fg: colors.exemptText };

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: palette.bg,
          borderRadius: radius.pill,
          paddingHorizontal: compact ? 6 : 10,
          paddingVertical: compact ? 2 : 4,
        },
      ]}
    >
      <Ionicons name={ICON_MAP[status]} size={compact ? 12 : 14} color={palette.fg} />
      <Text style={[styles.text, { color: palette.fg, fontSize: compact ? 11 : 12 }]}>
        {t(`compliance.${status}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '600',
  },
});
