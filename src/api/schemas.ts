import { z } from 'zod';

// ---- WebSocket messages ----
export const HitSchema = z.object({
  type: z.literal('hit'),
  session_id: z.string(),
  ts: z.number(),
  // Monotonic sequence number assigned by the Pi. Mobile uses this to
  // detect gaps and request a replay via /api/hits/replay?since=N.
  // Optional for backward compat with older Pi firmware that didn't
  // include a seq — those messages just bypass the gap detector.
  seq: z.number().int().nonnegative().optional(),
  x_norm: z.number().min(0).max(1),
  y_norm: z.number().min(0).max(1),
  score: z.number().int().min(0).max(10),
  ring: z.number().int().min(0).max(10),
  x_mm: z.number(),
  y_mm: z.number(),
  dist_mm: z.number().nonnegative(),
  is_inner_ten: z.boolean(),
});

export const ResetMsgSchema = z.object({ type: z.literal('reset') });
export const SessionStartedMsgSchema = z.object({
  type: z.literal('session_started'),
  session_id: z.string(),
  started_at: z.number(),
});
export const SessionEndedMsgSchema = z.object({
  type: z.literal('session_ended'),
  summary: z.object({
    session_id: z.string(),
    ended_at: z.number(),
    total_score: z.number(),
    shot_count: z.number(),
  }),
});
export const CalibrationMsgSchema = z.object({
  type: z.literal('calibration'),
  state: z.enum(['frozen', 'live']),
});
export const CameraStatusMsgSchema = z.object({
  type: z.literal('camera_status'),
  ok: z.boolean(),
  fps: z.number().nonnegative(),
});

export const WsMessageSchema = z.discriminatedUnion('type', [
  HitSchema,
  ResetMsgSchema,
  SessionStartedMsgSchema,
  SessionEndedMsgSchema,
  CalibrationMsgSchema,
  CameraStatusMsgSchema,
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;

// ---- REST responses ----
export const HealthSchema = z.object({
  status: z.string(),
  version: z.string(),
  uptime_s: z.number().nonnegative(),
});

export const TargetConfigSchema = z.object({
  paper_mm: z.number().positive(),
  ring_diameters_mm: z.array(z.number().positive()).min(1),
  inner_ten_mm: z.number().positive(),
  pellet_mm: z.number().positive(),
  discipline: z.string(),
});

export const ShooterSchema = z.object({
  id: z.string(),
  name: z.string(),
  dob: z.string().optional(),
  dominant_eye: z.enum(['left', 'right']).optional(),
  club: z.string().optional(),
  notes: z.string().optional(),
});

export const SessionStartResponseSchema = z.object({
  session_id: z.string(),
  started_at: z.number(),
});
export const SessionEndResponseSchema = z.object({
  session_id: z.string(),
  ended_at: z.number(),
  total_score: z.number(),
  shot_count: z.number(),
});

export const SessionFullSchema = z.object({
  id: z.string(),
  shooter_id: z.string(),
  discipline: z.string(),
  started_at: z.number(),
  ended_at: z.number().nullable(),
  total_score: z.number(),
  shot_count: z.number(),
  // Hits inside a Session payload do not repeat the session_id (it's implied
  // by the parent). They also don't carry the WS "type" tag. Strip both.
  hits: z.array(HitSchema.omit({ type: true, session_id: true })),
  notes: z.string().optional(),
  /** Programme format. Optional for backward compatibility with older Pi
   *  firmware / sessions stored before custom programmes existed. */
  shots_per_target: z.number().int().positive().nullable().optional(),
  targets_per_session: z.number().int().positive().nullable().optional(),
});

export const SessionListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      shooter_id: z.string(),
      discipline: z.string(),
      started_at: z.number(),
      ended_at: z.number().nullable(),
      total_score: z.number(),
      shot_count: z.number(),
    }),
  ),
  total: z.number().int().nonnegative(),
});

export const PairResponseSchema = z.object({
  token: z.string(),
  device_name: z.string(),
  device_id: z.string(),
});
