import { create } from 'zustand';

import type { PairingRecord } from '@/types/pairing';

type PairingState = {
  active: PairingRecord | null;
  knownRanges: PairingRecord[];
  setActive: (r: PairingRecord | null) => void;
  setKnown: (rs: PairingRecord[]) => void;
  upsert: (r: PairingRecord) => void;
  remove: (id: string) => void;
};

export const usePairingStore = create<PairingState>((set) => ({
  active: null,
  knownRanges: [],
  setActive: (active) => set({ active }),
  setKnown: (knownRanges) => set({ knownRanges }),
  upsert: (r) =>
    set((s) => ({
      knownRanges: [...s.knownRanges.filter((x) => x.id !== r.id), r],
    })),
  remove: (id) =>
    set((s) => ({
      knownRanges: s.knownRanges.filter((x) => x.id !== id),
      active: s.active?.id === id ? null : s.active,
    })),
}));
