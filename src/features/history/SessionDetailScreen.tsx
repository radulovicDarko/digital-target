import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useApiClient, useSessionQuery, useTargetConfigQuery } from '@/api/hooks';
import { queryKeys } from '@/api/queryKeys';
import { useRefetchOnFocus } from '@/api/useRefetchOnFocus';
import { Button, Card, ErrorState, Loading, Screen, Text } from '@/components';
import { LiveTargetCanvas } from '@/features/session/LiveTargetCanvas';
import { ShotTrend } from '@/features/session/ShotTrend';
import { computeShotTrend } from '@/features/session/shotTrendUtils';
import { formatForDiscipline } from '@/features/session/disciplineFormats';
import {
  computeAverage,
  computeExtremeSpread,
  computeGroupExtents,
  computeMpi,
} from '@/features/session/geometry';
import { usePairingStore } from '@/state/pairingStore';
import { useTheme } from '@/theme';
import type { Hit } from '@/types/session';

type Props = { sessionId: string; onClose: () => void };

const RING_BUCKETS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const ALL = -1;

export const SessionDetailScreen = ({ sessionId, onClose }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const active = usePairingStore((s) => s.active);
  const apiClient = useApiClient();
  const session = useSessionQuery(sessionId);
  const target = useTargetConfigQuery();

  useRefetchOnFocus([queryKeys.session(active?.id ?? 'none', sessionId)]);

  const [targetFilter, setTargetFilter] = useState<number>(ALL);
  const [focusedHitTs, setFocusedHitTs] = useState<number | null>(null);

  const allHits: Hit[] = useMemo(
    () =>
      (session.data?.hits ?? []).map((h) => ({
        sessionId: session.data?.id ?? '',
        ts: h.ts,
        xNorm: h.x_norm,
        yNorm: h.y_norm,
        score: h.score,
        ring: h.ring,
        xMm: h.x_mm,
        yMm: h.y_mm,
        distMm: h.dist_mm,
        isInnerTen: h.is_inner_ten,
      })),
    [session.data],
  );

  if (session.isLoading || !apiClient) return <Loading />;
  if (session.isError || !session.data)
    return (
      <ErrorState message={t('errors.network')} onRetry={() => void session.refetch()} />
    );

  const data = session.data;

  // Resolve the programme format. Priority:
  //  1. Whatever the session was started with (Pi-side fields).
  //  2. The built-in discipline format (ISSF presets).
  //  3. Fallback "everything is one target" so old sessions still render.
  const baseFmt = formatForDiscipline(data.discipline);
  const fmt = {
    shotsPerTarget:
      data.shots_per_target && data.shots_per_target > 0
        ? data.shots_per_target
        : baseFmt.shotsPerTarget,
    targetsPerSession:
      data.targets_per_session && data.targets_per_session > 0
        ? data.targets_per_session
        : baseFmt.targetsPerSession,
  };
  const totalTargets = Math.max(
    1,
    Math.min(fmt.targetsPerSession, Math.ceil(allHits.length / fmt.shotsPerTarget) || 1),
  );

  // Hits filtered to the selected target index (1-based) or all.
  const visibleHits =
    targetFilter === ALL
      ? allHits
      : allHits.slice((targetFilter - 1) * fmt.shotsPerTarget, targetFilter * fmt.shotsPerTarget);

  const avg = computeAverage(visibleHits);
  const mpi = computeMpi(visibleHits);
  const ext = computeGroupExtents(visibleHits);
  const groupSize =
    ext != null ? Math.hypot(ext.maxXMm - ext.minXMm, ext.maxYMm - ext.minYMm) : 0;
  const extremeSpread = computeExtremeSpread(visibleHits);
  const innerTens = visibleHits.filter((h) => h.isInnerTen).length;

  const ringCounts = RING_BUCKETS.map((ring) => ({
    ring,
    count: visibleHits.filter((h) => h.ring === ring).length,
  }));
  const maxBucket = Math.max(1, ...ringCounts.map((b) => b.count));

  const { width, height } = Dimensions.get('window');
  // Smaller cap than before because the target card now sticks to the top
  // while the rest of the screen scrolls underneath — a 460 px square would
  // dominate the viewport and hide the table you're trying to read.
  const targetSize = Math.min(
    width - theme.spacing(8),
    Math.floor(height * 0.38),
    340,
  );

  // Use the live target geometry from the Pi (or, in demo mode, the mock
  // server). Falling back to a hardcoded set caused the rings to render at
  // the wrong scale relative to the paper, which is why old sessions used
  // to show a tiny bull crammed against the centre.
  const config = target.data
    ? {
        paperMm: target.data.paper_mm,
        ringDiametersMm: target.data.ring_diameters_mm,
        innerTenMm: target.data.inner_ten_mm,
        pelletMm: target.data.pellet_mm,
        discipline: data.discipline,
      }
    : null;

  const total = visibleHits.reduce((acc, h) => acc + h.score, 0);

  // Sticky-headers index math: the target card always renders, but the
  // filter chip strip is conditional. Track its index so the right slot
  // gets pinned. Header is 0, optional chips is 1, target is 1 or 2.
  const targetCardIndex = totalTargets > 1 ? 2 : 1;

  return (
    <Screen testID="session-detail">
      <ScrollView
        stickyHeaderIndices={[targetCardIndex]}
        contentContainerStyle={{ gap: theme.spacing(3), paddingBottom: theme.spacing(8) }}
      >
        <View style={styles.headerRow}>
          <View style={{ flexShrink: 1 }}>
            <Text variant="h1">{data.discipline}</Text>
            <Text color="textMuted">{new Date(data.started_at * 1000).toLocaleString()}</Text>
          </View>
          <Button onPress={onClose} variant="ghost" testID="session-detail-close">
            {t('common.close')}
          </Button>
        </View>

        {/* Target filter chips */}
        {totalTargets > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <FilterChip
              label={t('detail.allTargets')}
              active={targetFilter === ALL}
              onPress={() => {
                setTargetFilter(ALL);
                setFocusedHitTs(null);
              }}
              testID="filter-all"
            />
            {Array.from({ length: totalTargets }).map((_, i) => {
              const idx = i + 1;
              return (
                <FilterChip
                  key={idx}
                  label={t('detail.targetN', { n: idx })}
                  active={targetFilter === idx}
                  onPress={() => {
                    setTargetFilter(idx);
                    setFocusedHitTs(null);
                  }}
                  testID={`filter-target-${idx}`}
                />
              );
            })}
          </ScrollView>
        ) : null}

        {/* STICKY: target canvas card. Wrapped in a Screen-bg-coloured View
            so the gap above/below the Card stays opaque while it sticks —
            otherwise scrolling content peeks through the inter-card spacing. */}
        <View style={{ backgroundColor: theme.colors.bg, paddingBottom: theme.spacing(2) }}>
          <Card>
            <Text variant="h3" style={{ marginBottom: theme.spacing(2) }}>
              {targetFilter === ALL
                ? t('detail.allHits')
                : t('detail.targetHits', { n: targetFilter })}
            </Text>
            <View style={{ alignItems: 'center' }}>
              {config ? (
                <LiveTargetCanvas
                  size={targetSize}
                  config={config}
                  hits={visibleHits}
                  showMpi
                  showGroupEllipse
                  highlightTs={focusedHitTs}
                />
              ) : (
                <Loading />
              )}
            </View>
            {mpi ? (
              <Text variant="caption" color="textMuted" style={{ marginTop: theme.spacing(2) }}>
                {t('detail.mpiLabel', {
                  x: mpi.x.toFixed(1),
                  y: mpi.y.toFixed(1),
                })}
              </Text>
            ) : null}
          </Card>
        </View>

        <View style={[styles.statsRow, { gap: theme.spacing(2) }]}>
          <StatTile label={t('session.total')} value={`${total}`} />
          <StatTile label={t('session.shots')} value={`${visibleHits.length}`} />
          <StatTile label={t('session.avg')} value={visibleHits.length ? avg.toFixed(1) : '—'} />
        </View>

        <View style={[styles.statsRow, { gap: theme.spacing(2) }]}>
          <StatTile label={t('session.innerTens')} value={`${innerTens}`} />
          <StatTile
            label={t('detail.groupSize')}
            value={visibleHits.length > 1 ? `${groupSize.toFixed(1)} mm` : '—'}
          />
          <StatTile
            label={t('detail.extremeSpread')}
            value={visibleHits.length > 1 ? `${extremeSpread.toFixed(1)} mm` : '—'}
          />
        </View>

        <Card>
          <Text variant="h3">{t('detail.ringDistribution')}</Text>
          <View style={{ gap: theme.spacing(1), marginTop: theme.spacing(2) }}>
            {ringCounts
              .filter((b) => b.count > 0)
              .map((b) => (
                <View key={b.ring} style={styles.barRow}>
                  <Text variant="caption" style={{ width: 28 }}>
                    {b.ring}
                  </Text>
                  <View
                    style={{
                      flex: 1,
                      height: 12,
                      borderRadius: theme.radius.sm,
                      backgroundColor: theme.colors.surfaceAlt,
                    }}
                  >
                    <View
                      style={{
                        width: `${(b.count / maxBucket) * 100}%`,
                        height: 12,
                        borderRadius: theme.radius.sm,
                        backgroundColor:
                          theme.colors.ringPalette[b.ring] ?? theme.colors.primary,
                      }}
                    />
                  </View>
                  <Text variant="caption" color="textMuted" style={{ width: 28, textAlign: 'right' }}>
                    {b.count}
                  </Text>
                </View>
              ))}
          </View>
        </Card>

        <Card>
          <Text variant="h3">{t('detail.shotTable')}</Text>
          <View style={[styles.tableHeader, { borderColor: theme.colors.border }]}>
            <Text variant="caption" color="textMuted" style={styles.colNum}>#</Text>
            <Text variant="caption" color="textMuted" style={styles.colTime}>
              {t('detail.time')}
            </Text>
            <Text variant="caption" color="textMuted" style={styles.colScore}>
              {t('detail.score')}
            </Text>
            <Text variant="caption" color="textMuted" style={styles.colTrend}>
              {t('detail.trend')}
            </Text>
            <Text
              variant="caption"
              color="textMuted"
              style={[styles.colDist, { textAlign: 'right' }]}
            >
              {t('detail.distance')}
            </Text>
          </View>
          {visibleHits.length === 0 ? (
            <Text color="textMuted" style={{ marginTop: theme.spacing(2) }}>
              {t('common.empty')}
            </Text>
          ) : (
            visibleHits.map((h, i) => {
              const globalIndex =
                targetFilter === ALL ? i : (targetFilter - 1) * fmt.shotsPerTarget + i;
              const trend = computeShotTrend(i > 0 ? visibleHits[i - 1] ?? null : null, h);
              const isFocused = focusedHitTs === h.ts;
              return (
                <Pressable
                  key={`${h.ts}-${i}`}
                  onPress={() =>
                    setFocusedHitTs((prev) => (prev === h.ts ? null : h.ts))
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: isFocused }}
                  testID={`detail-row-${globalIndex + 1}`}
                  style={[
                    styles.tableRow,
                    {
                      borderColor: theme.colors.border,
                      backgroundColor: isFocused
                        ? `${theme.colors.primary}1A`
                        : 'transparent',
                    },
                  ]}
                >
                  <Text variant="caption" style={styles.colNum}>
                    {globalIndex + 1}
                  </Text>
                  <Text variant="caption" style={styles.colTime}>
                    {new Date(h.ts * 1000).toLocaleTimeString()}
                  </Text>
                  <Text
                    variant="bodyBold"
                    style={[
                      styles.colScore,
                      { color: theme.colors.ringPalette[h.ring] ?? theme.colors.text },
                    ]}
                  >
                    {h.score}
                  </Text>
                  <View style={styles.colTrend}>
                    <ShotTrend trend={trend} compact />
                  </View>
                  <Text variant="caption" style={[styles.colDist, { textAlign: 'right' }]}>
                    {`${h.distMm.toFixed(1)} mm`}
                  </Text>
                </Pressable>
              );
            })
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
};

const FilterChip = ({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) => {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={testID}
      style={{
        paddingVertical: t.spacing(1) + 2,
        paddingHorizontal: t.spacing(3),
        borderRadius: t.radius.pill,
        backgroundColor: active ? t.colors.primary : t.colors.surfaceAlt,
        borderWidth: 1,
        borderColor: active ? t.colors.primary : t.colors.border,
      }}
    >
      <Text variant="caption" color={active ? 'textInverse' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
};

const StatTile = ({ label, value }: { label: string; value: string }) => {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, minWidth: 0 }}>
      {/* Allow the label to wrap onto a second line — single-line truncation
          chops off translations like "Centralne desetke" / "Maksimalna
          razlika" with ellipsis on narrow phones. */}
      <Text variant="caption" color="textMuted" numberOfLines={2}>
        {label}
      </Text>
      <Text
        variant="h3"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ marginTop: t.spacing(1) }}
      >
        {value}
      </Text>
    </Card>
  );
};

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chipRow: { gap: 8, paddingVertical: 4, paddingRight: 16 },
  statsRow: { flexDirection: 'row' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colNum: { width: 32 },
  colTime: { flex: 1 },
  colScore: { width: 40, textAlign: 'center' },
  colTrend: { width: 56, alignItems: 'center' },
  colDist: { width: 70 },
});
