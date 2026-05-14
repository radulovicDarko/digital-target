import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/theme';

type Props = {
  title?: string;
  subtitle?: string;
  /** Tap handler for the leading back/close button. Hidden when omitted. */
  onBack?: () => void;
  /** Customise the back icon (default: chevron-back). */
  backIcon?: 'chevron-back' | 'close';
  /** Optional accessibility label for the back button. */
  backLabel?: string;
  /** Trailing slot, typically a settings/menu/edit button. */
  right?: ReactNode;
};

/**
 * Standard header used at the top of feature screens. Provides a consistent
 * place for the back button, title, and optional trailing action so screens
 * outside of the React Navigation stack still feel native.
 */
export const ScreenHeader = ({
  title,
  subtitle,
  onBack,
  backIcon = 'chevron-back',
  backLabel = 'Back',
  right,
}: Props) => {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.leftSlot}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            hitSlop={10}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: pressed
                  ? theme.colors.surfaceAlt
                  : 'transparent',
                borderRadius: theme.radius.md,
              },
            ]}
            testID="screen-header-back"
          >
            <Ionicons name={backIcon} size={24} color={theme.colors.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.titleSlot}>
        {title ? <Text variant="h2">{title}</Text> : null}
        {subtitle ? (
          <Text variant="caption" color="textMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.rightSlot}>{right}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  leftSlot: {
    width: 44,
    alignItems: 'flex-start',
  },
  rightSlot: {
    minWidth: 44,
    alignItems: 'flex-end',
  },
  titleSlot: {
    flex: 1,
    paddingHorizontal: 4,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
