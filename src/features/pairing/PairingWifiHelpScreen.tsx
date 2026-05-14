import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Screen, Text } from '@/components';

type Props = { onBack: () => void };

export const PairingWifiHelpScreen = ({ onBack }: Props) => {
  const { t } = useTranslation();
  return (
    <Screen scroll>
      <Text variant="h2">{t('pairing.wifiInstructionsTitle')}</Text>
      <Card>
        <Text>{t('pairing.wifiInstructions')}</Text>
      </Card>
      <Button onPress={() => void Linking.openSettings()}>{t('pairing.openWifiSettings')}</Button>
      <Button onPress={onBack} variant="secondary">
        {t('common.back')}
      </Button>
    </Screen>
  );
};
