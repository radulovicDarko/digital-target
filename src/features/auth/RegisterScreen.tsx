import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, PasswordInput, Screen, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';
import { userStore } from '@/storage/users';
import { useTheme } from '@/theme';

type Props = { onGoToLogin: () => void };

export const RegisterScreen = ({ onGoToLogin }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert(t('common.error'), t('auth.fillFields'));
      return;
    }
    if (password.length < 6) {
      Alert.alert(t('common.error'), t('auth.passwordTooShort'));
      return;
    }
    setBusy(true);
    try {
      const user = await userStore.register({ email, name, password, role: 'member' });
      await userStore.setCurrentId(user.id);
      setUser(user);
    } catch (e) {
      const msg =
        e instanceof Error && e.message === 'EMAIL_TAKEN'
          ? t('auth.emailTaken')
          : t('auth.unknown');
      Alert.alert(t('common.error'), msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="register">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, gap: theme.spacing(3) }}
      >
        <Text variant="h1">{t('auth.registerTitle')}</Text>
        <Text color="textMuted">{t('auth.registerSubtitle')}</Text>

        <Card>
          <Field
            label={t('auth.name')}
            value={name}
            onChange={setName}
            autoCapitalize="words"
            testID="register-name"
          />
          <Field
            label={t('auth.email')}
            value={email}
            onChange={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            testID="register-email"
          />
          <PasswordInput
            label={t('auth.password')}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            testID="register-password"
          />
        </Card>

        <Button onPress={() => void submit()} loading={busy} testID="register-submit">
          {t('auth.registerButton')}
        </Button>

        <View style={styles.footer}>
          <Text color="textMuted">{t('auth.haveAccount')}</Text>
          <Button onPress={onGoToLogin} variant="ghost" testID="register-go-login">
            {t('auth.loginButton')}
          </Button>
        </View>
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
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
});
