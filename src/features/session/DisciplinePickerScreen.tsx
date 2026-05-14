import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components';
import { useTheme } from '@/theme';

const DISCIPLINES = ['ISSF 10m Air Rifle', 'ISSF 10m Air Pistol', 'Custom', 'Free', 'Demo'];

type Props = { onPick: (discipline: string) => void; onCancel: () => void };

export const DisciplinePickerScreen = ({ onPick, onCancel }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [picked, setPicked] = useState(DISCIPLINES[0]!);

  const labelFor = (d: string): string => {
    if (d === 'Free') return t('disciplines.free');
    if (d === 'Demo') return t('disciplines.demo');
    return d;
  };

  return (
    <Screen>
      <Text variant="h2">{t('session.discipline')}</Text>
      {DISCIPLINES.map((d) => (
        <Card key={d}>
          <View style={styles.row}>
            <Text variant="bodyBold">{labelFor(d)}</Text>
            <Button
              onPress={() => setPicked(d)}
              variant={picked === d ? 'primary' : 'ghost'}
              testID={`discipline-${d}`}
            >
              {picked === d ? '✓' : t('common.next')}
            </Button>
          </View>
        </Card>
      ))}

      <View style={[styles.row, { marginTop: theme.spacing(2) }]}>
        <Button onPress={onCancel} variant="secondary">
          {t('common.cancel')}
        </Button>
        <Button onPress={() => onPick(picked)} testID="discipline-confirm">
          {t('home.startSession')}
        </Button>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
