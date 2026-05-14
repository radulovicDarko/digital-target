import type { AxiosInstance } from 'axios';
import axios, { AxiosError } from 'axios';
import type { z } from 'zod';

import { logger } from '@/storage/logger';
import type { PairingRecord } from '@/types/pairing';
import type { Hit } from '@/types/session';

import {
  HealthSchema,
  HitSchema,
  PairResponseSchema,
  TargetConfigSchema,
} from './schemas';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: 'network' | 'auth' | 'validation' | 'server' | 'fingerprint',
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const REQUEST_TIMEOUT_MS = 8000;

const parse = <T>(schema: z.ZodSchema<T>, data: unknown): T => {
  const result = schema.safeParse(data);
  if (!result.success) {
    void logger.warn('api', `validation failed: ${result.error.message}`);
    throw new ApiError('Invalid response shape', 'validation', undefined, result.error);
  }
  return result.data;
};

const wsHitToDomainHit = (m: z.infer<typeof HitSchema>): Hit => ({
  sessionId: m.session_id,
  ts: m.ts,
  ...(m.seq != null ? { seq: m.seq } : {}),
  xNorm: m.x_norm,
  yNorm: m.y_norm,
  score: m.score,
  ring: m.ring,
  xMm: m.x_mm,
  yMm: m.y_mm,
  distMm: m.dist_mm,
  isInnerTen: m.is_inner_ten,
});

const toApiError = (e: unknown): ApiError => {
  if (e instanceof ApiError) return e;
  if (e instanceof AxiosError) {
    if (!e.response) return new ApiError(e.message, 'network', undefined, e);
    if (e.response.status === 401 || e.response.status === 403) {
      return new ApiError('Auth required', 'auth', e.response.status, e);
    }
    return new ApiError(e.message, 'server', e.response.status, e);
  }
  return new ApiError('Unknown error', 'server', undefined, e);
};

export type ApiClient = ReturnType<typeof createApiClient>;

export const createApiClient = (pairing: PairingRecord) => {
  const http: AxiosInstance = axios.create({
    baseURL: pairing.baseUrl,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${pairing.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  return {
    async health() {
      try {
        const r = await http.get('/api/health');
        return parse(HealthSchema, r.data);
      } catch (e) {
        throw toApiError(e);
      }
    },
    async targetConfig() {
      try {
        const r = await http.get('/api/target/config');
        return parse(TargetConfigSchema, r.data);
      } catch (e) {
        throw toApiError(e);
      }
    },
    /**
     * Backfill missed hits via the Pi's replay buffer. Returns hits with
     * seq > `since`, oldest first. Used when the WS gap detector spots a
     * dropped sequence number.
     */
    async replayHits(since: number, limit = 256) {
      try {
        const r = await http.get('/api/hits/replay', {
          params: { since, limit, consume: 1 },
        });
        const data = r.data as { hits: unknown[]; since: number; count: number };
        // Validate each hit individually so a single bad row doesn't drop
        // the whole replay batch.
        const hits = data.hits
          .map((h) => HitSchema.safeParse({ type: 'hit', ...(h as object) }))
          .filter((p): p is { success: true; data: z.infer<typeof HitSchema> } => p.success)
          .map((p) => wsHitToDomainHit(p.data));
        return { hits, since: data.since, count: hits.length };
      } catch (e) {
        throw toApiError(e);
      }
    },
    raw: http,
  };
};

/**
 * Unauthenticated client used during the pairing handshake.
 * No bearer token, no fingerprint check yet.
 */
export const pairProbe = async (baseUrl: string) => {
  try {
    const r = await axios.get(`${baseUrl}/api/health`, { timeout: REQUEST_TIMEOUT_MS });
    return parse(HealthSchema, r.data);
  } catch (e) {
    throw toApiError(e);
  }
};

export const pairExchange = async (baseUrl: string, code?: string) => {
  try {
    const r = await axios.post(
      `${baseUrl}/api/pair`,
      { code: code ?? '' },
      { timeout: REQUEST_TIMEOUT_MS },
    );
    return parse(PairResponseSchema, r.data);
  } catch (e) {
    throw toApiError(e);
  }
};
