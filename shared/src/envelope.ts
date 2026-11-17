import { decodeBase64Url } from './base64url';
import { hasExactKeys } from './object-shape';

export const ENVELOPE_VERSION = 1;
export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const MAX_CIPHERTEXT_CHARS = 65_536;

export interface Envelope {
  readonly v: typeof ENVELOPE_VERSION;
  readonly seq: number;
  readonly iv: string;
  readonly ct: string;
}

export interface ParsedEnvelope {
  readonly seq: number;
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ct: Uint8Array<ArrayBuffer>;
}

const ENVELOPE_KEYS: readonly string[] = ['v', 'seq', 'iv', 'ct'];

export function isPositiveSafeSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

// Changing this format is a protocol version bump: old envelopes would stop verifying.
export function buildAad(sessionId: string, seq: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`slm:v${ENVELOPE_VERSION}|${sessionId}|${seq}`);
}

export function parseEnvelope(input: unknown): ParsedEnvelope | null {
  if (!hasExactKeys(input, ENVELOPE_KEYS)) return null;
  const { v, seq, iv, ct } = input;
  if (v !== ENVELOPE_VERSION || !isPositiveSafeSeq(seq)) return null;
  if (typeof iv !== 'string' || typeof ct !== 'string') return null;
  if (ct.length > MAX_CIPHERTEXT_CHARS) return null;
  const ivBytes = decodeBase64Url(iv);
  const ctBytes = decodeBase64Url(ct);
  if (ivBytes === null || ivBytes.length !== IV_BYTES) return null;
  if (ctBytes === null || ctBytes.length < TAG_BYTES) return null;
  return { seq, iv: ivBytes, ct: ctBytes };
}
