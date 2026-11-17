import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodeBase64Url, type Envelope } from '@slm/shared';
import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  decide,
  emptySessionState,
  runCommand,
  type Command,
  type CommandResult,
  type Effect,
  type SessionConfig,
  type SessionState,
} from './session-core';

const SESSION_ID = encodeBase64Url(new Uint8Array(16).fill(1));
const OTHER_SESSION_ID = encodeBase64Url(new Uint8Array(16).fill(2));
const SENDER_TOKEN = encodeBase64Url(new Uint8Array(32).fill(3));
const WRONG_TOKEN = encodeBase64Url(new Uint8Array(32).fill(4));
const REJOIN_TOKEN = encodeBase64Url(new Uint8Array(32).fill(5));
const SECOND_REJOIN_TOKEN = encodeBase64Url(new Uint8Array(32).fill(6));

const SENDER = 'socket-sender';
const SENDER_2 = 'socket-sender-2';
const RECEIVER = 'socket-receiver';
const RECEIVER_2 = 'socket-receiver-2';
const STRANGER = 'socket-stranger';

const T0 = 1_000_000;
const TTL = 30 * 60 * 1000;
const CONFIG: SessionConfig = { idleTtlMs: TTL, maxSessions: 1000 };

function envelope(seq: number, fill = seq): Envelope {
  return {
    v: 1,
    seq,
    iv: encodeBase64Url(new Uint8Array(12).fill(fill)),
    ct: encodeBase64Url(new Uint8Array(20).fill(fill)),
  };
}

function sha256(value: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(value, 'utf8').digest());
}

function run(state: SessionState, command: Command, now = T0, config = CONFIG): CommandResult {
  return runCommand(state, command, now, config);
}

function ackOf(effects: readonly Effect[]): unknown {
  const acks = effects.filter((effect) => effect.type === 'ack');
  expect(acks).toHaveLength(1);
  return acks[0]?.result;
}

function effectsFor(effects: readonly Effect[], socketId: string): Effect[] {
  return effects.filter((effect) => effect.type !== 'ack' && effect.socketId === socketId);
}

function created(sessionId = SESSION_ID, now = T0): SessionState {
  return run(emptySessionState(), { type: 'create', sessionId, senderToken: SENDER_TOKEN }, now).state;
}

function withSender(state = created(), socketId = SENDER, now = T0): SessionState {
  return run(state, { type: 'joinSender', sessionId: SESSION_ID, senderToken: SENDER_TOKEN, socketId }, now).state;
}

function joinReceiver(
  state: SessionState,
  socketId = RECEIVER,
  rejoinToken?: string,
  freshRejoinToken = REJOIN_TOKEN,
  now = T0,
): CommandResult {
  return run(state, { type: 'joinReceiver', sessionId: SESSION_ID, socketId, rejoinToken, freshRejoinToken }, now);
}

function bothJoined(): SessionState {
  return joinReceiver(withSender()).state;
}

function publish(state: SessionState, payload: unknown, socketId = SENDER, now = T0): CommandResult {
  return run(state, { type: 'publish', socketId, envelope: payload }, now);
}

