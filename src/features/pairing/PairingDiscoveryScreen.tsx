import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Empty, Loading, Screen, ScreenHeader, Text } from '@/components';
import { useTheme } from '@/theme';

import { useApProbe } from './useApProbe';
import { useMdnsDiscovery } from './useMdnsDiscovery';

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
  const { services, scanning } = useMdnsDiscovery();
  const { probe, probing, candidates } = useApProbe();

  useEffect(() => {
    void probe();
    // probe is stable (useCallback) but include it for correctness.
  }, [probe]);

  return (
    <Screen testID="pairing-discovery">
      <ScreenHeader
        title={t('pairing.title')}
        subtitle={t('pairing.subtitle')}
        onBack={onCancel}
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
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
});
