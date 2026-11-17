import { decodeBase64Url } from './base64url';
import { parseEnvelope, type Envelope } from './envelope';
import { hasExactKeys } from './object-shape';
import {
  PEER_STATES,
  SESSION_ID_BYTES,
  SESSION_ID_LENGTH,
  TOKEN_BYTES,
  TOKEN_LENGTH,
  type PeerStatusPayload,
  type ReceiverJoinPayload,
  type SenderJoinPayload,
} from './protocol';

const SENDER_JOIN_KEYS: readonly string[] = ['sessionId', 'senderToken'];
const RECEIVER_JOIN_KEYS: readonly string[] = ['sessionId'];
const RECEIVER_JOIN_OPTIONAL_KEYS: readonly string[] = ['rejoinToken'];
const PEER_STATUS_KEYS: readonly string[] = ['peer'];

// Inputs come off the network and may be proxies or carry getters that throw; a validator must answer, not throw.
function neverThrows(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function isFixedSizeBase64Url(value: unknown, length: number, byteCount: number): value is string {
  if (typeof value !== 'string' || value.length !== length) return false;
  return decodeBase64Url(value)?.length === byteCount;
}

export function isSessionId(value: unknown): value is string {
  return neverThrows(() => isFixedSizeBase64Url(value, SESSION_ID_LENGTH, SESSION_ID_BYTES));
}

export function isToken(value: unknown): value is string {
  return neverThrows(() => isFixedSizeBase64Url(value, TOKEN_LENGTH, TOKEN_BYTES));
}

export function isValidEnvelope(input: unknown): input is Envelope {
  return neverThrows(() => parseEnvelope(input) !== null);
}

export function isValidSenderJoin(input: unknown): input is SenderJoinPayload {
  return neverThrows(
    () => hasExactKeys(input, SENDER_JOIN_KEYS) && isSessionId(input['sessionId']) && isToken(input['senderToken']),
  );
}

export function isValidReceiverJoin(input: unknown): input is ReceiverJoinPayload {
  return neverThrows(
    () =>
      hasExactKeys(input, RECEIVER_JOIN_KEYS, RECEIVER_JOIN_OPTIONAL_KEYS) &&
      isSessionId(input['sessionId']) &&
      (!Object.hasOwn(input, 'rejoinToken') || isToken(input['rejoinToken'])),
  );
}

export function isValidPeerStatus(input: unknown): input is PeerStatusPayload {
  return neverThrows(
    () => hasExactKeys(input, PEER_STATUS_KEYS) && PEER_STATES.some((state) => state === input['peer']),
  );
}
