# ShooterRange — Architecture

This document explains the runtime architecture, data flow, and the trickier subsystems
(pairing, WebSocket reconnection, certificate pinning, offline-first behaviour).

## 1. High-level

```
┌──────────────────────────────────────────────────────────────┐
│                         RN App (Expo)                        │
│                                                              │
│  UI (Skia, RN, Reanimated)                                   │
│        ▲                                                     │
│        │ selectors / hooks                                   │
│        │                                                     │
│  ┌─────┴────────┐   ┌────────────────┐   ┌────────────────┐  │
│  │ zustand      │   │ react-query    │   │ i18n / theme   │  │
│  │ (UI state)   │   │ (server cache) │   │ (presentation) │  │
│  └─────┬────────┘   └────────┬───────┘   └────────────────┘  │
│        │                     │                               │
│        │              ┌──────┴───────┐                       │
│        │              │ API layer    │                       │
│        │              │ axios + zod  │                       │
│        │              │ WS client    │                       │
│        │              └──────┬───────┘                       │
│        │                     │                               │
│  ┌─────┴────────┐    ┌───────┴────────┐                      │
│  │ SQLite       │    │ SecureStore    │                      │
│  │ sessions/log │    │ pairing tokens │                      │
│  └──────────────┘    └────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
                           │
                  Wi-Fi (no internet)
                           │
                  ┌────────▼─────────┐
                  │   Raspberry Pi   │
                  │  FastAPI + WS    │
                  └──────────────────┘
```

## 2. Layers

### 2.1 Presentation
- **React Navigation v6** native-stack + bottom-tabs (chosen over expo-router; see [DECISIONS.md](DECISIONS.md)).
- **Theme**: token-based (`src/theme/tokens.ts`) with light + dark palettes.
  All components consume tokens through `useTheme()`. No raw hex outside tokens.
- **Skia** for the live target — paths and circles drawn in a single `<Canvas>` so
  even with 200+ hits we stay on the GPU compositor.
- **Reanimated** for the pulse animation on the latest hit and screen transitions.

### 2.2 State
- **`zustand`** for ephemeral UI state and the live session reducer.
  Stores live in `src/state/`, one file per slice. Each store exports both the hook and
  selectors so components subscribe to the smallest slice.
- **`@tanstack/react-query`** for everything that talks to the Pi REST API.
  Query keys are centralised in `src/api/queryKeys.ts`.
- **No Redux**. State that must be persisted goes to SQLite or SecureStore — never to
  Zustand `persist`, because we need transactional guarantees for the offline outbox.

### 2.3 Networking
- **`apiClient`** (`src/api/client.ts`) — `axios` instance built per paired Pi
  (base URL + bearer + optional cert fingerprint). Every response is run through a
  `zod` schema before returning; malformed payloads throw a typed `ApiError` that
  react-query treats as a normal error (no silent failures).
- **`wsClient`** (`src/api/ws.ts`) — thin EventEmitter wrapper around the native
  WebSocket with:
  - exponential backoff (250ms → 8s, jittered),
  - heartbeats (ping every 15s, drop after 30s of silence),
  - schema validation per message,
  - subscriber API: `wsClient.on('hit', cb)`.
- **Outbox** (`src/storage/outbox.ts`) — any mutation that targets the Pi while it's
  unreachable is written to a SQLite `outbox` table and replayed in order when the
  WebSocket reports `online` again. React-query mutations call `enqueueOrSend()`.

### 2.4 Persistence
- **`expo-sqlite`** — `sessions`, `hits`, `shooters`, `outbox`, `logs`.
  Schema migrations live in `src/storage/migrations/`. We run them on app start.
- **`expo-secure-store`** — pairing records: `{ id, name, baseUrl, token, fingerprint }`.
  Never store tokens in Zustand or AsyncStorage.

### 2.5 i18n
- `i18next` + `react-i18next`. English (`en`) and Serbian Latin (`sr-Latn`)
  bundled. RTL-safe layouts via `I18nManager` + logical `start/end` paddings.

## 3. Pairing flow

```
launch ──▶ read SecureStore ──▶ pings each known Pi /api/health
                  │
                  └─ none reachable ──▶ Pairing wizard
                                            │
                                            ├─ A. SSID heuristic: if connected to
                                            │      "ShooterRange-*" → probe 192.168.4.1
                                            │
                                            ├─ B. mDNS browse _shooter._tcp.local.
                                            │      via react-native-zeroconf
                                            │
                                            └─ C. Manual: user types IP / scans QR
                                                  printed on the Pi
                  ▼
             handshake: GET /api/health (HTTPS, self-signed cert)
                  │
                  ▼
             show fingerprint → user taps "Trust"
                  │
                  ▼
             POST /api/pair → bearer token
                  │
                  ▼
             save { baseUrl, token, fingerprint } in SecureStore
                  │
                  ▼
             unlock app
```

