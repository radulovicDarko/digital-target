import { createNativeStackNavigator } from '@react-navigation/native-stack';

import {
  CustomSessionConfigScreen,
  DisciplinePickerScreen,
  FreeSessionConfigScreen,
  LiveSessionScreen,
} from '@/features/session';
import { INFINITE_TARGETS } from '@/features/session/disciplineFormats';

import type { SessionStackParamList } from './types';

const Stack = createNativeStackNavigator<SessionStackParamList>();

type Props = { onExit: () => void };

const CUSTOM_DISCIPLINE = 'Custom';
const FREE_DISCIPLINE = 'Free';

export const SessionFlowNavigator = ({ onExit }: Props) => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="DisciplinePicker">
      {({ navigation }) => (
        <DisciplinePickerScreen
          onPick={(discipline) => {
            if (discipline === CUSTOM_DISCIPLINE) {
              navigation.navigate('CustomConfig');
              return;
            }
            if (discipline === FREE_DISCIPLINE) {
              navigation.navigate('FreeConfig');
              return;
            }
            navigation.navigate('LiveSession', { discipline });
          }}
          onCancel={onExit}
        />
      )}
    </Stack.Screen>
    <Stack.Screen name="CustomConfig">
      {({ navigation }) => (
        <CustomSessionConfigScreen
          onCancel={() => navigation.goBack()}
          onConfirm={({ name, shotsPerTarget, targetsPerSession }) =>
            navigation.replace('LiveSession', {
              discipline: name,
              shotsPerTarget,
              targetsPerSession,
            })
          }
        />
      )}
    </Stack.Screen>
    <Stack.Screen name="FreeConfig">
      {({ navigation }) => (
        <FreeSessionConfigScreen
          onCancel={() => navigation.goBack()}
          onConfirm={({ shotsPerTarget }) =>
            navigation.replace('LiveSession', {
              discipline: FREE_DISCIPLINE,
              shotsPerTarget,
              targetsPerSession: INFINITE_TARGETS,
            })
          }
        />
      )}
    </Stack.Screen>
    <Stack.Screen name="LiveSession">
      {({ route }) => (
        <LiveSessionScreen
          discipline={route.params.discipline}
          shotsPerTarget={route.params.shotsPerTarget}
          targetsPerSession={route.params.targetsPerSession}
          onEnded={onExit}
        />
      )}
    </Stack.Screen>
  </Stack.Navigator>
);
