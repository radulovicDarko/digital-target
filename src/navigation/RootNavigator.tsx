import { useEffect, useMemo, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthFlow } from '@/features/auth';
import { CalibrationScreen } from '@/features/calibration';
import { SessionDetailScreen } from '@/features/history';
import { PairingWizard } from '@/features/pairing';
import { ProfileScreen } from '@/features/profile';
import { closeSharedWsClient, getOrCreateSharedWsClient } from '@/api/sharedWs';
import { Button, Loading, Screen, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';
import { usePairingStore } from '@/state/pairingStore';
import { getOrCreateClientId } from '@/storage/clientId';
import { logger } from '@/storage/logger';
import { securePairings } from '@/storage/securePairings';
import { useTheme } from '@/theme';
import { darkTheme, lightTheme } from '@/theme/tokens';

import { SessionFlowNavigator } from './SessionFlowNavigator';
import { TabsNavigator } from './TabsNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = (scheme: 'light' | 'dark') => {
  const t = scheme === 'light' ? lightTheme : darkTheme;
  return {
    dark: scheme === 'dark',
    colors: {
      primary: t.colors.primary,
      background: t.colors.bg,
      card: t.colors.surface,
      text: t.colors.text,
      border: t.colors.border,
      notification: t.colors.danger,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' as const },
      medium: { fontFamily: 'System', fontWeight: '500' as const },
      bold: { fontFamily: 'System', fontWeight: '700' as const },
      heavy: { fontFamily: 'System', fontWeight: '900' as const },
    },
  };
};

