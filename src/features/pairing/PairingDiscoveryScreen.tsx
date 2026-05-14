import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { buildDemoPairing } from '@/api/demo';
import { Button, Card, Empty, Loading, Screen, ScreenHeader, Text } from '@/components';
import { usePairingStore } from '@/state/pairingStore';
import { securePairings } from '@/storage/securePairings';
import { useTheme } from '@/theme';

import { useApProbe } from './useApProbe';
import { useMdnsDiscovery } from './useMdnsDiscovery';

type Props = {
  onCandidateSelected: (baseUrl: string, displayName: string) => void;
  onManual: () => void;
  onWifiInstructions: () => void;
  onPaired?: () => void;
  /** Optional dismiss handler shown as a back arrow in the header. */
  onCancel?: () => void;
};

export const PairingDiscoveryScreen = ({
  onCandidateSelected,
  onManual,
  onWifiInstructions,
  onPaired,
  onCancel,
}: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { services, scanning } = useMdnsDiscovery();
  const { probe, probing, candidates } = useApProbe();
  const upsert = usePairingStore((s) => s.upsert);
  const setActive = usePairingStore((s) => s.setActive);

  const useDemo = async () => {
    const demo = buildDemoPairing();
    await securePairings.upsert(demo);
    await securePairings.setActiveId(demo.id);
    upsert(demo);
    setActive(demo);
    onPaired?.();
  };

  return (
    <Screen testID="pairing-discovery">
      <ScreenHeader
        title={t('pairing.title')}
        subtitle={t('pairing.subtitle')}
        onBack={onCancel}
      />

      <ScrollView contentContainerStyle={{ gap: theme.spacing(3), paddingBottom: theme.spacing(6) }}>
        <Card>
          <Text variant="h3">{t('pairing.scanning')}</Text>
          <View style={[styles.row, { marginTop: theme.spacing(2) }]}>
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
          <Text variant="h3">{t('pairing.wifiInstructionsTitle')}</Text>
          <Text color="textMuted" style={{ marginTop: theme.spacing(1) }}>
            {t('pairing.wifiInstructions')}
          </Text>
          <Button
            onPress={onWifiInstructions}
            variant="secondary"
            style={{ marginTop: theme.spacing(3) }}
          >
            {t('pairing.openWifiSettings')}
          </Button>
        </Card>

        <Button onPress={onManual} variant="ghost">
          {t('pairing.manualIp')}
        </Button>

        <Card style={{ borderStyle: 'dashed' }}>
          <Text variant="h3">{t('pairing.demoTitle')}</Text>
          <Text color="textMuted" style={{ marginTop: theme.spacing(1) }}>
            {t('pairing.demoBody')}
          </Text>
          <Button
            onPress={() => void useDemo()}
            variant="primary"
            testID="pairing-use-demo"
            style={{ marginTop: theme.spacing(3) }}
          >
            {t('pairing.useDemo')}
          </Button>
        </Card>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
