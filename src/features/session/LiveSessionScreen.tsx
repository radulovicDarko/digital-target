import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { useApiClient, useTargetConfigQuery } from '@/api/hooks';
import { getSharedWsClient } from '@/api/sharedWs';
import type { WsClient } from '@/api/ws';
import { Button, Card, ErrorState, Loading, Screen, Text } from '@/components';
import { useLiveSessionStore } from '@/state/liveSessionStore';
import { usePairingStore } from '@/state/pairingStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useTheme } from '@/theme';
import type { Hit } from '@/types/session';

import { LiveTargetCanvas } from './LiveTargetCanvas';
import { Scoreboard } from './Scoreboard';
import { SessionSummaryModal } from './SessionSummaryModal';
import { ShotTrend } from './ShotTrend';
import { computeShotTrend } from './shotTrendUtils';
import {
  DEMO_DISCIPLINE,
  formatForDiscipline,
  INFINITE_TARGETS,
} from './disciplineFormats';
import { onHitFeedback } from './feedback';
import { useSessionPersistence } from './useSessionPersistence';

type Props = {
  discipline: string;
  /** Override the discipline's default shots-per-target (Custom flow). */
  shotsPerTarget?: number;
  /** Override the discipline's default targets-per-session (Custom flow). */
  targetsPerSession?: number;
  onEnded: () => void;
};

