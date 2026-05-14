import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components';
import { useTheme } from '@/theme';
import type { Hit } from '@/types/session';

import { computeGroupExtents } from './geometry';

type Props = {
  visible: boolean;
  total: number;
  shotCount: number;
  innerTens: number;
  hits: Hit[];
  /** Elapsed seconds; LiveSessionScreen pauses the clock during pauses. */
  elapsedSec: number;
  /** Optional — hides the link if the caller doesn't pass a handler. */
  onViewDetails?: () => void;
  onDismiss: () => void;
};

const formatElapsed = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * End-of-session summary popup. Replaces the OS Alert that used to fire
 * when a session reached its target count. Visual goals:
 *  - sits above the bottom action row (no peek-through), centred vertically
 *  - scales gracefully on small phones (SE) and short modals on tablets
 *  - the headline number is the visual anchor — large, ring-tinted
 */
export const SessionSummaryModal = ({
  visible,
  total,
  shotCount,
  innerTens,
  hits,
  elapsedSec,
  onViewDetails,
  onDismiss,
}: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { height } = useWindowDimensions();

  const avg = shotCount > 0 ? total / shotCount : 0;
  const avgLabel = shotCount > 0 ? avg.toFixed(1) : '—';
  // Tint the trophy + total by the average score's ring colour.
  const tintRing = Math.max(0, Math.min(10, Math.round(avg)));
  const tint =
    shotCount > 0
      ? theme.colors.ringPalette[tintRing] ?? theme.colors.primary
      : theme.colors.textMuted;

  const bestShot = hits.length
    ? hits.reduce((best, h) => (h.score > best.score ? h : best), hits[0]!)
    : null;

  const extents = computeGroupExtents(hits);
  const groupSizeMm = extents
    ? Math.hypot(extents.maxXMm - extents.minXMm, extents.maxYMm - extents.minYMm)
    : 0;

  // Ring distribution buckets: 10 → 5, plus a collapsed "<5" bucket so the
  // chart stays compact while still surfacing misses.
  const buckets = [10, 9, 8, 7, 6, 5];
  const ringCounts = buckets.map((ring) => ({
    ring,
    count: hits.filter((h) => h.ring === ring).length,
  }));
  const lowCount = hits.filter((h) => h.ring < 5).length;
  const max = Math.max(1, ...ringCounts.map((b) => b.count), lowCount);

  // Cap the modal so on a tablet/iPad it doesn't span the whole height —
  // the content has natural max breadth so this just prevents stretchiness.
  const cardMaxHeight = Math.min(height - theme.spacing(8), 720);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
      testID="session-summary-modal"
    >
      <SafeAreaView style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
        <View style={styles.centerWrap}>
          <Card padded={false} style={[styles.card, { maxHeight: cardMaxHeight }]}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: theme.spacing(2) }}
              bounces={false}
            >
              {/* Header — coloured banner with trophy + headline total */}
              <View
                style={[
                  styles.header,
                  {
                    backgroundColor: `${tint}1F`,
                    paddingVertical: theme.spacing(5),
                    paddingHorizontal: theme.spacing(4),
                  },
                ]}
              >
                <View style={[styles.iconBubble, { backgroundColor: `${tint}33` }]}>
                  <Ionicons name="trophy" size={28} color={tint} />
                </View>
                <Text
                  variant="caption"
                  color="textMuted"
                  style={[styles.headerLabel, { marginTop: theme.spacing(2) }]}
                >
                  {t('session.summary.title').toUpperCase()}
                </Text>
                <View style={[styles.totalRow, { marginTop: theme.spacing(1) }]}>
                  {/* Plain RN-styled text so the variant's fontSize doesn't
                      override us. The headline is the visual anchor. */}
                  <Text style={[styles.totalNumber, { color: tint }]}>{total}</Text>
                  <Text
                    variant="caption"
                    color="textMuted"
                    style={{ marginLeft: theme.spacing(2) }}
                  >
                    {t('session.summary.total').toLowerCase()}
                  </Text>
                </View>
              </View>

              {/* Key stats grid */}
              <View
                style={[
                  styles.statsGrid,
                  { padding: theme.spacing(4), gap: theme.spacing(2) },
                ]}
              >
                <Stat label={t('session.summary.shots')} value={`${shotCount}`} />
                <Stat label={t('session.summary.average')} value={avgLabel} />
                <Stat label={t('session.summary.innerTens')} value={`${innerTens}`} />
                <Stat label={t('session.summary.duration')} value={formatElapsed(elapsedSec)} />
                {bestShot ? (
                  <Stat
                    label={t('session.summary.bestShot')}
                    value={`${bestShot.score}`}
                    accent={
                      theme.colors.ringPalette[bestShot.ring] ?? theme.colors.text
                    }
                  />
                ) : null}
                {extents ? (
                  <Stat
                    label={t('session.summary.groupSize')}
                    value={`${groupSizeMm.toFixed(1)} mm`}
                  />
                ) : null}
              </View>

              {/* Ring distribution mini-bars */}
              {hits.length > 0 ? (
                <View
                  style={{
                    paddingHorizontal: theme.spacing(4),
                    paddingBottom: theme.spacing(4),
                  }}
                >
                  <Text variant="caption" color="textMuted" style={styles.sectionLabel}>
                    {t('session.summary.ringDistribution')}
                  </Text>
                  <View style={{ gap: theme.spacing(1), marginTop: theme.spacing(2) }}>
                    {ringCounts.map((b) => (
                      <RingBar
                        key={b.ring}
                        label={`${b.ring}`}
                        count={b.count}
                        max={max}
                        color={theme.colors.ringPalette[b.ring] ?? theme.colors.primary}
                      />
                    ))}
                    {lowCount > 0 ? (
                      <RingBar
                        label="<5"
                        count={lowCount}
                        max={max}
                        color={theme.colors.danger}
                      />
                    ) : null}
                  </View>
                </View>
              ) : null}
            </ScrollView>

            {/* Sticky action row at the bottom of the card. Stays out of
                the scroll so it's always reachable. */}
            <View
              style={[
                styles.actions,
                {
                  padding: theme.spacing(4),
                  borderTopColor: theme.colors.border,
                  gap: theme.spacing(2),
                },
              ]}
            >
              {onViewDetails ? (
                <Pressable
                  onPress={onViewDetails}
                  accessibilityRole="button"
                  testID="summary-view-details"
                  hitSlop={theme.hitSlop}
                  style={({ pressed }) => [
                    styles.linkBtn,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text variant="bodyBold" color="primary">
                    {t('session.summary.viewDetails')}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.primary} />
                </Pressable>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <Button onPress={onDismiss} testID="summary-done">
                {t('session.summary.done')}
              </Button>
            </View>
          </Card>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

// ---- Subcomponents --------------------------------------------------------

const Stat = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) => {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.statCell,
        { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md },
      ]}
    >
      <Text variant="caption" color="textMuted" numberOfLines={2}>
        {label}
      </Text>
      <Text
        variant="h3"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ marginTop: 2, color: accent ?? theme.colors.text }}
      >
        {value}
      </Text>
    </View>
  );
};

