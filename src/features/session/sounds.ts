/**
 * Lightweight wrapper around expo-audio for one-shot sound effects.
 *
 * The shot sound used to play on the Pi (pygame). We now play it on the
 * phone instead so it can be muted per-user via Settings → Sound, and so
 * users without speakers on the Pi still get audio feedback.
 *
 * Players are created lazily and reused — re-creating an `AudioPlayer` for
 * every shot would leak native handles on iOS. `seekTo(0)` + `play()`
 * restarts a still-decoding sound without allocating.
 *
 * Latency design:
 *  - Audio mode is configured eagerly via `primeSounds()` at app start so
 *    the very first hit doesn't pay the bridge round-trip.
 *  - Players are created during priming, not on first hit, for the same
 *    reason.
 *  - `playSound` is fully synchronous from the JS-thread perspective —
 *    no `await` inside, no microtasks queued. Bridge call happens, JS
 *    returns to the WS handler immediately. Critical for not blocking the
 *    next hit during rapid fire.
 *  - We rate-limit at 50 ms (= 20 sounds/s ceiling) so a freak burst of
 *    detector blobs can't queue up dozens of audio commands on the bridge.
 */
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { logger } from '@/storage/logger';

type SoundName = 'shot' | 'reset';

// Bundled WAV sources — Metro inlines the require so the asset is part of
// the JS bundle (matches assetBundlePatterns: ['**/*'] in app.config.ts).
// Path math: this file lives at src/features/session/, so three "../" hops
// land us at the workspace root next to assets/.
const SOURCES: Record<SoundName, number> = {
  shot: require('../../../assets/sounds/shot.wav'),
  reset: require('../../../assets/sounds/reset.wav'),
};

const players = new Map<SoundName, AudioPlayer>();
let modeConfigured = false;
let primed = false;
const lastPlayedAt = new Map<SoundName, number>();
const MIN_INTERVAL_MS = 50;

/**
 * One-time setup: configure audio mode and instantiate players. Safe to
 * call multiple times. Call once at app boot (or first time the user
 * enables sound) so the first hit doesn't pay the cost.
 */
export const primeSounds = (): void => {
  if (primed) return;
  primed = true;
  // Fire and forget — we don't want the caller to await. Subsequent
  // playSound() calls find the player already cached.
  void (async () => {
    if (!modeConfigured) {
      modeConfigured = true;
      try {
        await setAudioModeAsync({ playsInSilentMode: true });
      } catch (e) {
        void logger.warn('sounds', `setAudioMode failed: ${String(e)}`);
      }
    }
    for (const name of Object.keys(SOURCES) as SoundName[]) {
      if (players.has(name)) continue;
      try {
        // iOS AVPlayer is picky about bundled assets whose type can't be
        // inferred. `downloadFirst` forces expo-asset to materialize a
        // local file URI before the player starts (expo-audio has a
        // built-in workaround for this).
        players.set(name, createAudioPlayer(SOURCES[name], { downloadFirst: true }));
      } catch (e) {
        void logger.warn('sounds', `prime ${name} failed: ${String(e)}`);
      }
    }
  })();
};

/**
 * Fully synchronous fire-and-forget play. No await, no microtask. Returns
 * immediately so the WS handler can move on to the next hit. Drops the
 * call if it arrives within MIN_INTERVAL_MS of the previous one.
 */
export const playSound = (name: SoundName): void => {
  // Rate-limit: a burst of "blobs" from the detector could otherwise pile
  // up dozens of audio commands on the native bridge.
  const now = Date.now();
  const last = lastPlayedAt.get(name) ?? 0;
  if (now - last < MIN_INTERVAL_MS) return;
  lastPlayedAt.set(name, now);

  // Lazy prime if the caller forgot — first hit pays the cost, all
  // subsequent ones are cheap.
  if (!primed) primeSounds();

  const p = players.get(name);
  if (!p) return; // still priming, skip this one (next hit will work)

  try {
    // seekTo() / play() return Promises but we intentionally don't await —
    // the native side queues them in order on its own thread.
    void p.seekTo(0);
    p.play();
  } catch (e) {
    void logger.warn('sounds', `play(${name}) failed: ${String(e)}`);
  }
};
