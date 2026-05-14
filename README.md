# ShooterRange — Mobile App

Cross-platform mobile app for live laser-shot detection ranges. Connects to a
Raspberry Pi over Wi-Fi, renders the target with Skia at 60 fps, and tracks
sessions, shooters, and analytics offline.

> **Architecture & decisions**: see [ARCHITECTURE.md](ARCHITECTURE.md) and
> [DECISIONS.md](DECISIONS.md).
> **Tests**: see [TESTING.md](TESTING.md).

---

## Quick start

```bash
# 1. Install
npm install
cp .env.example .env

# 2. Run the app
npm run ios       # or: npm run android
```

When the pairing wizard opens, scroll down and tap **Use Demo Range** — the
app runs with a fully simulated Pi (in-memory hits), no Wi-Fi required.

### Optional: real HTTP+WS transport (only needed for Detox/E2E)

```bash
cd mock-server && npm install && npm start   # http://localhost:8080
# In the wizard → Enter IP address → localhost:8080
```

## Scripts

| Command                 | What                                  |
|-------------------------|----------------------------------------|
| `npm run typecheck`     | strict TS check                        |
| `npm run lint`          | ESLint (airbnb-typescript)             |
| `npm test`              | Jest unit tests                        |
| `npm run mock`          | Run the mock backend                   |
| `npm run e2e:test:ios`  | Detox iOS E2E (requires `npm run e2e:build:ios` once) |

## EAS builds

```bash
npm i -g eas-cli
eas login
eas init                              # writes the projectId into app.config.ts (extra.eas)

eas build --platform ios     --profile development
eas build --platform android --profile development
eas build --platform all     --profile production
```

The `production` profile is wired for App Store TestFlight + Play Internal
Testing — fill the `appleId` / `ascAppId` / `appleTeamId` placeholders in
[eas.json](eas.json) and add a `play-service-account.json` to enable submit.

## Environment variables

Only used by `EAS development` and the mock workflow (production never points
at localhost).

| Var                          | Default                       |
|------------------------------|--------------------------------|
| `EXPO_PUBLIC_DEV_API_URL`    | `http://localhost:8080`       |
| `EXPO_PUBLIC_DEV_WS_URL`     | `ws://localhost:8080/ws/hits` |
| `EXPO_PUBLIC_SENTRY_DSN`     | empty (Sentry disabled)       |

## Pi backend contract reference

See [ARCHITECTURE.md §2.3](ARCHITECTURE.md) and the Zod schemas in
[src/api/schemas.ts](src/api/schemas.ts) for the full, version-pinned contract
(REST endpoints, WS message types, target config shape).

## Folder layout

```
src/
  api/             axios + zod + WS client + react-query hooks
  components/      themed presentational components
  features/
    pairing/       discovery + manual + trust screens + wizard
    dashboard/     home screen
    session/       Skia target, scoreboard, live + discipline picker
    history/       sessions list (vertical slice)
    shooters/      shooter CRUD scaffold
    settings/      full settings UI
    diagnostics/   health + camera status
  navigation/      RootNavigator + tabs + session flow
  state/           zustand stores
  storage/         SQLite, SecureStore, outbox, logger
  i18n/            en + sr-Latn translations
  theme/           tokens + provider
  types/
app/               expo entry
mock-server/       Express + WS mock of the Pi backend
__tests__/         unit tests
e2e/               Detox tests
.github/workflows/ CI (typecheck, lint, test, EAS on tag)
```

## Known limitations

- True TLS pinning is best-effort in managed workflow — see
  [DECISIONS.md §D5](DECISIONS.md). Acceptable for the realistic threat model
  (rogue AP at a closed range), not adequate for hostile environments.
- iOS Captive Portal: when the phone joins the Pi AP, iOS opens a captive
  assistant page. We document the workaround in the pairing wizard and the
  in-app help screens.
- Background sockets on iOS: the live session pauses when the app is
  backgrounded for >30s and reconciles on foreground.
