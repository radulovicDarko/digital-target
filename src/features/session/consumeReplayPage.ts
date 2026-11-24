import type { Hit } from '@/types/session';

export function consumeReplayPage(last: number | null, hits: Hit[], accept: (h: Hit) => void) {
  for (const hit of hits) {
    if (hit.seq != null && last != null && hit.seq <= last) continue;
    accept(hit);
    last = hit.seq ?? last;
  }
  return last;
}
