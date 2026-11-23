import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { z } from 'zod';

import { SessionFullSchema } from '@/api/schemas';

export type SavedSession = z.infer<typeof SessionFullSchema>;

const writes = new Map<string, Promise<void>>();
const keyFor = (owner: string) => {
  if (!owner) throw new Error('Session history requires an account');
  return `shooterrange.history.${owner.split('').map((c) => c.charCodeAt(0).toString(16)).join('-')}`;
};
const fileFor = (key: string, slot: string) => new File(Paths.document, `${key}.${slot}.json`);

const read = async (owner: string): Promise<SavedSession[]> => {
  const key = keyFor(owner);
  const slot = await SecureStore.getItemAsync(key);
  if (slot === null) return [];
  if (slot !== 'a' && slot !== 'b') throw new Error('Invalid session history index');
  return SessionFullSchema.array().parse(JSON.parse(await fileFor(key, slot).text()));
};

export const sessionHistory = {
  async load(owner: string): Promise<SavedSession[]> {
    const pending = writes.get(owner);
    if (pending) await pending;
    return read(owner);
  },

  upsert(owner: string, session: SavedSession): Promise<void> {
    const save = async () => {
      const next = SessionFullSchema.parse(session);
      const existing = await read(owner);
      const sessions = [next, ...existing.filter((s) => s.id !== next.id)]
        .sort((a, b) => b.started_at - a.started_at);
      const key = keyFor(owner);
      const current = await SecureStore.getItemAsync(key);
      const slot = current === 'a' ? 'b' : 'a';
      // Commit the index only after the inactive file is fully written.
      const file = fileFor(key, slot);
      file.create({ overwrite: true });
      await file.write(JSON.stringify(sessions));
      await SecureStore.setItemAsync(key, slot);
    };
    const previous = writes.get(owner);
    const operation = previous ? previous.then(save, save) : save();
    writes.set(owner, operation);
    const cleanup = () => {
      if (writes.get(owner) === operation) writes.delete(owner);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  },
};
