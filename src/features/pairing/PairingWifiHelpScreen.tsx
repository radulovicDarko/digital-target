import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Screen, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';

type Props = { onBack: () => void };

export const PairingWifiHelpScreen = ({ onBack }: Props) => {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  const setUser = useAuthStore((s) => s.setUser);
  const exitGuest = useAuthStore((s) => s.exitGuest);

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
      {authLabel ? (
        <Button onPress={onAuthPress} variant="ghost" testID="pairing-auth-action">
          {authLabel}
        </Button>
      ) : null}
    </Screen>
  );
};
