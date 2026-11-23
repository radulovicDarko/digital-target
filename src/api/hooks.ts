import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAuthStore } from '@/state/authStore';
import { usePairingStore } from '@/state/pairingStore';
import { demoStorage } from '@/storage/demoStorage';
import { getOrCreateClientId } from '@/storage/clientId';
import { sessionHistory, type SavedSession } from '@/storage/sessionHistory';
import { logger } from '@/storage/logger';

import { createBackendClient, hasRemoteBackend } from './backend';
import { createApiClient } from './client';
import { createDemoApiClient, isDemoPairing } from './demo';
import { queryKeys } from './queryKeys';

export const useApiClient = () => {
  const active = usePairingStore((s) => s.active);
  // Memoize on the pairing identity so callers can safely use the client
  // as a useEffect dependency without retriggering on every render.
  return useMemo(() => {
    if (!active) return null;
    // Demo pairing has no Pi behind it — return the in-memory client.
    if (isDemoPairing(active)) return createDemoApiClient();
    return createApiClient(active);
  }, [active]);
};

export const useHealthQuery = () => {
  const active = usePairingStore((s) => s.active);
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.health(active?.id ?? 'none'),
    queryFn: async () => {
      if (!client) throw new Error('No paired Range');
      const clientId = await getOrCreateClientId();
      return client.health(clientId);
    },
    enabled: !!client,
    refetchInterval: 5000,
    staleTime: 2000,
  });
};

export const useTargetConfigQuery = () => {
  const active = usePairingStore((s) => s.active);
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.targetConfig(active?.id ?? 'none'),
    queryFn: async () => {
      if (!client) throw new Error('No paired Range');
      return client.targetConfig();
    },
    enabled: !!client,
    staleTime: 60_000,
  });
};

/**
 * Session list — pulled from the right backing store depending on context:
 *   - Demo Range  → local SecureStore (demoStorage)
 *   - Logged-in   → phone history, merged with cloud when configured
 *   - Guest       → empty (no history available)
 *
 * The Pi NEVER serves sessions; it's a thin sensor.
 */
export const useSessionsQuery = (opts: {
  shooterId?: string;
  limit?: number;
  offset?: number;
} = {}) => {
  const active = usePairingStore((s) => s.active);
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  return useQuery({
    queryKey: [...queryKeys.sessions(active?.id ?? 'none', opts), user?.id ?? 'guest'],
    queryFn: async () => {
      // Demo pairing → local SecureStore.
      if (isDemoPairing(active)) {
        const legacy = await demoStorage.load();
        const local = await sessionHistory.load(user?.id ?? 'demo-guest');
        const all = [...new Map([...legacy, ...local].map((s) => [s.id, s])).values()];
        const filtered = opts.shooterId
          ? all.filter((s) => s.shooter_id === opts.shooterId)
          : all;
        const sorted = [...filtered].sort((a, b) => b.started_at - a.started_at);
        const offset = opts.offset ?? 0;
        const limit = opts.limit ?? 50;
        return {
          items: sorted.slice(offset, offset + limit).map((s) => ({
            id: s.id,
            shooter_id: s.shooter_id,
            discipline: s.discipline,
            started_at: s.started_at,
            ended_at: s.ended_at,
            total_score: s.total_score,
            shot_count: s.shot_count,
          })),
          total: sorted.length,
          source: 'demo' as const,
          syncError: null,
        };
      }
      // Guest → no history (login to save).
      if (guest || !user) {
        return { items: [], total: 0, source: 'local' as const, syncError: null };
      }
      const local = await sessionHistory.load(user.id);
      const items = new Map<string, Omit<SavedSession, 'hits'>>(local.map((s) => [s.id, s]));
      let syncError: string | null = null;
      let remoteTotal = 0;
      let source: 'local' | 'cloud' = 'local';
      if (hasRemoteBackend()) {
        try {
          const token = (user as { token?: string }).token ?? 'placeholder-token';
          const remote = await createBackendClient(token).listSessions({ limit: 200 });
          for (const s of remote.items) if (!items.has(s.id)) items.set(s.id, s);
          remoteTotal = remote.total;
          source = 'cloud';
        } catch (failure) {
          syncError = failure instanceof Error ? failure.message : String(failure);
          void logger.warn('history', `cloud history unavailable: ${syncError}`);
        }
      }
      const sorted = [...items.values()].sort((a, b) => b.started_at - a.started_at);
      const offset = opts.offset ?? 0;
      return {
        items: sorted.slice(offset, offset + (opts.limit ?? 50)),
        total: Math.max(sorted.length, remoteTotal), source, syncError,
      };
    },
    enabled: true,
  });
};

/**
 * Single-session detail — same routing rules as useSessionsQuery.
 */
export const useSessionQuery = (id: string | null) => {
  const active = usePairingStore((s) => s.active);
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  return useQuery({
    queryKey: [...queryKeys.session(active?.id ?? 'none', id ?? 'none'), user?.id ?? 'guest'],
    queryFn: async () => {
      if (!id) throw new Error('No session id');
      if (isDemoPairing(active)) {
        const legacy = await demoStorage.load();
        const local = await sessionHistory.load(user?.id ?? 'demo-guest');
        const all = [...local, ...legacy];
        const s = all.find((x) => x.id === id);
        if (!s) throw new Error('Session not found');
        return {
          id: s.id,
          shooter_id: s.shooter_id,
          discipline: s.discipline,
          started_at: s.started_at,
          ended_at: s.ended_at,
          total_score: s.total_score,
          shot_count: s.shot_count,
          hits: s.hits,
          shots_per_target: s.shots_per_target,
          targets_per_session: s.targets_per_session,
        };
      }
      if (guest || !user) {
        throw new Error('Guest mode — no session history');
      }
      const local = (await sessionHistory.load(user.id)).find((s) => s.id === id);
      if (local) return local;
      if (!hasRemoteBackend()) throw new Error('Session is not saved on this phone');
      const token = (user as { token?: string }).token ?? 'placeholder-token';
      const client = createBackendClient(token);
      return client.getSession(id);
    },
    enabled: !!id,
  });
};
