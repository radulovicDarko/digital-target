import { create } from 'zustand';

import { preferencesStorage, type StoredPreferences } from '@/storage/preferences';
import type { ColorScheme } from '@/theme/tokens';

export type ThemePref = ColorScheme | 'system';
export type Units = 'mm' | 'inch';
export type Lang = 'en' | 'sr-Latn';

type SettingsState = {
  /** Has the persisted snapshot been loaded? Other code (e.g. App.tsx) waits
   *  on this so the very first render uses the user's saved theme/language
   *  instead of flashing the defaults. */
  hydrated: boolean;
  theme: ThemePref;
  units: Units;
  lang: Lang;
  soundEnabled: boolean;
  voiceEnabled: boolean;
  hapticsEnabled: boolean;
  idleEndMinutes: number;
  analyticsOptIn: boolean;
  crashReportsOptIn: boolean;
  setTheme: (t: ThemePref) => void;
  setUnits: (u: Units) => void;
  setLang: (l: Lang) => void;
  setSoundEnabled: (v: boolean) => void;
  setVoiceEnabled: (v: boolean) => void;
  setHapticsEnabled: (v: boolean) => void;
  setIdleEndMinutes: (v: number) => void;
  setAnalyticsOptIn: (v: boolean) => void;
  setCrashReportsOptIn: (v: boolean) => void;
  /** Replace the in-memory state with a persisted snapshot. Marks `hydrated`. */
  hydrate: (prefs: StoredPreferences) => void;
};

const PERSISTED_KEYS = [
  'theme',
  'units',
  'lang',
  'soundEnabled',
  'voiceEnabled',
  'hapticsEnabled',
  'idleEndMinutes',
  'analyticsOptIn',
  'crashReportsOptIn',
] as const;

const snapshot = (s: SettingsState): StoredPreferences => ({
  theme: s.theme,
  units: s.units,
  lang: s.lang,
  soundEnabled: s.soundEnabled,
  voiceEnabled: s.voiceEnabled,
  hapticsEnabled: s.hapticsEnabled,
  idleEndMinutes: s.idleEndMinutes,
  analyticsOptIn: s.analyticsOptIn,
  crashReportsOptIn: s.crashReportsOptIn,
});

export const useSettingsStore = create<SettingsState>((set, get) => {
  // Save-on-change: any setter that touches a persisted key writes the
  // entire snapshot back to SecureStore. We don't await so UI stays snappy.
  const persist = () => {
    void preferencesStorage.save(snapshot(get()));
  };
  const setAndPersist = (patch: Partial<SettingsState>) => {
    set(patch);
    persist();
  };
  return {
    hydrated: false,
    theme: 'system',
    units: 'mm',
    lang: 'en',
    soundEnabled: true,
    voiceEnabled: false,
    hapticsEnabled: true,
    idleEndMinutes: 30,
    analyticsOptIn: false,
    crashReportsOptIn: false,
    setTheme: (theme) => setAndPersist({ theme }),
    setUnits: (units) => setAndPersist({ units }),
    setLang: (lang) => setAndPersist({ lang }),
    setSoundEnabled: (soundEnabled) => setAndPersist({ soundEnabled }),
    setVoiceEnabled: (voiceEnabled) => setAndPersist({ voiceEnabled }),
    setHapticsEnabled: (hapticsEnabled) => setAndPersist({ hapticsEnabled }),
    setIdleEndMinutes: (idleEndMinutes) => setAndPersist({ idleEndMinutes }),
    setAnalyticsOptIn: (analyticsOptIn) => setAndPersist({ analyticsOptIn }),
    setCrashReportsOptIn: (crashReportsOptIn) => setAndPersist({ crashReportsOptIn }),
    hydrate: (prefs) => {
      const patch: Partial<SettingsState> = { hydrated: true };
      for (const k of PERSISTED_KEYS) {
        const v = prefs[k];
        if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
      }
      set(patch);
    },
  };
});
