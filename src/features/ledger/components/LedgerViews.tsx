import React from 'react';
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
import { formatPKR } from '@/core/money';
import { formatMonthShort } from '@/core/dates';
import { ComplianceBadge } from '@/core/ui/Badge';
import { Card } from '@/core/ui/Card';
import {
  MemberFiscalYearSummary,
  MonthComplianceResult,
} from '@/core/rules/compliance';

export type LedgerViewMode = 'cards' | 'table';

const STICKY_NAME_WIDTH = 154;
const MONTH_COL_WIDTH = 74;
const TOTAL_COL_WIDTH = 92;
const ROW_HEIGHT = 64;

// =============================================================================
// 1. Labeled Cards / Table Segmented Toggle (shared by Client & Admin)
// =============================================================================
interface ViewModeToggleProps {
  value: LedgerViewMode;
  onChange: (mode: LedgerViewMode) => void;
  lang: 'en' | 'ur';
}

export function ViewModeToggle({ value, onChange, lang }: ViewModeToggleProps) {
  const { colors, radius } = useTheme();

  return (
    <View
      style={[
        styles.viewToggle,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.lg,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cards view"
        onPress={() => onChange('cards')}
        style={[
          styles.viewToggleBtn,
          {
            backgroundColor: value === 'cards' ? colors.primary : 'transparent',
            borderRadius: radius.md,
          },
        ]}
      >
        <Ionicons
          name="albums-outline"
          size={15}
          color={value === 'cards' ? '#FFFFFF' : colors.textSecondary}
        />
        <Text
          style={[
            styles.viewToggleLabel,
            { color: value === 'cards' ? '#FFFFFF' : colors.textSecondary },
          ]}
        >
          {lang === 'ur' ? 'کارڈز' : 'Cards'}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Table view"
        onPress={() => onChange('table')}
        style={[
          styles.viewToggleBtn,
          {
            backgroundColor: value === 'table' ? colors.primary : 'transparent',
            borderRadius: radius.md,
          },
        ]}
      >
        <Ionicons
          name="grid-outline"
          size={14}
          color={value === 'table' ? '#FFFFFF' : colors.textSecondary}
        />
        <Text
          style={[
            styles.viewToggleLabel,
            { color: value === 'table' ? '#FFFFFF' : colors.textSecondary },
          ]}
        >
          {lang === 'ur' ? 'جدول' : 'Table'}
        </Text>
      </Pressable>
    </View>
  );
}

// =============================================================================
// 2. Spacious Member Card (shared by Client & Admin; Admin gets quick "+ Collect")
// =============================================================================
interface LedgerMemberCardProps {
  item: MemberFiscalYearSummary;
  lang: 'en' | 'ur';
  currentMonth: string;
  isAdmin?: boolean;
  onPress: () => void;
  onQuickCollect?: () => void;
}

export function LedgerMemberCard({
  item,
  lang,
  currentMonth,
  isAdmin = false,
  onPress,
  onQuickCollect,
}: LedgerMemberCardProps) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();

  const displayName =
    lang === 'ur' && item.member.full_name_ur
      ? item.member.full_name_ur
      : item.member.full_name;
  const effTier = item.currentMonthCompliance?.effectiveTier;
  const rowBadgeStatus =
    item.arrearsTotal > 0
      ? item.unpaidCount > 0
        ? 'unpaid'
        : 'short'
      : item.currentMonthCompliance?.status ?? 'exempt';
  const hasArrears = item.arrearsTotal > 0;
  const paidMonthsCount = item.months.filter((m) => m.paidAmount > 0).length;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.92 }]}
    >
      <Card style={styles.memberCard}>
        {/* Top Row: Avatar + Name + Yearly Total */}
        <View style={styles.cardHeaderRow}>
          <View
            style={[
              styles.avatarCircle,
              {
                backgroundColor: hasArrears
                  ? colors.unpaidBg
                  : item.member.status === 'non_earning'
                    ? colors.surfaceSubtle
                    : colors.primarySoft,
                borderColor: hasArrears
                  ? colors.danger
                  : item.member.status === 'non_earning'
                    ? colors.border
                    : colors.primaryBorder,
              },
            ]}
          >
            <Text
              style={[
                styles.avatarText,
                typography.numeric,
                {
                  color: hasArrears
                    ? colors.unpaidText
                    : item.member.status === 'non_earning'
                      ? colors.textSecondary
                      : colors.primary,
                },
              ]}
            >
              #{item.member.member_no}
            </Text>
          </View>

          <View style={styles.flex1}>
            <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            <View style={styles.cardPillsRow}>
              <View
                style={[
                  styles.metaPill,
                  {
                    backgroundColor: effTier ? colors.primarySoft : colors.surfaceSubtle,
                    borderColor: effTier ? colors.primaryBorder : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.metaPillText,
                    typography.numeric,
                    { color: effTier ? colors.primary : colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {effTier
                    ? `${formatPKR(effTier.minAmount)}/${lang === 'ur' ? 'ماہ' : 'mo'}`
                    : t(`memberStatus.${item.member.status}`)}
                </Text>
              </View>
              {item.member.designation ? (
                <View
                  style={[
                    styles.metaPill,
                    { backgroundColor: colors.surfaceSubtle, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.metaPillText, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {item.member.designation}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.cardRightCol}>
            <Text style={[styles.cardTotalAmt, typography.numeric, { color: colors.text }]}>
              {formatPKR(item.yearlyCharityTotal)}
            </Text>
            <View style={styles.cardStatusRow}>
              <ComplianceBadge status={rowBadgeStatus} compact />
              {hasArrears ? (
                <Text
                  style={[
                    styles.arrearsTag,
                    typography.numeric,
                    { backgroundColor: colors.unpaidBg, color: colors.unpaidText },
                  ]}
                >
                  -{item.arrearsTotal.toLocaleString()}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* 12-Month Glanceable Mini Progress Strip */}
        <View style={styles.miniMonthsStrip}>
          {item.months.map((cell) => {
            const isCurrent = cell.periodStart === currentMonth;
            const pillBg =
              cell.status === 'met'
                ? colors.metBg
                : cell.status === 'short'
                  ? colors.shortBg
                  : cell.status === 'unpaid'
                    ? colors.unpaidBg
                    : cell.status === 'advance'
                      ? colors.advanceBg
                      : colors.surfaceSubtle;
            const pillFg =
              cell.status === 'met'
                ? colors.metText
                : cell.status === 'short'
                  ? colors.shortText
                  : cell.status === 'unpaid'
                    ? colors.unpaidText
                    : cell.status === 'advance'
                      ? colors.advanceText
                      : colors.textMuted;
            const shortLabel = formatMonthShort(cell.periodStart, 'en').slice(0, 1);

            return (
              <View
                key={cell.periodStart}
                style={[
                  styles.miniMonthDot,
                  {
                    backgroundColor: pillBg,
                    borderWidth: isCurrent ? 1.5 : 0,
                    borderColor: isCurrent ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.miniMonthText, { color: pillFg }]}>
                  {shortLabel}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Subtle Footer: Paid Months Summary + Admin Quick Collect */}
        <View style={[styles.cardFooterRow, { borderTopColor: colors.border }]}>
          <View style={styles.cardFooterLeft}>
            <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
            <Text style={[styles.cardFooterHint, { color: colors.textMuted }]}>
              {lang === 'ur'
                ? `${paidMonthsCount}/12 مہینے ادا · تفصیل کے لیے ٹیپ کریں`
                : `${paidMonthsCount}/12 months paid · Tap for breakdown`}
            </Text>
          </View>
          {isAdmin && onQuickCollect ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onQuickCollect();
              }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.quickPayBtn,
                {
                  backgroundColor: colors.primarySoft,
                  borderColor: colors.primaryBorder,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Ionicons name="add-circle" size={14} color={colors.primary} />
              <Text style={[styles.quickPayText, { color: colors.primary }]}>
                {lang === 'ur' ? 'ادائیگی' : 'Collect'}
              </Text>
            </Pressable>
          ) : (
            <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
          )}
        </View>
      </Card>
    </Pressable>
  );
}

// =============================================================================
// 3. Upgraded User-Friendly Register Table (shared by Client & Admin)
// =============================================================================
interface LedgerTableViewProps {
  summaries: MemberFiscalYearSummary[];
  fyMonths: string[];
  perMonthTotals: number[];
  grandCollected: number;
  currentMonth: string;
  lang: 'en' | 'ur';
  isAdmin?: boolean;
  onPressCell: (item: MemberFiscalYearSummary, cell: MonthComplianceResult) => void;
  onPressMember?: (item: MemberFiscalYearSummary) => void;
}

export function LedgerTableView({
  summaries,
  fyMonths,
  perMonthTotals,
  grandCollected,
  currentMonth,
  lang,
  isAdmin = false,
  onPressCell,
  onPressMember,
}: LedgerTableViewProps) {
  const { colors, typography, isDark } = useTheme();
  const { t } = useTranslation();

  const stripeBg = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(12, 80, 60, 0.025)';

  return (
    <View style={styles.tableWrapper}>
      {/* Clean Legend & Horizontal Scroll Hint Bar */}
      <View
        style={[
          styles.legendBar,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.legendItems}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.metText }]} />
            <Text style={[styles.legendText, { color: colors.textSecondary }]}>
              {t('compliance.met')}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.shortText }]} />
            <Text style={[styles.legendText, { color: colors.textSecondary }]}>
              {t('compliance.short')}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.unpaidText }]} />
            <Text style={[styles.legendText, { color: colors.textSecondary }]}>
              {t('compliance.unpaid')}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.advanceText }]} />
            <Text style={[styles.legendText, { color: colors.textSecondary }]}>
              {t('compliance.advance')}
            </Text>
          </View>
        </View>
        <View style={styles.swipeHint}>
          <Text style={[styles.swipeHintText, { color: colors.primary }]}>
            {lang === 'ur' ? 'سوائپ کریں' : 'Swipe'}
          </Text>
          <Ionicons name="arrow-forward" size={12} color={colors.primary} />
        </View>
      </View>

      {/* Split Table inside Elevated Rounded Frame */}
      <View
        style={[
          styles.splitTable,
          {
            backgroundColor: colors.surface,
            borderColor: colors.borderStrong,
          },
        ]}
      >
        {/* Left Sticky Member Column */}
        <View style={[styles.leftColumn, { borderEndColor: colors.borderStrong }]}>
          <View
            style={[
              styles.headerRowBox,
              {
                backgroundColor: colors.surfaceSubtle,
                borderBottomColor: colors.borderStrong,
              },
            ]}
          >
            <Text style={[styles.headerCellText, { color: colors.text }]}>
              {t('members.title')} ({summaries.length})
            </Text>
          </View>

          {summaries.map((item, idx) => {
            const displayName =
              lang === 'ur' && item.member.full_name_ur
                ? item.member.full_name_ur
                : item.member.full_name;
            const hasArrears = item.arrearsTotal > 0;
            const rowBg = idx % 2 === 1 ? stripeBg : colors.surface;
            const effTier = item.currentMonthCompliance?.effectiveTier;

            return (
              <Pressable
                key={item.member.id}
                onPress={() => onPressMember?.(item)}
                style={[
                  styles.memberRowBox,
                  { backgroundColor: rowBg, borderBottomColor: colors.border },
                ]}
              >
                <View style={styles.tableNameRow}>
                  <View
                    style={[
                      styles.tableNumBadge,
                      {
                        backgroundColor: hasArrears
                          ? colors.unpaidBg
                          : colors.primarySoft,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tableNumText,
                        typography.numeric,
                        { color: hasArrears ? colors.unpaidText : colors.primary },
                      ]}
                    >
                      {item.member.member_no}
                    </Text>
                  </View>
                  <Text
                    style={[styles.tableMemberName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {displayName}
                  </Text>
                </View>
                <View style={styles.tableMetaRow}>
                  <Text
                    style={[styles.tableSubText, { color: colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {effTier
                      ? `${formatPKR(effTier.minAmount)}/mo`
                      : t(`memberStatus.${item.member.status}`)}
                  </Text>
                  {hasArrears ? (
                    <Text
                      style={[
                        styles.tableArrearsBadge,
                        typography.numeric,
                        { backgroundColor: colors.unpaidBg, color: colors.unpaidText },
                      ]}
                    >
                      -{item.arrearsTotal.toLocaleString()}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}

          <View
            style={[
              styles.footerRowBox,
              {
                backgroundColor: colors.primarySoft,
                borderTopColor: colors.primaryBorder,
              },
            ]}
          >
            <Text style={[styles.footerLabel, { color: colors.primary }]}>
              {t('common.total')}
            </Text>
          </View>
        </View>

        {/* Right Synchronized Horizontal Scroll: 12 Months + Yearly Total */}
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            {/* Header Row */}
            <View
              style={[
                styles.monthsHeaderRow,
                styles.headerRowBox,
                {
                  backgroundColor: colors.surfaceSubtle,
                  borderBottomColor: colors.borderStrong,
                },
              ]}
            >
              {fyMonths.map((m) => {
                const isCurrent = m === currentMonth;
                return (
                  <View key={m} style={styles.monthHeaderCell}>
                    <View
                      style={[
                        styles.monthHeaderPill,
                        isCurrent && { backgroundColor: colors.primary },
                      ]}
                    >
                      <Text
                        style={[
                          styles.headerCellText,
                          { color: isCurrent ? '#FFFFFF' : colors.textSecondary },
                        ]}
                      >
                        {formatMonthShort(m, lang)}
                      </Text>
                    </View>
                  </View>
                );
              })}
              <View style={styles.totalHeaderCell}>
                <Text style={[styles.headerCellText, { color: colors.primary }]}>
                  {t('common.total')}
                </Text>
              </View>
            </View>

            {/* Member Data Rows */}
            {summaries.map((item, idx) => {
              const rowBg = idx % 2 === 1 ? stripeBg : colors.surface;
              return (
                <View
                  key={item.member.id}
                  style={[
                    styles.monthsRow,
                    styles.dataRowHeight,
                    { backgroundColor: rowBg, borderBottomColor: colors.border },
                  ]}
                >
                  {item.months.map((cell) => {
                    const isCurrent = cell.periodStart === currentMonth;
                    const bg =
                      cell.status === 'met'
                        ? colors.metBg
                        : cell.status === 'short'
                          ? colors.shortBg
                          : cell.status === 'unpaid'
                            ? colors.unpaidBg
                            : cell.status === 'advance'
                              ? colors.advanceBg
                              : colors.exemptBg;
                    const fg =
                      cell.status === 'met'
                        ? colors.metText
                        : cell.status === 'short'
                          ? colors.shortText
                          : cell.status === 'unpaid'
                            ? colors.unpaidText
                            : cell.status === 'advance'
                              ? colors.advanceText
                              : colors.exemptText;

                    return (
                      <View
                        key={cell.periodStart}
                        style={[
                          styles.monthCellSlot,
                          isCurrent && {
                            backgroundColor: isDark
                              ? 'rgba(46, 196, 146, 0.08)'
                              : 'rgba(12, 80, 60, 0.05)',
                          },
                        ]}
                      >
                        <Pressable
                          onPress={() => onPressCell(item, cell)}
                          style={({ pressed }) => [
                            styles.monthCell,
                            {
                              backgroundColor: bg,
                              borderColor: isCurrent ? colors.primary : 'transparent',
                              borderWidth: isCurrent ? 1 : 0,
                              opacity: pressed ? 0.72 : 1,
                            },
                          ]}
                        >
                          <Text style={[styles.cellValue, typography.numeric, { color: fg }]}>
                            {cell.paidAmount > 0 ? cell.paidAmount.toLocaleString() : '—'}
                          </Text>
                          {cell.status === 'met' ? (
                            <Ionicons name="checkmark" size={11} color={fg} />
                          ) : cell.status === 'short' ? (
                            <Text style={[styles.cellMiniTag, { color: fg }]}>
                              {lang === 'ur' ? 'کم' : 'Short'}
                            </Text>
                          ) : cell.status === 'unpaid' && isAdmin ? (
                            <Text style={[styles.cellMiniTag, { color: fg }]}>+ Pay</Text>
                          ) : null}
                        </Pressable>
                      </View>
                    );
                  })}

                  <View
                    style={[
                      styles.totalCell,
                      {
                        backgroundColor: colors.surfaceSubtle,
                        borderStartColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.totalValue, typography.numeric, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {formatPKR(item.yearlyCharityTotal)}
                    </Text>
                    {item.arrearsTotal > 0 ? (
                      <Text
                        style={[styles.arrearsMini, typography.numeric, { color: colors.danger }]}
                        numberOfLines={1}
                      >
                        -{item.arrearsTotal.toLocaleString()}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}

            {/* Footer Totals Row */}
            <View
              style={[
                styles.monthsHeaderRow,
                styles.footerRowBox,
                {
                  backgroundColor: colors.primarySoft,
                  borderTopColor: colors.primaryBorder,
                },
              ]}
            >
              {perMonthTotals.map((amt, idx) => (
                <View key={fyMonths[idx] ?? idx} style={styles.monthHeaderCell}>
                  <Text style={[styles.footerNum, typography.numeric, { color: colors.primary }]}>
                    {amt > 0 ? amt.toLocaleString() : '—'}
                  </Text>
                </View>
              ))}
              <View style={styles.totalHeaderCell}>
                <Text style={[styles.footerNum, typography.numeric, { color: colors.primary }]}>
                  {formatPKR(grandCollected)}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

// =============================================================================
// 4. Shared 12-Month Member Breakdown Bottom Sheet (Client: view receipt; Admin: tap to collect/edit)
// =============================================================================
interface MemberYearSheetProps {
  summary: MemberFiscalYearSummary | null;
  fiscalYearLabel?: string;
  currentMonth: string;
  lang: 'en' | 'ur';
  isAdmin?: boolean;
  onClose: () => void;
  onPressMonth: (summary: MemberFiscalYearSummary, cell: MonthComplianceResult) => void;
  onQuickCollect?: (summary: MemberFiscalYearSummary) => void;
}

export function MemberYearSheet({
  summary,
  fiscalYearLabel,
  currentMonth,
  lang,
  isAdmin = false,
  onClose,
  onPressMonth,
  onQuickCollect,
}: MemberYearSheetProps) {
  const { colors, radius, typography } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const displayName = summary
    ? lang === 'ur' && summary.member.full_name_ur
      ? summary.member.full_name_ur
      : summary.member.full_name
    : '';

  return (
    <Modal
      visible={Boolean(summary)}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.sheetBackdrop}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={styles.flex1}>
              <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                #{summary?.member.member_no} · {displayName}
              </Text>
              <Text style={[styles.sheetSub, { color: colors.textSecondary }]}>
                {fiscalYearLabel ?? ''} ·{' '}
                {t(`memberStatus.${summary?.member.status ?? 'active'}`)}
                {summary?.member.designation ? ` · ${summary.member.designation}` : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.sheetBody,
              { paddingBottom: Math.max(insets.bottom + 20, 36) },
            ]}
          >
            {summary ? (
              <>
                <View style={styles.sheetStatsRow}>
                  <Card variant="charity" style={styles.sheetStatCard}>
                    <Text style={[styles.sheetStatLabel, { color: colors.primary }]}>
                      {t('ledger.collected')}
                    </Text>
                    <Text style={[styles.sheetStatVal, typography.numeric, { color: colors.text }]}>
                      {formatPKR(summary.yearlyCharityTotal)}
                    </Text>
                  </Card>
                  <Card style={styles.sheetStatCard}>
                    <Text style={[styles.sheetStatLabel, { color: colors.textSecondary }]}>
                      {t('ledger.arrears')}
                    </Text>
                    <Text
                      style={[
                        styles.sheetStatVal,
                        typography.numeric,
                        { color: summary.arrearsTotal > 0 ? colors.danger : colors.metText },
                      ]}
                    >
                      {formatPKR(summary.arrearsTotal)}
                    </Text>
                  </Card>
                </View>

                <Text style={[styles.sheetSectionLabel, { color: colors.textSecondary }]}>
                  {isAdmin
                    ? lang === 'ur'
                      ? 'ادائیگی درج یا ترمیم کرنے کے لیے کسی بھی مہینے پر ٹیپ کریں'
                      : 'Tap any month below to record or edit payment'
                    : lang === 'ur'
                      ? 'تفصیل دیکھنے کے لیے کسی بھی مہینے پر ٹیپ کریں'
                      : 'Tap any month below to view receipt details'}
                </Text>

                <View style={styles.monthGrid}>
                  {summary.months.map((cell) => {
                    const isCurrent = cell.periodStart === currentMonth;
                    const bg =
                      cell.status === 'met'
                        ? colors.metBg
                        : cell.status === 'short'
                          ? colors.shortBg
                          : cell.status === 'unpaid'
                            ? colors.unpaidBg
                            : cell.status === 'advance'
                              ? colors.advanceBg
                              : colors.surfaceSubtle;
                    const fg =
                      cell.status === 'met'
                        ? colors.metText
                        : cell.status === 'short'
                          ? colors.shortText
                          : cell.status === 'unpaid'
                            ? colors.unpaidText
                            : cell.status === 'advance'
                              ? colors.advanceText
                              : colors.textMuted;

                    return (
                      <Pressable
                        key={cell.periodStart}
                        onPress={() => onPressMonth(summary, cell)}
                        style={({ pressed }) => [
                          styles.monthTile,
                          {
                            backgroundColor: bg,
                            borderColor: isCurrent ? colors.primary : colors.border,
                            borderWidth: isCurrent ? 1.5 : 1,
                            opacity: pressed ? 0.78 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.monthTileLabel, { color: fg }]}>
                          {formatMonthShort(cell.periodStart, lang)}
                        </Text>
                        <Text
                          style={[styles.monthTileAmt, typography.numeric, { color: fg }]}
                        >
                          {cell.paidAmount > 0 ? `Rs ${cell.paidAmount.toLocaleString()}` : '—'}
                        </Text>
                        <Text style={[styles.monthTileStatus, { color: fg }]}>
                          {t(`compliance.${cell.status}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {isAdmin && onQuickCollect ? (
                  <Pressable
                    onPress={() => onQuickCollect(summary)}
                    style={[
                      styles.sheetCollectBtn,
                      { backgroundColor: colors.primary, borderRadius: radius.lg },
                    ]}
                  >
                    <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.sheetCollectBtnText}>
                      {t('ledger.recordPayment')}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },

  // Labeled Toggle
  viewToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    padding: 3,
    gap: 2,
    alignItems: 'center',
  },
  viewToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 10,
    minHeight: 36,
  },
  viewToggleLabel: { fontSize: 12, fontWeight: '700' },

  // Member Card
  memberCard: {
    padding: 14,
    gap: 11,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '800' },
  cardName: { fontSize: 15, fontWeight: '800' },
  cardPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 4,
  },
  metaPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  metaPillText: { fontSize: 11, fontWeight: '600' },
  cardRightCol: { alignItems: 'flex-end', gap: 4 },
  cardTotalAmt: { fontSize: 15, fontWeight: '800' },
  cardStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  arrearsTag: {
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  miniMonthsStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 3,
  },
  miniMonthDot: {
    flex: 1,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniMonthText: { fontSize: 10, fontWeight: '800' },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  cardFooterHint: { fontSize: 11, fontWeight: '500' },
  quickPayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  quickPayText: { fontSize: 11, fontWeight: '700' },

  // Upgraded Table
  tableWrapper: { gap: 8 },
  legendBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  legendItems: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: '600' },
  swipeHint: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  swipeHintText: { fontSize: 11, fontWeight: '700' },

  splitTable: {
    flexDirection: 'row',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  leftColumn: { width: STICKY_NAME_WIDTH, borderEndWidth: 1 },
  headerRowBox: {
    height: 44,
    borderBottomWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  memberRowBox: {
    height: ROW_HEIGHT,
    paddingHorizontal: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    gap: 5,
  },
  tableNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tableNumBadge: {
    minWidth: 24,
    height: 20,
    borderRadius: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableNumText: { fontSize: 10, fontWeight: '800' },
  tableMemberName: { fontSize: 12.5, fontWeight: '700', flex: 1 },
  tableMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  tableSubText: { fontSize: 10.5, fontWeight: '500', flex: 1 },
  tableArrearsBadge: {
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
  },
  dataRowHeight: {
    height: ROW_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  footerRowBox: {
    height: 46,
    borderTopWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  headerCellText: { fontSize: 11.5, fontWeight: '800' },
  monthsHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 0 },
  monthHeaderCell: {
    width: MONTH_COL_WIDTH + 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthHeaderPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  totalHeaderCell: { width: TOTAL_COL_WIDTH, alignItems: 'center', justifyContent: 'center' },
  monthsRow: { flexDirection: 'row', alignItems: 'center' },
  monthCellSlot: {
    width: MONTH_COL_WIDTH + 6,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  monthCell: {
    width: MONTH_COL_WIDTH,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    gap: 1,
  },
  cellValue: { fontSize: 12.5, fontWeight: '800' },
  cellMiniTag: { fontSize: 9.5, fontWeight: '700' },
  totalCell: {
    width: TOTAL_COL_WIDTH,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderStartWidth: StyleSheet.hairlineWidth,
  },
  totalValue: { fontSize: 12.5, fontWeight: '800' },
  arrearsMini: { fontSize: 10, fontWeight: '700', marginTop: 1 },
  footerLabel: { fontSize: 12, fontWeight: '800' },
  footerNum: { fontSize: 11.5, fontWeight: '800' },

  // Breakdown Sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'flex-end',
  },
  sheet: { maxHeight: '88%' },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  sheetSub: { fontSize: 12.5, marginTop: 2 },
  closeBtn: { padding: 4 },
  sheetBody: { paddingHorizontal: 18, gap: 14 },
  sheetStatsRow: { flexDirection: 'row', gap: 10 },
  sheetStatCard: { flex: 1, padding: 13, gap: 4 },
  sheetStatLabel: { fontSize: 12, fontWeight: '600' },
  sheetStatVal: { fontSize: 18, fontWeight: '800' },
  sheetSectionLabel: { fontSize: 12, fontWeight: '600' },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  monthTile: {
    width: '31%',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 2,
  },
  monthTileLabel: { fontSize: 12, fontWeight: '800' },
  monthTileAmt: { fontSize: 13, fontWeight: '800', marginTop: 2 },
  monthTileStatus: { fontSize: 10, fontWeight: '600' },
  sheetCollectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    marginTop: 4,
  },
  sheetCollectBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
