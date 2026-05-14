import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  Image,
  type ImageErrorEventData,
  type ImageLoadEventData,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text } from './Text';
import { useTheme } from '@/theme';

const MIN_SCALE = 1;
const MAX_SCALE = 5;

export type ZoomablePreviewProps = {
  uri: string;
  badge?: string;
  topBadge?: { text: string; color: string; icon?: 'lock-closed' | 'flash' };
  onLoad?: (e: NativeSyntheticEvent<ImageLoadEventData>) => void;
  onError?: (e: NativeSyntheticEvent<ImageErrorEventData>) => void;
  errorMessage?: string | null;
  accessibilityLabel?: string;
};

/**
 * Pinch + pan zoom around the live preview image. Uses the modern
 * gesture-handler API (Gesture.Pinch / Gesture.Pan) which is the only
 * one supported by Reanimated v4.
 */
export const ZoomablePreview = ({
  uri,
  badge,
  topBadge,
  onLoad,
  onError,
  errorMessage,
  accessibilityLabel,
}: ZoomablePreviewProps) => {
  const theme = useTheme();
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const lastTap = useRef<number>(0);

  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);

  const w = layout.width;
  const h = layout.height;

  const pinch = Gesture.Pinch()
    .onStart(() => {
      'worklet';
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, startScale.value * e.scale));
      scale.value = next;
      // Re-clamp translation so the image edge can't move past the frame.
      const maxX = ((next - 1) * w) / 2;
      const maxY = ((next - 1) * h) / 2;
      tx.value = Math.max(-maxX, Math.min(maxX, tx.value));
      ty.value = Math.max(-maxY, Math.min(maxY, ty.value));
    })
    .onEnd(() => {
      'worklet';
      if (scale.value < 1.05) {
        scale.value = withTiming(1, { duration: 120 });
        tx.value = withTiming(0, { duration: 120 });
        ty.value = withTiming(0, { duration: 120 });
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .onStart(() => {
      'worklet';
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      'worklet';
      const maxX = ((scale.value - 1) * w) / 2;
      const maxY = ((scale.value - 1) * h) / 2;
      tx.value = Math.max(-maxX, Math.min(maxX, startTx.value + e.translationX));
      ty.value = Math.max(-maxY, Math.min(maxY, startTy.value + e.translationY));
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      const target = scale.value > 1.05 ? 1 : 2.5;
      scale.value = withTiming(target, { duration: 160 });
      tx.value = withTiming(0, { duration: 160 });
      ty.value = withTiming(0, { duration: 160 });
    }
    lastTap.current = now;
  };

  const resetZoom = () => {
    scale.value = withTiming(1, { duration: 160 });
    tx.value = withTiming(0, { duration: 160 });
    ty.value = withTiming(0, { duration: 160 });
  };

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureHandlerRootView style={styles.root}>
      <View
        style={[
          styles.frame,
          { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
        ]}
        onLayout={(e) =>
          setLayout({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }
      >
        <GestureDetector gesture={composed}>
          <Animated.View style={[StyleSheet.absoluteFill, animStyle]}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={onTap}>
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
                onLoad={onLoad}
                onError={onError}
                accessibilityLabel={accessibilityLabel}
              />
            </Pressable>
          </Animated.View>
        </GestureDetector>

        {errorMessage ? (
          <View style={styles.errorOverlay}>
            <Ionicons name="alert-circle" size={28} color={theme.colors.danger} />
            <Text variant="caption" color="textMuted" style={{ textAlign: 'center', marginTop: 6 }}>
              {errorMessage}
            </Text>
          </View>
        ) : null}

        {badge ? (
          <View style={[styles.badgeBL, { backgroundColor: theme.colors.surface }]}>
            <Ionicons name="flask-outline" size={12} color={theme.colors.textMuted} />
            <Text variant="caption" color="textMuted">{` ${badge}`}</Text>
          </View>
        ) : null}

        {topBadge ? (
          <View style={[styles.badgeTR, { backgroundColor: topBadge.color }]}>
            {topBadge.icon ? (
              <Ionicons name={topBadge.icon} size={14} color={theme.colors.textInverse} />
            ) : null}
            <Text variant="caption" color="textInverse">{` ${topBadge.text}`}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.resetBtn, { backgroundColor: theme.colors.surface }]}
          onPress={resetZoom}
          hitSlop={6}
          accessibilityLabel="Reset zoom"
        >
          <Ionicons name="contract" size={18} color={theme.colors.text} />
        </Pressable>
      </View>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  root: { width: '100%', aspectRatio: 4 / 3 },
  frame: {
    flex: 1,
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  badgeBL: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    opacity: 0.9,
  },
  badgeTR: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
  },
  resetBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
});