export const LiveSessionScreen = ({
  discipline,
  shotsPerTarget: shotsPerTargetOverride,
  targetsPerSession: targetsPerSessionOverride,
  onEnded,
}: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const active = usePairingStore((s) => s.active);
  const lang = useSettingsStore((s) => s.lang);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const setSoundEnabled = useSettingsStore((s) => s.setSoundEnabled);
  const target = useTargetConfigQuery();
  const api = useApiClient();
  // Used to invalidate the dashboard / history caches when this session
  // ends so they refresh immediately without waiting for refetch-on-focus.
  const queryClient = useQueryClient();
  const { saveSession } = useSessionPersistence();

  const sessionId = useLiveSessionStore((s) => s.sessionId);
  const hits = useLiveSessionStore((s) => s.hits);
  const total = useLiveSessionStore((s) => s.total);
  const shotCount = useLiveSessionStore((s) => s.shotCount);
  const innerTens = useLiveSessionStore((s) => s.innerTens);
  const lastHit = useLiveSessionStore((s) => s.lastHit);
  const startedAt = useLiveSessionStore((s) => s.startedAt);
  const reconnecting = useLiveSessionStore((s) => s.reconnecting);
  const showGroupEllipse = useLiveSessionStore((s) => s.showGroupEllipse);
  const showMpi = useLiveSessionStore((s) => s.showMpi);
  const targetIndex = useLiveSessionStore((s) => s.targetIndex);
  const shotsOnTarget = useLiveSessionStore((s) => s.shotsOnTarget);
  const shotsPerTarget = useLiveSessionStore((s) => s.shotsPerTarget);
  const targetsPerSession = useLiveSessionStore((s) => s.targetsPerSession);
  const status = useLiveSessionStore((s) => s.status);
  const archivedHits = useLiveSessionStore((s) => s.archivedHits);

  const setSession = useLiveSessionStore((s) => s.setSession);
  const setStatus = useLiveSessionStore((s) => s.setStatus);
  const addHit = useLiveSessionStore((s) => s.addHit);
  const reset = useLiveSessionStore((s) => s.reset);
  const end = useLiveSessionStore((s) => s.end);
  const setReconnecting = useLiveSessionStore((s) => s.setReconnecting);
  const setShowGroupEllipse = useLiveSessionStore((s) => s.setShowGroupEllipse);
  const setShowMpi = useLiveSessionStore((s) => s.setShowMpi);

  const wsRef = useRef<WsClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const autoEndedRef = useRef(false);
  const lastSeqRef = useRef<number | null>(null);
  const replayInFlightRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [canvasArea, setCanvasArea] = useState({ width: 0, height: 0 });
  const [focusedHitTs, setFocusedHitTs] = useState<number | null>(null);
  // The replacement for the OS Alert end-of-session popup. We open it from
  // the auto-end effect and close it via the modal's own buttons.
  const [showSummary, setShowSummary] = useState(false);
  const finishedSessionIdRef = useRef<string | null>(null);

  // Drop focus when the focused hit no longer exists on the visible target.
  useEffect(() => {
    if (focusedHitTs == null) return;
    if (!hits.some((h) => h.ts === focusedHitTs)) setFocusedHitTs(null);
  }, [hits, focusedHitTs]);
  // Keep a ref so the WS handler always sees the latest session id without
  // needing it as a hook dep (which would tear down/restore the socket).
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Start the local session as soon as we land here. The Pi has no
  // concept of sessions any more — it's a thin sensor that just streams
  // hits. We mint a UUID locally, push it into the live store, and the
  // backend (if the user is logged in) will receive the full session
  // record on end.
  useEffect(() => {
    if (!sessionId) {
      // Defensive: only start once. Rerunning would orphan the previous
      // local session before it was saved.
      const baseFmt = formatForDiscipline(discipline);
      const fmt = {
        shotsPerTarget: shotsPerTargetOverride ?? baseFmt.shotsPerTarget,
        targetsPerSession: targetsPerSessionOverride ?? baseFmt.targetsPerSession,
      };
      const localId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const startedAt = Date.now() / 1000;
      autoEndedRef.current = false;
      setSession(localId, startedAt, fmt);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discipline, shotsPerTargetOverride, targetsPerSessionOverride]);

  // Connect WS once we have a paired Pi. This must NOT depend on `sessionId`
  // so we don't tear down the socket on every state change.
  useEffect(() => {
    if (!active) return undefined;

    const ws = getSharedWsClient(active);
    if (!ws) return undefined;

    const acceptHit = (h: Hit): void => {
      // Pi sends session_id="live" for every hit (it doesn't know about
      // sessions). Rewrite to the locally active id so liveSessionStore
      // accepts it. Demo path already sends the real local id, so we only
      // patch the placeholder.
      const patched: Hit =
        h.sessionId === 'live' && sessionIdRef.current
          ? { ...h, sessionId: sessionIdRef.current }
          : h.sessionId
            ? h
            : { ...h, sessionId: sessionIdRef.current ?? 'pending' };
      if (sessionIdRef.current && patched.sessionId !== sessionIdRef.current) return;
      addHit(patched);
      void onHitFeedback(h.score, lang);
    };

    const onHit = (h: Hit): void => {
      const seq = h.seq;
      // If server doesn't include seq (old firmware) or we don't have an
      // API client (shouldn't happen with a real pairing), just accept.
      if (seq == null || !api) {
        acceptHit(h);
        if (seq != null) lastSeqRef.current = Math.max(lastSeqRef.current ?? 0, seq);
        return;
      }

      const last = lastSeqRef.current;
      // First hit we see: accept and seed.
      if (last == null) {
        acceptHit(h);
        lastSeqRef.current = seq;
        return;
      }

      // Duplicate/out-of-order: drop.
      if (seq <= last) return;

      // In-order: accept.
      if (seq === last + 1) {
        acceptHit(h);
        lastSeqRef.current = seq;
        return;
      }

      // Gap detected: ask REST replay buffer to backfill. We avoid running
      // multiple concurrent replays; the first will advance lastSeqRef.
      // While a replay is in flight, still accept strictly in-order hits
      // so rapid sequences don't get dropped.
      if (replayInFlightRef.current) {
        const curLast = lastSeqRef.current;
        if (curLast != null && seq === curLast + 1) {
          acceptHit(h);
          lastSeqRef.current = seq;
        }
        return;
      }
      replayInFlightRef.current = true;
      void (async () => {
        let processedCurrent = false;
        try {
          const replay = await api.replayHits(last, 256);
          replay.hits.forEach((rh) => {
            const rseq = rh.seq;
            if (rseq == null) {
              // Unexpected: replay hits should carry seq, but keep it anyway.
              acceptHit(rh);
              return;
            }
            const curLast = lastSeqRef.current ?? 0;
            if (rseq <= curLast) return;
            acceptHit(rh);
            lastSeqRef.current = rseq;
            if (rseq === seq) processedCurrent = true;
          });
        } catch {
          // Fall back: at least don't lose the current hit.
        } finally {
          // If replay didn't include the current hit (buffer overflow, race)
          // accept it so the user still sees something.
          if (!processedCurrent) {
            acceptHit(h);
            lastSeqRef.current = Math.max(lastSeqRef.current ?? 0, seq);
          }
          replayInFlightRef.current = false;
        }
      })();
    };
    const onReconnectingEvt = (): void => setReconnecting(true);
    const onOpen = (): void => setReconnecting(false);

    let cleanup: () => void;
    wsRef.current = ws;
    const offHit = ws.on('hit', onHit);
    const offRec = ws.on('reconnecting', onReconnectingEvt);
    const offOpen = ws.on('open', onOpen);
    cleanup = () => {
      offHit();
      offRec();
      offOpen();
      // Do not close: shared WS is owned by RootNavigator.
    };
    return cleanup;
  }, [active, addHit, api, lang, setReconnecting]);

  // Demo discipline: simulate shots client-side. Pi has no concept of
  // sessions any more, so we feed hits straight into the live store via
  // addHit() instead of round-tripping through the WS. Shots stop once
  // the configured target count is filled (5×3 = 15).
  useEffect(() => {
    if (discipline !== DEMO_DISCIPLINE) return undefined;
    if (!sessionId) return undefined;
    if (status !== 'running') return undefined;

    const SHOT_INTERVAL_MS = 1100;
    const PAPER_MM = target.data?.paper_mm ?? 170;
    const RING_DIAMETERS_MM = target.data?.ring_diameters_mm ?? [
      155.5, 139.5, 123.5, 107.5, 91.5, 75.5, 59.5, 43.5, 27.5, 11.5,
    ];
    const INNER_TEN_MM = target.data?.inner_ten_mm ?? 5;

    // Box-Muller normal distribution → tight grouping around the centre,
    // with occasional flyers — looks like a real shooter's pattern.
    const buildHit = () => {
      const sigmaMm = 8;
      const u1 = Math.max(Math.random(), 1e-9);
      const u2 = Math.random();
      const r = Math.sqrt(-2 * Math.log(u1));
      const t2 = 2 * Math.PI * u2;
      const xMm = r * Math.cos(t2) * sigmaMm;
      const yMm = r * Math.sin(t2) * sigmaMm;
      const distMm = Math.hypot(xMm, yMm);
      // Sorted outer→inner so index 0 = ring 1 (largest, lowest score) and
      // index 9 = ring 10 (smallest, highest score). We walk all rings and
      // keep the SMALLEST one that still contains the shot — that's the
      // ring with the highest score the hit qualifies for. Final value of
      // `ring` (= i + 1) is therefore the correct ISSF ring number.
      const sorted = [...RING_DIAMETERS_MM].sort((a, b) => b - a);
      let ring = 0;
      for (let i = 0; i < sorted.length; i += 1) {
        if (distMm <= (sorted[i] ?? 0) / 2) ring = i + 1;
      }
      return {
        x_norm: 0.5 + xMm / PAPER_MM,
        y_norm: 0.5 + yMm / PAPER_MM,
        score: ring,
        ring,
        x_mm: xMm,
        y_mm: yMm,
        dist_mm: distMm,
        is_inner_ten: distMm <= INNER_TEN_MM / 2,
      };
    };

    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      const raw = buildHit();
      // Demo path: emit hit straight into the live store (no Pi round-trip
      // since Pi has no concept of sessions any more). Same code path the
      // real WS would hit, just shorter.
      const hit: Hit = {
        sessionId,
        ts: Date.now() / 1000,
        xNorm: raw.x_norm,
        yNorm: raw.y_norm,
        score: raw.score,
        ring: raw.ring,
        xMm: raw.x_mm,
        yMm: raw.y_mm,
        distMm: raw.dist_mm,
        isInnerTen: raw.is_inner_ten,
      };
      addHit(hit);
      void onHitFeedback(hit.score, lang);
    }, SHOT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [discipline, sessionId, status, target.data, addHit, lang]);

  // Reconcile on foreground used to fetch the full session from the Pi to
  // catch hits we missed while backgrounded. The Pi no longer persists
  // sessions (it's a thin sensor), so there's nothing to reconcile against
  // — local state is the source of truth. Hits that arrived while
  // backgrounded are dropped; the WS reconnect handler will resume the
  // live stream when iOS resumes the JS thread.

  // Elapsed timer — pauses with the session.
  // We accumulate `pausedSeconds` whenever the session is in `paused` state.
  const pauseStartRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);

  useEffect(() => {
    if (status === 'paused' && pauseStartRef.current === null) {
      pauseStartRef.current = Date.now();
    } else if (status !== 'paused' && pauseStartRef.current !== null) {
      pausedTotalRef.current += (Date.now() - pauseStartRef.current) / 1000;
      pauseStartRef.current = null;
    }
  }, [status]);

  // Reset pause accumulator when a new session starts.
  useEffect(() => {
    pauseStartRef.current = null;
    pausedTotalRef.current = 0;
  }, [sessionId]);

  useEffect(() => {
    if (!startedAt) return undefined;
    // Once the session is ended, freeze the timer at its current value so
    // the summary modal shows a stable duration. Without this the clock
    // kept ticking while the modal was visible because this effect didn't
    // depend on `status`.
    if (status === 'ended') return undefined;
    const tick = () => {
      const livePause =
        pauseStartRef.current !== null ? (Date.now() - pauseStartRef.current) / 1000 : 0;
      const elapsedNow =
        Date.now() / 1000 - startedAt - pausedTotalRef.current - livePause;
      setElapsed(Math.max(0, Math.floor(elapsedNow)));
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [startedAt, status]);

  // Auto-end the session when the local store reports completion. The Pi
  // is no longer involved in session lifecycle (it's a stateless sensor),
  // so this just persists locally / to the backend and shows the summary
  // modal.
  useEffect(() => {
    if (status !== 'ended' || !sessionId || !startedAt) return;
    if (autoEndedRef.current) return;
    autoEndedRef.current = true;
    const finishedSessionId = sessionId;
    finishedSessionIdRef.current = finishedSessionId;
    void (async () => {
      await saveSession({
        id: finishedSessionId,
        discipline,
        startedAt,
        endedAt: Date.now() / 1000,
        totalScore: total,
        shotCount,
        shotsPerTarget,
        targetsPerSession,
        hits: archivedHits,
      });
      // Refresh dashboard stats + history list immediately so the just-
      // finished session shows up without waiting for the next focus
      // refetch (which can be 30+s away if the user lingers on summary).
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setShowSummary(true);
    })();
  }, [
    archivedHits,
    discipline,
    queryClient,
    saveSession,
    sessionId,
    shotCount,
    shotsPerTarget,
    startedAt,
    status,
    targetsPerSession,
    total,
  ]);

  const onReset = () => {
    Alert.alert(t('session.reset'), t('session.resetConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('session.reset'),
        style: 'destructive',
        onPress: () => {
          // Pi is stateless; resetting just clears the local store. The
          // next hit from the WS stream populates a fresh session id is
          // unchanged — this is "clear my hits", not "start new session".
          reset();
        },
      },
    ]);
  };

  const onEnd = () => {
    Alert.alert(t('session.end'), t('session.endConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('session.end'),
        style: 'destructive',
        onPress: async () => {
          if (sessionId && startedAt) {
            await saveSession({
              id: sessionId,
              discipline,
              startedAt,
              endedAt: Date.now() / 1000,
              totalScore: total,
              shotCount,
              shotsPerTarget,
              targetsPerSession,
              hits: archivedHits,
            });
          }
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
          end();
          onEnded();
        },
      },
    ]);
  };

  if (target.isLoading) return <Loading label={t('common.loading')} />;
  if (target.isError || !target.data)
    return <ErrorState message={t('errors.network')} onRetry={() => void target.refetch()} />;

  const config = {
    paperMm: target.data.paper_mm,
    ringDiametersMm: target.data.ring_diameters_mm,
    innerTenMm: target.data.inner_ten_mm,
    pelletMm: target.data.pellet_mm,
    discipline: target.data.discipline,
  };

  const onCanvasLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - canvasArea.width) > 0.5 || Math.abs(height - canvasArea.height) > 0.5) {
      setCanvasArea({ width, height });
    }
  };

  // Cap the canvas to whichever dimension is smaller so it never overlaps
  // the scoreboard or the action row.
  const targetSize =
    canvasArea.width > 0 && canvasArea.height > 0
      ? Math.max(120, Math.floor(Math.min(canvasArea.width, canvasArea.height) - 8))
      : 0;

  const sessionDone = status === 'ended' && shotCount > 0;
  const displayTargetIndex = Math.min(targetIndex, targetsPerSession);
  const isOpenEnded = targetsPerSession >= INFINITE_TARGETS;
  // Show a per-target progress card whenever shots are batched onto a target,
  // even in open-ended (Free) mode where there is no fixed total — in that
  // case we render an ongoing "Target #N" counter instead of "X of Y".
  const showTargetProgress = !isOpenEnded || shotsPerTarget > 1;

  return (
    <Screen testID="live-session" padding={2} gap={2}>
      <Scoreboard
        total={total}
        shots={shotCount}
        innerTens={innerTens}
        lastScore={lastHit?.score ?? null}
        lastRing={lastHit?.ring ?? null}
        elapsedSec={elapsed}
      />

      {showTargetProgress ? (
        <Card style={{ paddingVertical: theme.spacing(2) }}>
          <View style={styles.rowBetween}>
            <Text variant="bodyBold">
              {isOpenEnded
                ? t('session.targetOngoing', { current: displayTargetIndex })
                : t('session.targetProgress', {
                    current: displayTargetIndex,
                    total: targetsPerSession,
                  })}
            </Text>
            <Text color="textMuted">
              {t('session.shotsOnTarget', { shots: shotsOnTarget, size: shotsPerTarget })}
            </Text>
          </View>
        </Card>
      ) : null}

      {reconnecting ? (
        <Card style={{ backgroundColor: theme.colors.warning }}>
          <Text color="textInverse">{t('session.reconnecting')}</Text>
        </Card>
      ) : null}

      {status === 'paused' ? (
        <Card style={{ backgroundColor: theme.colors.info }}>
          <Text color="textInverse">{t('session.pausedBanner')}</Text>
        </Card>
      ) : null}

      <View style={styles.targetWrap} onLayout={onCanvasLayout}>
        {targetSize > 0 ? (
          <LiveTargetCanvas
            size={targetSize}
            config={config}
            hits={hits}
            showMpi={showMpi}
            showGroupEllipse={showGroupEllipse}
            highlightTs={focusedHitTs}
          />
        ) : null}
      </View>

      {/* Two-tier control area:
          1. Toggle row — icon-only chips for view options (sound, group
             ellipse, MPI). Compact, fixed 44×44 hit targets, side-by-side.
          2. Action row — text buttons for state-changing actions (pause,
             reset, end). Each grows to share the row width evenly so the
             layout works the same in EN and SR translations and on narrow
             phones (wraps onto multiple rows when needed). */}
      <View style={styles.toggleRow}>
        <IconToggle
          icon={soundEnabled ? 'volume-high' : 'volume-mute'}
          active={soundEnabled}
          onPress={() => setSoundEnabled(!soundEnabled)}
          accessibilityLabel={
            soundEnabled ? t('session.toggleSoundOn') : t('session.toggleSoundOff')
          }
          testID="live-sound-toggle"
        />
        <IconToggle
          icon="ellipse-outline"
          active={showGroupEllipse}
          onPress={() => setShowGroupEllipse(!showGroupEllipse)}
          accessibilityLabel={t('session.toggleGroup')}
          testID="live-group-toggle"
        />
        <IconToggle
          icon="locate"
          active={showMpi}
          onPress={() => setShowMpi(!showMpi)}
          accessibilityLabel={t('session.toggleMpi')}
          testID="live-mpi-toggle"
        />
      </View>

      <View style={styles.actionRow}>
        <View style={styles.actionBtn}>
          <Button
            onPress={() => setStatus(status === 'paused' ? 'running' : 'paused')}
            variant={status === 'paused' ? 'primary' : 'secondary'}
            accessibilityLabel={
              status === 'paused' ? t('session.resume') : t('a11y.pauseSession')
            }
            testID="live-pause"
            disabled={sessionDone}
          >
            {status === 'paused' ? t('session.resume') : t('session.pause')}
          </Button>
        </View>
        <View style={styles.actionBtn}>
          <Button
            onPress={onReset}
            variant="secondary"
            accessibilityLabel={t('a11y.resetSession')}
            testID="live-reset"
          >
            {t('session.reset')}
          </Button>
        </View>
        <View style={styles.actionBtn}>
          <Button
            onPress={onEnd}
            variant={sessionDone ? 'primary' : 'danger'}
            accessibilityLabel={t('a11y.endSession')}
            testID="live-end"
          >
            {sessionDone ? t('session.finish') : t('session.end')}
          </Button>
        </View>
      </View>

      <ShotStrip
        hits={hits}
        max={shotsPerTarget}
        focusedTs={focusedHitTs}
        onPickHit={(ts) => setFocusedHitTs((prev) => (prev === ts ? null : ts))}
      />

      <SessionSummaryModal
        visible={showSummary}
        total={total}
        shotCount={shotCount}
        innerTens={innerTens}
        // Whole-session hits — `hits` only holds the current target slice,
        // so we use `archivedHits` for ring distribution + best shot.
        hits={archivedHits}
        elapsedSec={elapsed}
        onDismiss={() => {
          setShowSummary(false);
          end();
          onEnded();
        }}
      />
    </Screen>
  );
};

