import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';
import { usePairingStore } from '@/state/pairingStore';
import { useSettingsStore } from '@/state/settingsStore';
import { securePairings } from '@/storage/securePairings';
import { userStore } from '@/storage/users';
import { useTheme } from '@/theme';

type Props = {
  onPairAnother: () => void;
  /** Optional handler for the Diagnostics tile. Hidden if not provided. */
  onOpenDiagnostics?: () => void;
};

export const SettingsScreen = ({ onPairAnother, onOpenDiagnostics }: Props) => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const settings = useSettingsStore();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const logout = async () => {
    await userStore.setCurrentId(null);
    setUser(null);
  };
  const ranges = usePairingStore((s) => s.knownRanges);
  const active = usePairingStore((s) => s.active);
  const setActive = usePairingStore((s) => s.setActive);
  const upsert = usePairingStore((s) => s.upsert);
  const removeRange = usePairingStore((s) => s.remove);

  const forget = async (id: string) => {
    await securePairings.remove(id);
    removeRange(id);
    if (active?.id === id) await securePairings.setActiveId(null);
  };

  return (
    <Screen testID="settings">
      <ScrollView contentContainerStyle={{ gap: theme.spacing(3), paddingBottom: theme.spacing(8) }}>
        <Text variant="h1">{t('settings.title')}</Text>

        {user ? (
          <Card>
            <Text variant="h3">{user.name}</Text>
            <Text color="textMuted">{user.email}</Text>
            <Text variant="caption" color="textMuted" style={{ marginTop: theme.spacing(1) }}>
              {user.role.toUpperCase()}
            </Text>
            <Button
              onPress={() => void logout()}
              variant="secondary"
              style={{ marginTop: theme.spacing(3) }}
              testID="settings-logout"
            >
              {t('auth.logout')}
            </Button>
          </Card>
        ) : null}

        <Card>
          <Text variant="h3">{t('settings.language')}</Text>
          <View style={styles.row}>
            <Button
              variant={settings.lang === 'en' ? 'primary' : 'secondary'}
              onPress={() => {
                settings.setLang('en');
                void i18n.changeLanguage('en');
              }}
            >
              English
            </Button>
            <Button
              variant={settings.lang === 'sr-Latn' ? 'primary' : 'secondary'}
              onPress={() => {
                settings.setLang('sr-Latn');
                void i18n.changeLanguage('sr-Latn');
              }}
            >
              Srpski
            </Button>
          </View>
        </Card>

        <Card>
          <Text variant="h3">{t('settings.theme')}</Text>
          <View style={styles.row}>
            {(['system', 'light', 'dark'] as const).map((m) => (
              <Button
                key={m}
                variant={settings.theme === m ? 'primary' : 'secondary'}
                onPress={() => settings.setTheme(m)}
              >
                {t(`settings.theme${m[0]!.toUpperCase()}${m.slice(1)}` as never)}
              </Button>
            ))}
          </View>
        </Card>

        <Card>
          <Toggle
            label={t('settings.sound')}
            value={settings.soundEnabled}
            onChange={settings.setSoundEnabled}
          />
          <Toggle
            label={t('settings.voice')}
            value={settings.voiceEnabled}
            onChange={settings.setVoiceEnabled}
          />
          <Toggle
            label={t('settings.haptics')}
            value={settings.hapticsEnabled}
            onChange={settings.setHapticsEnabled}
          />
        </Card>

        <Card>
          <Text variant="h3">{t('settings.privacy')}</Text>
          <Toggle
            label={t('settings.analytics')}
            value={settings.analyticsOptIn}
            onChange={settings.setAnalyticsOptIn}
          />
          <Toggle
            label={t('settings.crashReports')}
            value={settings.crashReportsOptIn}
            onChange={settings.setCrashReportsOptIn}
          />
        </Card>

        <Card>
          <Text variant="h3">{t('settings.managePis')}</Text>
          {ranges.length === 0 ? (
            <Text color="textMuted">{t('common.empty')}</Text>
          ) : (
            ranges.map((r) => (
              <View key={r.id} style={[styles.rowBetween, { marginTop: theme.spacing(2) }]}>
                <View style={{ flexShrink: 1 }}>
                  <Text variant="bodyBold">{r.name}</Text>
                  <Text color="textMuted" numberOfLines={1}>
                    {r.baseUrl}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Button
                    onPress={async () => {
                      // Force re-calibration whenever the active Range
                      // switches — different physical setup likely needs it.
                      const reset = { ...r, calibrationConfirmedAt: null };
                      await securePairings.upsert(reset);
                      await securePairings.setActiveId(reset.id);
                      upsert(reset);
                      setActive(reset);
                    }}
                    variant="ghost"
                  >
                    {active?.id === r.id ? '✓' : t('common.ok')}
                  </Button>
                  <Button onPress={() => void forget(r.id)} variant="danger">
                    {t('pairing.forget')}
                  </Button>
                </View>
              </View>
            ))
          )}
          <Button onPress={onPairAnother} style={{ marginTop: theme.spacing(2) }}>
            {t('pairing.pairAnother')}
          </Button>
        </Card>

        {onOpenDiagnostics ? (
          <Card>
            <Text variant="h3">Diagnostics</Text>
            <Text color="textMuted" style={{ marginTop: theme.spacing(1) }}>
              View live logs from the app and the Range. Useful when hits feel
              laggy or get dropped.
            </Text>
            <Button
              onPress={onOpenDiagnostics}
              variant="secondary"
              style={{ marginTop: theme.spacing(3) }}
              testID="settings-open-diagnostics"
            >
              Open log viewer
            </Button>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
};

const Toggle = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) => {
  const t = useTheme();
  return (
    <View style={[styles.rowBetween, { marginTop: t.spacing(2) }]}>
      <Text>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
