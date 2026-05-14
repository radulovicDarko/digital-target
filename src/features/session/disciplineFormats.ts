/**
 * Per-discipline shooting format. Currently:
 *  - 10m Air Rifle / Air Pistol: 5 hits per target × 5 targets = 25 shots.
 *  - Custom: open-ended, 1 hit per "target" (effectively no batching).
 *  - Free: open-ended, configurable shots-per-target. The session never
 *    auto-ends — the shooter just keeps going and ends manually.
 *  - Demo: 5 shots × 3 targets = 15 simulated shots. Hits are generated
 *    client-side and POSTed to the server so they persist to history.
 */
export type DisciplineFormat = {
  shotsPerTarget: number;
  targetsPerSession: number;
};

/** Sentinel value for "no fixed target count" — used by Custom and Free.
 *  Any code that wants to detect open-ended sessions should compare
 *  `targetsPerSession >= INFINITE_TARGETS`. */
export const INFINITE_TARGETS = 9999;

/** Stable identifier for the Demo discipline. Code that needs to know it
 *  (e.g. the LiveSessionScreen simulator) imports this constant instead
 *  of hardcoding the string. */
export const DEMO_DISCIPLINE = 'Demo';

const FORMATS: Record<string, DisciplineFormat> = {
  'ISSF 10m Air Rifle': { shotsPerTarget: 5, targetsPerSession: 5 },
  'ISSF 10m Air Pistol': { shotsPerTarget: 5, targetsPerSession: 5 },
  Custom: { shotsPerTarget: 1, targetsPerSession: INFINITE_TARGETS },
  Free: { shotsPerTarget: 5, targetsPerSession: INFINITE_TARGETS },
  [DEMO_DISCIPLINE]: { shotsPerTarget: 5, targetsPerSession: 3 },
};

export const formatForDiscipline = (discipline: string): DisciplineFormat =>
  FORMATS[discipline] ?? FORMATS.Custom!;
