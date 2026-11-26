import { useLiveSessionStore } from '../liveSessionStore';
import type { Hit } from '@/types/session';
import { consumeReplayPage } from '@/features/session/consumeReplayPage';
import { onHitFeedback } from '@/features/session/feedback';
import { playSound } from '@/features/session/sounds';
import { useSettingsStore } from '@/state/settingsStore';

jest.mock('@/features/session/sounds', () => ({ playSound: jest.fn() }));

it('keeps calibration off the target and displays new events even when the Pi clock is behind', () => {
  const store = useLiveSessionStore;
  store.getState().setSession('new', 100, { shotsPerTarget: 2, targetsPerSession: 1 }, 42);
  const event: Hit = {
    sessionId: 'new', seq: 42, ts: 75, score: 9, ring: 9, isInnerTen: false,
    xNorm: 0.5, yNorm: 0.5, xMm: 0, yMm: 0, distMm: 0,
  };
  store.getState().addHit(event);
  expect(store.getState()).toMatchObject({ hits: [], shotCount: 0, archivedHits: [], total: 0 });
  const first = { ...event, seq: 43, ts: 76 };
  store.getState().addHit(first);
  expect(store.getState()).toMatchObject({ hits: [first], archivedHits: [first], shotCount: 1, total: 9, status: 'running' });
  store.getState().reconcile([event, first]);
  expect(store.getState()).toMatchObject({ hits: [first], archivedHits: [first], shotCount: 1 });
});

it('accepts available events after a sequence gap without counting duplicates', () => {
  const events = [7, 9, 10, 10, 11].map((seq): Hit => ({
    seq, sessionId: 'live', ts: 100 + seq, score: 9, ring: 9, isInnerTen: false,
    xNorm: 0.5, yNorm: 0.5, xMm: 0, yMm: 0, distMm: 0,
  }));
  const accepted: number[] = [];
  expect(consumeReplayPage(7, events, h => accepted.push(h.ts))).toBe(11);
  expect(accepted).toEqual([109, 110, 111]);
});

it('counts a miss without points and requests one sound per distinct batched hit', () => {
  useSettingsStore.setState({ soundEnabled: true, hapticsEnabled: false, voiceEnabled: false });
  useLiveSessionStore.getState().setSession('batch', 100, { shotsPerTarget: 5, targetsPerSession: 1 }, 0);
  const miss: Hit = {
    seq: 1, sessionId: 'batch', ts: 101, score: 0, ring: 0, isInnerTen: false,
    xNorm: 0.02, yNorm: 0.02, xMm: -55, yMm: -50, distMm: 74.3,
  };
  const scored = { ...miss, seq: 2, ts: 102, score: 9, ring: 9, xMm: 4, yMm: 0, distMm: 4 };
  const accept = (hit: Hit) => {
    useLiveSessionStore.getState().addHit(hit);
    if (useLiveSessionStore.getState().lastHit === hit) onHitFeedback(hit.score, 'sr-Latn');
  };
  jest.mocked(playSound).mockClear();
  const cursor = consumeReplayPage(0, [miss, scored, scored], accept);
  consumeReplayPage(cursor, [miss, scored], accept);
  expect(useLiveSessionStore.getState()).toMatchObject({
    shotCount: 2, total: 9, hits: [miss, scored], archivedHits: [miss, scored],
  });
  expect(playSound).toHaveBeenCalledTimes(2);
  useSettingsStore.setState({ soundEnabled: false });
  onHitFeedback(0, 'sr-Latn');
  expect(playSound).toHaveBeenCalledTimes(2);
});
