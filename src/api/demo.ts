/**
 * Demo / no-Pi mode. Provides drop-in replacements for the API client and the
 * WS client that operate entirely in memory + SecureStore. Used for App
 * Store demo builds and for users who want to try the app before buying
 * the hardware.
 *
 * The shape of every method matches the real client so the rest of the app
 * is identical between demo and real modes.
 *
 * Persistence: demo sessions are saved to SecureStore via `demoStorage` so
 * History survives app cold-starts. Hits are POSTed via `simulateHit()`
 * (mirrors the Python /api/session/{id}/hit endpoint) — there's no auto
 * emitter, so the LiveSessionScreen's Demo discipline simulator is the
 * only thing producing hits.
 */
import type { Hit } from '@/types/session';
import type { PairingRecord } from '@/types/pairing';

import { demoStorage, type StoredDemoSession } from '@/storage/demoStorage';

import type { ApiClient } from './client';

export const DEMO_PAIRING_ID = 'demo-range';

/** Marker URL — demo client never actually opens HTTP/WS to this address.
 *  Kept to satisfy the PairingRecord shape and to make accidental fetches
 *  fail loudly with a recognisable host instead of hitting a real server. */
const DEMO_MARKER_URL = 'demo://local';

/** Local dev base URL used by CalibrationScreen for preview fetches when the
 *  demo pairing is active. Demo mode normally bypasses calibration entirely,
 *  but keeping this export avoids typecheck errors and lets devs point the
 *  preview at a local Pi/control server if desired. */
export const DEMO_LOCAL_BASE_URL = 'http://localhost:8080';

export const isDemoPairing = (p: PairingRecord | null): boolean =>
  p?.id === DEMO_PAIRING_ID;

export const buildDemoPairing = (): PairingRecord => ({
  id: DEMO_PAIRING_ID,
  name: 'Demo Range',
  // Demo never reaches the network — these URLs are placeholders. The
  // ApiClient/WsClient factories detect the demo pairing and return
  // in-memory implementations instead of making real HTTP/WS calls.
  baseUrl: DEMO_MARKER_URL,
  wsUrl: DEMO_MARKER_URL,
  token: 'demo',
  fingerprint: 'demo',
  pairedAt: Date.now(),
  // Demo Range bypasses the calibration gate (RootNavigator detects it),
  // so leaving this null is fine — RootNavigator drops users straight
  // into Tabs.
  calibrationConfirmedAt: null,
});

// ---------- in-memory state shared across calls ----------

const demoState = {
  startedAt: Date.now(),
  sessions: new Map<string, DemoSession>(),
  target: {
    paper_mm: 170,
    // Real ISSF 10m air pistol ring diameters (matches the Python config).
    // Index 0 = ring 1 (outer), index 9 = ring 10 (bullseye).
    ring_diameters_mm: [
      155.5, 139.5, 123.5, 107.5, 91.5, 75.5, 59.5, 43.5, 27.5, 11.5,
    ],
    inner_ten_mm: 5,
    pellet_mm: 4.5,
    discipline: 'ISSF 10m Air Pistol',
  },
  hydrated: false,
};

type DemoHit = {
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

type DemoSession = {
  id: string;
  shooter_id: string;
  discipline: string;
  started_at: number;
  ended_at: number | null;
  total_score: number;
  shot_count: number;
  hits: DemoHit[];
  shots_per_target: number | null;
  targets_per_session: number | null;
};

const uuid = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------- persistence ----------

/**
 * Hydrate the in-memory demo session map from SecureStore. Idempotent —
 * called from App.tsx bootstrap so History shows old demo sessions
 * immediately on app launch.
 */
export const hydrateDemoState = async (): Promise<void> => {
  if (demoState.hydrated) return;
  demoState.hydrated = true;
  const records = await demoStorage.load();
  for (const r of records) {
    demoState.sessions.set(r.id, {
      id: r.id,
      shooter_id: r.shooter_id,
      discipline: r.discipline,
      started_at: r.started_at,
      ended_at: r.ended_at,
      total_score: r.total_score,
      shot_count: r.shot_count,
      hits: r.hits,
      shots_per_target: r.shots_per_target,
      targets_per_session: r.targets_per_session,
    });
  }
};

// Debounced save: SecureStore writes hit the Keychain — batching keeps
// us off the main thread when the simulator pumps shots at 1100 ms
// intervals (also fine for occasional /reset bursts).
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 250;
const persist = (): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const all: StoredDemoSession[] = Array.from(demoState.sessions.values()).map((s) => ({
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
    }));
    void demoStorage.save(all);
  }, PERSIST_DEBOUNCE_MS);
};

