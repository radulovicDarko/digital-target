import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { useTheme } from '@/theme';

import type { Direction, ShotTrend as ShotTrendData } from './shotTrendUtils';

/**
 * Compass direction → base icon + rotation. We rotate `arrow-up` 8 ways so the
 * tap target & glyph stay consistent regardless of theme.
 */
const DIR_VISUAL: Record<
  Exclude<Direction, 'center'>,
  { icon: keyof typeof Ionicons.glyphMap; rotate: string }
> = {
  up: { icon: 'arrow-up', rotate: '0deg' },
  'up-right': { icon: 'arrow-up', rotate: '45deg' },
  right: { icon: 'arrow-up', rotate: '90deg' },
  'down-right': { icon: 'arrow-up', rotate: '135deg' },
  down: { icon: 'arrow-up', rotate: '180deg' },
  'down-left': { icon: 'arrow-up', rotate: '-135deg' },
  left: { icon: 'arrow-up', rotate: '-90deg' },
  'up-left': { icon: 'arrow-up', rotate: '-45deg' },
};

type Props = {
  trend: ShotTrendData;
  /** Compact = icons only. Expanded shows numeric deltas + offset. */
  compact?: boolean;
};

export const ShotTrend = ({ trend, compact = false }: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const scoreColor =
    trend.scoreTrend === 'up'
      ? theme.colors.success
      : trend.scoreTrend === 'down'
        ? theme.colors.danger
        : theme.colors.textMuted;

  const labelStyle = (color: string) => ({
    color,
    fontSize: 11,
    fontWeight: '600' as const,
    marginLeft: 2,
  });

  return (
    <View style={styles.row}>
      {/* Score change vs previous shot */}
      <View style={styles.cluster}>
        {trend.scoreTrend === 'up' ? (
          <Ionicons name="trending-up" size={14} color={scoreColor} />
        ) : trend.scoreTrend === 'down' ? (
          <Ionicons name="trending-down" size={14} color={scoreColor} />
        ) : (
          <Ionicons name="remove" size={14} color={scoreColor} />
        )}
        {!compact && trend.scoreDelta !== 0 ? (
          <RNText style={labelStyle(scoreColor)}>
            {`${trend.scoreDelta > 0 ? '+' : ''}${trend.scoreDelta}`}
          </RNText>
        ) : null}
      </View>

      {/* Direction relative to centre of target */}
      {trend.direction === 'center' ? (
        <View style={styles.cluster}>
          <Ionicons name="locate" size={14} color={theme.colors.success} />
          {!compact ? (
            <RNText style={labelStyle(theme.colors.success)}>{t('trend.bullseye')}</RNText>
          ) : null}
        </View>
      ) : (
        <View style={styles.cluster}>
          <Ionicons
            name={DIR_VISUAL[trend.direction].icon}
            size={14}
            color={theme.colors.text}
            style={{ transform: [{ rotate: DIR_VISUAL[trend.direction].rotate }] }}
            accessibilityLabel={t(
              `trend.dir_${trend.direction.replace('-', '_')}` as never,
            )}
          />
          {!compact ? (
            <RNText style={labelStyle(theme.colors.textMuted)}>
              {`${trend.offsetMm.toFixed(1)} mm`}
            </RNText>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  cluster: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
