import type { AudioStatus } from 'expo-audio';

const mockMode = jest.fn<Promise<void>, []>();
const mockWarn = jest.fn();
const mockListeners = new Set<(status: AudioStatus) => void>();
const status = (patch: Partial<AudioStatus> = {}): AudioStatus => ({
  id: 'shot', currentTime: 0, duration: 0.47, playbackState: 'readyToPlay',
  timeControlStatus: 'paused', reasonForWaitingToPlay: '', mute: false,
  playing: false, loop: false, didJustFinish: false, isBuffering: false,
  isLoaded: true, playbackRate: 1, shouldCorrectPitch: true,
  isLive: false, currentOffsetFromLive: null, error: null, ...patch,
});
const mockPlayer = {
  isLoaded: true,
  currentStatus: status(),
  seekTo: jest.fn<Promise<void>, [number]>(),
  play: jest.fn(),
  addListener: (_event: string, listener: (value: AudioStatus) => void) => {
    mockListeners.add(listener);
    return { remove: () => mockListeners.delete(listener) };
  },
};
jest.mock('expo-audio', () => ({
  setAudioModeAsync: () => mockMode(),
  createAudioPlayer: () => mockPlayer,
}));
jest.mock('@/storage/logger', () => ({ logger: { warn: (...args: unknown[]) => mockWarn(...args) } }));

let sounds: typeof import('../sounds');
const flush = () => jest.advanceTimersByTimeAsync(0);
const emit = (patch: Partial<AudioStatus>) => {
  mockPlayer.currentStatus = status(patch);
  mockPlayer.isLoaded = mockPlayer.currentStatus.isLoaded;
  for (const listener of [...mockListeners]) listener(mockPlayer.currentStatus);
};
const finish = () => emit({ didJustFinish: true, currentTime: 0.47 });

beforeEach(() => {
  jest.useFakeTimers();
  mockListeners.clear();
  mockMode.mockReset().mockResolvedValue();
  mockWarn.mockReset();
  mockPlayer.seekTo.mockReset().mockResolvedValue();
  mockPlayer.play.mockReset();
  mockPlayer.isLoaded = true;
  mockPlayer.currentStatus = status();
  jest.isolateModules(() => { sounds = require('../sounds'); });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('plays two sounds for two hits delivered together, without interrupting either clip', async () => {
  sounds.playSound('shot');
  sounds.playSound('shot');
  await flush();
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  finish();
  await flush();
  expect(mockPlayer.seekTo).toHaveBeenNthCalledWith(1, 0);
  expect(mockPlayer.seekTo).toHaveBeenNthCalledWith(2, 0);
  expect(mockWarn).not.toHaveBeenCalled();
});

it('retains first hits while the audio mode and asset are still loading', async () => {
  let ready!: () => void;
  mockMode.mockReturnValue(new Promise<void>((resolve) => { ready = resolve; }));
  mockPlayer.isLoaded = false;
  mockPlayer.currentStatus = status({ isLoaded: false });
  sounds.playSound('shot');
  sounds.playSound('shot');
  await flush();
  expect(mockPlayer.play).not.toHaveBeenCalled();
  ready();
  await flush();
  expect(mockPlayer.play).not.toHaveBeenCalled();
  emit({ isLoaded: true });
  await flush();
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  finish();
  await flush();
});

it('waits for seek completion before starting playback', async () => {
  let seeked!: () => void;
  mockPlayer.seekTo.mockReturnValueOnce(new Promise<void>((resolve) => { seeked = resolve; }));
  sounds.playSound('shot');
  await flush();
  expect(mockPlayer.play).not.toHaveBeenCalled();
  seeked();
  await flush();
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  finish();
  await flush();
});

it('reports a failed seek and still plays the next queued hit', async () => {
  mockPlayer.seekTo.mockRejectedValueOnce(new Error('seek failed'));
  sounds.playSound('shot');
  sounds.playSound('shot');
  await flush();
  expect(mockWarn).toHaveBeenCalledWith('sounds', expect.stringContaining('seek failed'));
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  finish();
  await flush();
});

it('cleans up a missing playback completion and continues with the next hit', async () => {
  sounds.playSound('shot');
  sounds.playSound('shot');
  await flush();
  expect(mockListeners.size).toBe(1);
  await jest.advanceTimersByTimeAsync(10_000);
  expect(mockWarn).toHaveBeenCalledWith('sounds', expect.stringContaining('play shot timed out'));
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  expect(mockListeners.size).toBe(1);
  finish();
  await flush();
  expect(mockListeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not let a stalled seek block every subsequent hit', async () => {
  mockPlayer.seekTo.mockReturnValueOnce(new Promise<void>(() => {}));
  sounds.playSound('shot');
  sounds.playSound('shot');
  await flush();
  await jest.advanceTimersByTimeAsync(10_000);
  expect(mockWarn).toHaveBeenCalledWith('sounds', expect.stringContaining('seek shot timed out'));
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  finish();
  await flush();
});
