const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogRow = { ts: number; level: string; tag: string; message: string };

const MAX_ROWS = 5000;

let rows: LogRow[] = [];

const pushRow = (row: LogRow) => {
  rows = [row, ...rows];
  if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS);
};

export const logger = {
  async write(level: LogLevel, tag: string, message: string): Promise<void> {
    // Intentionally memory-only: we do NOT want SQLite writes on the hot
    // path (WS hits) because it causes I/O backlog and UI lag.
    try {
      pushRow({
        ts: Date.now(),
        level,
        tag,
        message: message.slice(0, 4000),
      });
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log(`[${level}] [${tag}]`, message);
      }
    } catch {
      // Logging must never throw.
    }
  },

  debug: (tag: string, msg: string) => logger.write('debug', tag, msg),
  info: (tag: string, msg: string) => logger.write('info', tag, msg),
  warn: (tag: string, msg: string) => logger.write('warn', tag, msg),
  error: (tag: string, msg: string) => logger.write('error', tag, msg),

  async readAll(): Promise<LogRow[]> {
    return rows;
  },

  async prune(): Promise<void> {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    rows = rows.filter((r) => r.ts >= cutoff);
  },

  /** Test-only helper. */
  _clear(): void {
    rows = [];
  },
};
