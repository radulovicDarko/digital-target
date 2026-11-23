import { sessionHistory, type SavedSession } from '../sessionHistory';

const mockFiles = new Map<string, string>();
const mockIndices = new Map<string, string>();
const mockWrite = jest.fn<Promise<void>, []>();
jest.mock('expo-file-system', () => ({
  Paths: { document: 'documents' },
  File: class {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join('/'); }
    create() { mockFiles.set(this.uri, ''); }
    async write(text: string) { await mockWrite(); mockFiles.set(this.uri, text); }
    async text() {
      const text = mockFiles.get(this.uri);
      if (text === undefined) throw new Error('Missing history file');
      return text;
    }
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockIndices.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { mockIndices.set(key, value); },
}));

const session = (id: string): SavedSession => ({
  id, shooter_id: 'owner', discipline: 'Air pistol', started_at: 10, ended_at: 20,
  total_score: 10, shot_count: 1,
  hits: [{ ts: 12, x_norm: 0.5, y_norm: 0.5, ring: 10, score: 10,
    x_mm: 0, y_mm: 0, dist_mm: 0, is_inner_ten: true }],
});

beforeEach(() => {
  mockFiles.clear();
  mockIndices.clear();
  mockWrite.mockReset().mockResolvedValue();
});

it('retains full large sessions across reads, upserts IDs, and isolates accounts', async () => {
  const large = { ...session('one'), shot_count: 2000, hits: Array.from({ length: 2000 }, () => session('hit').hits[0]!) };
  await sessionHistory.upsert('account one', large);
  expect((await sessionHistory.load('account one'))[0]?.hits).toHaveLength(2000);
  expect([...mockFiles.values()][0]?.length).toBeGreaterThan(2000);
  await sessionHistory.upsert('account one', { ...large, total_score: 123 });
  expect(await sessionHistory.load('account one')).toEqual([{ ...large, total_score: 123 }]);
  expect(await sessionHistory.load('account-two')).toEqual([]);
});

it('serializes concurrent saves without losing either session', async () => {
  await Promise.all([
    sessionHistory.upsert('account', session('first')),
    sessionHistory.upsert('account', session('second')),
  ]);
  expect((await sessionHistory.load('account')).map((s) => s.id).sort()).toEqual(['first', 'second']);
});

it('preserves the committed history after a write failure and allows retry', async () => {
  await sessionHistory.upsert('account', session('first'));
  mockWrite.mockRejectedValueOnce(new Error('Storage full'));
  await expect(sessionHistory.upsert('account', session('second'))).rejects.toThrow('Storage full');
  expect((await sessionHistory.load('account')).map((s) => s.id)).toEqual(['first']);
  await sessionHistory.upsert('account', session('second'));
  expect(await sessionHistory.load('account')).toHaveLength(2);
});

it('reports corrupt history rather than silently clearing it', async () => {
  await sessionHistory.upsert('account', session('first'));
  for (const uri of mockFiles.keys()) mockFiles.set(uri, 'invalid JSON');
  await expect(sessionHistory.load('account')).rejects.toThrow();
  expect([...mockFiles.values()]).toEqual(['invalid JSON']);
});
