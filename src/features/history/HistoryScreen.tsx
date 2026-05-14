import { useMemo, useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { useSessionsQuery } from '@/api/hooks';
import { isDemoPairing } from '@/api/demo';
import { queryKeys } from '@/api/queryKeys';
import { useRefetchOnFocus } from '@/api/useRefetchOnFocus';
import { Button, Card, Empty, ErrorState, Loading, Screen, Text } from '@/components';
import { useAuthStore } from '@/state/authStore';
import { useLiveSessionStore } from '@/state/liveSessionStore';
import { usePairingStore } from '@/state/pairingStore';
import { useTheme } from '@/theme';

import { SessionRow } from './SessionRow';

type SessionItem = {
  id: string;
  shooter_id: string;
  discipline: string;
  started_at: number;
  ended_at: number | null;
  total_score: number;
  shot_count: number;
};

type Props = { onOpenSession: (id: string) => void };

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

type FixedBucket = 'today' | 'yesterday' | 'thisWeek';

const bucketFor = (startedAtSec: number, now: Date): FixedBucket | string => {
  const startedDay = startOfDay(new Date(startedAtSec * 1000)).getTime();
  const todayMs = startOfDay(now).getTime();
  if (startedDay === todayMs) return 'today';
  if (startedDay === todayMs - DAY_MS) return 'yesterday';
  if (todayMs - startedDay <= 6 * DAY_MS) return 'thisWeek';
  const date = new Date(startedAtSec * 1000);
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' });
};

const isFixedBucket = (k: string): k is FixedBucket =>
  k === 'today' || k === 'yesterday' || k === 'thisWeek';

// ---- Filter model ---------------------------------------------------------

type DateRange = 'all' | 'today' | 'week' | 'month';
type SortMode = 'newest' | 'oldest' | 'scoreDesc' | 'scoreAsc' | 'shotsDesc' | 'shotsAsc';

const RANGE_KEYS: DateRange[] = ['all', 'today', 'week', 'month'];
const SORT_KEYS: SortMode[] = [
  'newest',
  'oldest',
  'scoreDesc',
  'scoreAsc',
  'shotsDesc',
  'shotsAsc',
];

/** Map a discipline string to the picker bucket so we can offer a stable
 *  set of filter chips even though Custom programmes have arbitrary names. */
const disciplineBucket = (d: string): string => {
  if (d === 'Demo' || d === 'Free' || d === 'Custom') return d;
  if (d.includes('Rifle')) return 'Air Rifle';
  if (d.includes('Pistol')) return 'Air Pistol';
  return 'Custom';
};

const KNOWN_BUCKETS = ['Air Rifle', 'Air Pistol', 'Custom', 'Free', 'Demo'];

const matchesRange = (startedAtSec: number, range: DateRange, now: Date): boolean => {
  if (range === 'all') return true;
  const ms = startedAtSec * 1000;
  const todayMs = startOfDay(now).getTime();
  if (range === 'today') return ms >= todayMs;
  if (range === 'week') return now.getTime() - ms <= 7 * DAY_MS;
  if (range === 'month') return now.getTime() - ms <= 30 * DAY_MS;
  return true;
};

const sortItems = (items: SessionItem[], mode: SortMode): SessionItem[] => {
  const copy = [...items];
  switch (mode) {
    case 'newest':
      return copy.sort((a, b) => b.started_at - a.started_at);
    case 'oldest':
      return copy.sort((a, b) => a.started_at - b.started_at);
    case 'scoreDesc':
      return copy.sort((a, b) => b.total_score - a.total_score);
    case 'scoreAsc':
      return copy.sort((a, b) => a.total_score - b.total_score);
    case 'shotsDesc':
      return copy.sort((a, b) => b.shot_count - a.shot_count);
    case 'shotsAsc':
      return copy.sort((a, b) => a.shot_count - b.shot_count);
    default:
      return copy;
  }
};

// ---- Screen ---------------------------------------------------------------

export const HistoryScreen = ({ onOpenSession }: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const guest = useAuthStore((s) => s.guest);
  const active = usePairingStore((s) => s.active);
  // Pull more than we display so client-side filters have material to work
  // with — 50 was tight once date/discipline filters narrow the set.
  const sessions = useSessionsQuery({ shooterId: user?.id, limit: 200 });

  useRefetchOnFocus([
    queryKeys.sessions(active?.id ?? 'none', { shooterId: user?.id, limit: 200 }),
  ]);

  // Force a refetch the moment a session ends elsewhere — see Dashboard
  // for the full rationale. Same belt-and-suspenders approach.
  const lastEndedAt = useLiveSessionStore((s) => s.lastEndedAt);
  useEffect(() => {
    if (lastEndedAt === 0) return;
    void sessions.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEndedAt]);

  const [range, setRange] = useState<DateRange>('all');
  const [modes, setModes] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>('newest');
  const [query, setQuery] = useState('');
  // Filter row collapses by default to keep the screen clean. A pill-shaped
  // filter button toggles it; the unread-style dot shows when any filter is
  // active (so a collapsed bar never hides "I'm filtering" state).
  const [showFilters, setShowFilters] = useState(false);

  const allItems: SessionItem[] = sessions.data?.items ?? [];

  // Derive the discipline filter chips from data (so a Custom program named
  // "Free Sunday Drill" still shows up as a chip option even though we
  // bucket it under "Custom" for matching).
  const availableModes = useMemo(() => {
    const present = new Set<string>();
    for (const s of allItems) present.add(disciplineBucket(s.discipline));
    // Always show known modes so filters are stable as data grows.
    for (const k of KNOWN_BUCKETS) {
      if (allItems.length > 0) present.add(k);
    }
    return KNOWN_BUCKETS.filter((k) => present.has(k));
  }, [allItems]);

  const filtered = useMemo(() => {
    const now = new Date();
    const q = query.trim().toLowerCase();
    const list = allItems.filter((s) => {
      if (!matchesRange(s.started_at, range, now)) return false;
      if (modes.size > 0 && !modes.has(disciplineBucket(s.discipline))) return false;
      if (q && !s.discipline.toLowerCase().includes(q)) return false;
      return true;
    });
    return sortItems(list, sort);
  }, [allItems, range, modes, query, sort]);

  // Group AFTER filtering + sorting. Only meaningful for the date sorts —
  // for score/shot sorts a flat list is more useful, so we suppress headers.
  const grouped = useMemo(() => {
    const isDateSort = sort === 'newest' || sort === 'oldest';
    if (!isDateSort) return [{ key: '__flat__', items: filtered }];

    const now = new Date();
    const map = new Map<string, SessionItem[]>();
    for (const s of filtered) {
      const key = bucketFor(s.started_at, now);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    const ORDERED: string[] = ['today', 'yesterday', 'thisWeek'];
    const monthBuckets = Array.from(map.keys()).filter((k) => !ORDERED.includes(k));
    monthBuckets.sort((a, b) => {
      const aTs = map.get(a)?.[0]?.started_at ?? 0;
      const bTs = map.get(b)?.[0]?.started_at ?? 0;
      return sort === 'newest' ? bTs - aTs : aTs - bTs;
    });
    const order = sort === 'newest' ? [...ORDERED, ...monthBuckets] : [...monthBuckets.reverse(), ...[...ORDERED].reverse()];
    return order.filter((k) => map.has(k)).map((k) => ({ key: k, items: map.get(k)! }));
  }, [filtered, sort]);

  if (sessions.isLoading) return <Loading />;
  if (sessions.isError)
    return <ErrorState message={t('errors.network')} onRetry={() => void sessions.refetch()} />;

  const total = allItems.length;
  const shown = filtered.length;
  const filtersActive =
    range !== 'all' || modes.size > 0 || sort !== 'newest' || query.trim().length > 0;

  const clearFilters = () => {
    setRange('all');
    setModes(new Set());
    setSort('newest');
    setQuery('');
  };

  return (
    <Screen testID="history">
      <View style={styles.headerRow}>
        <Text variant="h1">{t('tabs.history')}</Text>
        {total > 0 ? (
          <Text variant="caption" color="textMuted">
            {filtersActive
              ? t('history.filteredCount', { shown, total })
              : t('history.sessionsCount', { count: total })}
          </Text>
        ) : null}
      </View>

      {/* Search + filter toggle */}
      {total > 0 ? (
        <View style={styles.searchRow}>
          <View
            style={[
              styles.searchBox,
              {
                backgroundColor: theme.colors.surfaceAlt,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
              },
            ]}
          >
            <Ionicons name="search" size={16} color={theme.colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('history.searchPlaceholder')}
              placeholderTextColor={theme.colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              style={[styles.searchInput, { color: theme.colors.text }]}
              testID="history-search"
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={theme.hitSlop}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Ionicons name="close-circle" size={16} color={theme.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => setShowFilters((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={t('history.filters' as never) ?? 'Filters'}
            testID="history-filters-toggle"
            hitSlop={theme.hitSlop}
            style={({ pressed }) => [
              styles.filterBtn,
              {
                backgroundColor: showFilters
                  ? `${theme.colors.primary}22`
                  : theme.colors.surfaceAlt,
                borderColor: showFilters ? theme.colors.primary : theme.colors.border,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name="options"
              size={20}
              color={showFilters ? theme.colors.primary : theme.colors.text}
            />
            {filtersActive ? (
              <View
                style={[
                  styles.filterDot,
                  { backgroundColor: theme.colors.primary, borderColor: theme.colors.bg },
                ]}
              />
            ) : null}
          </Pressable>
        </View>
      ) : null}

      {/* Collapsible filter panel */}
      {showFilters && total > 0 ? (
        <Card style={{ paddingVertical: theme.spacing(3) }}>
          <FilterGroup label={t('history.range.label')}>
            {RANGE_KEYS.map((r) => (
              <Chip
                key={r}
                label={t(`history.range.${r}` as never)}
                active={range === r}
                onPress={() => setRange(r)}
                testID={`filter-range-${r}`}
              />
            ))}
          </FilterGroup>

          {availableModes.length > 0 ? (
            <FilterGroup label={t('history.mode.label')}>
              {availableModes.map((m) => (
                <Chip
                  key={m}
                  label={m === 'Demo' ? t('disciplines.demo') : m === 'Free' ? t('disciplines.free') : m}
                  active={modes.has(m)}
                  onPress={() =>
                    setModes((prev) => {
                      const next = new Set(prev);
                      if (next.has(m)) next.delete(m);
                      else next.add(m);
                      return next;
                    })
                  }
                  testID={`filter-mode-${m}`}
                />
              ))}
            </FilterGroup>
          ) : null}

          <FilterGroup label={t('history.sort.label')}>
            {SORT_KEYS.map((s) => (
              <Chip
                key={s}
                label={t(`history.sort.${s}` as never)}
                active={sort === s}
                onPress={() => setSort(s)}
                testID={`filter-sort-${s}`}
              />
            ))}
          </FilterGroup>

          {filtersActive ? (
            <Button
              onPress={clearFilters}
              variant="ghost"
              testID="filter-clear"
            >
              {t('history.clearFilters')}
            </Button>
          ) : null}
        </Card>
      ) : null}

      <ScrollView
        contentContainerStyle={{ gap: theme.spacing(2), paddingBottom: theme.spacing(8) }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={sessions.isFetching}
            onRefresh={() => void sessions.refetch()}
            tintColor={theme.colors.primary}
          />
        }
      >
        {total === 0 ? (
          guest && !isDemoPairing(active) ? (
            // Guest user on a real Range — they have no remote backend
            // account, so history can't sync. Nudge them to sign in.
            <Empty
              title={t('history.emptyTitle')}
              subtitle={t('auth.loginToSave')}
            />
          ) : (
            <Empty title={t('history.emptyTitle')} subtitle={t('history.emptyBody')} />
          )
        ) : shown === 0 ? (
          <Empty title={t('history.noMatchTitle')} subtitle={t('history.noMatchBody')} />
        ) : (
          grouped.map((group) => (
            <View key={group.key} style={{ gap: theme.spacing(1) }}>
              {group.key !== '__flat__' ? (
                <Text
                  variant="caption"
                  color="textMuted"
                  style={{
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                    marginTop: theme.spacing(2),
                  }}
                >
                  {isFixedBucket(group.key) ? t(`history.${group.key}` as never) : group.key}
                </Text>
              ) : null}
              {group.items.map((s) => (
                <SessionRow key={s.id} session={s} onPress={() => onOpenSession(s.id)} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
};

// ---- Subcomponents --------------------------------------------------------

const FilterGroup = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing(2) }}>
      <Text
        variant="caption"
        color="textMuted"
        style={{
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          marginBottom: theme.spacing(1),
        }}
      >
        {label}
      </Text>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
};

const Chip = ({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={testID}
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

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  filterBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    position: 'relative',
  },
  filterDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
});
