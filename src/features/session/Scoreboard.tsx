import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Card, Text } from '@/components';
import { useTheme } from '@/theme';

type Props = {
  total: number;
  shots: number;
  innerTens: number;
  lastScore: number | null;
  lastRing?: number | null;
  elapsedSec: number;
};

const formatElapsed = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const Scoreboard = ({
  total,
  shots,
  innerTens,
  lastScore,
  lastRing,
  elapsedSec,
}: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const avg = shots > 0 ? (total / shots).toFixed(1) : '—';
  const lastColor =
    lastRing != null ? theme.colors.ringPalette[lastRing] ?? theme.colors.text : theme.colors.text;

  return (
    <Card style={{ paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
      <View
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('a11y.scoreboard', { total, shots, avg })}
      >
        <View style={styles.headerRow}>
          <View>
            <Text variant="caption" color="textMuted">
              {t('session.total')}
            </Text>
            <Text variant="h2">{total}</Text>
          </View>
          <View
            style={[
              styles.lastBadge,
              {
                backgroundColor: lastScore == null ? theme.colors.surfaceAlt : `${lastColor}22`,
                borderColor: lastScore == null ? theme.colors.border : lastColor,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <Text variant="caption" color="textMuted">
              {t('session.last')}
            </Text>
            <Text variant="h2" style={{ color: lastColor }}>
              {lastScore == null ? '—' : lastScore}
            </Text>
          </View>
        </View>

        <View style={[styles.statsRow, { marginTop: theme.spacing(1) }]}>
          <Stat label={t('session.shots')} value={`${shots}`} />
          <Stat label={t('session.avg')} value={avg} />
          <Stat label={t('session.innerTens')} value={`${innerTens}`} />
          <Stat label={t('session.elapsed')} value={formatElapsed(elapsedSec)} />
        </View>
      </View>
    </Card>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.cell}>
    <Text variant="caption" color="textMuted">
      {label}
    </Text>
    <Text variant="bodyBold">{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lastBadge: {
    minWidth: 84,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  cell: { minWidth: 60 },
});
