import * as SecureStore from 'expo-secure-store';

import { logger } from './logger';

/**
 * Persisted user preferences (theme, language, units, sound/voice/haptics,
 * idle-end timer, privacy opt-ins). Stored as a single JSON blob in
 * SecureStore so it survives app cold-starts.
 *
 * SecureStore is overkill for non-sensitive prefs but it's the only KV
 * primitive already available in this app (no AsyncStorage dep). The
 * iOS Keychain / Android Keystore handle a small JSON blob fine.
 */

const KEY = 'shooterrange.preferences.v1';

export type StoredPreferences = {
  theme?: 'system' | 'light' | 'dark';
  units?: 'mm' | 'inch';
  lang?: 'en' | 'sr-Latn';
  soundEnabled?: boolean;
  voiceEnabled?: boolean;
  hapticsEnabled?: boolean;
  idleEndMinutes?: number;
  analyticsOptIn?: boolean;
  crashReportsOptIn?: boolean;
};

export const preferencesStorage = {
  async load(): Promise<StoredPreferences> {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as StoredPreferences;
    } catch (e) {
      void logger.warn('prefs', `load failed: ${String(e)}`);
      return {};
    }
  },
  async save(prefs: StoredPreferences): Promise<void> {
    try {
      await SecureStore.setItemAsync(KEY, JSON.stringify(prefs));
    } catch (e) {
      void logger.warn('prefs', `save failed: ${String(e)}`);
    }
  },
};
