import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, radius, spacing, ThemeColors, typography } from './tokens';
import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemePrefState {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
}

export const useThemePreferenceStore = create<ThemePrefState>((set) => ({
  preference: 'system',
  setPreference: (preference) => set({ preference }),
}));

export interface AppTheme {
  isDark: boolean;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

const ThemeContext = createContext<AppTheme>({
  isDark: false,
  colors: lightColors,
  spacing,
  radius,
  typography,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const preference = useThemePreferenceStore((s) => s.preference);

  const theme = useMemo<AppTheme>(() => {
    const isDark =
      preference === 'dark' || (preference === 'system' && systemScheme === 'dark');
    return {
      isDark,
      colors: isDark ? darkColors : lightColors,
      spacing,
      radius,
      typography,
    };
  }, [preference, systemScheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): AppTheme {
  return useContext(ThemeContext);
}
