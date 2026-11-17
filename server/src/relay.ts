import { randomBytes } from 'node:crypto';
import { encodeBase64Url, EVENTS, SESSION_ID_BYTES, TOKEN_BYTES } from '@slm/shared';
import type { Server, Socket } from 'socket.io';
import { CLIENT_EVENTS, planEvent, type AcceptedEvent, type Ack, type RateLimits, type SocketLimiters } from './event-intake';
import { ackOutcome, type Logger } from './log';
import { decide, type Command, type Effect, type SessionConfig } from './session-core';
import { applyChangesInPlace, createSessionStore } from './session-store';

export interface RelayOptions {
  readonly sessionConfig: SessionConfig;
  readonly rateLimits: RateLimits;
  readonly sweepIntervalMs: number;
  readonly now: () => number;
  readonly log: Logger;
}

export interface Relay {
  stop(): void;
}

function randomBase64Url(byteCount: number): string {
  return encodeBase64Url(new Uint8Array(randomBytes(byteCount)));
}

function toCommand(accepted: AcceptedEvent, socketId: string): Command {
  switch (accepted.event) {
    case EVENTS.sessionCreate:
      return { type: 'create', sessionId: randomBase64Url(SESSION_ID_BYTES), senderToken: randomBase64Url(TOKEN_BYTES) };
    case EVENTS.senderJoin:
      return { type: 'joinSender', socketId, ...accepted.payload };
    case EVENTS.receiverJoin:
      return {
        type: 'joinReceiver',
        socketId,
        sessionId: accepted.payload.sessionId,
        rejoinToken: accepted.payload.rejoinToken,
        freshRejoinToken: randomBase64Url(TOKEN_BYTES),
      };
    case EVENTS.messagePublish:
      return { type: 'publish', socketId, envelope: accepted.payload };
  }
}

export function attachRelay(io: Server, options: RelayOptions): Relay {
  const store = createSessionStore();
  const { log } = options;

  function run(command: Command, event: string, ack?: Ack): void {
    const { changes, effects } = decide(store, command, options.now(), options.sessionConfig);
    applyChangesInPlace(store, changes);
    for (const effect of effects) {
      execute(effect, event, ack);
    }
  }

  function execute(effect: Effect, event: string, ack: Ack | undefined): void {
    switch (effect.type) {
      case 'ack':
        log({ event, outcome: ackOutcome(effect.result) });
        ack?.(effect.result);
        break;
      case 'messageUpdate':
        io.to(effect.socketId).emit(EVENTS.messageUpdate, effect.envelope);
        break;
      case 'peerStatus':
        io.to(effect.socketId).emit(EVENTS.peerStatus, { peer: effect.peer });
        break;
      case 'disconnect':
        io.sockets.sockets.get(effect.socketId)?.disconnect(true);
        break;
    }
  }

  io.on('connection', (socket: Socket) => {
    let limiters: SocketLimiters = {};
    log({ event: 'connect', count: io.of('/').sockets.size });

    for (const event of CLIENT_EVENTS) {
      socket.on(event, (...args: unknown[]) => {
        const plan = planEvent(event, args, limiters, options.now(), options.rateLimits);
        limiters = plan.limiters;
        const { outcome } = plan;
        switch (outcome.type) {
          case 'ignore':
            log({ event, outcome: 'no_ack' });
            break;
          case 'reject':
            log({ event, outcome: outcome.error });
            outcome.ack({ ok: false, error: outcome.error });
            break;
          case 'accept':
            run(toCommand(outcome.accepted, socket.id), event, outcome.ack);
            break;
        }
      });
    }

    socket.on('disconnect', () => {
      run({ type: 'leave', socketId: socket.id }, 'disconnect');
      log({ event: 'disconnect', count: io.of('/').sockets.size });
    });
  });

  const sweep = setInterval(() => {
    const before = store.sessions.size;
    run({ type: 'expire' }, 'sweep');
    log({ event: 'sweep', outcome: 'expired', count: before - store.sessions.size });
  }, options.sweepIntervalMs);
  sweep.unref();

  return {
    stop: () => clearInterval(sweep),
  };
}
