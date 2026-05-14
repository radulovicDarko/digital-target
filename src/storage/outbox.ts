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

let nextId = 1;
let items: OutboxItem[] = [];

export const outbox = {
  async enqueue({ method, url, body }: EnqueueArgs): Promise<number> {
    const id = nextId++;
    const rec: OutboxItem = {
      id,
      method,
      url,
      bodyJson: body == null ? null : JSON.stringify(body),
      createdAt: Date.now(),
      attempts: 0,
      lastError: null,
    };
    items = [...items, rec];
    return id;
  },

  async list(limit = 50): Promise<OutboxItem[]> {
    return items.slice(0, Math.max(0, limit));
  },

  async markFailed(id: number, error: string): Promise<void> {
    items = items.map((it) =>
      it.id === id
        ? { ...it, attempts: it.attempts + 1, lastError: error.slice(0, 1000) }
        : it,
    );
  },

  async remove(id: number): Promise<void> {
    items = items.filter((it) => it.id !== id);
  },

  /** Test-only helper. */
  _clear(): void {
    items = [];
    nextId = 1;
  },
};
