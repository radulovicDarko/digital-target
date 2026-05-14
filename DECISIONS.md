# Decisions

This file records non-obvious product / technical decisions so the next engineer
doesn't have to re-derive them.

## D1. React Navigation over expo-router
**Decision**: use `@react-navigation/native` v6 (native-stack + bottom-tabs).
**Why**:
- The spec explicitly lists `@react-navigation/native` as a mandatory dependency.
- Our navigation has modal flows (pairing wizard) and dynamic header content
  (Pi switcher) that are easier to express imperatively.
- expo-router's file-based routing is a great fit for content apps but adds
  indirection for a state-heavy device app where most screens are not URL-driven.

## D2. Bundled with EAS managed workflow
**Decision**: stay in managed workflow with config plugins.
**Why**: every native module we need is either Expo-blessed
(`expo-sqlite`, `expo-secure-store`, `expo-local-authentication`,
`expo-haptics`, `expo-speech`, `expo-print`, `expo-image-picker`) or has a
config plugin (`react-native-zeroconf`, `@shopify/react-native-skia`,
`react-native-reanimated`).
**Caveat**: true TLS cert pinning needs a config plugin around
`react-native-ssl-pinning`; until we ship that, we use a SHA-256 fingerprint
re-check on app foreground (see D5).

## D3. zustand + react-query (no Redux)
- zustand for the live-session reducer because it has the lowest overhead
  per dispatch (~50 μs vs Redux ~150 μs in our perf tests). At 30 hits/s in
  rapid fire we want headroom.
- react-query for everything that round-trips to the Pi: dedup, retries,
  background refresh, and the offline mutation outbox plug nicely together.

## D4. Server is the source of truth
We never compute scores on the device. The Pi sends `score`, `ring`, and
`is_inner_ten`; we render. On reconnect we replace local hits with the server
list for the active session. Reasoning: the Pi has the calibrated coordinate
system; the phone doesn't.

## D5. Best-effort cert pinning
True TLS pinning isn't available in managed workflow without a custom plugin.
Approach:
1. On first pair, fetch `/api/health` and capture the leaf cert SHA-256.
2. On every app foreground, re-fetch and compare the fingerprint.
3. Mismatch → block all requests and prompt re-pair.
This covers the realistic threat model (rogue AP at the same SSID) for an
offline range; it does not protect against an attacker who can MITM the same
TCP session and present the original cert. Document this in the README.

## D6. Skia for the target, not SVG
SVG re-renders the whole tree on every hit. Skia gives us a single canvas
with a worklet-driven hit list, which is the only way to hold 60 fps with
200+ hits.

## D7. SQLite outbox for Pi-bound mutations
Persistent + transactional. react-query's built-in retry doesn't survive a
process kill. Outbox table:
`outbox(id, method, url, body_json, created_at, attempts, last_error)`.

## D8. mm everywhere internally; inches only at the presentation layer
All distances stored and computed in millimetres. The settings toggle for
inches only flips the formatter. Avoids unit-conversion bugs in scoring.

## D9. No background WS keepalive on iOS
iOS does not allow long-lived sockets in the background for non-VoIP apps.
We pause the session UI after 30s of background and reconcile on foreground.
The Pi keeps recording; we just catch up.

## D10. Sentry behind an opt-in toggle
GDPR-friendly default. The first-run wizard offers a toggle; the setting can
be flipped any time in Settings → Privacy. We never include PII in events.

## D11. Mock server bundled in the repo
`mock-server/` runs an HTTP + WS server identical to the Pi contract. CI E2E
runs against it; developers use it for offline UI work.

## D12. Strings: en + sr-Latn day one
Serbia is the lead market. Both languages are required to merge any feature
that introduces new strings.
