/// <reference types="node" />
import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ShooterRange',
  slug: 'shooter-range',
  scheme: 'shooterrange',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    backgroundColor: '#0B0F14',
    resizeMode: 'contain',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.shooterrange.app',
    icon: './assets/icon.png',
    infoPlist: {
      NSLocalNetworkUsageDescription:
        'ShooterRange uses your local network to talk to your Range device.',
      NSCameraUsageDescription: 'Optional: take a profile photo of a shooter.',
      NSPhotoLibraryUsageDescription: 'Optional: choose a profile photo of a shooter.',
      ITSAppUsesNonExemptEncryption: false,
      // Allow plaintext HTTP to LAN devices (Raspberry Pi AP, dev Mac running
      // the Python control server). Required so the MJPEG preview Image and
      // /api/calibration/* requests work without TLS.
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
        NSAllowsArbitraryLoads: true,
      },
    },
  },
  android: {
    package: 'com.shooterrange.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0B0F14',
    },
    permissions: [
      'ACCESS_NETWORK_STATE',
      'ACCESS_WIFI_STATE',
      'CHANGE_WIFI_STATE',
      'INTERNET',
      'VIBRATE',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-secure-store',
    'expo-local-authentication',
    'expo-audio',
    [
      'expo-image-picker',
      {
        photosPermission: 'ShooterRange needs access to your photos to set a shooter profile photo.',
      },
    ],
  ],
  extra: {
    eas: { projectId: '519b56df-b2e4-4c70-84fa-0868c6164183' },
    devApiUrl: process.env.EXPO_PUBLIC_DEV_API_URL ?? 'http://localhost:8080',
    devWsUrl: process.env.EXPO_PUBLIC_DEV_WS_URL ?? 'ws://localhost:8080/ws/hits',
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    // Remote backend that owns user accounts + session history. The Pi is
    // a thin sensor and does NOT persist sessions. Override at build time
    // with EXPO_PUBLIC_BACKEND_URL to point at staging/prod.
    backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL ?? 'https://api.etarget.placeholder',
  },
  experiments: {
    typedRoutes: false,
  },
});
