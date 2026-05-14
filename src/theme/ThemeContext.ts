import { createContext, useContext } from 'react';

import type { Theme } from './tokens';
import { darkTheme } from './tokens';

export const ThemeContext = createContext<Theme>(darkTheme);

export const useTheme = (): Theme => useContext(ThemeContext);
