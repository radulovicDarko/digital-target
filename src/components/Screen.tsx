import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
  /** Override the default 16pt content padding. Use `2` for tighter screens. */
  padding?: number;
  /** Override the default vertical gap between children. */
  gap?: number;
};

export const Screen = ({ children, scroll = false, testID, padding, gap }: Props) => {
  const t = useTheme();
  const padPx = padding == null ? t.spacing(4) : t.spacing(padding);
  const gapPx = gap == null ? t.spacing(3) : t.spacing(gap);
  const Inner = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.bg }]} testID={testID}>
      <Inner
        style={styles.flex}
        contentContainerStyle={scroll ? { padding: padPx, gap: gapPx } : undefined}
      >
        {scroll ? (
          children
        ) : (
          <View style={[styles.flex, { padding: padPx, gap: gapPx }]}>{children}</View>
        )}
      </Inner>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
});
