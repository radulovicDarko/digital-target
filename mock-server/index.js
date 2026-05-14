/* eslint-disable no-console */
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuid } = require('uuid');

const PORT = Number(process.env.PORT || 8080);
const HIT_INTERVAL_MS = Number(process.env.HIT_INTERVAL_MS || 1500);

const state = {
  startedAt: Date.now(),
  sessions: new Map(),
  shooters: [
    { id: 's1', name: 'Marko Petrović', dominant_eye: 'right' },
    { id: 's2', name: 'Ana Janković' },
  ],
  target: {
    paper_mm: 170,
    ring_diameters_mm: [0.5, 5.5, 10.5, 15.5, 20.5, 25.5, 30.5, 35.5, 40.5, 45.5],
    inner_ten_mm: 5.0,
    pellet_mm: 4.5,
    discipline: 'ISSF 10m Air Rifle',
  },
};

const app = express();
app.use(express.json());

// CORS for dev
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// --- Pairing handshake ---
app.post('/api/pair', (req, res) => {
  res.json({
    token: 'mock-bearer-token-' + uuid(),
    device_name: 'ShooterRange Mock',
    device_id: 'mock-device-1',
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0-mock',
    uptime_s: (Date.now() - state.startedAt) / 1000,
  });
});

app.get('/api/target/config', (_req, res) => res.json(state.target));
app.post('/api/target/config', (req, res) => {
  Object.assign(state.target, req.body || {});
  res.json(state.target);
});

app.get('/api/shooters', (_req, res) => res.json({ items: state.shooters }));
app.post('/api/shooters', (req, res) => {
  const s = { id: uuid(), ...req.body };
  state.shooters.push(s);
  res.json(s);
});

app.post('/api/session/start', (req, res) => {
  const id = uuid();
  const startedAt = Date.now() / 1000;
  const session = {
    id,
    shooter_id: req.body.shooter_id || 's1',
    discipline: req.body.discipline || state.target.discipline,
    started_at: startedAt,
    ended_at: null,
    total_score: 0,
    shot_count: 0,
    hits: [],
  };
  state.sessions.set(id, session);
  broadcast({ type: 'session_started', session_id: id, started_at: startedAt });
  console.log('[mock] session started', id);
  return res.json({ session_id: id, started_at: startedAt });
});

app.post('/api/session/:id/end', (req, res) => {
  const s = state.sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  s.ended_at = Date.now() / 1000;
  broadcast({
    type: 'session_ended',
    summary: {
      session_id: s.id,
      ended_at: s.ended_at,
      total_score: s.total_score,
      shot_count: s.shot_count,
    },
  });
  return res.json({
    session_id: s.id,
    ended_at: s.ended_at,
    total_score: s.total_score,
    shot_count: s.shot_count,
  });
});

app.post('/api/session/:id/reset', (req, res) => {
  const s = state.sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  s.hits = [];
  s.total_score = 0;
  s.shot_count = 0;
  broadcast({ type: 'reset' });
  return res.status(204).end();
});

app.get('/api/session/:id', (req, res) => {
  const s = state.sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  return res.json(s);
});

app.get('/api/sessions', (req, res) => {
  const items = Array.from(state.sessions.values())
    .filter((s) => !req.query.shooter_id || s.shooter_id === req.query.shooter_id)
    .map((s) => ({
      id: s.id,
      shooter_id: s.shooter_id,
      discipline: s.discipline,
      started_at: s.started_at,
      ended_at: s.ended_at,
      total_score: s.total_score,
      shot_count: s.shot_count,
    }))
    .sort((a, b) => b.started_at - a.started_at)
    .slice(Number(req.query.offset || 0), Number(req.query.offset || 0) + Number(req.query.limit || 20));
  res.json({ items, total: state.sessions.size });
});

app.post('/api/calibration/freeze', (_req, res) => {
  broadcast({ type: 'calibration', state: 'frozen' });
  res.status(204).end();
});
app.post('/api/calibration/unfreeze', (_req, res) => {
  broadcast({ type: 'calibration', state: 'live' });
  res.status(204).end();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/hits' });

const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch {
      /* ignore */
    }
  });
  // emit a camera_status snapshot on connect
  ws.send(JSON.stringify({ type: 'camera_status', ok: true, fps: 30 }));
});

function broadcast(msg) {
  const json = JSON.stringify(msg);
  clients.forEach((c) => {
    if (c.readyState === 1) c.send(json);
  });
}

// --- Realistic hit emitter ---
// Bivariate-normal scatter around centre, biased by group skill (sigma).
function sampleHit() {
  const sigmaMm = 4.5; // ~ a 90mm group at 10m on a typical day
  const u1 = Math.random();
  const u2 = Math.random();
  const r = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9)));
  const t = 2 * Math.PI * u2;
  const xMm = r * Math.cos(t) * sigmaMm;
  const yMm = r * Math.sin(t) * sigmaMm;
  const distMm = Math.hypot(xMm, yMm);
  const ringIdx = state.target.ring_diameters_mm.findIndex(
    (d) => distMm <= d / 2,
  );
  const ring = ringIdx === -1 ? 0 : 10 - ringIdx;
  const isInnerTen = distMm <= state.target.inner_ten_mm / 2;
  const score = Math.max(0, Math.min(10, ring));
  const xNorm = 0.5 + xMm / state.target.paper_mm;
  const yNorm = 0.5 + yMm / state.target.paper_mm;
  return {
    ts: Date.now() / 1000,
    x_norm: xNorm,
    y_norm: yNorm,
    score,
    ring,
    x_mm: xMm,
    y_mm: yMm,
    dist_mm: distMm,
    is_inner_ten: isInnerTen,
  };
}

setInterval(() => {
  const active = Array.from(state.sessions.values()).filter((s) => !s.ended_at);
  if (active.length === 0) return;
  for (const s of active) {
    const h = sampleHit();
    s.hits.push(h);
    s.total_score += h.score;
    s.shot_count += 1;
    broadcast({ type: 'hit', session_id: s.id, ...h });
  }
}, HIT_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`[mock] http+ws on http://localhost:${PORT}`);
  console.log(`[mock] WS path: ws://localhost:${PORT}/ws/hits`);
});
