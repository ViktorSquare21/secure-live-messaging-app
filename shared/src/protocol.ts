import type { Envelope } from './envelope';

export const EVENTS = {
  sessionCreate: 'session:create',
  senderJoin: 'sender:join',
  receiverJoin: 'receiver:join',
  messagePublish: 'message:publish',
  messageUpdate: 'message:update',
  peerStatus: 'peer:status',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export const ACK_ERROR_CODES = [
  'unknown_session',
  'bad_token',
  'slot_taken',
  'not_sender',
  'invalid_payload',
  'stale_seq',
  'server_busy',
  'rate_limited',
] as const;

export type AckErrorCode = (typeof ACK_ERROR_CODES)[number];

export const PEER_STATES = ['connected', 'disconnected'] as const;

export type PeerState = (typeof PEER_STATES)[number];

export const SESSION_ID_BYTES = 16;
export const TOKEN_BYTES = 32;
export const SESSION_ID_LENGTH = base64UrlLength(SESSION_ID_BYTES);
export const TOKEN_LENGTH = base64UrlLength(TOKEN_BYTES);

function base64UrlLength(byteCount: number): number {
  return Math.ceil((byteCount * 4) / 3);
}

export interface SenderJoinPayload {
  readonly sessionId: string;
  readonly senderToken: string;
}

export interface ReceiverJoinPayload {
  readonly sessionId: string;
  readonly rejoinToken?: string;
}

export interface PeerStatusPayload {
  readonly peer: PeerState;
}

export interface AckError {
  readonly ok: false;
  readonly error: AckErrorCode;
}

export type SessionCreateAck =
  | { readonly ok: true; readonly sessionId: string; readonly senderToken: string }
  | AckError;

export type SenderJoinAck = { readonly ok: true } | AckError;

export type ReceiverJoinAck =
  | { readonly ok: true; readonly rejoinToken: string; readonly latest?: Envelope }
  | AckError;

export type PublishAck = { readonly ok: true } | AckError;
