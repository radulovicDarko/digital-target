# ShooterRange Mock Server

A drop-in stand-in for the Pi backend. Implements every REST endpoint and WS
event the app expects so you can develop and run E2E tests with no hardware.

```
cd mock-server
npm install
npm start          # listens on :8080
```

Tunables via env:

- `PORT` (default `8080`)
- `HIT_INTERVAL_MS` (default `1500` — slow it down or speed it up)
