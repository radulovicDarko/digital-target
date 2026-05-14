# Testing

## Unit

```bash
npm test
npm run test:watch
npm run test:ci      # CI mode with coverage
```

Notable suites:

- `__tests__/geometry.test.ts` — MPI, group extents, extreme spread.
- `__tests__/liveSessionStore.test.ts` — reducer behaviour incl. session
  reconcile.
- `__tests__/wsSchemas.test.ts` — zod parsing of every WS message.

## E2E (Detox)

Pre-reqs: Xcode + iOS sim, or Android Studio + an emulator named `Pixel_6_API_34`.

```bash
# In one terminal — start the mock backend
cd mock-server && npm install && npm start

# In another — build the app once, then run E2E
npm run e2e:build:ios
npm run e2e:test:ios
```

The flagship test (`e2e/pairAndLive.test.ts`) covers the acceptance-criteria
flow: pair → start session → receive hits → end.

For Android: use the equivalent `:android` scripts.
