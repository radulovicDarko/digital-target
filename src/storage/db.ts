import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shooters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dob TEXT,
    dominant_eye TEXT,
    club TEXT,
    notes TEXT,
    photo_uri TEXT,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    shooter_id TEXT NOT NULL,
    discipline TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    total_score INTEGER NOT NULL DEFAULT 0,
    shot_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    pi_id TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS hits (
    session_id TEXT NOT NULL,
    ts REAL NOT NULL,
    x_norm REAL NOT NULL,
    y_norm REAL NOT NULL,
    score INTEGER NOT NULL,
    ring INTEGER NOT NULL,
    x_mm REAL NOT NULL,
    y_mm REAL NOT NULL,
    dist_mm REAL NOT NULL,
    is_inner_ten INTEGER NOT NULL,
    PRIMARY KEY (session_id, ts)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_hits_session ON hits(session_id);`,
  `CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    body_json TEXT,
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    tag TEXT NOT NULL,
    message TEXT NOT NULL
  );`,
];

export const getDb = (): Promise<SQLite.SQLiteDatabase> => {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('shooterrange.db');
      await db.execAsync('PRAGMA journal_mode = WAL;');
      for (const stmt of SCHEMA) {
        await db.execAsync(stmt);
      }
      return db;
    })();
  }
  return dbPromise;
};

/** Test-only: drop the cached handle so the next call re-opens. */
export const _resetDb = (): void => {
  dbPromise = null;
};
