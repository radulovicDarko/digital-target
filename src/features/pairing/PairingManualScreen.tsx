import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components';
import { useTheme } from '@/theme';

type Props = {
  onSubmit: (baseUrl: string) => void;
  onCancel: () => void;
};

export const PairingManualScreen = ({ onSubmit, onCancel }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [host, setHost] = useState('192.168.4.1');
  const [https, setHttps] = useState(false);

  const submit = () => {
    const proto = https ? 'https' : 'http';
    onSubmit(`${proto}://${host.trim()}`);
  };

  return (
    <Screen>
      <Text variant="h2">{t('pairing.manualIp')}</Text>
      <Card>
        <TextInput
          value={host}
          onChangeText={setHost}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          placeholder="192.168.4.1"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="IP address"
          testID="pairing-manual-ip"
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceAlt,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              padding: theme.spacing(3),
            },
          ]}
        />
        <View style={[styles.row, { marginTop: theme.spacing(2) }]}>
          <Button onPress={() => setHttps((v) => !v)} variant="ghost">
            {https ? 'HTTPS ✓' : 'HTTPS ✗'}
          </Button>
        </View>
      </Card>

      <View style={[styles.row, { marginTop: theme.spacing(2) }]}>
        <Button onPress={onCancel} variant="secondary">
          {t('common.cancel')}
        </Button>
        <Button onPress={submit} testID="pairing-manual-submit">
          {t('common.next')}
        </Button>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth, fontSize: 18 },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
});
