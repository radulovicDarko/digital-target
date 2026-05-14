export type PairingRecord = {
  id: string;
  name: string;
  baseUrl: string; // e.g. https://192.168.4.1
  wsUrl: string; // e.g. wss://192.168.4.1/ws/hits
  token: string;
  /** SHA-256 of the leaf cert in hex */
  fingerprint: string | null;
  pairedAt: number;
  /** Epoch ms when the user last confirmed calibration on this Range.
   *  null = needs confirmation before the user can use the app. */
  calibrationConfirmedAt: number | null;
};
