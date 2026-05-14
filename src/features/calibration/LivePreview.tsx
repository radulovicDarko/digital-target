import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Text, ZoomablePreview } from '@/components';
import { logger } from '@/storage/logger';
import { useTheme } from '@/theme';

type Props = {
  baseUrl: string;
  /** Shown in the bottom-left badge (e.g. local dev URL in demo mode). */
  demoBadge?: string;
  /** Optional top-right badge (lock icon + label) when calibration is frozen. */
  frozenLabel?: string;
  pollMs?: number;
  accessibilityLabel?: string;
};

/**
 * Live MJPEG-as-JPEG-snapshot preview. Owns its own polling state so the
 * parent screen never re-renders when a new frame arrives — that prevents
 * the slider flicker we used to see whenever a tick fired.
 */
const LivePreviewImpl = ({
  baseUrl,
  demoBadge,
  frozenLabel,
  pollMs = 100,
  accessibilityLabel,
}: Props) => {
  const theme = useTheme();
  const [tick, setTick] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!baseUrl) return;
    void logger.info('cal', `preview source baseUrl=${baseUrl}`);
    const id = setInterval(() => setTick(Date.now()), pollMs);
    return () => clearInterval(id);
  }, [baseUrl, pollMs]);

  const uri = `${baseUrl}/api/stream/preview.jpg?t=${tick}`;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <ZoomablePreview
        uri={uri}
        badge={demoBadge}
        topBadge={
          frozenLabel
            ? {
                text: frozenLabel,
                color: theme.colors.success,
                icon: 'lock-closed',
              }
            : undefined
        }
        accessibilityLabel={accessibilityLabel}
        onLoad={() => {
          if (!loadedOnce.current) {
            loadedOnce.current = true;
            void logger.info('cal', `preview first frame loaded from ${baseUrl}`);
          }
          if (error) setError(null);
        }}
        onError={(e) => {
          const msg = e.nativeEvent?.error ?? 'unknown';
          if (error !== msg) {
            setError(msg);
            void logger.warn('cal', `preview error from ${baseUrl}: ${msg}`);
          }
        }}
        errorMessage={error}
      />
      <View style={[styles.zoomHint, { backgroundColor: theme.colors.surfaceAlt }]}>
        <Ionicons name="resize" size={14} color={theme.colors.textMuted} />
        <Text variant="caption" color="textMuted">
          {' '}Pinch to zoom · drag to pan · double-tap or ⤓ to reset
        </Text>
      </View>
    </Card>
  );
};

// Memoised so it ignores the parent's re-renders while the user drags a slider.
export const LivePreview = memo(LivePreviewImpl);

const styles = StyleSheet.create({
  zoomHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
