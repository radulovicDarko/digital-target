import { create } from 'zustand';

import type { User } from '@/types/user';

type AuthState = {
  user: User | null;
  /** True when the user explicitly chose "Continue as guest" instead of
   *  logging in. Skips remote backend calls (no history saved). */
  guest: boolean;
  setUser: (u: User | null) => void;
  /** Enter guest mode. Clears any signed-in user. */
  continueAsGuest: () => void;
  /** Cancel guest mode (used when the user logs in / registers later). */
  exitGuest: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  guest: false,
  setUser: (user) => set({ user, guest: false }),
  continueAsGuest: () => set({ user: null, guest: true }),
  exitGuest: () => set({ guest: false }),
}));
