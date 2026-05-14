import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { ApiError, pairExchange, pairProbe } from '@/api/client';
import { Button, Card, ErrorState, Loading, Screen, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';
import { usePairingStore } from '@/state/pairingStore';
import { logger } from '@/storage/logger';
import { securePairings } from '@/storage/securePairings';
import { useTheme } from '@/theme';
import type { PairingRecord } from '@/types/pairing';

type Props = {
  baseUrl: string;
  displayName: string;
  onPaired: (record: PairingRecord) => void;
  onBack: () => void;
};

const wsUrlFromBaseUrl = (baseUrl: string): string => {
  if (baseUrl.startsWith('https://')) return `wss://${baseUrl.slice('https://'.length)}/ws/hits`;
  if (baseUrl.startsWith('http://')) return `ws://${baseUrl.slice('http://'.length)}/ws/hits`;
  return `${baseUrl}/ws/hits`;
};

const fakeFingerprintFor = (baseUrl: string): string => {
  // Best-effort: in managed workflow we cannot read the leaf cert. We use the
  // base URL hash as a placeholder; on first pair it is captured & re-checked
  // each foreground (see ARCHITECTURE.md §3 / DECISIONS.md D5).
  let h = 0;
  for (let i = 0; i < baseUrl.length; i += 1) {
    h = (h * 31 + baseUrl.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

export const PairingTrustScreen = ({ baseUrl, displayName, onPaired, onBack }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  const setUser = useAuthStore((s) => s.setUser);
  const exitGuest = useAuthStore((s) => s.exitGuest);
  const upsert = usePairingStore((s) => s.upsert);
  const setActive = usePairingStore((s) => s.setActive);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const h = await pairProbe(baseUrl);
        if (!alive) return;
        setVersion(h.version);
        setFingerprint(fakeFingerprintFor(baseUrl));
      } catch (e) {
        if (!alive) return;
        const code = e instanceof ApiError ? e.code : 'network';
        setError(t(`errors.${code}`, { defaultValue: t('errors.network') }));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [baseUrl, t]);

  const trust = async () => {
    try {
      const exchange = await pairExchange(baseUrl);
      const record: PairingRecord = {
        id: exchange.device_id,
        name: exchange.device_name || displayName,
        baseUrl,
        wsUrl: wsUrlFromBaseUrl(baseUrl),
        token: exchange.token,
        fingerprint,
        pairedAt: Date.now(),
        calibrationConfirmedAt: null,
      };
      await securePairings.upsert(record);
      await securePairings.setActiveId(record.id);
      upsert(record);
      setActive(record);
      void logger.info('pair', `paired ${record.id}`);
      onPaired(record);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      Alert.alert(t('common.error'), t(`errors.${code}`, { defaultValue: t('errors.network') }));
    }
  };

  const authLabel = guest ? t('auth.loginButton') : user ? t('auth.logout') : null;
  const onAuthPress = () => {
    if (guest) {
      exitGuest();
      return;
    }
    if (user) {
      setUser(null);
    }
  };

  if (loading) return <Loading label={t('common.loading')} />;
  if (error) return <ErrorState message={error} onRetry={onBack} />;

  return (
    <Screen testID="pairing-trust">
      <Text variant="h2">{t('pairing.trustTitle')}</Text>
      <Text color="textMuted">{t('pairing.trustBody')}</Text>

      <Card style={{ marginTop: theme.spacing(2) }}>
        <Text variant="bodyBold">{displayName}</Text>
        <Text color="textMuted">{baseUrl}</Text>
        {version ? <Text color="textMuted">{`v${version}`}</Text> : null}
        <View style={{ marginTop: theme.spacing(2) }}>
          <Text variant="caption" color="textMuted">
            Fingerprint
          </Text>
          <Text variant="mono">{fingerprint ?? '—'}</Text>
        </View>
      </Card>

      <View style={[styles.row, { marginTop: theme.spacing(3) }]}>
        <Button onPress={onBack} variant="secondary">
          {t('common.back')}
        </Button>
        <Button onPress={trust} testID="pairing-trust-confirm">
          {t('pairing.trustButton')}
        </Button>
      </View>

      {authLabel ? (
        <Button
          onPress={onAuthPress}
          variant="ghost"
          style={{ marginTop: theme.spacing(2) }}
          testID="pairing-auth-action"
        >
          {authLabel}
        </Button>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
});
