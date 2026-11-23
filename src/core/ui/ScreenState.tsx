import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export function LoadingState({ message }: { message?: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {message ?? t('common.loading')}
      </Text>
    </View>
  );
}

export function EmptyState({
  title,
  subtitle,
  icon = 'book-outline',
  actionLabel,
  onAction,
}: {
  title?: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.center}>
      <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSubtle }]}>
        <Ionicons name={icon} size={28} color={colors.textMuted} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>
        {title ?? t('common.emptyTitle')}
      </Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {subtitle ?? t('common.emptySubtitle')}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.center}>
      <View style={[styles.iconWrap, { backgroundColor: colors.dangerSoft }]}>
        <Ionicons name="warning-outline" size={28} color={colors.danger} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>
        {message ?? t('common.errorGeneric')}
      </Text>
      {onRetry ? (
        <Button label={t('common.retry')} onPress={onRetry} variant="secondary" style={styles.action} />
      ) : null}
    </View>
  );
}

interface BoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  BoundaryState
> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorState onRetry={this.handleReset} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  action: {
    marginTop: 12,
  },
});