// ---------- ApiClient drop-in ----------

export const createDemoApiClient = (): ApiClient => {
  const wait = (ms = 80) => new Promise((res) => setTimeout(res, ms));

  const client = {
    async health() {
      await wait(40);
      return {
        status: 'ok',
        version: '0.1.0-demo',
        uptime_s: (Date.now() - demoState.startedAt) / 1000,
      };
    },
    async targetConfig() {
      await wait();
      return demoState.target;
    },
    async startSession(input: {
      shooter_id: string;
      discipline: string;
      shots_per_target?: number;
      targets_per_session?: number;
    }) {
      await wait();
      const id = uuid();
      const startedAt = Date.now() / 1000;
      const session: DemoSession = {
        id,
        shooter_id: input.shooter_id,
        discipline: input.discipline,
        started_at: startedAt,
        ended_at: null,
        total_score: 0,
        shot_count: 0,
        hits: [],
        shots_per_target: input.shots_per_target ?? null,
        targets_per_session: input.targets_per_session ?? null,
      };
      demoState.sessions.set(id, session);
      // notify any listening demo WS clients
      demoBus.emit('session_started', { session_id: id, started_at: startedAt });
      persist();
      return { session_id: id, started_at: startedAt };
    },
    async endSession(id: string) {
      await wait();
      const s = demoState.sessions.get(id);
      if (!s) throw new Error('Demo: session not found');
      s.ended_at = Date.now() / 1000;
      demoBus.emit('session_ended', {
        summary: {
          session_id: s.id,
          ended_at: s.ended_at,
          total_score: s.total_score,
          shot_count: s.shot_count,
        },
      });
      persist();
      return {
        session_id: s.id,
        ended_at: s.ended_at,
        total_score: s.total_score,
        shot_count: s.shot_count,
      };
    },
    async resetSession(id: string) {
      await wait();
      const s = demoState.sessions.get(id);
      if (!s) return;
      s.hits = [];
      s.total_score = 0;
      s.shot_count = 0;
      demoBus.emit('reset', null);
      persist();
    },
    /**
     * Inject a hit into an active demo session. Mirrors the Python
     * /api/session/{id}/hit endpoint so LiveSessionScreen's Demo
     * simulator drives the same code path in both modes.
     */
    async simulateHit(
      sessionId: string,
      hit: {
        x_norm: number;
        y_norm: number;
        score: number;
        ring: number;
        x_mm: number;
        y_mm: number;
        dist_mm: number;
        is_inner_ten: boolean;
      },
    ) {
      const s = demoState.sessions.get(sessionId);
      if (!s) return;
      const stamped: DemoHit = { ts: Date.now() / 1000, ...hit };
      s.hits.push(stamped);
      s.total_score += hit.score;
      s.shot_count += 1;
      demoBus.emitHit(s.id, stamped);
      persist();
    },
    async getSession(id: string) {
      await wait();
      const s = demoState.sessions.get(id);
      if (!s) throw new Error('Demo: session not found');
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
    },
    async listSessions(opts: { shooterId?: string; limit?: number; offset?: number } = {}) {
      await wait();
      const items = Array.from(demoState.sessions.values())
        .filter((s) => !opts.shooterId || s.shooter_id === opts.shooterId)
        .map((s) => ({
          id: s.id,
          shooter_id: s.shooter_id,
          discipline: s.discipline,
          started_at: s.started_at,
          ended_at: s.ended_at,
          total_score: s.total_score,
          shot_count: s.shot_count,
        }))
        .sort((a, b) => b.started_at - a.started_at)
        .slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 20));
      return { items, total: demoState.sessions.size };
    },
    raw: undefined as never,
  };

  return client as unknown as ApiClient;
};

