import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, PasswordInput, Screen, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';
import { userStore } from '@/storage/users';
import { useTheme } from '@/theme';

type Props = { onGoToRegister: () => void; onForgotPassword: () => void };

export const LoginScreen = ({ onGoToRegister, onForgotPassword }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const setUser = useAuthStore((s) => s.setUser);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      Alert.alert(t('common.error'), t('auth.fillFields'));
      return;
    }
    setBusy(true);
    try {
      const user = await userStore.authenticate(email.trim(), password);
      if (!user) {
        Alert.alert(t('common.error'), t('auth.invalidCredentials'));
        return;
      }
      await userStore.setCurrentId(user.id);
      setUser(user);
    } catch {
      Alert.alert(t('common.error'), t('auth.unknown'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="login">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, gap: theme.spacing(3) }}
      >
        <Text variant="h1">{t('auth.loginTitle')}</Text>
        <Text color="textMuted">{t('auth.loginSubtitle')}</Text>

        <Card>
          <Field
            label={t('auth.email')}
            value={email}
            onChange={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            testID="login-email"
          />
          <PasswordInput
            label={t('auth.password')}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            textContentType="password"
            testID="login-password"
          />
        </Card>

        <Button onPress={() => void submit()} loading={busy} testID="login-submit">
          {t('auth.loginButton')}
        </Button>

        <Button onPress={onForgotPassword} variant="ghost" testID="login-forgot">
          {t('auth.forgotPassword')}
        </Button>

        <View style={styles.footer}>
          <Text color="textMuted">{t('auth.noAccount')}</Text>
          <Button onPress={onGoToRegister} variant="ghost" testID="login-go-register">
            {t('auth.registerButton')}
          </Button>
        </View>

        {/* Guest mode escape hatch — lets the user explore the app without
            an account. History won't sync to the backend in this mode. */}
        <View
          style={{
            marginTop: theme.spacing(3),
            paddingTop: theme.spacing(3),
            borderTopColor: theme.colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            alignItems: 'center',
            gap: theme.spacing(1),
          }}
        >
          <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
            {t('auth.guestNotice')}
          </Text>
          <Button
            onPress={continueAsGuest}
            variant="ghost"
            testID="login-continue-guest"
          >
            {t('auth.continueAsGuest')}
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
