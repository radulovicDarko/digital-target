import type { Hit } from '@/types/session';

export type ScoreTrend = 'up' | 'down' | 'same';
export type Direction =
  | 'up'
  | 'up-right'
  | 'right'
  | 'down-right'
  | 'down'
  | 'down-left'
  | 'left'
  | 'up-left'
  | 'center';

export type ShotTrend = {
  /** Score delta vs the previous shot. 0 if this is the first one. */
  scoreDelta: number;
  scoreTrend: ScoreTrend;
  /** Direction from the bullseye (target centre) to this hit, bucketed
   *  into 8 compass headings. `center` when the hit is in the dead zone. */
  direction: Direction;
  /** Distance from centre in mm — same as Hit.distMm, exposed for the UI. */
  offsetMm: number;
};

const DEAD_ZONE_MM = 1.0;

/**
 * Trend describing this hit:
 *   • score change vs `prev` (relative)
 *   • direction from target centre (absolute)
 */
export const computeShotTrend = (prev: Hit | null, curr: Hit): ShotTrend => {
  const scoreDelta = prev ? curr.score - prev.score : 0;
  const scoreTrend: ScoreTrend =
    scoreDelta > 0 ? 'up' : scoreDelta < 0 ? 'down' : 'same';

  const offsetMm = curr.distMm;
  if (offsetMm < DEAD_ZONE_MM) {
    return { scoreDelta, scoreTrend, direction: 'center', offsetMm };
  }

  // Direction of curr relative to centre. +y on screen = down, +x = right.
  const angle = Math.atan2(curr.xMm, -curr.yMm) * (180 / Math.PI);
  const normalized = (angle + 360) % 360;

  const bucket: Direction[] = [
    'up',
    'up-right',
    'right',
    'down-right',
    'down',
    'down-left',
    'left',
    'up-left',
  ];
  const idx = Math.round(normalized / 45) % 8;
  return { scoreDelta, scoreTrend, direction: bucket[idx]!, offsetMm };
};