describe('session core: full flow', () => {
  it('create, sender join, receiver join, publish acks the sender and forwards the identical envelope', () => {
    const createResult = run(emptySessionState(), { type: 'create', sessionId: SESSION_ID, senderToken: SENDER_TOKEN });
    expect(ackOf(createResult.effects)).toEqual({ ok: true, sessionId: SESSION_ID, senderToken: SENDER_TOKEN });
    expect(createResult.state.bindings.size).toBe(0);

    const sent = envelope(1);
    const result = publish(bothJoined(), sent);

    expect(ackOf(result.effects)).toEqual({ ok: true });
    const updates = result.effects.filter((effect) => effect.type === 'messageUpdate');
    expect(updates).toEqual([{ type: 'messageUpdate', socketId: RECEIVER, envelope: sent }]);
    expect(updates[0]?.type === 'messageUpdate' && updates[0].envelope).toBe(sent);
  });

  it('accepts seq 1 then seq 2, forwards both in order and keeps seq 2 as the latest', () => {
    const first = envelope(1);
    const second = envelope(2);
    const afterFirst = publish(bothJoined(), first);
    const afterSecond = publish(afterFirst.state, second);

    const forwarded = [...afterFirst.effects, ...afterSecond.effects].flatMap((effect) =>
      effect.type === 'messageUpdate' ? [effect.envelope] : [],
    );
    expect(forwarded[0]).toBe(first);
    expect(forwarded[1]).toBe(second);
    expect(afterSecond.state.sessions.get(SESSION_ID)?.latest).toBe(second);
    expect(afterSecond.state.sessions.get(SESSION_ID)?.lastSeq).toBe(2);
  });

  it('gives a receiver joining after a publish the latest envelope in its ack', () => {
    const sent = envelope(1);
    const published = publish(withSender(), sent);
    expect(published.effects.filter((effect) => effect.type === 'messageUpdate')).toEqual([]);

    const ack = ackOf(joinReceiver(published.state).effects);
    expect(ack).toEqual({ ok: true, rejoinToken: REJOIN_TOKEN, latest: sent });
  });

  it('gives a receiver joining before any publish an ok ack with no latest', () => {
    const ack = ackOf(joinReceiver(withSender()).effects);
    expect(ack).toEqual({ ok: true, rejoinToken: REJOIN_TOKEN });
    expect(ack).not.toHaveProperty('latest');
  });
});

describe('session core: sender join', () => {
  it('refuses a wrong token with bad_token and binds nothing', () => {
    const state = created();
    const result = run(state, { type: 'joinSender', sessionId: SESSION_ID, senderToken: WRONG_TOKEN, socketId: SENDER });
    expect(ackOf(result.effects)).toEqual({ ok: false, error: 'bad_token' });
    expect(result.effects).toHaveLength(1);
    expect(result.state).toBe(state);
  });

  it('refuses an unknown session id with unknown_session for both roles', () => {
    const state = created();
    const sender = run(state, {
      type: 'joinSender',
      sessionId: OTHER_SESSION_ID,
      senderToken: SENDER_TOKEN,
      socketId: SENDER,
    });
    const receiver = run(state, {
      type: 'joinReceiver',
      sessionId: OTHER_SESSION_ID,
      socketId: RECEIVER,
      freshRejoinToken: REJOIN_TOKEN,
    });
    expect(ackOf(sender.effects)).toEqual({ ok: false, error: 'unknown_session' });
    expect(ackOf(receiver.effects)).toEqual({ ok: false, error: 'unknown_session' });
    expect(sender.state).toBe(state);
    expect(receiver.state).toBe(state);
  });

  it('refuses a socket that already holds a slot with slot_taken', () => {
    const state = bothJoined();
    const result = run(state, {
      type: 'joinSender',
      sessionId: SESSION_ID,
      senderToken: SENDER_TOKEN,
      socketId: RECEIVER,
    });
    expect(ackOf(result.effects)).toEqual({ ok: false, error: 'slot_taken' });
    expect(result.state).toBe(state);
  });

  it('lets a takeover with the right token disconnect the old sender, which then gets not_sender', () => {
    const result = run(bothJoined(), {
      type: 'joinSender',
      sessionId: SESSION_ID,
      senderToken: SENDER_TOKEN,
      socketId: SENDER_2,
    });
    expect(ackOf(result.effects)).toEqual({ ok: true });
    expect(effectsFor(result.effects, SENDER)).toEqual([{ type: 'disconnect', socketId: SENDER }]);
    expect(effectsFor(result.effects, RECEIVER)).not.toContainEqual(
      expect.objectContaining({ type: 'peerStatus', peer: 'disconnected' }),
    );
    expect(result.state.bindings.has(SENDER)).toBe(false);
    expect(result.state.sessions.get(SESSION_ID)?.senderSocketId).toBe(SENDER_2);

    expect(ackOf(publish(result.state, envelope(1), SENDER).effects)).toEqual({ ok: false, error: 'not_sender' });
    expect(ackOf(publish(result.state, envelope(1), SENDER_2).effects)).toEqual({ ok: true });
  });
});

