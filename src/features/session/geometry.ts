import type { Hit } from '@/types/session';

export type GroupExtents = {
  minXMm: number;
  maxXMm: number;
  minYMm: number;
  maxYMm: number;
};

/** Mean Point of Impact in mm coordinates. */
export const computeMpi = (hits: Hit[]): { x: number; y: number } | null => {
  if (hits.length === 0) return null;
  const sum = hits.reduce(
    (acc, h) => ({ x: acc.x + h.xMm, y: acc.y + h.yMm }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / hits.length, y: sum.y / hits.length };
};

/** Axis-aligned bounding extents of all hits, in mm. */
export const computeGroupExtents = (hits: Hit[]): GroupExtents | null => {
  if (hits.length < 2) return null;
  let minX = hits[0]!.xMm;
  let maxX = hits[0]!.xMm;
  let minY = hits[0]!.yMm;
  let maxY = hits[0]!.yMm;
  for (let i = 1; i < hits.length; i += 1) {
    const h = hits[i]!;
    if (h.xMm < minX) minX = h.xMm;
    if (h.xMm > maxX) maxX = h.xMm;
    if (h.yMm < minY) minY = h.yMm;
    if (h.yMm > maxY) maxY = h.yMm;
  }
  return { minXMm: minX, maxXMm: maxX, minYMm: minY, maxYMm: maxY };
};

/** Extreme spread (max distance between any two hits, mm). */
export const computeExtremeSpread = (hits: Hit[]): number => {
  let max = 0;
  for (let i = 0; i < hits.length; i += 1) {
    for (let j = i + 1; j < hits.length; j += 1) {
      const a = hits[i]!;
      const b = hits[j]!;
      const dx = a.xMm - b.xMm;
      const dy = a.yMm - b.yMm;
      const d = Math.hypot(dx, dy);
      if (d > max) max = d;
    }
  }
  return max;
};

export const computeAverage = (hits: Hit[]): number => {
  if (hits.length === 0) return 0;
  const sum = hits.reduce((acc, h) => acc + h.score, 0);
  return sum / hits.length;
};
