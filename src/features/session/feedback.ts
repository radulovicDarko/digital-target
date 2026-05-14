import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

import { useSettingsStore } from '@/state/settingsStore';

import { playSound } from './sounds';

const settings = () => useSettingsStore.getState();

/**
 * Fire-and-forget feedback for a fresh hit. Returns synchronously so the
 * WS handler can immediately move on to the next pending hit. None of the
 * three subsystems (sound / haptics / speech) blocks; their internal
 * native queues handle ordering on their own threads.
 *
 * Used to be `async` + `await`, which meant a 5-shot burst stacked up to
 * ~150 ms of microtask work on the JS thread before the next WS message
 * could be drained. That showed up as visible hit-render lag.
 */
export const onHitFeedback = (score: number, lang: string): void => {
  const s = settings();
  if (s.soundEnabled) {
    playSound('shot');
  }
  if (s.hapticsEnabled) {
    // Don't await — Haptics.impactAsync resolves after the buzzer has
    // physically vibrated (~30-80ms). Awaiting blocks the WS pipeline.
    if (score >= 9) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else if (score >= 7) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  if (s.voiceEnabled) {
    Speech.speak(`${score}`, { language: lang === 'sr-Latn' ? 'sr-RS' : 'en-US' });
  }
};
