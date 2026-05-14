/* eslint-disable @typescript-eslint/no-require-imports */
require('react-native-gesture-handler/jestSetup');

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'l', Medium: 'm', Heavy: 'h' },
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 's', Warning: 'w', Error: 'e' },
}));

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

jest.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const Mock = ({ children }) => React.createElement('View', null, children);
  return new Proxy(
    {},
    {
      get: () => Mock,
    },
  );
});

global.__reanimatedWorkletInit = jest.fn();