describe('session core: receiver join', () => {
  it('refuses a second receiver with slot_taken, without a rejoin token and with a wrong one', () => {
    const state = bothJoined();
    const noToken = joinReceiver(state, RECEIVER_2, undefined, SECOND_REJOIN_TOKEN);
    const wrongToken = joinReceiver(state, RECEIVER_2, WRONG_TOKEN, SECOND_REJOIN_TOKEN);

    for (const result of [noToken, wrongToken]) {
      expect(ackOf(result.effects)).toEqual({ ok: false, error: 'slot_taken' });
      expect(result.effects).toHaveLength(1);
      expect(result.state).toBe(state);
    }
  });

  it('refuses the sender socket joining as receiver with slot_taken', () => {
    const state = withSender();
    const result = joinReceiver(state, SENDER);
    expect(ackOf(result.effects)).toEqual({ ok: false, error: 'slot_taken' });
    expect(result.state).toBe(state);
  });

  it('lets a receiver with the current rejoin token take over: old socket disconnected, new one gets the latest', () => {
    const sent = envelope(1);
    const state = publish(bothJoined(), sent).state;
    const result = joinReceiver(state, RECEIVER_2, REJOIN_TOKEN, SECOND_REJOIN_TOKEN);

    expect(ackOf(result.effects)).toEqual({ ok: true, rejoinToken: REJOIN_TOKEN, latest: sent });
    expect(effectsFor(result.effects, RECEIVER)).toEqual([{ type: 'disconnect', socketId: RECEIVER }]);
    expect(result.state.bindings.has(RECEIVER)).toBe(false);
    expect(result.state.bindings.get(RECEIVER_2)).toEqual({ sessionId: SESSION_ID, role: 'receiver' });
    expect(result.state.sessions.get(SESSION_ID)?.rejoinTokenHash).toEqual(sha256(REJOIN_TOKEN));
    expect(effectsFor(result.effects, SENDER)).toEqual([{ type: 'peerStatus', socketId: SENDER, peer: 'connected' }]);
  });

  it('stores only a hash of the rejoin token; the plain token appears only in the join ack', () => {
    const result = joinReceiver(withSender());
    const session = result.state.sessions.get(SESSION_ID);
    expect(session?.rejoinTokenHash).toEqual(sha256(REJOIN_TOKEN));
    expect(JSON.stringify(serialisable(result.state))).not.toContain(REJOIN_TOKEN);
    const nonAck = result.effects.filter((effect) => effect.type !== 'ack');
    expect(JSON.stringify(nonAck)).not.toContain(REJOIN_TOKEN);
  });
});

describe('session core: publish', () => {
  it('refuses the receiver socket and an unbound socket with not_sender and leaves the state unchanged', () => {
    const state = bothJoined();
    for (const socketId of [RECEIVER, STRANGER]) {
      const result = publish(state, envelope(1), socketId);
      expect(ackOf(result.effects)).toEqual({ ok: false, error: 'not_sender' });
      expect(result.effects).toHaveLength(1);
      expect(result.state).toBe(state);
    }
  });

  it('checks the sender binding before the payload, so a non-sender never learns the payload or seq verdict', () => {
    const state = publish(bothJoined(), envelope(1)).state;
    expect(ackOf(publish(state, { v: 1 }, RECEIVER).effects)).toEqual({ ok: false, error: 'not_sender' });
    expect(ackOf(publish(state, envelope(1), RECEIVER).effects)).toEqual({ ok: false, error: 'not_sender' });
  });

  it('refuses a duplicate and a lower seq with stale_seq without changing the latest', () => {
    const latest = envelope(2);
    const state = publish(publish(bothJoined(), envelope(1)).state, latest).state;
    for (const seq of [2, 1]) {
      const result = publish(state, envelope(seq, 9));
      expect(ackOf(result.effects)).toEqual({ ok: false, error: 'stale_seq' });
      expect(result.effects).toHaveLength(1);
      expect(result.state).toBe(state);
      expect(result.state.sessions.get(SESSION_ID)?.latest).toBe(latest);
    }
  });

  it.each([
    ['a non-object', 'hello'],
    ['an extra field', { ...envelope(1), role: 'sender' }],
    ['a wrong version', { ...envelope(1), v: 2 }],
    ['a zero seq', envelope(0)],
    ['a short iv', { ...envelope(1), iv: 'AAAA' }],
  ])('refuses %s with invalid_payload without changing the latest', (_name, payload) => {
    const state = bothJoined();
    const result = publish(state, payload);
    expect(ackOf(result.effects)).toEqual({ ok: false, error: 'invalid_payload' });
    expect(result.effects).toHaveLength(1);
    expect(result.state).toBe(state);
    expect(result.state.sessions.get(SESSION_ID)?.latest).toBeUndefined();
  });

  it('updates last activity only on success', () => {
    const state = bothJoined();
    expect(publish(state, envelope(0), SENDER, T0 + 5).state.sessions.get(SESSION_ID)?.lastActivity).toBe(T0);
    expect(publish(state, envelope(1), SENDER, T0 + 5).state.sessions.get(SESSION_ID)?.lastActivity).toBe(T0 + 5);
  });
});

