import { getDb } from './db';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const logger = {
  async write(level: LogLevel, tag: string, message: string): Promise<void> {
    try {
      const db = await getDb();
      await db.runAsync(
        'INSERT INTO logs (ts, level, tag, message) VALUES (?, ?, ?, ?)',
        Date.now(),
        level,
        tag,
        message.slice(0, 4000),
      );
    } catch {
      // Logging must never throw.
    }
  },

  debug: (tag: string, msg: string) => logger.write('debug', tag, msg),
  info: (tag: string, msg: string) => logger.write('info', tag, msg),
  warn: (tag: string, msg: string) => logger.write('warn', tag, msg),
  error: (tag: string, msg: string) => logger.write('error', tag, msg),

  async readAll(): Promise<{ ts: number; level: string; tag: string; message: string }[]> {
    const db = await getDb();
    return db.getAllAsync('SELECT ts, level, tag, message FROM logs ORDER BY ts DESC LIMIT 5000');
  },

  async prune(): Promise<void> {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const db = await getDb();
    await db.runAsync('DELETE FROM logs WHERE ts < ?', cutoff);
  },
};
