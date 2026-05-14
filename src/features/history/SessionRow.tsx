import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Text } from '@/components';
import { logger } from '@/storage/logger';
import { useTheme } from '@/theme';

export type SessionListItem = {
  id: string;
  shooter_id: string;
  discipline: string;
  started_at: number;
  ended_at: number | null;
  total_score: number;
  shot_count: number;
};

const disciplineIcon = (discipline: string): keyof typeof Ionicons.glyphMap => {
  if (discipline === 'Demo') return 'flask-outline';
  if (discipline === 'Free') return 'infinite-outline';
  if (discipline === 'Custom') return 'construct-outline';
  if (discipline.includes('Rifle')) return 'rocket-outline';
  if (discipline.includes('Pistol')) return 'aperture-outline';
  return 'radio-button-on';
};

type Props = {
  session: SessionListItem;
  onPress: () => void;
  testID?: string;
};

/**
 * Single session row used by both the History list and the Dashboard's
 * "Recent sessions" panel. Centralised here so the two screens stay
 * visually consistent — pre-existing duplication had drifted (history
 * showed an icon bubble + ring-tinted score chip, dashboard just text).
 */
export const SessionRow = ({ session, onPress, testID }: Props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const avg = session.shot_count > 0 ? session.total_score / session.shot_count : 0;
  const avgLabel = session.shot_count > 0 ? avg.toFixed(1) : '—';
  // Tint icon bubble + score chip by the average score's ring colour so
  // the row reads as "good/average/bad" at a glance.
  const avgRing = Math.max(0, Math.min(10, Math.round(avg)));
  const tint =
    session.shot_count > 0
      ? theme.colors.ringPalette[avgRing] ?? theme.colors.primary
      : theme.colors.textMuted;

  const startedAt = new Date(session.started_at * 1000);
  const dateStr = startedAt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = startedAt.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Pressable
      onPress={() => {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[ui] SessionRow onPress', {
            id: session.id,
            discipline: session.discipline,
            shots: session.shot_count,
            total: session.total_score,
          });
        }
        void logger.info(
          'ui',
          `SessionRow press id=${session.id} discipline=${session.discipline} shots=${session.shot_count} total=${session.total_score}`,
        );
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${session.discipline}, ${session.shot_count} shots, total ${session.total_score}`}
      testID={testID ?? `session-row-${session.id}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={{ paddingVertical: theme.spacing(3) }}>
        <View style={styles.row}>
          <View
            style={[
              styles.iconBubble,
              { backgroundColor: `${tint}1F`, borderRadius: theme.radius.lg },
            ]}
          >
            <Ionicons name={disciplineIcon(session.discipline)} size={22} color={tint} />
          </View>

          <View style={styles.middle}>
            <Text variant="bodyBold" numberOfLines={1}>
              {session.discipline}
            </Text>
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {`${dateStr} • ${timeStr}`}
            </Text>
            <View style={styles.metaRow}>
              <Ionicons name="locate-outline" size={12} color={theme.colors.textMuted} />
              <Text variant="caption" color="textMuted">
                {t('history.shotsCount', { count: session.shot_count })}
              </Text>
              <Text variant="caption" color="textMuted">
                {`• ${t('history.avg')} ${avgLabel}`}
              </Text>
            </View>
          </View>

          <View style={styles.trailing}>
            <View
              style={[
                styles.scoreChip,
                {
                  backgroundColor: `${tint}22`,
                  borderColor: tint,
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <Text variant="h3" style={{ color: tint }}>
                {session.total_score}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={theme.colors.textMuted}
              style={{ marginLeft: 4 }}
            />
          </View>
        </View>
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBubble: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, minWidth: 0, gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center' },
  scoreChip: {
    minWidth: 56,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
