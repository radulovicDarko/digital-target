import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as Application from 'expo-application';

const KEY = 'shooterrange.clientId.v2';

const randomId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const getStableOsId = async (): Promise<string | null> => {
  try {
    if (Platform.OS === 'ios') {
      const id = await Application.getIosIdForVendorAsync();
      return id ? `ios-${id}` : null;
    }
    if (Platform.OS === 'android') {
      // androidId can be null on some devices/ROMs.
      const id = await Application.getAndroidId();
      return id ? `android-${id}` : null;
    }
    return null;
  } catch {
    return null;
  }
};

/** Stable per-install client id used to identify "this phone" to the Range.
 * Lets the same device reattach (take over) after app restart without allowing
 * other devices to steal the attachment.
 */
export const getOrCreateClientId = async (): Promise<string> => {
  const existing = await SecureStore.getItemAsync(KEY);
  if (existing && existing.trim()) return existing;
  const stable = await getStableOsId();
  const next = stable ?? randomId();
  await SecureStore.setItemAsync(KEY, next);
  return next;
};
