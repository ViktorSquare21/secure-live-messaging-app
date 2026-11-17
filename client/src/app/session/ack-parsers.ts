import {
  ACK_ERROR_CODES,
  isSessionId,
  isToken,
  type AckError,
  type PublishAck,
  type SenderJoinAck,
  type SessionCreateAck,
} from '@slm/shared';

type Fields = Readonly<Record<string, unknown>>;

function plainObject(input: unknown): Fields | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null ? (input as Fields) : null;
}

function hasOnlyKeys(fields: Fields, allowed: readonly string[]): boolean {
  return Object.keys(fields).every((key) => allowed.includes(key));
}

function parseAckError(fields: Fields): AckError | null {
  if (fields['ok'] !== false || !hasOnlyKeys(fields, ['ok', 'error'])) return null;
  const code = ACK_ERROR_CODES.find((candidate) => candidate === fields['error']);
  return code === undefined ? null : { ok: false, error: code };
}

// Acks come off the network like any other payload; a hostile object must yield null, not an exception.
function safely<T>(parse: () => T | null): T | null {
  try {
    return parse();
  } catch {
    return null;
  }
}

export function parseSessionCreateAck(input: unknown): SessionCreateAck | null {
  return safely(() => {
    const fields = plainObject(input);
    if (fields === null) return null;
    if (fields['ok'] !== true) return parseAckError(fields);
    const { sessionId, senderToken } = fields;
    if (!hasOnlyKeys(fields, ['ok', 'sessionId', 'senderToken'])) return null;
    return isSessionId(sessionId) && isToken(senderToken) ? { ok: true, sessionId, senderToken } : null;
  });
}

function parseOkOnly(input: unknown): { readonly ok: true } | AckError | null {
  return safely(() => {
    const fields = plainObject(input);
    if (fields === null) return null;
    if (fields['ok'] !== true) return parseAckError(fields);
    return hasOnlyKeys(fields, ['ok']) ? { ok: true } : null;
  });
}

export function parseSenderJoinAck(input: unknown): SenderJoinAck | null {
  return parseOkOnly(input);
}

export function parsePublishAck(input: unknown): PublishAck | null {
  return parseOkOnly(input);
}

// The latest envelope stays unknown so the receiver transition, not the parser, decides on a bad one.
export type ReceiverJoinResult =
  | { readonly ok: true; readonly rejoinToken: string; readonly latest?: unknown }
  | AckError;

export function parseReceiverJoinAck(input: unknown): ReceiverJoinResult | null {
  return safely(() => {
    const fields = plainObject(input);
    if (fields === null) return null;
    if (fields['ok'] !== true) return parseAckError(fields);
    if (!hasOnlyKeys(fields, ['ok', 'rejoinToken', 'latest'])) return null;
    const { rejoinToken, latest } = fields;
    if (!isToken(rejoinToken)) return null;
    return latest === undefined ? { ok: true, rejoinToken } : { ok: true, rejoinToken, latest };
  });
}
