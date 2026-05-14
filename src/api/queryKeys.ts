export const queryKeys = {
  health: (rangeId: string) => ['health', rangeId] as const,
  targetConfig: (rangeId: string) => ['targetConfig', rangeId] as const,
  session: (rangeId: string, id: string) => ['session', rangeId, id] as const,
  sessions: (rangeId: string, opts: { shooterId?: string; limit?: number; offset?: number }) =>
    ['sessions', rangeId, opts] as const,
};