type ShotStripProps = {
  hits: Hit[];
  max: number;
  focusedTs: number | null;
  onPickHit: (ts: number) => void;
};

const ShotStrip = ({ hits, max, focusedTs, onPickHit }: ShotStripProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const slots = Array.from({ length: max }, (_, i) => hits[i] ?? null);
  return (
    <View style={{ gap: theme.spacing(1) }}>
      <Text variant="caption" color="textMuted">
        {t('session.shotsOnTarget', { shots: hits.length, size: max })}
      </Text>
      <ScrollView
        horizontal
        contentContainerStyle={styles.shotStrip}
        showsHorizontalScrollIndicator={false}
      >
        {slots.map((h, i) => {
          const trend = h ? computeShotTrend(i > 0 ? hits[i - 1] ?? null : null, h) : null;
          const isFocused = !!h && focusedTs === h.ts;
          const card = (
            <View
              accessibilityLabel={
                h ? `Shot ${i + 1}, score ${h.score}` : `Shot ${i + 1}, pending`
              }
              style={[
                styles.shotCard,
                {
                  backgroundColor: h
                    ? `${theme.colors.ringPalette[h.ring] ?? theme.colors.surface}33`
                    : theme.colors.surfaceAlt,
                  borderColor: isFocused
                    ? theme.colors.primary
                    : h
                      ? theme.colors.ringPalette[h.ring] ?? theme.colors.border
                      : theme.colors.border,
                  borderWidth: isFocused ? 2 : 1,
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <Text variant="bodyBold">{h ? h.score : '·'}</Text>
              <Text variant="caption" color="textMuted">
                {h ? `${h.distMm.toFixed(1)} mm` : `#${i + 1}`}
              </Text>
              {/* Reserve a fixed-height slot for the trend row so the card
                  doesn't grow vertically the moment the first shot lands —
                  that bump used to push the entire layout one row down. */}
              <View style={styles.trendSlot}>
                {trend ? <ShotTrend trend={trend} compact /> : null}
              </View>
            </View>
          );
          if (!h) return <View key={`slot-${i}`}>{card}</View>;
          return (
            <Pressable
              key={`${h.ts}-${i}`}
              onPress={() => onPickHit(h.ts)}
              accessibilityRole="button"
              accessibilityState={{ selected: isFocused }}
              testID={`shot-strip-${i}`}
            >
              {card}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
};

type IconToggleProps = {
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
};

/** 44×44 pill-shaped toggle. Active state uses primary tint, inactive uses
 *  the neutral surface — matches the visual language of the other "view
 *  option" controls (e.g. group/MPI overlays). */
const IconToggle = ({
  icon,
  active,
  onPress,
  accessibilityLabel,
  testID,
}: IconToggleProps) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      testID={testID}
      hitSlop={theme.hitSlop}
      style={({ pressed }) => [
        styles.iconToggle,
        {
          backgroundColor: active
            ? `${theme.colors.primary}22`
            : theme.colors.surfaceAlt,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          borderRadius: theme.radius.md,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={active ? theme.colors.primary : theme.colors.textMuted}
      />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  targetWrap: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shotStrip: { gap: 8, paddingVertical: 4 },
  shotCard: {
    minWidth: 76,
    // Fixed height keeps the strip stable as cards transition between empty
    // (just score + index) and filled (score + distance + trend icons).
    minHeight: 70,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  // Always-rendered trend row. Same height (~16 px icon + 2 px gap) whether
  // the slot has a hit or not, so the card doesn't reflow on the first hit.
  trendSlot: { marginTop: 2, height: 16, alignItems: 'center', justifyContent: 'center' },
  // Compact icon toggles row — sound, group ellipse, MPI. Stays on a single
  // line on every screen size because each toggle is only 44 px wide.
  toggleRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  // Action buttons share the row width evenly via flex; on narrow screens
  // each button gets its own row (flexWrap + flexBasis fallback).
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' },
  actionBtn: { flexGrow: 1, flexBasis: 120, minWidth: 0 },
  iconToggle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
