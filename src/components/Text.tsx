import type { TextProps as RNTextProps, TextStyle, StyleProp } from 'react-native';
import { Text as RNText } from 'react-native';

import { useTheme } from '@/theme';
import type { Theme } from '@/theme';

type Variant = keyof Theme['typography'];

type Props = RNTextProps & {
  variant?: Variant;
  color?: 'text' | 'textMuted' | 'primary' | 'success' | 'warning' | 'danger' | 'textInverse';
  style?: StyleProp<TextStyle>;
};

export const Text = ({ variant = 'body', color = 'text', style, ...rest }: Props) => {
  const t = useTheme();
  return (
    <RNText
      maxFontSizeMultiplier={2}
      {...rest}
      style={[t.typography[variant], { color: t.colors[color] }, style]}
    />
  );
};
