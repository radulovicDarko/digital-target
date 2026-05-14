import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { useSettingsStore } from '@/state/settingsStore';

import { ThemeContext } from './ThemeContext';
import { darkTheme, lightTheme } from './tokens';

type Props = { children: ReactNode };

export const ThemeProvider = ({ children }: Props) => {
  const systemScheme = useColorScheme();
  const themePref = useSettingsStore((s) => s.theme);

  const theme = useMemo(() => {
    const effective =
      themePref === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : themePref;
    return effective === 'light' ? lightTheme : darkTheme;
  }, [themePref, systemScheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
};
