import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testID?: string;
  autoComplete?: 'password' | 'new-password' | 'current-password' | 'off';
  textContentType?: 'password' | 'newPassword' | 'oneTimeCode';
};

export const PasswordInput = ({
  label,
  value,
  onChange,
  testID,
  autoComplete = 'password',
  textContentType,
}: Props) => {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ marginTop: theme.spacing(2) }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <View
        style={[
          styles.row,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing(3),
            marginTop: theme.spacing(1),
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          textContentType={textContentType}
          accessibilityLabel={label}
          testID={testID}
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.input, { color: theme.colors.text }]}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          hitSlop={theme.hitSlop}
          testID={testID ? `${testID}-toggle` : undefined}
        >
          <Ionicons
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color={theme.colors.textMuted}
          />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
});
