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
eas build --platform ios     --profile production --auto-submit
```

The `production` profile is wired for App Store TestFlight + Play Internal
Testing — fill the `appleId` / `ascAppId` / `appleTeamId` placeholders in
[eas.json](eas.json) and add a `play-service-account.json` to enable submit.

[.easignore](.easignore) excludes the Pi backend, local caches and signing/account
files from cloud uploads. Use EAS-managed credentials and environment variables.
Auto-submit sends iOS builds to TestFlight; it does not publish an App Store release.
The native iOS Podfile keeps pod deployment targets at least as high as the app's
minimum, including resource bundles; do not patch generated `Pods.xcodeproj` files.
Keep shell scripts and `ios/.xcode.env` in LF format, as enforced by
[.gitattributes](.gitattributes); `.xcode.env.local` stays out of cloud uploads.

Production iOS builds use Expo SDK 58 / React Native 0.88 and a pinned Xcode 27.1
image. The checked-in native project adopts UIScene: AppDelegate provides the
React Native factory, and ExpoAppSceneDelegate owns window creation, startup,
link delivery and scene lifecycle events. Keep SceneDelegate in the Xcode source
build phase and the scene manifest in Info.plist; upgrading npm packages alone
does not migrate a checked-in native project. Multiple app windows remain disabled.
React Native now requires iOS 16.4 or newer. Tooling requires Node 22.13+, 24.3+
or 26+. Android uses the SDK 58 Gradle/autolinking template and the mandatory
new architecture; release minification remains opt-in.
See [Apple's migration requirements](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle)
and [Expo's scene migration guide](https://expo.fyi/ios-scene-lifecycle).

Use `npx expo install --fix` for the SDK-compatible React/native modules; do not
install nightly Reanimated or Worklets releases via `latest`. Other dependencies
use stable compatible releases. Babel stays on supported 7.x and TypeScript on
6.x because the ts-jest peer range excludes TypeScript 7. Tests use Jest 30 and
React Native Testing Library 14's asynchronous renderer, not react-test-renderer.

The mobile app accepts the previous detector status format. Until the Pi backend
provides `capture_mode`, `alignment_locked`, and `preview_hits`, it retains the
existing calibration flow and disables visible positioning and preview-only
clearing with an update notice. Deploy the backend update to enable those controls.

At 1× zoom the calibration preview shows the entire frame sent by the Pi without cropping or stretching.
Calibration now follows **Position → Lock and test → Next**, with the main
actions fixed below the preview. The positioning camera is bright; the locked
laser-detection preview intentionally uses shorter exposure. Clear hit dots
does not unlock geometry or delete session scores. Camera diagnostics, ROI,
homography and ArUco controls are collapsed under Advanced settings; old XY,
shape and paper sliders appear only in the actual legacy mapping mode.

Live hits are polled one second after each completed replay request, without
overlapping requests or changing camera detection thresholds. Every new accepted
hit, including a zero-point miss, requests a sound when Sound is enabled.
Batched hits play complete shot clips in FIFO order; initialization no longer
drops the first hit. Very fast firing can leave a short audible queue.
Optional `paper_bounds_mm` from the Pi places rings and hits consistently within
an offset visible opening; older target configurations remain centered.

Finished authenticated sessions are saved on the phone in account-scoped
document files. Two alternating files and a small SecureStore commit pointer
keep the previous history intact if a write fails. Writes are serialized and
session IDs are upserted; full hit records and programme sizes are retained.
Real guests still do not save history; demo guests can save demo sessions.
History remains accessible when an already-calibrated Pi is offline. A
placeholder cloud URL is never requested; a genuinely configured cloud can
contribute older records, with an explicit warning if fetching fails. Local
records are not uploaded automatically. Save failures keep the live hits on
screen and offer another End session attempt. Sessions discarded by the older
disabled persistence implementation cannot be recovered.

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