describe('session core: leave', () => {
  it('frees the receiver slot, tells the sender, and lets a new receiver join and get the latest', () => {
    const sent = envelope(1);
    const state = publish(bothJoined(), sent).state;
    const left = run(state, { type: 'leave', socketId: RECEIVER }, T0 + 10);

    expect(left.effects).toEqual([{ type: 'peerStatus', socketId: SENDER, peer: 'disconnected' }]);
    expect(left.state.bindings.has(RECEIVER)).toBe(false);
    expect(left.state.sessions.get(SESSION_ID)?.receiverSocketId).toBeUndefined();
    expect(left.state.sessions.get(SESSION_ID)?.lastActivity).toBe(T0 + 10);

    const rejoined = joinReceiver(left.state, RECEIVER_2, undefined, SECOND_REJOIN_TOKEN);
    expect(ackOf(rejoined.effects)).toEqual({ ok: true, rejoinToken: SECOND_REJOIN_TOKEN, latest: sent });
  });

  it('lets a sender rejoin with the token after leaving, and the next seq must still be higher', () => {
    const state = publish(bothJoined(), envelope(3)).state;
    const left = run(state, { type: 'leave', socketId: SENDER });
    expect(left.effects).toEqual([{ type: 'peerStatus', socketId: RECEIVER, peer: 'disconnected' }]);
    expect(ackOf(publish(left.state, envelope(4), SENDER).effects)).toEqual({ ok: false, error: 'not_sender' });

    const rejoined = withSender(left.state, SENDER_2);
    expect(ackOf(publish(rejoined, envelope(3, 7), SENDER_2).effects)).toEqual({ ok: false, error: 'stale_seq' });
    expect(ackOf(publish(rejoined, envelope(4), SENDER_2).effects)).toEqual({ ok: true });
  });

  it('is a no-op with no effects for a socket that holds no slot', () => {
    const state = bothJoined();
    const result = run(state, { type: 'leave', socketId: STRANGER });
    expect(result.effects).toEqual([]);
    expect(result.state).toBe(state);
  });
});

