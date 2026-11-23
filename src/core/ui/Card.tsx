import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type CardVariant = 'default' | 'charity' | 'zakat' | 'edit';

interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export function Card({ children, variant = 'default', style, padded = true }: CardProps) {
  const { colors, radius, spacing } = useTheme();

  const variantStyle: ViewStyle =
    variant === 'charity'
      ? { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder }
      : variant === 'zakat'
        ? { backgroundColor: colors.zakatSoft, borderColor: colors.zakatBorder }
        : variant === 'edit'
          ? { backgroundColor: colors.surface, borderColor: colors.editBorder, borderWidth: 2 }
          : { backgroundColor: colors.surface, borderColor: colors.border };

  return (
    <View
      style={[
        styles.base,
        { borderRadius: radius.lg },
        padded && { padding: spacing.lg },
        variantStyle,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
  },
});
