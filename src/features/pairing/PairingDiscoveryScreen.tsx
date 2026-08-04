import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Empty, Loading, Screen, ScreenHeader, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';
import { useTheme } from '@/theme';

import { useApProbe } from './useApProbe';
import { useMdnsDiscovery } from './useMdnsDiscovery';

/**
 * Turn free-form user input into a base URL the pairing handshake can use.
 * Accepts things like "192.168.4.1", "192.168.4.1:8080", "http://host",
 * "etarget-1.local". Defaults to http:// and port 8080 (the Pi's default)
 * when the user omits them. Returns null when the input can't be a host.
 */
const toBaseUrl = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    if (!url.port) url.port = '8080';
    // Strip any trailing path/query the user may have pasted.
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
};

type Props = {
  onCandidateSelected: (baseUrl: string, displayName: string) => void;
  onWifiInstructions: () => void;
  /** Optional dismiss handler shown as a back arrow in the header. */
  onCancel?: () => void;
};

export const PairingDiscoveryScreen = ({
  onCandidateSelected,
  onWifiInstructions,
  onCancel,
}: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  const setUser = useAuthStore((s) => s.setUser);
  const exitGuest = useAuthStore((s) => s.exitGuest);
  const { services, scanning } = useMdnsDiscovery();
  const { probe, probing, candidates } = useApProbe();

  const [manualIp, setManualIp] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const onManualSubmit = () => {
    const baseUrl = toBaseUrl(manualIp);
    if (!baseUrl) {
      setManualError(t('pairing.manualIpInvalid'));
      return;
    }
    setManualError(null);
    onCandidateSelected(baseUrl, manualIp.trim());
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

  useEffect(() => {
    void probe();
    // probe is stable (useCallback) but include it for correctness.
  }, [probe]);

  // Keep looking automatically. When the user lands here right after joining
  // the Range Wi-Fi, the association / DHCP lease may not be ready on the very
  // first probe. Re-probe on an interval until we find something, so the
  // device shows up on its own with no taps.
  useEffect(() => {
    if (candidates.length > 0 || services.length > 0) return undefined;
    const id = setInterval(() => {
      void probe();
    }, 3000);
    return () => clearInterval(id);
  }, [probe, candidates.length, services.length]);

  // As soon as exactly one Range is discovered (and no ambiguity), advance
  // straight to the trust step — nothing for the user to pick or type.
  const autoAdvancedRef = useRef(false);
  useEffect(() => {
    if (autoAdvancedRef.current) return;
    if (services.length === 0 && candidates.length === 1) {
      autoAdvancedRef.current = true;
      const c = candidates[0];
      onCandidateSelected(c.baseUrl, c.name);
    }
  }, [candidates, services.length, onCandidateSelected]);

  return (
    <Screen testID="pairing-discovery">
      <ScreenHeader
        title={t('pairing.title')}
        subtitle={t('pairing.subtitle')}
        onBack={onCancel}
        right={
          authLabel ? (
            <Pressable
              onPress={onAuthPress}
              accessibilityRole="button"
              hitSlop={theme.hitSlop}
              style={({ pressed }) => [
                {
                  opacity: pressed ? 0.7 : 1,
                  paddingHorizontal: theme.spacing(2),
                  paddingVertical: theme.spacing(1),
                },
              ]}
              testID="pairing-auth-action"
            >
              <Text variant="bodyBold" color="primary">
                {authLabel}
              </Text>
            </Pressable>
          ) : null
        }
      />

      <ScrollView contentContainerStyle={{ gap: theme.spacing(3), paddingBottom: theme.spacing(6) }}>
        <Card>
          <Text variant="h3">{t('pairing.wifiInstructionsTitle')}</Text>
          <Text color="textMuted" style={{ marginTop: theme.spacing(1) }}>
            {t('pairing.wifiInstructions')}
          </Text>
          <Button
            onPress={onWifiInstructions}
            variant="primary"
            style={{ marginTop: theme.spacing(3) }}
          >
            {t('pairing.openWifiSettings')}
          </Button>
        </Card>

        <Card>
          <View style={styles.rowBetween}>
            <Text variant="h3">{t('pairing.scanning')}</Text>
            <Button onPress={() => void probe()} variant="secondary" testID="pairing-rescan">
              {t('pairing.rescan')}
            </Button>
          </View>

          {scanning || probing ? <Loading /> : null}

          {services.length === 0 && candidates.length === 0 && !scanning && !probing ? (
            <Empty title={t('common.empty')} subtitle={t('pairing.wifiInstructions')} />
          ) : null}

          {services.map((s) => (
            <Card key={`mdns-${s.name}`} style={{ marginTop: theme.spacing(2) }}>
              <Text variant="bodyBold">{s.name}</Text>
              <Text color="textMuted">{`${s.host}:${s.port}`}</Text>
              <Button
                onPress={() =>
                  onCandidateSelected(
                    `https://${s.addresses[0] ?? s.host}:${s.port}`,
                    s.name,
                  )
                }
                style={{ marginTop: theme.spacing(2) }}
              >
                {t('common.next')}
              </Button>
            </Card>
          ))}

          {candidates.map((c) => (
            <Card key={`ap-${c.baseUrl}`} style={{ marginTop: theme.spacing(2) }}>
              <Text variant="bodyBold">{c.name}</Text>
              <Text color="textMuted">{`${c.baseUrl} • v${c.version}`}</Text>
              <Button
                onPress={() => onCandidateSelected(c.baseUrl, c.name)}
                style={{ marginTop: theme.spacing(2) }}
                testID={`pairing-candidate-${c.baseUrl}`}
              >
                {t('common.next')}
              </Button>
            </Card>
          ))}
        </Card>

        <Card>
          <Text variant="h3">{t('pairing.manualIp')}</Text>
          <Text color="textMuted" style={{ marginTop: theme.spacing(1) }}>
            {t('pairing.manualIpHint')}
          </Text>
          <TextInput
            value={manualIp}
            onChangeText={(v) => {
              setManualIp(v);
              if (manualError) setManualError(null);
            }}
            onSubmitEditing={onManualSubmit}
            placeholder={t('pairing.manualIpPlaceholder')}
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            returnKeyType="go"
            accessibilityLabel={t('pairing.manualIp')}
            testID="pairing-manual-ip"
            style={[
              styles.input,
              {
                backgroundColor: theme.colors.surfaceAlt,
                borderColor: manualError ? theme.colors.danger : theme.colors.border,
                borderRadius: theme.radius.md,
                color: theme.colors.text,
                marginTop: theme.spacing(2),
                paddingHorizontal: theme.spacing(3),
              },
            ]}
          />
          {manualError ? (
            <Text color="danger" variant="caption" style={{ marginTop: theme.spacing(1) }}>
              {manualError}
            </Text>
          ) : null}
          <Button
            onPress={onManualSubmit}
            variant="secondary"
            style={{ marginTop: theme.spacing(2) }}
            testID="pairing-manual-submit"
          >
            {t('pairing.manualIpConnect')}
          </Button>
        </Card>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  input: { borderWidth: StyleSheet.hairlineWidth, fontSize: 16, minHeight: 44, paddingVertical: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
});
