import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, PasswordInput, Screen, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';
import { userStore } from '@/storage/users';
import { useTheme } from '@/theme';

type Props = { onCancel: () => void };

export const ResetPasswordScreen = ({ onCancel }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const setUser = useAuthStore((s) => s.setUser);

  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !newPassword) {
      Alert.alert(t('common.error'), t('auth.fillFields'));
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert(t('common.error'), t('auth.passwordTooShort'));
      return;
    }
    setBusy(true);
    try {
      const user = await userStore.resetPassword(email, newPassword);
      await userStore.setCurrentId(user.id);
      setUser(user);
    } catch (e) {
      const msg =
        e instanceof Error && e.message === 'NOT_FOUND'
          ? t('auth.invalidCredentials')
          : t('auth.unknown');
      Alert.alert(t('common.error'), msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="reset-password">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, gap: theme.spacing(3) }}
      >
        <Text variant="h1">{t('auth.resetTitle')}</Text>
        <Text color="textMuted">{t('auth.resetSubtitle')}</Text>

        <Card>
          <Field
            label={t('auth.email')}
            value={email}
            onChange={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            testID="reset-email"
          />
          <PasswordInput
            label={t('auth.newPassword')}
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            testID="reset-new-password"
          />
        </Card>

        <Button onPress={() => void submit()} loading={busy} testID="reset-submit">
          {t('auth.resetButton')}
        </Button>

        <Button onPress={onCancel} variant="ghost">
          {t('common.cancel')}
        </Button>
      </KeyboardAvoidingView>
    </Screen>
  );
};

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'words';
  secure?: boolean;
  testID?: string;
};

const Field = ({ label, value, onChange, keyboardType, autoCapitalize, secure, testID }: FieldProps) => {
  const theme = useTheme();
  return (
    <View style={{ marginTop: theme.spacing(2) }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        secureTextEntry={secure}
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
});
