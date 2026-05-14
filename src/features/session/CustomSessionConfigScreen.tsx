import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
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
  onConfirm: (config: {
    name: string;
    shotsPerTarget: number;
    targetsPerSession: number;
  }) => void;
  onCancel: () => void;
};

const clampInt = (raw: string, min: number, max: number, fallback: number): number => {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

export const CustomSessionConfigScreen = ({ onConfirm, onCancel }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [name, setName] = useState('Custom');
  const [shotsPerTargetText, setShotsPerTargetText] = useState('5');
  const [targetsText, setTargetsText] = useState('5');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('custom.nameRequired'));
      return;
    }
    const shotsPerTarget = clampInt(shotsPerTargetText, 1, 50, 5);
    const targetsPerSession = clampInt(targetsText, 1, 50, 5);
    onConfirm({ name: trimmed, shotsPerTarget, targetsPerSession });
  };

  const totalShots =
    clampInt(shotsPerTargetText, 1, 50, 5) * clampInt(targetsText, 1, 50, 5);

  return (
    <Screen testID="custom-config">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ gap: theme.spacing(3), paddingBottom: theme.spacing(8) }}>
          <Text variant="h1">{t('custom.title')}</Text>
          <Text color="textMuted">{t('custom.subtitle')}</Text>

          <Card>
            <Field
              label={t('custom.nameLabel')}
              value={name}
              onChange={setName}
              autoCapitalize="words"
              testID="custom-name"
            />
          </Card>

          <Card>
            <Field
              label={t('custom.targetsLabel')}
              value={targetsText}
              onChange={setTargetsText}
              keyboardType="number-pad"
              testID="custom-targets"
            />
            <Text variant="caption" color="textMuted" style={{ marginTop: theme.spacing(1) }}>
              {t('custom.targetsHint')}
            </Text>
          </Card>

          <Card>
            <Field
              label={t('custom.shotsPerTargetLabel')}
              value={shotsPerTargetText}
              onChange={setShotsPerTargetText}
              keyboardType="number-pad"
              testID="custom-shots-per-target"
            />
            <Text variant="caption" color="textMuted" style={{ marginTop: theme.spacing(1) }}>
              {t('custom.shotsPerTargetHint')}
            </Text>
          </Card>

          <Card>
            <Text variant="caption" color="textMuted">
              {t('custom.totalShotsLabel')}
            </Text>
            <Text variant="h2" style={{ marginTop: theme.spacing(1) }}>
              {totalShots}
            </Text>
          </Card>

          <View style={[styles.row, { marginTop: theme.spacing(2) }]}>
            <Button onPress={onCancel} variant="secondary">
              {t('common.cancel')}
            </Button>
            <Button onPress={submit} testID="custom-confirm">
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
  autoCapitalize?: 'none' | 'words';
  testID?: string;
};

const Field = ({ label, value, onChange, keyboardType, autoCapitalize, testID }: FieldProps) => {
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
        autoCapitalize={autoCapitalize}
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
