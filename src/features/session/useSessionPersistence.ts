/**
 * `useSessionPersistence` — writes a finished session to whichever
 * persistence layer the user opted into:
 *
 *   - logged-in user → POST to remote backend (BackendClient)
 *   - guest user     → drops the session (no save). Returns "skipped".
 *   - Demo Range     → writes to local SecureStore via demoStorage
 *                       (so demo history survives app cold-starts)
 *
 * Returns a single `saveSession` function so callers (LiveSessionScreen,
 * SessionSummaryModal) don't need to know which path was taken.
 */
import { useCallback } from 'react';

import { isDemoPairing } from '@/api/demo';
import { createBackendClient, type RemoteSessionInput } from '@/api/backend';
import { useAuthStore } from '@/state/authStore';
import { usePairingStore } from '@/state/pairingStore';
import { demoStorage, type StoredDemoSession } from '@/storage/demoStorage';
import { logger } from '@/storage/logger';
import type { Hit } from '@/types/session';

export type SaveSessionInput = {
  id: string;
  discipline: string;
  startedAt: number;
  endedAt: number;
  totalScore: number;
  shotCount: number;
  shotsPerTarget: number | null;
  targetsPerSession: number | null;
  hits: Hit[];
};

export type SaveResult =
  | { kind: 'remote'; ok: boolean }
  | { kind: 'demoLocal'; ok: boolean }
  | { kind: 'guestSkipped' };

export const useSessionPersistence = () => {
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  const active = usePairingStore((s) => s.active);

  const saveSession = useCallback(
    async (input: SaveSessionInput): Promise<SaveResult> => {
      // Demo Range — keep using SecureStore so the user can browse demo
      // sessions in History without a backend round-trip.
      if (isDemoPairing(active)) {
        const record: StoredDemoSession = {
          id: input.id,
          shooter_id: user?.id ?? 'guest',
          discipline: input.discipline,
          started_at: input.startedAt,
          ended_at: input.endedAt,
          total_score: input.totalScore,
          shot_count: input.shotCount,
          hits: input.hits.map((h) => ({
            ts: h.ts,
            x_norm: h.xNorm,
            y_norm: h.yNorm,
            score: h.score,
            ring: h.ring,
            x_mm: h.xMm,
            y_mm: h.yMm,
            dist_mm: h.distMm,
            is_inner_ten: h.isInnerTen,
          })),
          shots_per_target: input.shotsPerTarget,
          targets_per_session: input.targetsPerSession,
        };
        const existing = await demoStorage.load();
        // Replace any prior record with the same id (defensive — auto-end
        // might fire twice in theory).
        const next = [record, ...existing.filter((s) => s.id !== record.id)];
        await demoStorage.save(next);
        return { kind: 'demoLocal', ok: true };
      }

      // Guest user → nothing to save remotely. The summary modal still
      // shows their numbers; they just won't appear in History after they
      // leave the screen.
      if (guest || !user) {
        return { kind: 'guestSkipped' };
      }

      // Logged-in user → POST the session to the remote backend. Soft-
      // failure: we still resolve so the UI can dismiss the modal even if
      // the backend is unreachable. The local view of the session is
      // available until the user navigates away.
      try {
        // TODO: replace 'guest' fallback once backend issues real tokens.
        const token = (user as { token?: string }).token ?? 'placeholder-token';
        const client = createBackendClient(token);
        const payload: RemoteSessionInput = {
          id: input.id,
          shooter_id: user.id,
          discipline: input.discipline,
          started_at: input.startedAt,
          ended_at: input.endedAt,
          total_score: input.totalScore,
          shot_count: input.shotCount,
          shots_per_target: input.shotsPerTarget,
          targets_per_session: input.targetsPerSession,
          hits: input.hits,
        };
        await client.saveSession(payload);
        return { kind: 'remote', ok: true };
      } catch (e) {
        void logger.warn('persist', `remote save failed: ${String(e)}`);
        return { kind: 'remote', ok: false };
      }
    },
    [active, guest, user],
  );

  return { saveSession };
};
