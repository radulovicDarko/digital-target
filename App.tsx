import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';

import { RootNavigator } from '@/navigation';
import { buildDemoPairing, hydrateDemoState } from '@/api/demo';
import { primeSounds } from '@/features/session/sounds';
import { useAuthStore } from '@/state/authStore';
import { usePairingStore } from '@/state/pairingStore';
import { useSettingsStore } from '@/state/settingsStore';
import { logger } from '@/storage/logger';
import { preferencesStorage } from '@/storage/preferences';
import { securePairings } from '@/storage/securePairings';
import { userStore } from '@/storage/users';
import { ThemeProvider } from '@/theme';
import type { PairingRecord } from '@/types/pairing';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
    mutations: { retry: 0 },
  },
});

const App = () => {
  const setKnown = usePairingStore((s) => s.setKnown);
  const setActive = usePairingStore((s) => s.setActive);
  const setUser = useAuthStore((s) => s.setUser);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Hydrate persisted user preferences (theme + language) FIRST so the
        // very first render uses the saved values instead of flashing the
        // default English/system theme.
        const prefs = await preferencesStorage.load();
        hydrateSettings(prefs);
        if (prefs.lang && prefs.lang !== i18next.language) {
          await i18next.changeLanguage(prefs.lang);
        }

        const records = await securePairings.list();
        // Migration: rewrite any persisted demo pairing so its baseUrl/wsUrl
        // are the safe `demo://local` placeholders. Older builds stored the
        // dev-time HTTP URL of the Mac running the Python control server,
        // which would now incorrectly trigger real HTTP fetches.
        const demo = buildDemoPairing();
        const migrated: PairingRecord[] = [];
        for (const r of records) {
          if (
            r.id === demo.id &&
            (r.baseUrl !== demo.baseUrl || r.wsUrl !== demo.wsUrl)
          ) {
            const fresh: PairingRecord = {
              ...r,
              baseUrl: demo.baseUrl,
              wsUrl: demo.wsUrl,
              token: demo.token,
              fingerprint: demo.fingerprint,
            };
            await securePairings.upsert(fresh);
            migrated.push(fresh);
          } else {
            migrated.push(r);
          }
        }
        setKnown(migrated);
        const activeId = await securePairings.getActiveId();
        const active = activeId ? migrated.find((r) => r.id === activeId) ?? null : null;
        setActive(active);

        // Hydrate demo session storage so History shows previous demo
        // sessions immediately on cold start. Cheap (one SecureStore read)
        // and no-op when there's no demo data.
        await hydrateDemoState();

        // Warm up the audio bridge in the background so the very first
        // hit of the first session doesn't pay the bridge round-trip
        // (which is most painful on cold app start).
        primeSounds();

        const currentId = await userStore.getCurrentId();
        if (currentId) {
          const user = await userStore.getById(currentId);
          setUser(user);
        }

        await logger.prune();
      } catch (e) {
        void logger.warn('app', `bootstrap: ${String(e)}`);
      } finally {
        setHydrated(true);
      }
    })();
  }, [setActive, setKnown, setUser, hydrateSettings]);

  if (!hydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <RootNavigator />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

export default App;
