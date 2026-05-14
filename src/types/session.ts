export type SessionStatus = 'idle' | 'running' | 'paused' | 'ended';

export type Hit = {
  /** Server session id */
  sessionId: string;
  /** Pi-local epoch seconds (float) */
  ts: number;
  /** Monotonic seq from the Pi. Used to detect dropped messages and
   *  trigger replay. Optional for back-compat with old firmware. */
  seq?: number;
  /** Normalized 0..1 within the paper */
  xNorm: number;
  yNorm: number;
  /** Score 0..10 */
  score: number;
  /** Ring 0..10 */
  ring: number;
  /** Position in millimetres from centre */
  xMm: number;
  yMm: number;
  /** Distance from centre in mm */
  distMm: number;
  isInnerTen: boolean;
};

export type Session = {
  id: string;
  shooterId: string;
  discipline: string;
  startedAt: number;
  endedAt: number | null;
  totalScore: number;
  shotCount: number;
  hits: Hit[];
  notes?: string;
};

export type SessionSummary = Pick<
  Session,
  'id' | 'shooterId' | 'discipline' | 'startedAt' | 'endedAt' | 'totalScore' | 'shotCount'
>;

export type TargetConfig = {
  paperMm: number;
  ringDiametersMm: number[]; // [d10, d9, ..., d1]
  innerTenMm: number;
  pelletMm: number;
  discipline: string;
};
