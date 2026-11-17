import { encodeBase64Url, EVENTS, MAX_CIPHERTEXT_CHARS, type Envelope } from '@slm/shared';
import { describe, expect, test } from 'vitest';
import { planEvent, type Ack, type RateLimits, type SocketLimiters } from './event-intake';

const LIMITS: RateLimits = {
  sessionCreate: { maxEvents: 2, windowMs: 1_000 },
  messagePublish: { maxEvents: 2, windowMs: 1_000 },
};
const SESSION_ID = encodeBase64Url(new Uint8Array(16).fill(1));
const TOKEN = encodeBase64Url(new Uint8Array(32).fill(2));
const ENVELOPE: Envelope = {
  v: 1,
  seq: 1,
  iv: encodeBase64Url(new Uint8Array(12).fill(3)),
  ct: encodeBase64Url(new Uint8Array(20).fill(4)),
};
const ack: Ack = () => undefined;

function outcomeOf(event: Parameters<typeof planEvent>[0], args: readonly unknown[], limiters: SocketLimiters = {}) {
  return planEvent(event, args, limiters, 0, LIMITS).outcome;
}

describe('planEvent: ack', () => {
  test('ignores an event whose last argument is not an ack callback, and leaves the limiters alone', () => {
    const limiters: SocketLimiters = {};
    for (const args of [[], [ENVELOPE], [ack, ENVELOPE], ['ack']]) {
      const plan = planEvent(EVENTS.messagePublish, args, limiters, 0, LIMITS);
      expect(plan.outcome).toEqual({ type: 'ignore' });
      expect(plan.limiters).toBe(limiters);
    }
    expect(outcomeOf(EVENTS.sessionCreate, [])).toEqual({ type: 'ignore' });
  });

  test('hands back the ack it was given', () => {
    const outcome = outcomeOf(EVENTS.sessionCreate, [ack]);
    expect(outcome.type === 'accept' && outcome.ack).toBe(ack);
  });
});

describe('planEvent: payload validation', () => {
  test('accepts each event with its valid payload', () => {
    expect(outcomeOf(EVENTS.sessionCreate, [ack])).toEqual({ type: 'accept', ack, accepted: { event: EVENTS.sessionCreate } });
    expect(outcomeOf(EVENTS.senderJoin, [{ sessionId: SESSION_ID, senderToken: TOKEN }, ack])).toEqual({
      type: 'accept',
      ack,
      accepted: { event: EVENTS.senderJoin, payload: { sessionId: SESSION_ID, senderToken: TOKEN } },
    });
    expect(outcomeOf(EVENTS.receiverJoin, [{ sessionId: SESSION_ID, rejoinToken: TOKEN }, ack])).toMatchObject({
      type: 'accept',
    });
    expect(outcomeOf(EVENTS.receiverJoin, [{ sessionId: SESSION_ID }, ack])).toMatchObject({ type: 'accept' });
  });

  test('passes the published envelope on as the very same object', () => {
    const outcome = outcomeOf(EVENTS.messagePublish, [ENVELOPE, ack]);
    expect(outcome.type === 'accept' && outcome.accepted.event === EVENTS.messagePublish && outcome.accepted.payload).toBe(
      ENVELOPE,
    );
  });

  test('rejects a payload on session create', () => {
    expect(outcomeOf(EVENTS.sessionCreate, [{}, ack])).toEqual({ type: 'reject', ack, error: 'invalid_payload' });
    expect(outcomeOf(EVENTS.sessionCreate, [undefined, ack])).toEqual({ type: 'reject', ack, error: 'invalid_payload' });
  });

  test('rejects a missing payload or extra arguments', () => {
    expect(outcomeOf(EVENTS.messagePublish, [ack])).toMatchObject({ type: 'reject', error: 'invalid_payload' });
    expect(outcomeOf(EVENTS.messagePublish, [ENVELOPE, ENVELOPE, ack])).toMatchObject({
      type: 'reject',
      error: 'invalid_payload',
    });
  });

  test('rejects payloads the shared validators refuse', () => {
    const invalid: [Parameters<typeof planEvent>[0], unknown][] = [
      [EVENTS.senderJoin, { sessionId: SESSION_ID }],
      [EVENTS.senderJoin, { sessionId: SESSION_ID, senderToken: TOKEN, role: 'sender' }],
      [EVENTS.receiverJoin, { sessionId: 'short' }],
      [EVENTS.receiverJoin, { sessionId: SESSION_ID, role: 'sender' }],
      [EVENTS.messagePublish, { ...ENVELOPE, sessionId: SESSION_ID }],
      [EVENTS.messagePublish, { ...ENVELOPE, seq: 0 }],
      [EVENTS.messagePublish, { ...ENVELOPE, ct: 'A'.repeat(MAX_CIPHERTEXT_CHARS + 1) }],
      [EVENTS.messagePublish, null],
    ];
    for (const [event, payload] of invalid) {
      expect(outcomeOf(event, [payload, ack])).toMatchObject({ type: 'reject', error: 'invalid_payload' });
    }
  });
});

describe('planEvent: rate limits', () => {
  function run(event: Parameters<typeof planEvent>[0], args: readonly unknown[], times: readonly number[]): string[] {
    let limiters: SocketLimiters = {};
    return times.map((now) => {
      const plan = planEvent(event, args, limiters, now, LIMITS);
      limiters = plan.limiters;
      return plan.outcome.type === 'reject' ? plan.outcome.error : plan.outcome.type;
    });
  }

  test('refuses creates and publishes beyond the limit with rate_limited', () => {
    expect(run(EVENTS.sessionCreate, [ack], [0, 1, 2, 1_000])).toEqual(['accept', 'accept', 'rate_limited', 'accept']);
    expect(run(EVENTS.messagePublish, [ENVELOPE, ack], [0, 1, 2])).toEqual(['accept', 'accept', 'rate_limited']);
  });

  test('checks the limit before the payload, so invalid publishes count too', () => {
    expect(run(EVENTS.messagePublish, [{}, ack], [0, 1, 2])).toEqual(['invalid_payload', 'invalid_payload', 'rate_limited']);
  });

  test('keeps a separate count for creates and publishes', () => {
    let limiters: SocketLimiters = {};
    for (const now of [0, 1]) {
      limiters = planEvent(EVENTS.sessionCreate, [ack], limiters, now, LIMITS).limiters;
    }
    expect(planEvent(EVENTS.messagePublish, [ENVELOPE, ack], limiters, 2, LIMITS).outcome.type).toBe('accept');
  });

  test('never rate-limits joins and never touches the limiters for them', () => {
    const limiters: SocketLimiters = { sessionCreate: { windowStart: 0, count: 2 }, messagePublish: { windowStart: 0, count: 2 } };
    const plan = planEvent(EVENTS.receiverJoin, [{ sessionId: SESSION_ID }, ack], limiters, 1, LIMITS);
    expect(plan.outcome.type).toBe('accept');
    expect(plan.limiters).toBe(limiters);
  });

  test('never mutates the limiters it is given', () => {
    const limiters: SocketLimiters = Object.freeze({ messagePublish: Object.freeze({ windowStart: 0, count: 1 }) });
    const plan = planEvent(EVENTS.messagePublish, [ENVELOPE, ack], limiters, 1, LIMITS);
    expect(plan.limiters).toEqual({ messagePublish: { windowStart: 0, count: 2 } });
    expect(limiters).toEqual({ messagePublish: { windowStart: 0, count: 1 } });
  });
});
