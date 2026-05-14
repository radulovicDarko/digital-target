import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useHealthQuery, useSessionsQuery } from '@/api/hooks';
import { queryKeys } from '@/api/queryKeys';
import { useRefetchOnFocus } from '@/api/useRefetchOnFocus';
import { Button, Card, ErrorState, Loading, Screen, Text } from '@/components';
import { SessionRow } from '@/features/history';
import { useAuthStore } from '@/state/authStore';
import { useLiveSessionStore } from '@/state/liveSessionStore';
import { usePairingStore } from '@/state/pairingStore';
import { userStore } from '@/storage/users';
import { useTheme } from '@/theme';

type Props = {
  onStartSession: () => void;
  onManagePis: () => void;
  onOpenSession: (sessionId: string) => void;
};

export const DashboardScreen = ({
  onStartSession,
  onManagePis,
  onOpenSession,
}: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const active = usePairingStore((s) => s.active);
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  const setUser = useAuthStore((s) => s.setUser);
  const exitGuest = useAuthStore((s) => s.exitGuest);
  const health = useHealthQuery();
  const sessions = useSessionsQuery({ shooterId: user?.id, limit: 5 });
  // Separate query for stats — pulls more rows so today's totals + personal
  // best are accurate without paginating "Recent sessions".
  const allSessions = useSessionsQuery({ shooterId: user?.id, limit: 200 });

  useRefetchOnFocus([
    queryKeys.health(active?.id ?? 'none'),
    queryKeys.sessions(active?.id ?? 'none', { shooterId: user?.id, limit: 5 }),
    queryKeys.sessions(active?.id ?? 'none', { shooterId: user?.id, limit: 200 }),
  ]);

  // Whenever a session ends elsewhere (LiveSessionScreen calls
  // liveSessionStore.end()), `lastEndedAt` ticks. We use that as a direct
  // signal to refetch — more reliable than waiting for navigation focus
  // events, which can race with the SessionFlow stack popping back to
  // the dashboard.
  const lastEndedAt = useLiveSessionStore((s) => s.lastEndedAt);
  useEffect(() => {
    if (lastEndedAt === 0) return;
    void sessions.refetch();
    void allSessions.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEndedAt]);

  const stats = (() => {
    const items = allSessions.data?.items ?? [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startTs = startOfToday.getTime() / 1000;

    let todayShots = 0;
    let todayScore = 0;
    let best = 0;
    items.forEach((s) => {
      if (s.started_at >= startTs) {
        todayShots += s.shot_count;
        todayScore += s.total_score;
      }
      if (s.total_score > best) best = s.total_score;
    });
    const todayAvg = todayShots > 0 ? (todayScore / todayShots).toFixed(1) : '—';
    return {
      shots: todayShots,
      avg: todayAvg,
      best: best > 0 ? `${best}` : '—',
    };
  })();

  const logout = async () => {
    await userStore.setCurrentId(null);
    setUser(null);
    // Also drop guest mode so RootNavigator returns the user to Auth.
    exitGuest();
  };

  if (!active) {
    return (
      <Screen>
        <Text variant="h2" style={{ flexShrink: 1 }}>
          {t('home.greeting')}
        </Text>
        <Card>
          <Text>{t('errors.network')}</Text>
          <Button onPress={onManagePis} style={{ marginTop: theme.spacing(3) }}>
            {t('pairing.title')}
          </Button>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen testID="dashboard">
      <ScrollView contentContainerStyle={{ gap: theme.spacing(3), paddingBottom: theme.spacing(8) }}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text variant="h1" numberOfLines={2} style={{ flexShrink: 1 }}>
              {t('home.greeting')}
            </Text>
            {user ? (
              <Text color="textMuted" numberOfLines={2} style={{ flexShrink: 1 }}>
                {t('auth.loggedInAs', { name: user.name })}
              </Text>
            ) : guest ? (
              <Text color="textMuted" numberOfLines={2} style={{ flexShrink: 1 }}>
                {t('auth.guestNotice')}
              </Text>
            ) : null}
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => void logout()}
              accessibilityRole="button"
              accessibilityLabel={t('auth.logout')}
              testID="dashboard-logout"
              hitSlop={theme.hitSlop}
              style={({ pressed }) => [
                styles.iconButton,
                {
                  backgroundColor: pressed
                    ? `${theme.colors.danger}22`
                    : 'transparent',
                  borderRadius: theme.radius.pill,
                },
              ]}
            >
              <Ionicons
                name="log-out-outline"
                size={24}
                color={theme.colors.danger}
              />
            </Pressable>
          </View>
        </View>

        {/* Range status card */}
        <Card>
          <View style={styles.rowBetween}>
            <Text variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>
              {t('home.rangeStatus')}
            </Text>
            <Button onPress={onManagePis} variant="ghost">
              {active.name}
            </Button>
          </View>
          {health.isLoading ? (
            <Loading />
          ) : health.isError ? (
            <ErrorState message={t('errors.network')} onRetry={() => void health.refetch()} />
          ) : (
            <View style={[styles.row, { marginTop: theme.spacing(2) }]}>
              <StatusPill label={t('home.online')} ok />
              <StatusPill label={t('home.fps', { fps: 30 })} ok />
              <StatusPill label={t('home.cameraOk')} ok />
            </View>
          )}
        </Card>

        {/* Quick stats */}
        <View style={[styles.statsRow, { gap: theme.spacing(2) }]}>
          <StatTile label={t('home.shots')} value={`${stats.shots}`} />
          <StatTile label={t('home.average')} value={stats.avg} />
          <StatTile label={t('home.best')} value={stats.best} />
        </View>

        <Button
          onPress={onStartSession}
          testID="dashboard-start-session"
          accessibilityLabel={t('home.startSession')}
        >
          {t('home.startSession')}
        </Button>

        <Text variant="h3" style={{ marginTop: theme.spacing(2) }}>
          {t('home.recent')}
        </Text>

        {sessions.isLoading ? (
          <Loading />
        ) : sessions.isError ? (
          <ErrorState message={t('errors.network')} onRetry={() => void sessions.refetch()} />
        ) : sessions.data && sessions.data.items.length > 0 ? (
          // Reuse the same row component as History so the two surfaces
          // stay visually consistent. Recently the dashboard showed a much
          // plainer card and users couldn't tell at a glance which session
          // had the better score.
          sessions.data.items.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              onPress={() => onOpenSession(s.id)}
              testID={`dashboard-session-${s.id}`}
            />
          ))
        ) : (
          <Card>
            <Text color="textMuted">{t('common.empty')}</Text>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
};

const StatusPill = ({ label, ok }: { label: string; ok: boolean }) => {
  const t = useTheme();
  return (
    <View
      accessibilityLabel={label}
      style={{
        paddingHorizontal: t.spacing(3),
        paddingVertical: t.spacing(1),
        borderRadius: t.radius.pill,
        backgroundColor: ok ? `${t.colors.success}22` : `${t.colors.danger}22`,
      }}
    >
      <Text variant="caption" color={ok ? 'success' : 'danger'}>
        {label}
      </Text>
    </View>
  );
};

const StatTile = ({ label, value }: { label: string; value: string }) => {
  const t = useTheme();
  return (
    <Card style={{ flex: 1 }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="h2" style={{ marginTop: t.spacing(1) }}>
        {value}
      </Text>
    </Card>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  // Greeting text container — `flexShrink: 1` lets it shrink when the
  // ghost-buttons get long (translated labels), and `minWidth` ensures the
  // text wraps onto a second line instead of becoming squished to one
  // character per row on very narrow phones.
  headerText: { flexShrink: 1, flexGrow: 1, flexBasis: 180, minWidth: 0 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: { flexDirection: 'row' },
});
