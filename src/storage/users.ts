import * as SecureStore from 'expo-secure-store';

import type { StoredUser, User, UserRole } from '@/types/user';

const KEY_USERS = 'shooterrange.users.v1';
const KEY_CURRENT = 'shooterrange.currentUserId.v1';

/**
 * Stable, dependency-free hash for local-only auth.
 * SecureStore is OS-encrypted, so this is just an extra obfuscation layer
 * to avoid storing plaintext passwords on disk.
 */
const djb2 = (input: string): string => {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

const randomSalt = (): string =>
  `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;

export const hashPassword = (password: string, salt: string): string =>
  // Multi-round djb2 with salt — fine for local-only demo auth.
  djb2(`${salt}::${password}::${salt}::${password}`);

const readUsers = async (): Promise<StoredUser[]> => {
  const raw = await SecureStore.getItemAsync(KEY_USERS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeUsers = async (users: StoredUser[]): Promise<void> => {
  await SecureStore.setItemAsync(KEY_USERS, JSON.stringify(users));
};

const toPublic = (u: StoredUser): User => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  createdAt: u.createdAt,
});

export const userStore = {
  async list(): Promise<User[]> {
    const all = await readUsers();
    return all.map(toPublic);
  },

  async getById(id: string): Promise<User | null> {
    const all = await readUsers();
    const found = all.find((u) => u.id === id);
    return found ? toPublic(found) : null;
  },

  async findByEmail(email: string): Promise<StoredUser | null> {
    const all = await readUsers();
    return all.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  },

  async register(input: {
    email: string;
    name: string;
    password: string;
    role?: UserRole;
  }): Promise<User> {
    const all = await readUsers();
    if (all.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      throw new Error('EMAIL_TAKEN');
    }
    const salt = randomSalt();
    const stored: StoredUser = {
      id: `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      email: input.email.trim(),
      name: input.name.trim(),
      role: input.role ?? 'member',
      createdAt: Date.now(),
      salt,
      passwordHash: hashPassword(input.password, salt),
    };
    await writeUsers([...all, stored]);
    return toPublic(stored);
  },

  async authenticate(email: string, password: string): Promise<User | null> {
    const found = await userStore.findByEmail(email);
    if (!found) return null;
    const expected = hashPassword(password, found.salt);
    if (expected !== found.passwordHash) return null;
    return toPublic(found);
  },

  async update(
    id: string,
    patch: { name?: string; email?: string },
  ): Promise<User> {
    const all = await readUsers();
    const idx = all.findIndex((u) => u.id === id);
    if (idx === -1) throw new Error('NOT_FOUND');
    if (patch.email && patch.email.trim().toLowerCase() !== all[idx]!.email.toLowerCase()) {
      const taken = all.some(
        (u) => u.id !== id && u.email.toLowerCase() === patch.email!.toLowerCase(),
      );
      if (taken) throw new Error('EMAIL_TAKEN');
    }
    const next: StoredUser = {
      ...all[idx]!,
      name: patch.name?.trim() || all[idx]!.name,
      email: patch.email?.trim() || all[idx]!.email,
    };
    all[idx] = next;
    await writeUsers(all);
    return toPublic(next);
  },

  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const all = await readUsers();
    const idx = all.findIndex((u) => u.id === id);
    if (idx === -1) throw new Error('NOT_FOUND');
    const u = all[idx]!;
    if (hashPassword(currentPassword, u.salt) !== u.passwordHash) {
      throw new Error('WRONG_PASSWORD');
    }
    const salt = randomSalt();
    all[idx] = { ...u, salt, passwordHash: hashPassword(newPassword, salt) };
    await writeUsers(all);
  },

  /** Local password reset: requires only the email + a new password. */
  async resetPassword(email: string, newPassword: string): Promise<User> {
    const all = await readUsers();
    const idx = all.findIndex((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (idx === -1) throw new Error('NOT_FOUND');
    const salt = randomSalt();
    all[idx] = { ...all[idx]!, salt, passwordHash: hashPassword(newPassword, salt) };
    await writeUsers(all);
    return toPublic(all[idx]!);
  },

  async remove(id: string): Promise<void> {
    const all = await readUsers();
    await writeUsers(all.filter((u) => u.id !== id));
  },

  async getCurrentId(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY_CURRENT);
  },

  async setCurrentId(id: string | null): Promise<void> {
    if (id === null) await SecureStore.deleteItemAsync(KEY_CURRENT);
    else await SecureStore.setItemAsync(KEY_CURRENT, id);
  },
};
