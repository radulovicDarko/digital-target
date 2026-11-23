import { renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { SavedSession } from '@/storage/sessionHistory';
import { useSessionPersistence, type SaveSessionInput } from '../useSessionPersistence';

let mockGuest = false;
const mockUpsert = jest.fn<Promise<void>, [string, SavedSession]>();
jest.mock('@/state/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string }; guest: boolean }) => unknown) =>
    selector({ user: { id: 'account' }, guest: mockGuest }),
}));
jest.mock('@/state/pairingStore', () => ({
  usePairingStore: (selector: (state: { active: null }) => unknown) => selector({ active: null }),
}));
jest.mock('@/api/demo', () => ({ isDemoPairing: () => false }));
jest.mock('@/storage/sessionHistory', () => ({
  sessionHistory: { upsert: (...args: [string, SavedSession]) => mockUpsert(...args) },
}));
jest.mock('@/storage/logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const input: SaveSessionInput = {
  id: 'session', discipline: 'ISSF 10m Air Rifle', startedAt: 100, endedAt: 200,
  totalScore: 10.9, shotCount: 1, shotsPerTarget: 10, targetsPerSession: 6,
  hits: [{
    sessionId: 'session', ts: 150, xNorm: 0.5, yNorm: 0.5, score: 10.9, ring: 10,
    xMm: 0, yMm: 0, distMm: 0, isInnerTen: true,
  }],
};

beforeEach(() => {
  mockGuest = false;
  mockUpsert.mockReset().mockResolvedValue();
});

it('saves completed authenticated sessions with full hit metrics and programme size', async () => {
  const { result } = await renderHook(() => useSessionPersistence());
  await expect(result.current.saveSession(input)).resolves.toEqual({ kind: 'deviceLocal', ok: true });
  expect(mockUpsert).toHaveBeenCalledWith('account', expect.objectContaining({
    id: 'session', started_at: 100, ended_at: 200, total_score: 10.9, shot_count: 1,
    shots_per_target: 10, targets_per_session: 6,
    hits: [{ ts: 150, x_norm: 0.5, y_norm: 0.5, score: 10.9, ring: 10,
      x_mm: 0, y_mm: 0, dist_mm: 0, is_inner_ten: true }],
  }));
});

it('preserves guest no-history behavior', async () => {
  mockGuest = true;
  const { result } = await renderHook(() => useSessionPersistence());
  await expect(result.current.saveSession(input)).resolves.toEqual({ kind: 'guestSkipped' });
  expect(mockUpsert).not.toHaveBeenCalled();
});

it('reports save failure explicitly so callers retain the live session for retry', async () => {
  mockUpsert.mockRejectedValueOnce(new Error('Storage full'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { result } = await renderHook(() => useSessionPersistence());
  await expect(result.current.saveSession(input)).resolves.toEqual({ kind: 'deviceLocal', ok: false });
  expect(alert).toHaveBeenCalledWith('history.saveFailedTitle', 'history.saveFailedBody');
  alert.mockRestore();
});
