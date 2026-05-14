import type { PairingRecord } from '@/types/pairing';

import { isDemoPairing } from './demo';
import { WsClient } from './ws';

let shared: { pairingId: string; clientId: string; client: WsClient } | null = null;

/**
 * Returns a single shared WsClient instance per pairing id.
 *
 * This prevents multiple parts of the app from opening competing WS
 * connections (which can lead to dropped hits and "nothing happens" bugs
 * when the server only allows a single subscriber).
 */
export const getSharedWsClient = (pairing: PairingRecord): WsClient | null => {
  // Back-compat overload: if caller doesn't supply clientId, only return
  // an existing shared client (do not create a new socket).
  if (isDemoPairing(pairing)) return null;
  if (shared && shared.pairingId === pairing.id) return shared.client;
  return null;
};

export const getOrCreateSharedWsClient = (
  pairing: PairingRecord,
  clientId: string,
): WsClient | null => {
  if (isDemoPairing(pairing)) return null;
  if (shared && shared.pairingId === pairing.id && shared.clientId === clientId) return shared.client;
  // Pairing/client changed: close previous socket and create a new client.
  if (shared) {
    try {
      shared.client.close();
    } catch {
      /* ignore */
    }
  }
  shared = { pairingId: pairing.id, clientId, client: new WsClient(pairing, clientId) };
  return shared.client;
};

export const closeSharedWsClient = (): void => {
  if (!shared) return;
  try {
    shared.client.close();
  } catch {
    /* ignore */
  }
  shared = null;
};
