import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Button, Card, Screen, Text } from '@/components';
import { useTheme } from '@/theme';

type Props = {
  onConfirm: (config: { shotsPerTarget: number }) => void;
  onCancel: () => void;
};

const clampInt = (raw: string, min: number, max: number, fallback: number): number => {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

export const FreeSessionConfigScreen = ({ onConfirm, onCancel }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [shotsPerTargetText, setShotsPerTargetText] = useState('5');

  const submit = () => {
    const shotsPerTarget = clampInt(shotsPerTargetText, 1, 50, 5);
    onConfirm({ shotsPerTarget });
  };

  return (
    <Screen testID="free-config">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ gap: theme.spacing(3), paddingBottom: theme.spacing(8) }}>
          <Text variant="h1">{t('free.title')}</Text>
          <Text color="textMuted">{t('free.subtitle')}</Text>

          <Card>
            <Field
              label={t('free.shotsPerTargetLabel')}
              value={shotsPerTargetText}
              onChange={setShotsPerTargetText}
              keyboardType="number-pad"
              testID="free-shots-per-target"
            />
            <Text variant="caption" color="textMuted" style={{ marginTop: theme.spacing(1) }}>
              {t('free.shotsPerTargetHint')}
            </Text>
          </Card>

          <Card>
            <Text variant="caption" color="textMuted">
              {t('free.openEndedLabel')}
            </Text>
            <Text variant="bodyBold" style={{ marginTop: theme.spacing(1) }}>
              {t('free.openEndedValue')}
            </Text>
          </Card>

          <View style={[styles.row, { marginTop: theme.spacing(2) }]}>
            <Button onPress={onCancel} variant="secondary">
              {t('common.cancel')}
            </Button>
            <Button onPress={submit} testID="free-confirm">
              {t('home.startSession')}
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
};

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  testID?: string;
};

const Field = ({ label, value, onChange, keyboardType, testID }: FieldProps) => {
  const theme = useTheme();
  return (
    <View>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoCorrect={false}
        accessibilityLabel={label}
        testID={testID}
        placeholderTextColor={theme.colors.textMuted}
        style={[
          styles.input,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
            padding: theme.spacing(3),
            marginTop: theme.spacing(1),
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth, fontSize: 16, minHeight: 44 },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
});
