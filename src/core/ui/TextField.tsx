import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  helperText?: string;
}

export function TextField({
  label,
  error,
  helperText,
  style,
  ...props
}: TextFieldProps) {
  const { colors, radius } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            color: colors.text,
            borderColor: error ? colors.danger : colors.borderStrong,
            borderRadius: radius.md,
          },
          style,
        ]}
        {...props}
      />
      {error ? (
        <Text style={[styles.feedback, { color: colors.danger }]}>{error}</Text>
      ) : helperText ? (
        <Text style={[styles.feedback, { color: colors.textMuted }]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    fontSize: 15,
    textAlign: 'auto',
  },
  feedback: {
    fontSize: 12,
  },
});
