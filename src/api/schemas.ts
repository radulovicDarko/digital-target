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
const DetectorAvailableSchema = z.object({
  available: z.literal(true),
  frame_size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  roi: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().positive(), z.number().int().positive()]).nullable(),
  effective_roi: z.array(z.number()).length(4).optional(),
  image_points: z.array(z.tuple([z.number().finite(), z.number().finite()])),
  target_points: z.array(z.tuple([z.number().finite(), z.number().finite()])).length(4),
  target_size: z.tuple([z.number().positive(), z.number().positive()]),
  mapping_mode: z.enum(['fixed_center', 'legacy', 'homography']),
  calibrated: z.boolean(),
  error: z.string().nullable(),
  version: z.number().int().nonnegative(),
  debug: z.boolean(),
  capture_mode: z.enum(['alignment', 'detection']).optional(),
  alignment_locked: z.boolean().optional(),
  preview_hits: z.number().int().nonnegative().optional(),
  detector: z.object({
    state: z.string(), reason: z.string(), confirmation: z.number().int().nonnegative(),
    cooldown: z.number().int().nonnegative(), armed: z.boolean(), refinement: z.string(),
    rejected: z.array(z.object({ reason: z.string() }).passthrough()),
  }),
  camera: z.object({
    requested: z.record(z.string(), z.unknown()), measured: z.record(z.string(), z.unknown()),
    controls_supported: z.boolean(),
  }),
  processing_ms: z.number().nonnegative().optional(),
});
export const DetectorStatusSchema = z.discriminatedUnion('available', [
  DetectorAvailableSchema,
  z.object({ available: z.literal(false), error: z.string().optional() }),
]);
export type DetectorStatus = z.infer<typeof DetectorStatusSchema>;
export const supportsDetectorWorkflow = (status: DetectorStatus): boolean =>
  status.available && status.capture_mode !== undefined
  && status.alignment_locked !== undefined && status.preview_hits !== undefined;
export type DetectorCalibrationUpdate = {
  frame_size: [number, number];
  version: number;
  roi?: [number, number, number, number] | null;
  image_points?: [number, number][];
  mapping_mode?: 'fixed_center' | 'legacy' | 'homography';
};

export const HealthSchema = z.object({
  status: z.string(),
  version: z.string(),
  uptime_s: z.number().nonnegative(),
});

export const TargetConfigSchema = z.object({
  paper_mm: z.number().positive(),
  paper_bounds_mm: z.tuple([z.number(), z.number(), z.number(), z.number()])
    .refine(([left, top, right, bottom]) => left < right && top < bottom)
    .optional(),
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
