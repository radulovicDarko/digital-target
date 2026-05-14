import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';

import { DashboardScreen } from '@/features/dashboard';
import { HistoryScreen } from '@/features/history';
import { ProfileScreen } from '@/features/profile';
import { SettingsScreen } from '@/features/settings';
import { useTheme } from '@/theme';

import type { RootTabParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();

type Props = {
  onStartSession: () => void;
  onManagePis: () => void;
  onOpenSession: (sessionId: string) => void;
  onDisconnect: () => void;
  onRecalibrate: () => void;
  onOpenDiagnostics?: () => void;
};

const ICONS: Record<keyof RootTabParamList, { focused: keyof typeof Ionicons.glyphMap; outline: keyof typeof Ionicons.glyphMap }> = {
  Home: { focused: 'home', outline: 'home-outline' },
  History: { focused: 'time', outline: 'time-outline' },
  Profile: { focused: 'person', outline: 'person-outline' },
  Settings: { focused: 'settings', outline: 'settings-outline' },
};

export const TabsNavigator = ({
  onStartSession,
  onManagePis,
  onOpenSession,
  onDisconnect,
  onRecalibrate,
  onOpenDiagnostics,
}: Props) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarIcon: ({ focused, color, size }) => {
          const set = ICONS[route.name];
          return (
            <Ionicons name={focused ? set.focused : set.outline} size={size} color={color} />
          );
        },
      })}
    >
      <Tab.Screen name="Home" options={{ title: t('tabs.home') }}>
        {() => (
          <DashboardScreen
            onStartSession={onStartSession}
            onManagePis={onManagePis}
            onOpenSession={onOpenSession}
            onDisconnect={onDisconnect}
            onRecalibrate={onRecalibrate}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="History" options={{ title: t('tabs.history') }}>
        {() => <HistoryScreen onOpenSession={onOpenSession} />}
      </Tab.Screen>
      <Tab.Screen name="Profile" options={{ title: t('tabs.profile') }}>
        {() => <ProfileScreen />}
      </Tab.Screen>
      <Tab.Screen name="Settings" options={{ title: t('tabs.settings') }}>
        {() => (
          <SettingsScreen
            onPairAnother={onManagePis}
            onOpenDiagnostics={onOpenDiagnostics}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
};
