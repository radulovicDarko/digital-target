import { logger } from '@/storage/logger';
import type { Hit } from '@/types/session';
import type { PairingRecord } from '@/types/pairing';

import type { WsMessage } from './schemas';
import { WsMessageSchema } from './schemas';

type Listener<T> = (value: T) => void;
type EventMap = {
  open: void;
  close: void;
  reconnecting: { attempt: number; nextDelayMs: number };
  hit: Hit;
  reset: void;
  session_started: { sessionId: string; startedAt: number };
  session_ended: { sessionId: string; endedAt: number; totalScore: number; shotCount: number };
  calibration: 'frozen' | 'live';
  camera_status: { ok: boolean; fps: number };
  raw: WsMessage;
};
type EventListeners = { [K in keyof EventMap]?: Set<Listener<EventMap[K]>> };

const MAX_BACKOFF_MS = 8000;
const MIN_BACKOFF_MS = 250;
const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 30000;

const wsMessageToHit = (m: Extract<WsMessage, { type: 'hit' }>): Hit => ({
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

export class WsClient {
  private socket: WebSocket | null = null;

  private listeners: EventListeners = {};

  private attempt = 0;

  private closedByUser = false;

  private heartbeat: ReturnType<typeof setInterval> | null = null;

  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly pairing: PairingRecord,
    private readonly clientId: string,
  ) {}

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  isConnecting(): boolean {
    return this.socket?.readyState === WebSocket.CONNECTING;
  }

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    const existing = this.listeners[event];
    const bucket = existing ?? new Set<Listener<EventMap[K]>>();
    if (!existing) {
      // Mapped-key generic stores require this through-cast: each key has its
      // own concrete value type so TS can't prove the Set is assignable.
      (this.listeners as Record<string, Set<Listener<EventMap[K]>>>)[event] = bucket;
    }
    bucket.add(listener);
    return () => this.listeners[event]?.delete(listener);
  }

  private emit<K extends keyof EventMap>(event: K, value: EventMap[K]): void {
    this.listeners[event]?.forEach((cb) => {
      try {
        cb(value);
      } catch (e) {
        void logger.warn('ws', `listener for ${event} threw: ${String(e)}`);
      }
    });
  }

  connect(): void {
    this.closedByUser = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Idempotent: if we're already connected/connecting, do nothing.
    const st = this.socket?.readyState;
    if (st === WebSocket.OPEN || st === WebSocket.CONNECTING) return;
    this.openSocket();
  }

  close(): void {
    this.closedByUser = true;
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const sock = this.socket;
    this.socket = null;
    try {
      sock?.close();
    } catch {
      /* ignore */
    }
  }

  private openSocket(): void {
    const st = this.socket?.readyState;
    if (st === WebSocket.OPEN || st === WebSocket.CONNECTING) return;

    const url = `${this.pairing.wsUrl}?token=${encodeURIComponent(this.pairing.token)}&client_id=${encodeURIComponent(this.clientId)}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      void logger.warn('ws', `construct failed: ${String(e)}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.attempt = 0;
      this.startHeartbeat();
      this.emit('open', undefined);
    };

    socket.onmessage = (ev) => {
      this.touchSilence();
      this.handleMessage(ev.data);
    };

    socket.onerror = (e) => {
      const msg = String((e as { message?: string }).message ?? '');
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[ws] error', msg);
      }
      void logger.warn('ws', `error: ${msg}`);
    };

    // Some RN environments provide close code/reason via event parameter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.onclose = (ev: any) => {
      if (this.socket !== socket) return;
      const code = typeof ev?.code === 'number' ? ev.code : undefined;
      const reason = typeof ev?.reason === 'string' ? ev.reason : undefined;
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[ws] close', { code, reason });
      }
      void logger.warn('ws', `close code=${code ?? 'n/a'} reason=${reason ?? ''}`);
      this.clearHeartbeat();
      this.emit('close', undefined);
      this.socket = null;
      if (!this.closedByUser) this.scheduleReconnect();
    };
  }

  private handleMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      void logger.warn('ws', 'malformed JSON, dropping');
      return;
    }

    // Allow plain "pong" / heartbeat ack without schema noise.
    if (parsed && typeof parsed === 'object' && (parsed as { type?: string }).type === 'pong') {
      return;
    }

    const result = WsMessageSchema.safeParse(parsed);
    if (!result.success) {
      void logger.warn('ws', `schema fail: ${result.error.message}`);
      return;
    }

    const msg = result.data;
    this.emit('raw', msg);

    switch (msg.type) {
      case 'hit': {
        // Per-hit instrumentation: time from when the Pi published the
        // hit (msg.ts is the server-side wall clock) to now. Logs as a
        // single line so you can grep "[ws hit]" in the device console
        // when sessions feel laggy.
        const hit = wsMessageToHit(msg);
        const latencyMs = Math.max(0, Date.now() - msg.ts * 1000);
        void logger.info(
          'ws',
          `hit score=${hit.score} ring=${hit.ring} dist=${hit.distMm.toFixed(1)}mm latency=${latencyMs}ms ts=${msg.ts.toFixed(3)}`,
        );
        this.emit('hit', hit);
        break;
      }
      case 'reset':
        this.emit('reset', undefined);
        break;
      case 'session_started':
        this.emit('session_started', { sessionId: msg.session_id, startedAt: msg.started_at });
        break;
      case 'session_ended':
        this.emit('session_ended', {
          sessionId: msg.summary.session_id,
          endedAt: msg.summary.ended_at,
          totalScore: msg.summary.total_score,
          shotCount: msg.summary.shot_count,
        });
        break;
      case 'calibration':
        this.emit('calibration', msg.state);
        break;
      case 'camera_status':
        this.emit('camera_status', { ok: msg.ok, fps: msg.fps });
        break;
      default: {
        // Exhaustiveness guard.
        const _exhaustive: never = msg;
        void _exhaustive;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.attempt += 1;
    const exp = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (this.attempt - 1));
    const jitter = Math.random() * 0.3 * exp;
    const delay = Math.round(exp + jitter);
    this.emit('reconnecting', { attempt: this.attempt, nextDelayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.openSocket();
    }, delay);
  }

  private startHeartbeat(): void {
    this.touchSilence();
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ type: 'ping' }));
        } catch {
          /* drop */
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private touchSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      void logger.warn('ws', 'silence timeout, forcing reconnect');
      this.socket?.close();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.heartbeat = null;
    this.silenceTimer = null;
  }
}

/**
 * Type the live screen consumes — both `WsClient` (real) and `DemoWsClient`
 * (in-memory) implement this surface. Allows LiveSessionScreen to swap
 * implementations without branching on pairing identity in every callback.
 */
export type AnyWsClient = Pick<WsClient, 'on' | 'connect' | 'close'>;

/**
 * Factory: returns the in-memory DemoWsClient for the demo pairing,
 * otherwise the real WsClient. Centralises the demo branch so callers
 * never import `DemoWsClient` directly.
 */
export const createWsClient = (pairing: PairingRecord, clientId = 'legacy'): AnyWsClient => {
  // Inline import to avoid a circular dep between api/ws.ts and api/demo.ts.
  // (demo.ts imports `Hit`/`PairingRecord` types only, no runtime cycle.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  const { isDemoPairing, DemoWsClient } = require('./demo') as typeof import('./demo');
  if (isDemoPairing(pairing)) return new DemoWsClient() as unknown as AnyWsClient;
  return new WsClient(pairing, clientId);
};
