import { getDb } from './db';

export type OutboxItem = {
  id: number;
  method: string;
  url: string;
  bodyJson: string | null;
  createdAt: number;
  attempts: number;
  lastError: string | null;
};

type EnqueueArgs = {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
};

export const outbox = {
  async enqueue({ method, url, body }: EnqueueArgs): Promise<number> {
    const db = await getDb();
    const result = await db.runAsync(
      'INSERT INTO outbox (method, url, body_json, created_at) VALUES (?, ?, ?, ?)',
      method,
      url,
      body == null ? null : JSON.stringify(body),
      Date.now(),
    );
    return result.lastInsertRowId;
  },
  async list(limit = 50): Promise<OutboxItem[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: number;
      method: string;
      url: string;
      body_json: string | null;
      created_at: number;
      attempts: number;
      last_error: string | null;
    }>('SELECT * FROM outbox ORDER BY id ASC LIMIT ?', limit);
    return rows.map((r) => ({
      id: r.id,
      method: r.method,
      url: r.url,
      bodyJson: r.body_json,
      createdAt: r.created_at,
      attempts: r.attempts,
      lastError: r.last_error,
    }));
  },
  async markFailed(id: number, error: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?',
      error,
      id,
    );
  },
  async remove(id: number): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM outbox WHERE id = ?', id);
  },
};