// ---------- DemoWsClient ----------

type BusEvent =
  | { type: 'hit'; hit: DemoHit; sessionId: string }
  | { type: 'session_started'; payload: { session_id: string; started_at: number } }
  | {
      type: 'session_ended';
      payload: {
        summary: {
          session_id: string;
          ended_at: number;
          total_score: number;
          shot_count: number;
        };
      };
    }
  | { type: 'reset'; payload: null };

class DemoBus {
  private listeners = new Set<(e: BusEvent) => void>();

  subscribe(cb: (e: BusEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(type: BusEvent['type'], payload: unknown): void {
    const event = { type, payload } as unknown as BusEvent;
    this.listeners.forEach((cb) => {
      try {
        cb(event);
      } catch {
        /* ignore listener errors */
      }
    });
  }

  emitHit(sessionId: string, hit: DemoHit): void {
    this.listeners.forEach((cb) => cb({ type: 'hit', sessionId, hit }));
  }
}

const demoBus = new DemoBus();

// (No auto-emitter — Demo discipline shots are produced by
// LiveSessionScreen's simulator via apiClient.simulateHit(). On a real
// Pi the laser drives them through the WS. Other disciplines on a Demo
// Range simply produce no hits, matching the expectation that you can
// browse the app without a live target.)

type WsListener<T> = (v: T) => void;
type WsEvents = {
  open: void;
  close: void;
  reconnecting: { attempt: number; nextDelayMs: number };
  hit: Hit;
  reset: void;
  session_started: { sessionId: string; startedAt: number };
  session_ended: { sessionId: string; endedAt: number; totalScore: number; shotCount: number };
  calibration: 'frozen' | 'live';
  camera_status: { ok: boolean; fps: number };
};
type WsEventListeners = { [K in keyof WsEvents]?: Set<WsListener<WsEvents[K]>> };

export class DemoWsClient {
  private listeners: WsEventListeners = {};

  private unsubscribeBus: (() => void) | null = null;

  on<K extends keyof WsEvents>(event: K, cb: WsListener<WsEvents[K]>): () => void {
    const existing = this.listeners[event];
    const bucket = existing ?? new Set<WsListener<WsEvents[K]>>();
    if (!existing) {
      (this.listeners as Record<string, Set<WsListener<WsEvents[K]>>>)[event] = bucket;
    }
    bucket.add(cb);
    return () => this.listeners[event]?.delete(cb);
  }

  private fire<K extends keyof WsEvents>(event: K, value: WsEvents[K]): void {
    this.listeners[event]?.forEach((cb) => {
      try {
        cb(value);
      } catch {
        /* ignore */
      }
    });
  }

  connect(): void {
    this.unsubscribeBus = demoBus.subscribe((e) => {
      switch (e.type) {
        case 'hit': {
          const h: Hit = {
            sessionId: e.sessionId,
            ts: e.hit.ts,
            xNorm: e.hit.x_norm,
            yNorm: e.hit.y_norm,
            score: e.hit.score,
            ring: e.hit.ring,
            xMm: e.hit.x_mm,
            yMm: e.hit.y_mm,
            distMm: e.hit.dist_mm,
            isInnerTen: e.hit.is_inner_ten,
          };
          this.fire('hit', h);
          break;
        }
        case 'session_started':
          this.fire('session_started', {
            sessionId: e.payload.session_id,
            startedAt: e.payload.started_at,
          });
          break;
        case 'session_ended':
          this.fire('session_ended', {
            sessionId: e.payload.summary.session_id,
            endedAt: e.payload.summary.ended_at,
            totalScore: e.payload.summary.total_score,
            shotCount: e.payload.summary.shot_count,
          });
          break;
        case 'reset':
          this.fire('reset', undefined);
          break;
        default:
          break;
      }
    });
    // Pretend a successful connection.
    setTimeout(() => {
      this.fire('open', undefined);
      this.fire('camera_status', { ok: true, fps: 30 });
    }, 100);
  }

  close(): void {
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;
    this.fire('close', undefined);
  }
}
