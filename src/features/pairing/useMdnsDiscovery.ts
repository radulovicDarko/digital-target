/**
 * mDNS discovery is intentionally disabled in the managed Expo workflow.
 * The previous implementation depended on `react-native-zeroconf`, which is
 * not maintained and breaks the iOS 26 / RN 0.83 build. We rely on:
 *  - the AP probe (`useApProbe`) for known AP IPs,
 *  - manual IP entry,
 *  - the in-app Demo Range,
 * which together cover every realistic pairing scenario.
 */
export const useMdnsDiscovery = (): {
  services: Array<{ name: string; host: string; port: number; addresses: string[] }>;
  scanning: boolean;
} => ({
  services: [],
  scanning: false,
});
