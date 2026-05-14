import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
};

export const Card = ({ children, style, padded = true }: Props) => {
  const t = useTheme();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: padded ? t.spacing(4) : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: { borderWidth: StyleSheet.hairlineWidth },
});
