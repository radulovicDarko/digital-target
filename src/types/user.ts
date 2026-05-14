export type UserRole = 'member' | 'admin';

export type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: number;
};

/** Persisted form — adds password hash. Never returned to UI. */
export type StoredUser = User & {
  passwordHash: string;
  salt: string;
};
