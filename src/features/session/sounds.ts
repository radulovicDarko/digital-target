/** Reused players with FIFO playback: batched hits never restart or drop a clip. */
import { type AudioPlayer, type AudioStatus, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { logger } from '@/storage/logger';

type SoundName = 'shot' | 'reset';

const SOURCES: Record<SoundName, number> = {
  shot: require('../../../assets/sounds/shot.wav'),
  reset: require('../../../assets/sounds/reset.wav'),
};

const players = new Map<SoundName, AudioPlayer>();
const queues = new Map<SoundName, Promise<void>>();
let priming: Promise<void> | null = null;

const withTimeout = async (pending: Promise<void>, operation: string): Promise<void> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`${operation} timed out`)), 10_000);
    })]);
  } finally {
    clearTimeout(timeout);
  }
};

const ensurePrimed = (): Promise<void> => {
  if (priming) return priming;
  priming = (async () => {
    await withTimeout(setAudioModeAsync({ playsInSilentMode: true }), 'audio mode');
    for (const name of Object.keys(SOURCES) as SoundName[]) {
      if (players.has(name)) continue;
      players.set(name, createAudioPlayer(SOURCES[name], { downloadFirst: true, updateInterval: 50 }));
    }
  })().catch((error: unknown) => {
    priming = null;
    throw error;
  });
  return priming;
};

export const primeSounds = (): void => {
  void ensurePrimed().catch((error: unknown) => {
    void logger.warn('sounds', `prime failed: ${String(error)}`);
  });
};

const waitForStatus = (
  player: AudioPlayer,
  ready: (status: AudioStatus) => boolean,
  operation: string,
  start?: () => void,
): Promise<void> => {
  if (!start) {
    if (player.currentStatus.error) return Promise.reject(new Error(player.currentStatus.error));
    if (ready(player.currentStatus)) return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let subscription: ReturnType<AudioPlayer['addListener']> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      subscription?.remove();
      if (error === undefined) resolve();
      else reject(error);
    };
    timeout = setTimeout(() => finish(new Error(`${operation} timed out`)), 10_000);
    subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.error) finish(new Error(status.error));
      else if (ready(status)) finish();
    });
    if (finished) subscription.remove();
    try {
      start?.();
    } catch (error) {
      finish(error);
    }
  });
};

/** Enqueue synchronously; native loading/playback never blocks hit acceptance. */
export const playSound = (name: SoundName): void => {
  const next = (queues.get(name) ?? Promise.resolve()).then(async () => {
    await ensurePrimed();
    const player = players.get(name);
    if (!player) throw new Error(`Missing audio player: ${name}`);
    await waitForStatus(player, (status) => status.isLoaded, `load ${name}`);
    await withTimeout(player.seekTo(0), `seek ${name}`);
    await waitForStatus(player, (status) => status.didJustFinish, `play ${name}`, () => player.play());
  }).catch((error: unknown) => {
    void logger.warn('sounds', `play(${name}) failed: ${String(error)}`);
  });
  queues.set(name, next);
  void next.then(() => {
    if (queues.get(name) === next) queues.delete(name);
  });
};
