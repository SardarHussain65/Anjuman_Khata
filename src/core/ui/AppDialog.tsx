import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';
import { useTheme } from '@/core/theme/ThemeProvider';
import { Button, ButtonVariant } from './Button';

export type DialogTone = 'info' | 'success' | 'warning' | 'danger';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void | Promise<void>;
}

export interface DialogConfig {
  title: string;
  message?: string;
  tone?: DialogTone;
  buttons?: DialogButton[];
}

interface DialogStoreState {
  current: DialogConfig | null;
  show: (config: DialogConfig) => void;
  hide: () => void;
}

export const useDialogStore = create<DialogStoreState>((set) => ({
  current: null,
  show: (config) => set({ current: config }),
  hide: () => set({ current: null }),
}));

/**
 * Drop-in themed replacement for React Native's `Alert.alert(...)`.
 * Renders a polished, branded Heritage Emerald & Gold modal dialog instead of raw OS alerts.
 */
export function showAppAlert(
  title: string,
  message?: string,
  buttons?: DialogButton[],
  tone?: DialogTone,
): void {
  const inferredTone: DialogTone =
    tone ??
    (buttons?.some((b) => b.style === 'destructive')
      ? 'danger'
      : /error|fail|wrong|مسئلہ|غلط/i.test(`${title} ${message ?? ''}`)
        ? 'danger'
        : /saved|updated|confirm|محفوظ|تصدیق/i.test(title)
          ? 'success'
          : 'warning');

  useDialogStore.getState().show({
    title,
    message,
    tone: inferredTone,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' }],
  });
}

export function AppDialogHost() {
  const { colors, radius } = useTheme();
  const current = useDialogStore((s) => s.current);
  const hide = useDialogStore((s) => s.hide);

  if (!current) return null;

  const tone = current.tone ?? 'info';
  const iconName: keyof typeof Ionicons.glyphMap =
    tone === 'danger'
      ? 'alert-circle'
      : tone === 'success'
        ? 'checkmark-circle'
        : tone === 'warning'
          ? 'warning'
          : 'information-circle';

  const iconBg =
    tone === 'danger'
      ? colors.dangerSoft
      : tone === 'success'
        ? colors.successSoft
        : tone === 'warning'
          ? colors.warningSoft
          : colors.primarySoft;

  const iconColor =
    tone === 'danger'
      ? colors.danger
      : tone === 'success'
        ? colors.success
        : tone === 'warning'
          ? colors.warning
          : colors.primary;

  const buttons = current.buttons ?? [{ text: 'OK', style: 'default' }];

  const handlePress = (btn: DialogButton) => {
    hide();
    if (btn.onPress) {
      Promise.resolve(btn.onPress()).catch(() => {});
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={hide}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          const cancelBtn = buttons.find((b) => b.style === 'cancel');
          if (cancelBtn || buttons.length === 1) {
            hide();
          }
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.xl,
            },
          ]}
        >
          <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
            <Ionicons name={iconName} size={30} color={iconColor} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>{current.title}</Text>

          {current.message ? (
            <Text style={[styles.message, { color: colors.textSecondary }]}>
              {current.message}
            </Text>
          ) : null}

          <View style={[styles.actions, buttons.length === 1 && styles.singleAction]}>
            {buttons.map((btn, idx) => {
              const variant: ButtonVariant =
                btn.style === 'destructive'
                  ? 'danger'
                  : btn.style === 'cancel'
                    ? 'secondary'
                    : 'primary';
              return (
                <Button
                  key={`${btn.text}-${idx}`}
                  label={btn.text}
                  variant={variant}
                  onPress={() => handlePress(btn)}
                  style={styles.actionBtn}
                />
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 18, 14, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    alignItems: 'center',
    gap: 10,
    elevation: 16,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    width: '100%',
  },
  singleAction: {
    justifyContent: 'center',
  },
  actionBtn: {
    flex: 1,
    minHeight: 44,
  },
});
