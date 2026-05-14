import type { ReactNode } from 'react';
import { useCallback } from 'react';
import type { AccessibilityProps, StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, Text, ActivityIndicator } from 'react-native';

import { logger } from '@/storage/logger';
import { useTheme } from '@/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = AccessibilityProps & {
  onPress: () => void;
  children: ReactNode;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const Button = ({
  onPress,
  children,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  testID,
  ...a11y
}: Props) => {
  const t = useTheme();
  const isDisabled = disabled || loading;

  const labelForLog = (() => {
    const a11yLabel = (a11y as { accessibilityLabel?: unknown }).accessibilityLabel;
    if (typeof a11yLabel === 'string' && a11yLabel.trim()) return a11yLabel;
    if (typeof children === 'string') return children;
    if (typeof children === 'number') return String(children);
    return '';
  })();

  const handlePress = useCallback(() => {
    // Note: if `disabled`/`loading` is true, Pressable won't call onPress.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[ui] Button onPress', {
        testID,
        variant,
        disabled: isDisabled,
        label: labelForLog,
      });
    }
    void logger.info(
      'ui',
      `Button press variant=${variant} disabled=${isDisabled} testID=${testID ?? ''} label=${labelForLog}`,
    );
    onPress();
  }, [isDisabled, labelForLog, onPress, testID, variant]);

  const palette: Record<Variant, { bg: string; text: string; border?: string }> = {
    primary: { bg: t.colors.primary, text: t.colors.textInverse },
    secondary: { bg: t.colors.surfaceAlt, text: t.colors.text, border: t.colors.border },
    ghost: { bg: 'transparent', text: t.colors.primary },
    danger: { bg: t.colors.danger, text: t.colors.textInverse },
  };
  const p = palette[variant];

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      hitSlop={t.hitSlop}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: p.bg,
          borderRadius: t.radius.md,
          borderWidth: p.border ? 1 : 0,
          borderColor: p.border ?? 'transparent',
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          minHeight: 44,
          paddingHorizontal: t.spacing(4),
        },
        style,
      ]}
      {...a11y}
    >
      {loading ? (
        <ActivityIndicator color={p.text} />
      ) : (
        <Text
          style={[t.typography.bodyBold, { color: p.text, textAlign: 'center' }]}
          numberOfLines={1}
        >
          {children}
        </Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
