import { describe, expect, it } from 'vitest';
import { checkRateLimit, DEFAULT_RATE_LIMITS, type RateLimit, type RateLimiterState } from './rate-limiter';

const LIMIT: RateLimit = { maxEvents: 3, windowMs: 1_000 };

function runEvents(times: readonly number[], limit = LIMIT): boolean[] {
  let state: RateLimiterState | undefined;
  return times.map((now) => {
    const decision = checkRateLimit(state, now, limit);
    state = decision.state;
    return decision.allowed;
  });
}

describe('checkRateLimit', () => {
  it('allows events up to the limit within a window and refuses the next one', () => {
    expect(runEvents([0, 10, 20, 30, 999])).toEqual([true, true, true, false, false]);
  });

  it('allows again once the window counted from its first event has passed', () => {
    expect(runEvents([100, 200, 300, 400, 1_099, 1_100, 1_101])).toEqual([
      true,
      true,
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it('never mutates the state it is given, and keeps it as is when refusing', () => {
    const state: RateLimiterState = Object.freeze({ windowStart: 0, count: 3 });
    const refused = checkRateLimit(state, 500, LIMIT);
    expect(refused).toEqual({ allowed: false, state: { windowStart: 0, count: 3 } });
    expect(state).toEqual({ windowStart: 0, count: 3 });

    const partial: RateLimiterState = Object.freeze({ windowStart: 0, count: 1 });
    const allowed = checkRateLimit(partial, 500, LIMIT);
    expect(allowed).toEqual({ allowed: true, state: { windowStart: 0, count: 2 } });
    expect(partial).toEqual({ windowStart: 0, count: 1 });
  });

  it('gives equal results for equal inputs', () => {
    const state: RateLimiterState = { windowStart: 0, count: 2 };
    expect(checkRateLimit(state, 10, LIMIT)).toEqual(checkRateLimit(state, 10, LIMIT));
  });

  it('defaults to 5 creates per minute and 10 publishes per second', () => {
    expect(DEFAULT_RATE_LIMITS.sessionCreate).toEqual({ maxEvents: 5, windowMs: 60_000 });
    expect(DEFAULT_RATE_LIMITS.messagePublish).toEqual({ maxEvents: 10, windowMs: 1_000 });
    const sixCreates = runEvents([0, 1, 2, 3, 4, 5], DEFAULT_RATE_LIMITS.sessionCreate);
    expect(sixCreates).toEqual([true, true, true, true, true, false]);
  });

  it('lets debounced typing at about 3 publishes a second through', () => {
    const times = Array.from({ length: 30 }, (_, i) => i * 300);
    expect(runEvents(times, DEFAULT_RATE_LIMITS.messagePublish).every(Boolean)).toBe(true);
  });
});
