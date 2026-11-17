export interface RateLimit {
  readonly maxEvents: number;
  readonly windowMs: number;
}

export interface RateLimiterState {
  readonly windowStart: number;
  readonly count: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly state: RateLimiterState;
}

export const DEFAULT_RATE_LIMITS = {
  sessionCreate: { maxEvents: 5, windowMs: 60_000 },
  messagePublish: { maxEvents: 10, windowMs: 1_000 },
} as const satisfies Record<string, RateLimit>;

export function checkRateLimit(
  state: RateLimiterState | undefined,
  now: number,
  limit: RateLimit,
): RateLimitDecision {
  if (state === undefined || now - state.windowStart >= limit.windowMs) {
    return { allowed: true, state: { windowStart: now, count: 1 } };
  }
  if (state.count >= limit.maxEvents) {
    return { allowed: false, state };
  }
  return { allowed: true, state: { windowStart: state.windowStart, count: state.count + 1 } };
}
