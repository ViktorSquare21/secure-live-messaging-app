import {
  EVENTS,
  isValidEnvelope,
  isValidReceiverJoin,
  isValidSenderJoin,
  type AckErrorCode,
  type Envelope,
  type ReceiverJoinPayload,
  type SenderJoinPayload,
} from '@slm/shared';
import { checkRateLimit, type RateLimit, type RateLimiterState } from './rate-limiter';

export type ClientEvent =
  | typeof EVENTS.sessionCreate
  | typeof EVENTS.senderJoin
  | typeof EVENTS.receiverJoin
  | typeof EVENTS.messagePublish;

export const CLIENT_EVENTS: readonly ClientEvent[] = [
  EVENTS.sessionCreate,
  EVENTS.senderJoin,
  EVENTS.receiverJoin,
  EVENTS.messagePublish,
];

export interface RateLimits {
  readonly sessionCreate: RateLimit;
  readonly messagePublish: RateLimit;
}

export interface SocketLimiters {
  readonly sessionCreate?: RateLimiterState | undefined;
  readonly messagePublish?: RateLimiterState | undefined;
}

export type Ack = (result: unknown) => void;

export type AcceptedEvent =
  | { readonly event: typeof EVENTS.sessionCreate }
  | { readonly event: typeof EVENTS.senderJoin; readonly payload: SenderJoinPayload }
  | { readonly event: typeof EVENTS.receiverJoin; readonly payload: ReceiverJoinPayload }
  | { readonly event: typeof EVENTS.messagePublish; readonly payload: Envelope };

export type IntakeOutcome =
  | { readonly type: 'ignore' }
  | { readonly type: 'reject'; readonly ack: Ack; readonly error: AckErrorCode }
  | { readonly type: 'accept'; readonly ack: Ack; readonly accepted: AcceptedEvent };

export interface IntakePlan {
  readonly limiters: SocketLimiters;
  readonly outcome: IntakeOutcome;
}

export function planEvent(
  event: ClientEvent,
  args: readonly unknown[],
  limiters: SocketLimiters,
  now: number,
  limits: RateLimits,
): IntakePlan {
  const ack = args[args.length - 1];
  if (typeof ack !== 'function') return { limiters, outcome: { type: 'ignore' } };
  const typedAck = ack as Ack;
  const payloadArgs = args.slice(0, -1);

  let nextLimiters = limiters;
  if (event === EVENTS.sessionCreate || event === EVENTS.messagePublish) {
    const key = event === EVENTS.sessionCreate ? 'sessionCreate' : 'messagePublish';
    const decision = checkRateLimit(limiters[key], now, limits[key]);
    nextLimiters = { ...limiters, [key]: decision.state };
    if (!decision.allowed) {
      return { limiters: nextLimiters, outcome: { type: 'reject', ack: typedAck, error: 'rate_limited' } };
    }
  }

  const accepted = acceptPayload(event, payloadArgs);
  const outcome: IntakeOutcome =
    accepted === null
      ? { type: 'reject', ack: typedAck, error: 'invalid_payload' }
      : { type: 'accept', ack: typedAck, accepted };
  return { limiters: nextLimiters, outcome };
}

function acceptPayload(event: ClientEvent, payloadArgs: readonly unknown[]): AcceptedEvent | null {
  if (event === EVENTS.sessionCreate) {
    return payloadArgs.length === 0 ? { event } : null;
  }
  if (payloadArgs.length !== 1) return null;
  const payload = payloadArgs[0];
  switch (event) {
    case EVENTS.senderJoin:
      return isValidSenderJoin(payload) ? { event, payload } : null;
    case EVENTS.receiverJoin:
      return isValidReceiverJoin(payload) ? { event, payload } : null;
    case EVENTS.messagePublish:
      return isValidEnvelope(payload) ? { event, payload } : null;
  }
}
