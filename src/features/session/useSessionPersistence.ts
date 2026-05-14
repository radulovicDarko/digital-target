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
import { useAuthStore } from '@/state/authStore';
import { usePairingStore } from '@/state/pairingStore';
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
      // For now we do NOT persist history anywhere (no SQLite, no demo
      // storage, no remote backend). We'll introduce a dedicated endpoint
      // later; this function keeps the call-site stable.
      try {
        const who = guest || !user ? 'guest' : 'user';
        const demo = isDemoPairing(active) ? 'demo' : 'real';
        void logger.info('persist', `skip saveSession (disabled) who=${who} pairing=${demo} hits=${input.hits.length}`);
      } catch (e) {
        void logger.warn('persist', `skip saveSession log failed: ${String(e)}`);
      }
      return { kind: 'guestSkipped' };
    },
    [active, guest, user],
  );

  return { saveSession };
};