describe('session core: peer status', () => {
  it('tells a sender joining alone that the receiver is disconnected', () => {
    const result = run(created(), {
      type: 'joinSender',
      sessionId: SESSION_ID,
      senderToken: SENDER_TOKEN,
      socketId: SENDER,
    });
    expect(result.effects.filter((effect) => effect.type === 'peerStatus')).toEqual([
      { type: 'peerStatus', socketId: SENDER, peer: 'disconnected' },
    ]);
  });

  it('tells a joining receiver the sender is connected, and tells the sender the receiver is connected', () => {
    const result = joinReceiver(withSender());
    expect(result.effects.filter((effect) => effect.type === 'peerStatus')).toEqual([
      { type: 'peerStatus', socketId: RECEIVER, peer: 'connected' },
      { type: 'peerStatus', socketId: SENDER, peer: 'connected' },
    ]);
  });

  it('tells a receiver joining before the sender that the sender is disconnected, then connected once it joins', () => {
    const receiverFirst = joinReceiver(created());
    expect(receiverFirst.effects.filter((effect) => effect.type === 'peerStatus')).toEqual([
      { type: 'peerStatus', socketId: RECEIVER, peer: 'disconnected' },
    ]);
    const senderJoin = run(receiverFirst.state, {
      type: 'joinSender',
      sessionId: SESSION_ID,
      senderToken: SENDER_TOKEN,
      socketId: SENDER,
    });
    expect(senderJoin.effects.filter((effect) => effect.type === 'peerStatus')).toEqual([
      { type: 'peerStatus', socketId: SENDER, peer: 'connected' },
      { type: 'peerStatus', socketId: RECEIVER, peer: 'connected' },
    ]);
  });
});

describe('session core: expire and the session cap', () => {
  it('removes an unbound session idle longer than the TTL and keeps younger, boundary and bound ones', () => {
    const idleId = SESSION_ID;
    const boundaryId = OTHER_SESSION_ID;
    const youngId = encodeBase64Url(new Uint8Array(16).fill(7));
    const boundId = encodeBase64Url(new Uint8Array(16).fill(8));
    let state = emptySessionState();
    state = run(state, { type: 'create', sessionId: idleId, senderToken: SENDER_TOKEN }, T0).state;
    state = run(state, { type: 'create', sessionId: boundaryId, senderToken: SENDER_TOKEN }, T0 + 1).state;
    state = run(state, { type: 'create', sessionId: youngId, senderToken: SENDER_TOKEN }, T0 + 2).state;
    state = run(state, { type: 'create', sessionId: boundId, senderToken: SENDER_TOKEN }, T0).state;
    state = run(state, { type: 'joinSender', sessionId: boundId, senderToken: SENDER_TOKEN, socketId: SENDER }, T0).state;

    const result = run(state, { type: 'expire' }, T0 + 1 + TTL);

    expect(result.effects).toEqual([]);
    expect([...result.state.sessions.keys()].sort()).toEqual([boundaryId, youngId, boundId].sort());
  });

  it('never expires a session whose only bound socket is the receiver', () => {
    const state = joinReceiver(created()).state;
    const result = run(state, { type: 'expire' }, T0 + 10 * TTL);
    expect(result.state.sessions.has(SESSION_ID)).toBe(true);
  });

  it('refuses create at the cap with server_busy and stores nothing; after expire, create succeeds again', () => {
    const config: SessionConfig = { idleTtlMs: TTL, maxSessions: 1 };
    const full = created();
    const refused = run(full, { type: 'create', sessionId: OTHER_SESSION_ID, senderToken: SENDER_TOKEN }, T0, config);
    expect(ackOf(refused.effects)).toEqual({ ok: false, error: 'server_busy' });
    expect(refused.state).toBe(full);

    const expired = run(full, { type: 'expire' }, T0 + TTL + 1, config).state;
    expect(expired.sessions.size).toBe(0);
    const accepted = run(
      expired,
      { type: 'create', sessionId: OTHER_SESSION_ID, senderToken: SENDER_TOKEN },
      T0 + TTL + 1,
      config,
    );
    expect(ackOf(accepted.effects)).toEqual({ ok: true, sessionId: OTHER_SESSION_ID, senderToken: SENDER_TOKEN });
    expect(accepted.state.sessions.has(OTHER_SESSION_ID)).toBe(true);
  });

  it('leaves an existing session untouched when create reuses its id', () => {
    const state = publish(withSender(), envelope(1)).state;
    const result = run(state, { type: 'create', sessionId: SESSION_ID, senderToken: WRONG_TOKEN });
    expect(ackOf(result.effects)).toEqual({ ok: false, error: 'server_busy' });
    expect(result.state).toBe(state);
  });
});

