import type { NavigatorScreenParams } from '@react-navigation/native';

export type SessionStackParamList = {
  DisciplinePicker: undefined;
  CustomConfig: undefined;
  FreeConfig: undefined;
  LiveSession: {
    discipline: string;
    /** Optional override for shots per target / targets per session.
     *  When omitted, the discipline's built-in format is used. */
    shotsPerTarget?: number;
    targetsPerSession?: number;
  };
};

export type RootTabParamList = {
  Home: undefined;
  History: undefined;
  Profile: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Pairing: undefined;
  Calibration: undefined;
  Tabs: NavigatorScreenParams<RootTabParamList>;
  SessionFlow: NavigatorScreenParams<SessionStackParamList>;
  SessionDetail: { sessionId: string };
  Profile: undefined;
  Diagnostics: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
