import { isPositiveSafeSeq, isToken, MAX_CIPHERTEXT_CHARS, TAG_BYTES, type AckErrorCode } from '@slm/shared';

export interface SenderRecord {
  readonly senderToken: string;
  readonly keyFragment: string;
  readonly lastSeq: number;
}

const KEY_FRAGMENT_LENGTH = 43;

export function senderRecordKey(sessionId: string): string {
  return `slm:sender:${sessionId}`;
}

export function receiverTokenKey(sessionId: string): string {
  return `slm:receiver:${sessionId}`;
}

export function buildReceiverLink(origin: string, sessionId: string, keyFragment: string): string {
  return `${origin}/r/${sessionId}#${keyFragment}`;
}

export function base64UrlLength(byteCount: number): number {
  return Math.ceil((byteCount * 4) / 3);
}

export function envelopeFits(text: string): boolean {
  const plaintextBytes = new TextEncoder().encode(text).length;
  return base64UrlLength(plaintextBytes + TAG_BYTES) <= MAX_CIPHERTEXT_CHARS;
}

export function serializeSenderRecord(record: SenderRecord): string {
  return JSON.stringify(record);
}

export function parseSenderRecord(raw: string | null): SenderRecord | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { senderToken, keyFragment, lastSeq } = value as Record<string, unknown>;
  if (!isToken(senderToken)) return null;
  if (typeof keyFragment !== 'string' || keyFragment.length !== KEY_FRAGMENT_LENGTH) return null;
  if (lastSeq !== 0 && !isPositiveSafeSeq(lastSeq)) return null;
  return { senderToken, keyFragment, lastSeq: lastSeq as number };
}

export function withLastSeq(record: SenderRecord, lastSeq: number): SenderRecord {
  return { ...record, lastSeq };
}

export type SenderError = AckErrorCode | 'protocol_error' | 'unreachable';