describe('session core: purity and token handling', () => {
  const commands: readonly Command[] = [
    { type: 'create', sessionId: OTHER_SESSION_ID, senderToken: SENDER_TOKEN },
    { type: 'joinSender', sessionId: SESSION_ID, senderToken: SENDER_TOKEN, socketId: SENDER_2 },
    { type: 'joinReceiver', sessionId: SESSION_ID, socketId: RECEIVER_2, rejoinToken: REJOIN_TOKEN, freshRejoinToken: SECOND_REJOIN_TOKEN },
    { type: 'publish', socketId: SENDER, envelope: envelope(2) },
    { type: 'leave', socketId: RECEIVER },
    { type: 'expire' },
  ];

  it.each(commands.map((command) => [command.type, command] as const))(
    '%s returns a new state, leaves the input unchanged and gives equal results for equal inputs',
    (_type, command) => {
      const idleSessionId = encodeBase64Url(new Uint8Array(16).fill(9));
      const withIdle = run(bothJoined(), { type: 'create', sessionId: idleSessionId, senderToken: SENDER_TOKEN }).state;
      const state = publish(withIdle, envelope(1)).state;
      const before = structuredClone(state);
      const first = run(state, command, T0 + 2 * TTL);
      const second = run(state, command, T0 + 2 * TTL);
      expect(first.state).not.toBe(state);
      expect(first.state).not.toEqual(state);
      expect(state).toEqual(before);
      expect(first).toEqual(second);
    },
  );

  it('applyChanges never mutates the state it is given', () => {
    const state = bothJoined();
    const before = structuredClone(state);
    const { changes } = decide(state, { type: 'leave', socketId: SENDER }, T0, CONFIG);
    const next = applyChanges(state, changes);
    expect(state).toEqual(before);
    expect(next).not.toBe(state);
    expect(next.bindings.has(SENDER)).toBe(false);
  });

  it('stores a SHA-256 hash of the sender token, never the token, and only the create ack carries it', () => {
    const results: CommandResult[] = [];
    let state = emptySessionState();
    const steps: Command[] = [
      { type: 'create', sessionId: SESSION_ID, senderToken: SENDER_TOKEN },
      { type: 'joinReceiver', sessionId: SESSION_ID, socketId: RECEIVER, freshRejoinToken: REJOIN_TOKEN },
      { type: 'joinSender', sessionId: SESSION_ID, senderToken: SENDER_TOKEN, socketId: SENDER },
      { type: 'publish', socketId: SENDER, envelope: envelope(1) },
      { type: 'joinSender', sessionId: SESSION_ID, senderToken: SENDER_TOKEN, socketId: SENDER_2 },
      { type: 'leave', socketId: SENDER_2 },
    ];
    for (const step of steps) {
      const result = run(state, step);
      results.push(result);
      state = result.state;
    }

    expect(state.sessions.get(SESSION_ID)?.senderTokenHash).toEqual(sha256(SENDER_TOKEN));
    expect(JSON.stringify(serialisable(state))).not.toContain(SENDER_TOKEN);
    const [createResult, ...rest] = results;
    expect(JSON.stringify(createResult?.effects)).toContain(SENDER_TOKEN);
    for (const result of rest) {
      expect(JSON.stringify(result.effects)).not.toContain(SENDER_TOKEN);
    }
  });

  it('contains no clock, randomness, logging, timers or socket access in its source', () => {
    const source = readFileSync(new URL('./session-core.ts', import.meta.url), 'utf8');
    for (const forbidden of [
      /\bDate\b/,
      /Math\.random/,
      /\bconsole\./,
      /randomBytes|getRandomValues|randomUUID/,
      /setTimeout|setInterval|setImmediate/,
      /socket\.io/,
      /process\./,
      /node:fs|node:net|node:http/,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });
});

function serialisable(state: SessionState): unknown {
  return {
    sessions: [...state.sessions].map(([id, session]) => [
      id,
      {
        ...session,
        senderTokenHash: Buffer.from(session.senderTokenHash).toString('hex'),
        rejoinTokenHash: session.rejoinTokenHash && Buffer.from(session.rejoinTokenHash).toString('hex'),
      },
    ]),
    bindings: [...state.bindings],
  };
}
