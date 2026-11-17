import {
  isValidEnvelope,
  type AckError,
  type AckErrorCode,
  type Envelope,
  type PeerState,
  type PublishAck,
  type ReceiverJoinAck,
  type SenderJoinAck,
  type SessionCreateAck,
} from '@slm/shared';
import { hashToken, tokenMatchesHash } from './token-hash';

export type Role = 'sender' | 'receiver';

export interface Session {
  readonly senderTokenHash: Uint8Array;
  readonly senderSocketId?: string | undefined;
  readonly receiverSocketId?: string | undefined;
  readonly rejoinTokenHash?: Uint8Array | undefined;
  readonly latest?: Envelope | undefined;
  readonly lastSeq: number;
  readonly lastActivity: number;
}

export interface Binding {
  readonly sessionId: string;
  readonly role: Role;
}

export interface SessionState {
  readonly sessions: ReadonlyMap<string, Session>;
  readonly bindings: ReadonlyMap<string, Binding>;
}

export interface SessionConfig {
  readonly idleTtlMs: number;
  readonly maxSessions: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  idleTtlMs: 30 * 60 * 1000,
  maxSessions: 1000,
};

export type Command =
  | { readonly type: 'create'; readonly sessionId: string; readonly senderToken: string }
  | { readonly type: 'joinSender'; readonly sessionId: string; readonly senderToken: string; readonly socketId: string }
  | {
      readonly type: 'joinReceiver';
      readonly sessionId: string;
      readonly socketId: string;
      readonly rejoinToken?: string | undefined;
      readonly freshRejoinToken: string;
    }
  | { readonly type: 'publish'; readonly socketId: string; readonly envelope: unknown }
  | { readonly type: 'leave'; readonly socketId: string }
  | { readonly type: 'expire' };

export type AckResult = SessionCreateAck | SenderJoinAck | ReceiverJoinAck | PublishAck;

export type Effect =
  | { readonly type: 'ack'; readonly result: AckResult }
  | { readonly type: 'messageUpdate'; readonly socketId: string; readonly envelope: Envelope }
  | { readonly type: 'peerStatus'; readonly socketId: string; readonly peer: PeerState }
  | { readonly type: 'disconnect'; readonly socketId: string };

export type Change =
  | { readonly type: 'putSession'; readonly sessionId: string; readonly session: Session }
  | { readonly type: 'deleteSession'; readonly sessionId: string }
  | { readonly type: 'bind'; readonly socketId: string; readonly binding: Binding }
  | { readonly type: 'unbind'; readonly socketId: string };

export interface Decision {
  readonly changes: readonly Change[];
  readonly effects: readonly Effect[];
}

export interface CommandResult {
  readonly state: SessionState;
  readonly effects: readonly Effect[];
}

export function emptySessionState(): SessionState {
  return { sessions: new Map(), bindings: new Map() };
}

export function runCommand(state: SessionState, command: Command, now: number, config: SessionConfig): CommandResult {
  const { changes, effects } = decide(state, command, now, config);
  return { state: applyChanges(state, changes), effects };
}

export function applyChanges(state: SessionState, changes: readonly Change[]): SessionState {
  if (changes.length === 0) return state;
  const sessions = new Map(state.sessions);
  const bindings = new Map(state.bindings);
  for (const change of changes) {
    switch (change.type) {
      case 'putSession':
        sessions.set(change.sessionId, change.session);
        break;
      case 'deleteSession':
        sessions.delete(change.sessionId);
        break;
      case 'bind':
        bindings.set(change.socketId, change.binding);
        break;
      case 'unbind':
        bindings.delete(change.socketId);
        break;
    }
  }
  return { sessions, bindings };
}

export function decide(state: SessionState, command: Command, now: number, config: SessionConfig): Decision {
  switch (command.type) {
    case 'create':
      return decideCreate(state, command, now, config);
    case 'joinSender':
      return decideJoinSender(state, command, now);
    case 'joinReceiver':
      return decideJoinReceiver(state, command, now);
    case 'publish':
      return decidePublish(state, command, now);
    case 'leave':
      return decideLeave(state, command, now);
    case 'expire':
      return decideExpire(state, now, config);
  }
}

const NO_CHANGE: Decision = { changes: [], effects: [] };

function reject(error: AckErrorCode): Decision {
  const result: AckError = { ok: false, error };
  return { changes: [], effects: [{ type: 'ack', result }] };
}

function peerState(socketId: string | undefined): PeerState {
  return socketId === undefined ? 'disconnected' : 'connected';
}

function joinPeerStatuses(joinedSocketId: string, otherSocketId: string | undefined): Effect[] {
  const effects: Effect[] = [{ type: 'peerStatus', socketId: joinedSocketId, peer: peerState(otherSocketId) }];
  if (otherSocketId !== undefined) {
    effects.push({ type: 'peerStatus', socketId: otherSocketId, peer: 'connected' });
  }
  return effects;
}

function decideCreate(
  state: SessionState,
  command: Extract<Command, { type: 'create' }>,
  now: number,
  config: SessionConfig,
): Decision {
  // An id collision answers server_busy too: the shell retries with a fresh id, and the wire needs no extra code.
  if (state.sessions.size >= config.maxSessions || state.sessions.has(command.sessionId)) {
    return reject('server_busy');
  }
  const session: Session = { senderTokenHash: hashToken(command.senderToken), lastSeq: 0, lastActivity: now };
  return {
    changes: [{ type: 'putSession', sessionId: command.sessionId, session }],
    effects: [{ type: 'ack', result: { ok: true, sessionId: command.sessionId, senderToken: command.senderToken } }],
  };
}

