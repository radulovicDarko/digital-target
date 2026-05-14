/**
 * Remote backend client. Lives at the URL configured in `app.config.ts`
 * (`extra.backendUrl`, default `https://api.etarget.placeholder`). Owns:
 *
 *   - user-scoped session history (POST on session end, GET for History list,
 *     GET single for SessionDetail)
 *   - shooter profile / preferences (future)
 *
 * The Pi is a thin sensor and does NOT touch this. Demo Range and guest
 * users skip the backend entirely; the calls below all gracefully no-op
 * when the user is anonymous.
 *
 * Until the backend exists for real, every call here will fail at the
 * network layer. Callers MUST handle errors as soft failures (treat as
 * "no remote data available") so the rest of the app keeps working.
 */
import axios, { AxiosError, type AxiosInstance } from 'axios';
import Constants from 'expo-constants';

import type { Hit } from '@/types/session';
import { logger } from '@/storage/logger';

type Extra = { backendUrl?: string };

const REQUEST_TIMEOUT_MS = 8000;

const resolveBaseUrl = (): string => {
  const extra = (Constants.expoConfig?.extra ?? {}) as Extra;
  return extra.backendUrl ?? 'https://api.etarget.placeholder';
};

export type RemoteSession = {
  id: string;
  shooter_id: string;
  discipline: string;
  started_at: number;
  ended_at: number | null;
  total_score: number;
  shot_count: number;
  shots_per_target: number | null;
  targets_per_session: number | null;
};

export type RemoteSessionFull = RemoteSession & {
  hits: {
    ts: number;
    x_norm: number;
    y_norm: number;
    score: number;
    ring: number;
    x_mm: number;
    y_mm: number;
    dist_mm: number;
    is_inner_ten: boolean;
  }[];
};

export type RemoteSessionInput = {
  id: string;
  shooter_id: string;
  discipline: string;
  started_at: number;
  ended_at: number;
  total_score: number;
  shot_count: number;
  shots_per_target: number | null;
  targets_per_session: number | null;
  hits: Hit[];
};

export class BackendError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'BackendError';
  }
}

const toBackendError = (e: unknown): BackendError => {
  if (e instanceof BackendError) return e;
  if (e instanceof AxiosError) {
    if (!e.response) return new BackendError(e.message);
    return new BackendError(e.message, e.response.status);
  }
  return new BackendError('Unknown backend error');
};

const toRemoteHit = (h: Hit) => ({
  ts: h.ts,
  x_norm: h.xNorm,
  y_norm: h.yNorm,
  score: h.score,
  ring: h.ring,
  x_mm: h.xMm,
  y_mm: h.yMm,
  dist_mm: h.distMm,
  is_inner_ten: h.isInnerTen,
});

export type BackendClient = {
  /** POST a finished session + all its hits. Used when an authenticated
   *  user ends a session, so it shows up in History across devices. */
  saveSession(input: RemoteSessionInput): Promise<void>;
  /** GET the user's session list (shallow — no hits). */
  listSessions(opts?: { limit?: number; offset?: number }): Promise<{
    items: RemoteSession[];
    total: number;
  }>;
  /** GET a single session with all hits, for the History detail screen. */
  getSession(id: string): Promise<RemoteSessionFull>;
};

export const createBackendClient = (token: string): BackendClient => {
  const baseURL = resolveBaseUrl();
  const http: AxiosInstance = axios.create({
    baseURL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  return {
    async saveSession(input) {
      try {
        await http.post('/api/sessions', {
          ...input,
          hits: input.hits.map(toRemoteHit),
        });
      } catch (e) {
        const err = toBackendError(e);
        // Soft-fail: log + rethrow so the caller can decide. The end-of-
        // session UX is "show summary modal regardless of whether save
        // succeeded" — saved-vs-pending state is reflected separately.
        void logger.warn('backend', `saveSession failed: ${err.message}`);
        throw err;
      }
    },
    async listSessions(opts = {}) {
      try {
        const r = await http.get('/api/sessions', {
          params: { limit: opts.limit ?? 50, offset: opts.offset ?? 0 },
        });
        return r.data as { items: RemoteSession[]; total: number };
      } catch (e) {
        throw toBackendError(e);
      }
    },
    async getSession(id) {
      try {
        const r = await http.get(`/api/sessions/${encodeURIComponent(id)}`);
        return r.data as RemoteSessionFull;
      } catch (e) {
        throw toBackendError(e);
      }
    },
  };
};