const RingBar = ({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) => {
  const theme = useTheme();
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <View style={styles.barRow}>
      <Text variant="caption" style={{ width: 28 }}>
        {label}
      </Text>
      <View
        style={[
          styles.barTrack,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderRadius: theme.radius.sm,
          },
        ]}
      >
        <View
          style={{
            width: `${pct}%`,
            height: 10,
            borderRadius: theme.radius.sm,
            backgroundColor: color,
          }}
        />
      </View>
      <Text variant="caption" color="textMuted" style={styles.barCount}>
        {count}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  // Centre the card horizontally + vertically inside the safe area so it
  // doesn't sit under the notch on iPhone Pro and isn't crammed against
  // the bottom action buttons of the live session screen.
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    overflow: 'hidden',
  },
  header: { alignItems: 'center' },
  iconBubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: { textTransform: 'uppercase', letterSpacing: 0.6 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline' },
  // 44 px digit feels balanced against the 28 px trophy + caption label.
  // adjustsFontSizeToFit keeps it readable for 4-digit totals.
  totalNumber: {
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -1,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  // Cells share row width evenly. minWidth 0 + flexBasis lets them wrap
  // gracefully on narrow screens (320 px wide phones).
  statCell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 0.6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: { flex: 1, height: 10, overflow: 'hidden' },
  barCount: { width: 28, textAlign: 'right' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
});