function decideJoinSender(
  state: SessionState,
  command: Extract<Command, { type: 'joinSender' }>,
  now: number,
): Decision {
  const session = state.sessions.get(command.sessionId);
  if (session === undefined) return reject('unknown_session');
  if (!tokenMatchesHash(command.senderToken, session.senderTokenHash)) return reject('bad_token');
  if (state.bindings.has(command.socketId)) return reject('slot_taken');

  const changes: Change[] = [];
  const effects: Effect[] = [{ type: 'ack', result: { ok: true } }];
  const previousSocketId = session.senderSocketId;
  if (previousSocketId !== undefined) {
    changes.push({ type: 'unbind', socketId: previousSocketId });
    effects.push({ type: 'disconnect', socketId: previousSocketId });
  }
  changes.push(
    {
      type: 'putSession',
      sessionId: command.sessionId,
      session: { ...session, senderSocketId: command.socketId, lastActivity: now },
    },
    { type: 'bind', socketId: command.socketId, binding: { sessionId: command.sessionId, role: 'sender' } },
  );
  effects.push(...joinPeerStatuses(command.socketId, session.receiverSocketId));
  return { changes, effects };
}

function decideJoinReceiver(
  state: SessionState,
  command: Extract<Command, { type: 'joinReceiver' }>,
  now: number,
): Decision {
  const session = state.sessions.get(command.sessionId);
  if (session === undefined) return reject('unknown_session');
  if (state.bindings.has(command.socketId)) return reject('slot_taken');

  const changes: Change[] = [];
  const effects: Effect[] = [];
  const previousSocketId = session.receiverSocketId;
  let rejoinToken: string;
  let rejoinTokenHash: Uint8Array;

  if (previousSocketId === undefined) {
    rejoinToken = command.freshRejoinToken;
    rejoinTokenHash = hashToken(command.freshRejoinToken);
  } else {
    const presented = command.rejoinToken;
    const stored = session.rejoinTokenHash;
    if (presented === undefined || stored === undefined || !tokenMatchesHash(presented, stored)) {
      return reject('slot_taken');
    }
    rejoinToken = presented;
    rejoinTokenHash = stored;
    changes.push({ type: 'unbind', socketId: previousSocketId });
    effects.push({ type: 'disconnect', socketId: previousSocketId });
  }

  changes.push(
    {
      type: 'putSession',
      sessionId: command.sessionId,
      session: { ...session, receiverSocketId: command.socketId, rejoinTokenHash, lastActivity: now },
    },
    { type: 'bind', socketId: command.socketId, binding: { sessionId: command.sessionId, role: 'receiver' } },
  );
  const result: ReceiverJoinAck =
    session.latest === undefined ? { ok: true, rejoinToken } : { ok: true, rejoinToken, latest: session.latest };
  effects.unshift({ type: 'ack', result });
  effects.push(...joinPeerStatuses(command.socketId, session.senderSocketId));
  return { changes, effects };
}

// The order not_sender, invalid_payload, stale_seq keeps the current seq hidden from any socket that may not publish.
function decidePublish(state: SessionState, command: Extract<Command, { type: 'publish' }>, now: number): Decision {
  const binding = state.bindings.get(command.socketId);
  if (binding === undefined || binding.role !== 'sender') return reject('not_sender');
  const session = state.sessions.get(binding.sessionId);
  if (session === undefined) return reject('not_sender');
  const envelope = command.envelope;
  if (!isValidEnvelope(envelope)) return reject('invalid_payload');
  if (envelope.seq <= session.lastSeq) return reject('stale_seq');

  const effects: Effect[] = [{ type: 'ack', result: { ok: true } }];
  if (session.receiverSocketId !== undefined) {
    effects.push({ type: 'messageUpdate', socketId: session.receiverSocketId, envelope });
  }
  return {
    changes: [
      {
        type: 'putSession',
        sessionId: binding.sessionId,
        session: { ...session, latest: envelope, lastSeq: envelope.seq, lastActivity: now },
      },
    ],
    effects,
  };
}

function decideLeave(state: SessionState, command: Extract<Command, { type: 'leave' }>, now: number): Decision {
  const binding = state.bindings.get(command.socketId);
  if (binding === undefined) return NO_CHANGE;
  const unbind: Change = { type: 'unbind', socketId: command.socketId };
  const session = state.sessions.get(binding.sessionId);
  if (session === undefined) return { changes: [unbind], effects: [] };

  const isSender = binding.role === 'sender';
  const otherSocketId = isSender ? session.receiverSocketId : session.senderSocketId;
  const updated: Session = isSender
    ? { ...session, senderSocketId: undefined, lastActivity: now }
    : { ...session, receiverSocketId: undefined, lastActivity: now };
  const effects: Effect[] =
    otherSocketId === undefined ? [] : [{ type: 'peerStatus', socketId: otherSocketId, peer: 'disconnected' }];
  return { changes: [unbind, { type: 'putSession', sessionId: binding.sessionId, session: updated }], effects };
}

function decideExpire(state: SessionState, now: number, config: SessionConfig): Decision {
  const changes: Change[] = [];
  for (const [sessionId, session] of state.sessions) {
    const unbound = session.senderSocketId === undefined && session.receiverSocketId === undefined;
    if (unbound && now - session.lastActivity > config.idleTtlMs) {
      changes.push({ type: 'deleteSession', sessionId });
    }
  }
  return { changes, effects: [] };
}
