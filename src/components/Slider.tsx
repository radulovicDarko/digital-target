import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme';

export type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Step used by the +/- buttons. The slider itself is continuous. */
  step: number;
  /** Optional formatter for the readout (e.g. percent, mm, °). */
  format?: (v: number) => string;
  onChange: (next: number) => void;
};

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

const snap = (v: number, step: number) =>
  step > 0 ? Math.round(v / step) * step : v;

/**
 * Touch + drag slider with -/+ buttons. Built on PanResponder so it works
 * reliably inside a ScrollView (we ask the responder system for the touch
 * only when the user actually starts dragging the thumb).
 */
export const Slider = ({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: SliderProps) => {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  const valueToFrac = useCallback(
    (v: number) => (max === min ? 0 : (v - min) / (max - min)),
    [min, max],
  );
  const fracToValue = useCallback(
    (f: number) => snap(min + clamp(f, 0, 1) * (max - min), step),
    [min, max, step],
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const handleAt = (locationX: number) => {
    if (trackWidth <= 0) return;
    onChange(fracToValue(locationX / trackWidth));
  };

  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2,
    onPanResponderGrant: (e) => handleAt(e.nativeEvent.locationX),
    onPanResponderMove: (e) => handleAt(e.nativeEvent.locationX),
    onPanResponderTerminationRequest: () => false,
  });

  const frac = clamp(valueToFrac(value), 0, 1);
  const thumbLeft = frac * trackWidth;
  const filledWidth = thumbLeft;

  const readout = format ? format(value) : value.toFixed(2);

  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        <Text style={{ flex: 1 }}>{label}</Text>
        <Text variant="bodyBold">{readout}</Text>
      </View>
      <View style={styles.controls}>
        <Pressable
          onPress={() => onChange(clamp(snap(value - step, step), min, max))}
          style={[
            styles.stepBtn,
            { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
          ]}
          accessibilityLabel={`Decrease ${label}`}
          hitSlop={6}
        >
          <Ionicons name="remove" size={18} color={theme.colors.text} />
        </Pressable>
        <View
          style={styles.trackWrap}
          onLayout={onTrackLayout}
          {...responder.panHandlers}
        >
          <View
            style={[
              styles.trackBg,
              { backgroundColor: theme.colors.surfaceAlt },
            ]}
          />
          <View
            style={[
              styles.trackFilled,
              {
                backgroundColor: theme.colors.primary,
                width: filledWidth,
              },
            ]}
          />
          <View
            style={[
              styles.thumb,
              {
                backgroundColor: theme.colors.primary,
                borderColor: theme.colors.surface,
                transform: [{ translateX: thumbLeft - 11 }],
              },
            ]}
          />
        </View>
        <Pressable
          onPress={() => onChange(clamp(snap(value + step, step), min, max))}
          style={[
            styles.stepBtn,
            { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
          ]}
          accessibilityLabel={`Increase ${label}`}
          hitSlop={6}
        >
          <Ionicons name="add" size={18} color={theme.colors.text} />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { marginTop: 12 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trackWrap: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
  },
  trackFilled: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    elevation: 2,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
