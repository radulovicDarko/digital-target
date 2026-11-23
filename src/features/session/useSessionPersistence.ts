/**
 * `useSessionPersistence` — writes a finished session to whichever
 * persistence layer the user opted into:
 *
 *   - logged-in user → durable, account-scoped history on this phone
 *   - guest user     → drops the session (no save). Returns "skipped".
 *   - Demo Range     → local history, also available to demo guests
 *
 * Returns a single `saveSession` function so callers (LiveSessionScreen,
 * SessionSummaryModal) don't need to know which path was taken.
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { isDemoPairing } from '@/api/demo';
import { useAuthStore } from '@/state/authStore';
import { usePairingStore } from '@/state/pairingStore';
import { logger } from '@/storage/logger';
import { sessionHistory } from '@/storage/sessionHistory';
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
  | { kind: 'deviceLocal'; ok: boolean }
  | { kind: 'demoLocal'; ok: boolean }
  | { kind: 'guestSkipped' };

export const useSessionPersistence = () => {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  const active = usePairingStore((s) => s.active);

  const saveSession = useCallback(
    async (input: SaveSessionInput): Promise<SaveResult> => {
      const demo = isDemoPairing(active);
      if (!demo && (guest || !user)) return { kind: 'guestSkipped' };
      const owner = user?.id ?? 'demo-guest';
      const kind = demo ? 'demoLocal' : 'deviceLocal';
      try {
        await sessionHistory.upsert(owner, {
          id: input.id, shooter_id: owner, discipline: input.discipline,
          started_at: input.startedAt, ended_at: input.endedAt,
          total_score: input.totalScore, shot_count: input.shotCount,
          shots_per_target: input.shotsPerTarget, targets_per_session: input.targetsPerSession,
          hits: input.hits.map((h) => ({
            ts: h.ts, x_norm: h.xNorm, y_norm: h.yNorm, score: h.score, ring: h.ring,
            x_mm: h.xMm, y_mm: h.yMm, dist_mm: h.distMm, is_inner_ten: h.isInnerTen,
          })),
        });
        return { kind, ok: true };
      } catch (e) {
        void logger.warn('persist', `history save failed: ${String(e)}`);
        Alert.alert(t('history.saveFailedTitle'), t('history.saveFailedBody'));
        return { kind, ok: false };
      }
    },
    [active, guest, user, t],
  );

  return { saveSession };
};