All future requests are made through `axios` with a request interceptor that:
1. attaches `Authorization: Bearer <token>`,
2. on iOS via `expo-network` we cannot do real cert pinning in managed workflow —
   instead we re-fetch the cert via `fetch` once per session, hash it (SHA-256) and
   compare to the stored fingerprint. Mismatch → force re-pair.
   (Documented limitation; for true TLS pinning we would need a config plugin
   that uses `react-native-ssl-pinning` — see DECISIONS.md.)

## 4. Live-session data flow

```
WS hit ──▶ zod parse ──▶ liveSessionStore.addHit()
                              │
                              ├─ recompute scoreboard (selector memo)
                              ├─ enqueue local SQLite insert (batched 250ms)
                              └─ emit hit event ──▶ haptics + speech + sound
```

### Reconnect / catch-up
1. WS disconnect → banner "Reconnecting…", store flagged `live=false`.
2. Backoff reconnect.
3. On reconnect we call `GET /api/session/{id}` and reconcile: any server hit
   not present locally is appended; the local store is the projection, the server
   is the source of truth.
4. Background → foreground triggers the same catch-up (we listen on
   `AppState.change`).

### Why server is source of truth
The Pi is the only thing that actually sees the laser. The phone is a renderer.
We never let UI state diverge from server state for >1 reconcile cycle.

## 5. Live target rendering (Skia)

- One `<Canvas>` mounted for the lifetime of the live screen.
- Rings and the paper background are drawn from `targetConfig` once and cached
  in a `Skia.Picture`.
- Hits are drawn from a `useDerivedValue` over a Skia `SharedValue<Hit[]>` —
  they are mutated on the JS thread via Reanimated worklets so the canvas
  re-renders without going through React.
- Pinch + pan use a `Gesture.Race` and update a `Matrix4` shared value applied
  via `<Group transform={…}>` to the rings and the hits in a single transform.
- Pulse animation on the newest hit uses `withTiming` on a per-hit
  `SharedValue<number>`, kept in a ring buffer (max 4 active pulses).

## 6. Performance budget

| Item                       | Budget                  |
|----------------------------|-------------------------|
| Cold start → dashboard     | ≤ 2 s (Pixel 5 / iPhone 11) |
| Live target render         | 60 fps with ≥ 200 hits |
| WS hit → on-screen pulse   | ≤ 50 ms median          |
| WS reconnect after Wi-Fi drop | ≤ 5 s                |

Hermes is on (Expo default), Fabric/TurboModules enabled in `app.config.ts`
via `newArchEnabled: true`.

## 7. Security

- Bearer tokens & cert fingerprints **only** in SecureStore.
- Every WS payload is `zod`-parsed; unknown messages logged and discarded.
- Self-signed cert fingerprint is pinned (best-effort in managed workflow).
- No telemetry leaves the device unless the user opts in to Sentry.
- Logs are scrubbed of bearer tokens before being shared.

## 8. Accessibility

- Every interactive element has `accessibilityLabel` and `accessibilityRole`.
- Live scoreboard exposes an `accessibilityLiveRegion="polite"` for screen
  readers. Score speech via `expo-speech` is opt-in.
- Tap targets ≥ 44pt; AA contrast verified for both palettes.

## 9. Folder layout

```
src/
  api/             axios client, ws client, zod schemas, react-query hooks
  components/      presentational, themed, reusable
  features/
    session/       live + review + history + compare
    shooters/
    pairing/
    settings/
    diagnostics/
  navigation/
  state/           zustand stores
  storage/         sqlite, securestore wrappers, outbox, migrations
  i18n/
  theme/
  utils/
  types/
app/               Expo entry (registerRootComponent)
assets/
__tests__/
e2e/
mock-server/       Node express + ws (dev only)
```

## 10. Things explicitly deferred

See [DECISIONS.md](DECISIONS.md) for the full list. Headlines:
- True TLS pinning requires ejecting or a custom config plugin.
- iOS Captive Portal: we cannot programmatically dismiss it; we show
  step-by-step illustrations.
- Background WS keep-alive on iOS is not allowed; sessions pause when the
  app is backgrounded for >30s and reconcile on foreground.
