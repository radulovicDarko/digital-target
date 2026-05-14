import { create } from 'zustand';

import type { Hit, SessionStatus } from '@/types/session';

const MAX_HITS = 500;

type LiveSessionState = {
  sessionId: string | null;
  status: SessionStatus;
  startedAt: number | null;
  /** Timestamp (ms) of the most recent session end. Used as a refetch signal. */
  lastEndedAt: number;
  /** Hits visible on the current target — including the just-completed series
   *  while we wait for the first hit of the next series to arrive. */
  hits: Hit[];
  /** All hits this session, used for full-session stats / archive. */
  archivedHits: Hit[];
  lastHit: Hit | null;
  total: number;
  shotCount: number;
  innerTens: number;
  reconnecting: boolean;
  showGroupEllipse: boolean;
  showMpi: boolean;
  showPreview: boolean;
  /** Discipline format */
  shotsPerTarget: number;
  targetsPerSession: number;
  /** 1-based current target index */
  targetIndex: number;
  /** Hits placed on the current target so far. Equals shotsPerTarget once the
   *  series is full but before the next hit arrives — that's our "wait" state. */
  shotsOnTarget: number;
  /** True after a series is full and we're waiting for the next hit to clear. */
  pendingClear: boolean;
  setSession: (
    id: string,
    startedAt: number,
    format?: { shotsPerTarget: number; targetsPerSession: number },
  ) => void;
  setStatus: (s: SessionStatus) => void;
  addHit: (hit: Hit) => void;
  reset: () => void;
  end: () => void;
  setReconnecting: (v: boolean) => void;
  setShowGroupEllipse: (v: boolean) => void;
  setShowMpi: (v: boolean) => void;
  setShowPreview: (v: boolean) => void;
  /** Replace local hits with server-truth on reconcile. */
  reconcile: (hits: Hit[]) => void;
};

const empty = {
  sessionId: null,
  status: 'idle' as SessionStatus,
  startedAt: null,
  lastEndedAt: 0,
  hits: [] as Hit[],
  archivedHits: [] as Hit[],
  lastHit: null as Hit | null,
  total: 0,
  shotCount: 0,
  innerTens: 0,
  shotsPerTarget: 1,
  targetsPerSession: 9999,
  targetIndex: 1,
  shotsOnTarget: 0,
  pendingClear: false,
};

export const useLiveSessionStore = create<LiveSessionState>((set) => ({
  ...empty,
  reconnecting: false,
  showGroupEllipse: false,
  showMpi: false,
  showPreview: false,

  setSession: (id, startedAt, format) =>
    set({
      ...empty,
      sessionId: id,
      startedAt,
      status: 'running',
      shotsPerTarget: format?.shotsPerTarget ?? 1,
      targetsPerSession: format?.targetsPerSession ?? 9999,
    }),

  setStatus: (status) => set({ status }),

  addHit: (hit) =>
    set((s) => {
      if (s.sessionId && hit.sessionId !== s.sessionId) return s;
      // Drop hits that arrive while the session is paused or already ended.
      if (s.status === 'paused' || s.status === 'ended') return s;
      // Past the configured target count: ignore.
      if (s.targetIndex > s.targetsPerSession) return s;

      const baseAccumulator = {
        lastHit: hit,
        total: s.total + hit.score,
        shotCount: s.shotCount + 1,
        innerTens: s.innerTens + (hit.isInnerTen ? 1 : 0),
        archivedHits: [...s.archivedHits, hit],
      };

      // Step 1: figure out the next visible series + shot counter. If we were
      // waiting after a completed series, this hit wipes the prior series and
      // starts the next one at shot 1. Otherwise we append.
      let visibleHits: Hit[];
      let shotsOnTarget: number;
      if (s.pendingClear) {
        visibleHits = [hit];
        shotsOnTarget = 1;
      } else {
        shotsOnTarget = s.shotsOnTarget + 1;
        visibleHits =
          s.hits.length >= MAX_HITS ? [...s.hits.slice(1), hit] : [...s.hits, hit];
      }

      // Step 2: re-evaluate end-of-target after Step 1. This is what makes
      // shotsPerTarget=1 work: every single hit both clears the previous
      // series AND completes the new one in the same store update.
      const reachedEndOfTarget = shotsOnTarget >= s.shotsPerTarget;
      if (reachedEndOfTarget) {
        const nextIndex = s.targetIndex + 1;
        const sessionDone = nextIndex > s.targetsPerSession;
        return {
          ...baseAccumulator,
          hits: visibleHits,
          shotsOnTarget,
          targetIndex: sessionDone ? s.targetIndex : nextIndex,
          // Only mark pending clear if there's another target to fill.
          pendingClear: !sessionDone,
          status: sessionDone ? ('ended' as SessionStatus) : ('running' as SessionStatus),
        };
      }

      return {
        ...baseAccumulator,
        hits: visibleHits,
        shotsOnTarget,
        pendingClear: false,
      };
    }),

  reconcile: (hits) =>
    set((s) => {
      if (!s.sessionId) return s;
      const filtered = hits.filter((h) => h.sessionId === s.sessionId);
      const total = filtered.reduce((acc, h) => acc + h.score, 0);
      const innerTens = filtered.filter((h) => h.isInnerTen).length;
      const shotCount = filtered.length;
      const completedTargets = Math.floor(shotCount / s.shotsPerTarget);
      const shotsOnTarget = shotCount - completedTargets * s.shotsPerTarget;
      // If the last action exactly completed a target, hold the previous series
      // visible (pending clear). Otherwise show the in-progress series.
      const visible =
        shotsOnTarget === 0 && completedTargets > 0
          ? filtered.slice((completedTargets - 1) * s.shotsPerTarget, completedTargets * s.shotsPerTarget)
          : filtered.slice(completedTargets * s.shotsPerTarget);
      const targetIndex = Math.min(
        s.targetsPerSession + 1,
        completedTargets + (shotsOnTarget === 0 ? 0 : 1) || 1,
      );
      return {
        archivedHits: filtered,
        hits: visible,
        lastHit: filtered[filtered.length - 1] ?? null,
        total,
        shotCount,
        innerTens,
        targetIndex,
        shotsOnTarget,
        pendingClear: shotsOnTarget === 0 && completedTargets > 0 && completedTargets < s.targetsPerSession,
      };
    }),

  reset: () =>
    set((s) => ({
      ...empty,
      sessionId: s.sessionId,
      startedAt: s.startedAt,
      status: 'running',
      shotsPerTarget: s.shotsPerTarget,
      targetsPerSession: s.targetsPerSession,
    })),

  end: () =>
    set((s) => ({
      ...empty,
      status: 'ended',
      // Only tick the refetch signal if we were actually in a live/ended
      // session; calling end() as a cleanup helper (idle → ended) shouldn't
      // trigger a spurious refetch on app boot.
      lastEndedAt:
        s.sessionId != null || s.status === 'running' || s.status === 'paused'
          ? Date.now()
          : s.lastEndedAt,
    })),

  setReconnecting: (reconnecting) => set({ reconnecting }),
  setShowGroupEllipse: (showGroupEllipse) => set({ showGroupEllipse }),
  setShowMpi: (showMpi) => set({ showMpi }),
  setShowPreview: (showPreview) => set({ showPreview }),
}));
