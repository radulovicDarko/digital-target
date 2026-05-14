import * as SecureStore from 'expo-secure-store';

import { logger } from './logger';

/**
 * Local persistent storage for demo-mode sessions and hits.
 *
 * When the active Range is the Demo pairing we never reach a Pi — the whole
 * REST/WS surface is replaced by an in-memory implementation in
 * `src/api/demo.ts`. To make demo sessions survive an app cold-start (so
 * History shows them after a relaunch) we persist the entire session map
 * as a single JSON blob in SecureStore. Same primitive we already use for
 * pairings + preferences, no new native dep.
 *
 * Size note: each demo session is ~120 bytes plus ~150 bytes per hit. A
 * 5×3 demo session is ~2.4 KB. SecureStore handles this comfortably; we'd
 * only consider migrating to expo-file-system if a user accumulated
 * thousands of sessions — that's not the demo use case.
 */

const KEY = 'shooterrange.demo.sessions.v1';

export type StoredDemoHit = {
  ts: number;
  x_norm: number;
  y_norm: number;
  score: number;
  ring: number;
  x_mm: number;
  y_mm: number;
  dist_mm: number;
  is_inner_ten: boolean;
};

export type StoredDemoSession = {
  id: string;
  shooter_id: string;
  discipline: string;
  started_at: number;
  ended_at: number | null;
  total_score: number;
  shot_count: number;
  hits: StoredDemoHit[];
  shots_per_target: number | null;
  targets_per_session: number | null;
};

export const demoStorage = {
  async load(): Promise<StoredDemoSession[]> {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as StoredDemoSession[];
    } catch (e) {
      void logger.warn('demoStorage', `load failed: ${String(e)}`);
      return [];
    }
  },
  async save(sessions: StoredDemoSession[]): Promise<void> {
    try {
      await SecureStore.setItemAsync(KEY, JSON.stringify(sessions));
    } catch (e) {
      void logger.warn('demoStorage', `save failed: ${String(e)}`);
    }
  },
  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch (e) {
      void logger.warn('demoStorage', `clear failed: ${String(e)}`);
    }
  },
};
