import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, radius, spacing, type, type Palette } from './tokens';

interface ThemeValue {
  palette: Palette;
  scheme: 'light' | 'dark';
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const value = useMemo<ThemeValue>(
    () => ({
      palette: scheme === 'dark' ? darkPalette : lightPalette,
      scheme,
      spacing,
      radius,
      type,
    }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
