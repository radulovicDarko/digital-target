import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, PasswordInput, Screen, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';
import { userStore } from '@/storage/users';
import { useTheme } from '@/theme';

type Props = { onClose?: () => void };

export const ProfileScreen = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  if (!user) {
    return (
      <Screen>
        <Text>{t('common.error')}</Text>
      </Screen>
    );
  }

  const saveProfile = async () => {
    if (!name.trim() || !email.trim()) {
      Alert.alert(t('common.error'), t('auth.fillFields'));
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await userStore.update(user.id, { name, email });
      setUser(updated);
      Alert.alert(t('profile.savedTitle'), t('profile.savedBody'));
    } catch (e) {
      const msg =
        e instanceof Error && e.message === 'EMAIL_TAKEN'
          ? t('auth.emailTaken')
          : t('auth.unknown');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 6) {
      Alert.alert(t('common.error'), t('auth.passwordTooShort'));
      return;
    }
    setSavingPassword(true);
    try {
      await userStore.changePassword(user.id, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      Alert.alert(t('profile.passwordChangedTitle'), t('profile.passwordChangedBody'));
    } catch (e) {
      const msg =
        e instanceof Error && e.message === 'WRONG_PASSWORD'
          ? t('profile.wrongCurrentPassword')
          : t('auth.unknown');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSavingPassword(false);
    }
  };

  const deleteAccount = () => {
    Alert.alert(t('profile.deleteTitle'), t('profile.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await userStore.remove(user.id);
          await userStore.setCurrentId(null);
          setUser(null);
        },
      },
    ]);
  };

  return (
    <Screen testID="profile">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ gap: theme.spacing(3), paddingBottom: theme.spacing(8) }}>
          <View style={styles.headerRow}>
            <Text variant="h1">{t('profile.title')}</Text>
            {onClose ? (
              <Button onPress={onClose} variant="ghost">
                {t('common.close')}
              </Button>
            ) : null}
          </View>

          <Card>
            <Text variant="h3">{t('profile.detailsTitle')}</Text>
            <Field
              label={t('auth.name')}
              value={name}
              onChange={setName}
              autoCapitalize="words"
              testID="profile-name"
            />
            <Field
              label={t('auth.email')}
              value={email}
              onChange={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              testID="profile-email"
            />
            <Button
              onPress={() => void saveProfile()}
              loading={savingProfile}
              style={{ marginTop: theme.spacing(3) }}
              testID="profile-save"
            >
              {t('common.save')}
            </Button>
          </Card>

          <Card>
            <Text variant="h3">{t('profile.passwordTitle')}</Text>
            <PasswordInput
              label={t('profile.currentPassword')}
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              textContentType="password"
              testID="profile-current-password"
            />
            <PasswordInput
              label={t('profile.newPassword')}
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              testID="profile-new-password"
            />
            <Button
              onPress={() => void changePassword()}
              loading={savingPassword}
              style={{ marginTop: theme.spacing(3) }}
              testID="profile-change-password"
            >
              {t('profile.changePassword')}
            </Button>
          </Card>

          <Card>
            <Text variant="h3" color="danger">
              {t('profile.dangerZone')}
            </Text>
            <Text color="textMuted" style={{ marginTop: theme.spacing(1) }}>
              {t('profile.deleteHelp')}
            </Text>
            <Button
              onPress={deleteAccount}
              variant="danger"
              style={{ marginTop: theme.spacing(3) }}
              testID="profile-delete"
            >
              {t('profile.deleteAccount')}
            </Button>
          </Card>
        </ScrollView>
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: { borderWidth: StyleSheet.hairlineWidth, fontSize: 16, minHeight: 44 },
});
