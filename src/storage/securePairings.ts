import * as SecureStore from 'expo-secure-store';

import type { PairingRecord } from '@/types/pairing';

const KEY_RANGES = 'shooterrange.pairings.v1';
const KEY_ACTIVE = 'shooterrange.activePairingId.v1';

export const securePairings = {
  async list(): Promise<PairingRecord[]> {
    const raw = await SecureStore.getItemAsync(KEY_RANGES);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Partial<PairingRecord>[];
      if (!Array.isArray(parsed)) return [];
      // Migration: older records may not have `calibrationConfirmedAt`.
      return parsed.map((r) => ({
        id: r.id ?? '',
        name: r.name ?? '',
        baseUrl: r.baseUrl ?? '',
        wsUrl: r.wsUrl ?? '',
        token: r.token ?? '',
        fingerprint: r.fingerprint ?? null,
        pairedAt: r.pairedAt ?? Date.now(),
        calibrationConfirmedAt: r.calibrationConfirmedAt ?? null,
      }));
    } catch {
      return [];
    }
  },
  async save(records: PairingRecord[]): Promise<void> {
    await SecureStore.setItemAsync(KEY_RANGES, JSON.stringify(records));
  },
  async upsert(record: PairingRecord): Promise<PairingRecord[]> {
    const existing = await securePairings.list();
    const next = [...existing.filter((r) => r.id !== record.id), record];
    await securePairings.save(next);
    return next;
  },
  async remove(id: string): Promise<PairingRecord[]> {
    const existing = await securePairings.list();
    const next = existing.filter((r) => r.id !== id);
    await securePairings.save(next);
    return next;
  },
  async getActiveId(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY_ACTIVE);
  },
  async setActiveId(id: string | null): Promise<void> {
    if (id === null) await SecureStore.deleteItemAsync(KEY_ACTIVE);
    else await SecureStore.setItemAsync(KEY_ACTIVE, id);
  },
};
