import { useEffect, useState, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useHealthQuery } from '@/api/hooks';
import { Button, Card, ErrorState, Loading, Screen, Text } from '@/components';
import { logger } from '@/storage/logger';
import { useTheme } from '@/theme';

type LogRow = { ts: number; level: string; tag: string; message: string };

const LEVELS = ['all', 'debug', 'info', 'warn', 'error'] as const;
type LevelFilter = (typeof LEVELS)[number];

/**
 * Live log viewer for in-field debugging. Reads everything `logger.*` has
 * written to SQLite. Useful when sessions feel laggy / hits get dropped —
 * filter by tag "ws" to see hit latency, or by "live" for session events.
 */
export const DiagnosticsScreen = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const health = useHealthQuery();

  const [rows, setRows] = useState<LogRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');

  const load = async () => {
    setRefreshing(true);
    try {
      const data = await logger.readAll();
      setRows(data as LogRow[]);
    } finally {
      setRefreshing(false);
    }
  };

  // Auto-refresh every 2 seconds — enough for live tailing without thrashing
  // the SQLite db. Pause when the screen is unmounted.
  useEffect(() => {
    void load();
    const id = setInterval(() => {
      void load();
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.tag));
    return ['all', ...Array.from(set).sort()];
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (level !== 'all' && r.level !== level) return false;
    if (tagFilter !== 'all' && r.tag !== tagFilter) return false;
    return true;
  });

  if (health.isLoading) return <Loading />;

  return (
    <Screen testID="diagnostics">
      <Text variant="h1">Diagnostics</Text>

      {/* Range health card — quick at-a-glance */}
      {health.isError ? (
        <ErrorState message={t('errors.network')} onRetry={() => void health.refetch()} />
      ) : (
        <Card>
          <View style={styles.row}>
            <Ionicons
              name={health.data?.status === 'ok' ? 'checkmark-circle' : 'warning'}
              size={24}
              color={
                health.data?.status === 'ok' ? theme.colors.success : theme.colors.warning
              }
            />
            <View style={{ flex: 1 }}>
              <Text variant="bodyBold">{health.data?.status ?? '—'}</Text>
              <Text variant="caption" color="textMuted">
                {`v${health.data?.version ?? '?'} • uptime ${Math.floor(
                  health.data?.uptime_s ?? 0,
                )}s`}
              </Text>
            </View>
          </View>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <Text variant="caption" color="textMuted" style={styles.sectionLabel}>
          LEVEL
        </Text>
        <View style={styles.chipRow}>
          {LEVELS.map((l) => (
            <Chip
              key={l}
              label={l}
              active={level === l}
              onPress={() => setLevel(l)}
            />
          ))}
        </View>
        <Text variant="caption" color="textMuted" style={[styles.sectionLabel, { marginTop: theme.spacing(2) }]}>
          TAG
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {tagOptions.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                active={tagFilter === tag}
                onPress={() => setTagFilter(tag)}
              />
            ))}
          </View>
        </ScrollView>
        <View style={[styles.row, { justifyContent: 'space-between', marginTop: theme.spacing(2) }]}>
          <Text variant="caption" color="textMuted">
            {`${filtered.length} of ${rows.length} entries`}
          </Text>
          <Button
            onPress={() => void load()}
            variant="secondary"
            loading={refreshing}
            testID="diagnostics-refresh"
          >
            Refresh
          </Button>
        </View>
      </Card>

      {/* Log lines */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: theme.spacing(1), paddingBottom: theme.spacing(8) }}
      >
        {filtered.length === 0 ? (
          <Card>
            <Text color="textMuted">No logs match the filters yet.</Text>
          </Card>
        ) : (
          filtered.map((r, i) => <LogLine key={`${r.ts}-${i}`} row={r} />)
        )}
      </ScrollView>
    </Screen>
  );
};

const Chip = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={theme.hitSlop}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.colors.primary : theme.colors.surfaceAlt,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          borderRadius: theme.radius.pill,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text variant="caption" color={active ? 'textInverse' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
};

const LogLine = ({ row }: { row: LogRow }) => {
  const theme = useTheme();
  const date = new Date(row.ts);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;

  const levelColor =
    row.level === 'error'
      ? theme.colors.danger
      : row.level === 'warn'
        ? theme.colors.warning
        : row.level === 'info'
          ? theme.colors.primary
          : theme.colors.textMuted;

  return (
    <View
      style={[
        styles.logLine,
        {
          backgroundColor: theme.colors.surface,
          borderLeftColor: levelColor,
          borderRadius: theme.radius.sm,
        },
      ]}
    >
      <View style={styles.logHeader}>
        <Text variant="caption" style={{ color: levelColor, fontWeight: '700' }}>
          {row.level.toUpperCase()}
        </Text>
        <Text variant="caption" color="textMuted">
          {time}
        </Text>
        <Text variant="caption" color="textMuted">
          {`[${row.tag}]`}
        </Text>
      </View>
      <Text variant="caption" style={styles.logMessage}>
        {row.message}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 0.6 },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  logLine: { paddingVertical: 6, paddingHorizontal: 8, borderLeftWidth: 3 },
  logHeader: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  logMessage: { fontFamily: 'Courier', fontSize: 11 },
});
