import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';

type LoadingProps = { label?: string };
export const Loading = ({ label }: LoadingProps) => {
  const t = useTheme();
  return (
    <View style={[styles.center, { gap: t.spacing(2) }]}>
      <ActivityIndicator color={t.colors.primary} />
      {label ? <Text color="textMuted">{label}</Text> : null}
    </View>
  );
};

type EmptyProps = { title: string; subtitle?: string };
export const Empty = ({ title, subtitle }: EmptyProps) => {
  const t = useTheme();
  return (
    <View style={[styles.center, { gap: t.spacing(2), padding: t.spacing(6) }]}>
      <Text variant="h3">{title}</Text>
      {subtitle ? (
        <Text color="textMuted" style={{ textAlign: 'center' }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
};

type ErrorProps = { message: string; onRetry?: () => void };
export const ErrorState = ({ message, onRetry }: ErrorProps) => {
  const { t: tr } = useTranslation();
  const t = useTheme();
  return (
    <View style={[styles.center, { gap: t.spacing(3), padding: t.spacing(6) }]}>
      <Text variant="h3" color="danger">
        {tr('common.error')}
      </Text>
      <Text color="textMuted" style={{ textAlign: 'center' }}>
        {message}
      </Text>
      {onRetry ? (
        <Button onPress={onRetry} variant="secondary">
          {tr('common.retry')}
        </Button>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