export const RootNavigator = () => {
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  const active = usePairingStore((s) => s.active);
  const setActive = usePairingStore((s) => s.setActive);
  const upsertPairing = usePairingStore((s) => s.upsert);
  const [attached, setAttached] = useState(false);
  const [attachAttempt, setAttachAttempt] = useState(0);
  const [clientId, setClientId] = useState<string | null>(null);
  const [attachInfo, setAttachInfo] = useState<{
    kind: 'elsewhere' | 'self';
    remainingS?: number;
  } | null>(null);

  // If pairing is cleared (or user logs out), ensure the global WS is closed
  // so the Range isn't left "attached" by a stale socket.
  useEffect(() => {
    if (active) return;
    closeSharedWsClient();
  }, [active]);

  const baseUrl = active?.baseUrl;

  const healthUrl = useMemo(() => {
    if (!baseUrl) return null;
    return `${baseUrl.replace(/\/$/, '')}/api/health`;
  }, [baseUrl]);

  // While we're not attached, poll /api/health to show a clearer reason
  // when the Range is already attached to another device.
  useEffect(() => {
    setAttachInfo(null);
    if (!healthUrl) return undefined;
    if (attached) return undefined;
    if (!clientId) return undefined;

    let cancelled = false;
    const tick = async () => {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 2500);
      try {
        const r = await fetch(healthUrl, { signal: ac.signal });
        if (!r.ok) return;
        const body = (await r.json()) as {
          ws?: {
            attached?: boolean;
            last_seen_age_s?: number | null;
            timeout_s?: number;
            client_id?: string | null;
          };
        };
        if (cancelled) return;
        const ws = body.ws;
        const alreadyAttached = !!ws?.attached;
        if (!alreadyAttached) {
          setAttachInfo(null);
          return;
        }
        const attachedClientId = ws?.client_id ?? null;
        const kind: 'elsewhere' | 'self' =
          attachedClientId && attachedClientId === clientId ? 'self' : 'elsewhere';
        const age = ws?.last_seen_age_s ?? null;
        const timeoutS = ws?.timeout_s ?? null;
        const remainingS =
          age != null && timeoutS != null ? Math.max(0, Math.round(timeoutS - age)) : undefined;
        setAttachInfo({ kind, remainingS });
      } catch {
        // ignore — WS will keep trying; this is just for UX hints
      } finally {
        clearTimeout(timeout);
      }
    };

    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [attached, clientId, healthUrl, attachAttempt]);

  // Global WS connection: keep a single shared socket open once the user has
  // a paired device. This makes hit streaming more reliable and avoids
  // multiple screens racing to open/close their own WS.
  useEffect(() => {
    setAttached(false);
    if (!active) return undefined;

    let cancelled = false;
    let ws: ReturnType<typeof getOrCreateSharedWsClient> = null;

    const start = async () => {
      const clientId = await getOrCreateClientId();
      if (cancelled) return;
      setClientId(clientId);
      ws = getOrCreateSharedWsClient(active, clientId);
      if (!ws) {
        // Demo pairing: treat as attached.
        setAttached(true);
        return;
      }

      // Lightweight guard: if the Range is already attached to a different
      // device, don't enter a WS reconnect loop (which floods journald on the Pi).
      // Keep the socket closed and rely on the user's manual Retry.
      if (healthUrl) {
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), 2500);
        try {
          const r = await fetch(healthUrl, { signal: ac.signal });
          if (r.ok) {
            const body = (await r.json()) as {
              ws?: {
                attached?: boolean;
                last_seen_age_s?: number | null;
                timeout_s?: number;
                client_id?: string | null;
              };
            };
            const w = body.ws;
            const alreadyAttached = !!w?.attached;
            const attachedClientId = w?.client_id ?? null;
            if (alreadyAttached && attachedClientId && attachedClientId !== clientId) {
              const age = w?.last_seen_age_s ?? null;
              const timeoutS = w?.timeout_s ?? null;
              const remainingS =
                age != null && timeoutS != null
                  ? Math.max(0, Math.round(timeoutS - age))
                  : undefined;
              setAttachInfo({ kind: 'elsewhere', remainingS });
              ws.close();
              return;
            }
          }
        } catch {
          // Ignore — if health probe fails, fall back to normal WS connect.
        } finally {
          clearTimeout(timeout);
        }
      }

      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[ws] root attach start', { id: active.id, wsUrl: active.wsUrl, clientId });
      }
      void logger.info('ws', `root attach start id=${active.id}`);

      const offOpen = ws.on('open', () => {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[ws] root attached');
        }
        void logger.info('ws', 'root attached');
        setAttached(true);
      });
      const offClose = ws.on('close', () => {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[ws] root detached');
        }
        void logger.info('ws', 'root detached');
        setAttached(false);
      });
      const offRec = ws.on('reconnecting', ({ attempt, nextDelayMs }) => {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[ws] root reconnecting', { attempt, nextDelayMs });
        }
        void logger.info('ws', `root reconnecting attempt=${attempt} delay=${nextDelayMs}`);
        setAttached(false);
      });

      // If the socket is already open (e.g. effect re-mounted and we missed
      // the prior 'open' event), do NOT assume we're attached — we want a
      // fresh attach on app boot so Home never renders as "connected" until
      // we actually confirm WS liveness.
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws.connect();
      // Cleanup handlers when effect reruns.
      return () => {
        offOpen();
        offClose();
        offRec();
      };
    };

    let unsub: (() => void) | undefined;
    void (async () => {
      unsub = await start();
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
    // attachAttempt is a manual retry bump.
  }, [active, attachAttempt]);

  const clearActivePairing = async () => {
    closeSharedWsClient();
    await securePairings.setActiveId(null);
    setActive(null);
  };

  const recalibrateActive = async () => {
    if (!active) return;
    const updated = { ...active, calibrationConfirmedAt: null };
    await securePairings.upsert(updated);
    upsertPairing(updated);
    setActive(updated);
  };

  const AttachGate = ({
    onManage,
  }: {
    onManage: () => void | Promise<void>;
  }) => (
    <Screen testID="attach">
      <Text variant="h2">Connecting to Range…</Text>
      <Loading label="Waiting for WebSocket attach" />
      {attachInfo?.kind === 'elsewhere' ? (
        <Text color="textMuted" style={{ textAlign: 'center' }}>
          {attachInfo.remainingS != null
            ? `Already attached on another device. Retry in ~${attachInfo.remainingS}s or close it there.`
            : 'Already attached on another device. Close it there, then retry.'}
        </Text>
      ) : null}
      {attachInfo?.kind === 'self' ? (
        <Text color="textMuted" style={{ textAlign: 'center' }}>
          Reconnecting on this device…
        </Text>
      ) : null}
      <Button variant="secondary" onPress={() => setAttachAttempt((x) => x + 1)}>
        Retry
      </Button>
      <Button variant="ghost" onPress={() => void onManage()}>
        Manage Pairing
      </Button>
    </Screen>
  );

  return (
    <NavigationContainer theme={navTheme(theme.scheme)}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user && !guest ? (
          <Stack.Screen name="Auth" component={AuthFlow} />
        ) : !active ? (
          <Stack.Screen name="Pairing">
            {() => <PairingWizard onCompleted={() => null} />}
          </Stack.Screen>
        ) : !active.calibrationConfirmedAt ? (
          <Stack.Screen name="Calibration">
            {() =>
              attached ? (
                <CalibrationScreen onCompleted={() => null} />
              ) : (
                <AttachGate onManage={clearActivePairing} />
              )
            }
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Tabs">
              {({ navigation }) => (
                attached ? (
                  <TabsNavigator
                    onStartSession={() => {
                      if (__DEV__) {
                        // eslint-disable-next-line no-console
                        console.log('[nav] onStartSession');
                      }
                      void logger.info('nav', 'onStartSession');
                      navigation.navigate('SessionFlow', { screen: 'DisciplinePicker' });
                    }}
                    onManagePis={() => {
                      if (__DEV__) {
                        // eslint-disable-next-line no-console
                        console.log('[nav] onManagePis');
                      }
                      void logger.info('nav', 'onManagePis');
                      navigation.navigate('Pairing');
                    }}
                    onDisconnect={() => {
                      void (async () => {
                        await clearActivePairing();
                        navigation.navigate('Pairing');
                      })();
                    }}
                    onRecalibrate={() => {
                      void (async () => {
                        await recalibrateActive();
                      })();
                    }}
                    onOpenSession={(sessionId) => {
                      if (__DEV__) {
                        // eslint-disable-next-line no-console
                        console.log('[nav] onOpenSession', { sessionId });
                      }
                      void logger.info('nav', `onOpenSession sessionId=${sessionId}`);
                      navigation.navigate('SessionDetail', { sessionId });
                    }}
                  />
                ) : (
                  <AttachGate onManage={() => navigation.navigate('Pairing')} />
                )
              )}
            </Stack.Screen>
            <Stack.Screen
              name="SessionDetail"
              options={{ presentation: 'modal' }}
            >
              {({ navigation, route }) => (
                <SessionDetailScreen
                  sessionId={route.params.sessionId}
                  onClose={() => navigation.goBack()}
                />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="Profile"
              options={{ presentation: 'modal' }}
            >
              {({ navigation }) => (
                <ProfileScreen onClose={() => navigation.goBack()} />
              )}
            </Stack.Screen>
            <Stack.Screen name="SessionFlow">
              {({ navigation }) => (
                <SessionFlowNavigator
                  onExit={() => navigation.navigate('Tabs', { screen: 'Home' })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Pairing">
              {({ navigation }) => (
                <PairingWizard
                  onCompleted={() => navigation.navigate('Tabs', { screen: 'Home' })}
                  onCancel={() => navigation.goBack()}
                />
              )}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
