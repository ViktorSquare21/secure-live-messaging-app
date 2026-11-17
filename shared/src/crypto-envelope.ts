import { decodeBase64Url, encodeBase64Url } from './base64url';
import {
  buildAad,
  ENVELOPE_VERSION,
  IV_BYTES,
  isPositiveSafeSeq,
  KEY_BYTES,
  parseEnvelope,
  TAG_BYTES,
  type Envelope,
  type ParsedEnvelope,
} from './envelope';

// The server's Node typings declare only the CryptoKey value globally, not the type, so the type is derived from it.
export type SessionKey = InstanceType<typeof CryptoKey>;

export type ImportKeyResult = { readonly status: 'ok'; readonly key: SessionKey } | { readonly status: 'malformed' };

export type DecryptResult =
  | { readonly status: 'ok'; readonly text: string; readonly seq: number }
  | { readonly status: 'integrity_error' }
  | { readonly status: 'malformed' };

const ALGORITHM = 'AES-GCM';
const FRAGMENT_LENGTH = 43;

export function generateKey(): Promise<SessionKey> {
  return crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_BYTES * 8 }, true, ['encrypt', 'decrypt']);
}

export async function exportKeyToFragment(key: SessionKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return encodeBase64Url(new Uint8Array(raw));
}

export async function importKeyFromFragment(fragment: string): Promise<ImportKeyResult> {
  const value = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (value.length !== FRAGMENT_LENGTH) return { status: 'malformed' };
  const raw = decodeBase64Url(value);
  if (raw === null || raw.length !== KEY_BYTES) return { status: 'malformed' };
  try {
    const key = await crypto.subtle.importKey('raw', raw, { name: ALGORITHM }, false, ['encrypt', 'decrypt']);
    return { status: 'ok', key };
  } catch {
    return { status: 'malformed' };
  }
}

export async function encrypt(key: SessionKey, sessionId: string, seq: number, plaintext: string): Promise<Envelope> {
  if (!isPositiveSafeSeq(seq)) throw new RangeError('invalid_seq');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, additionalData: buildAad(sessionId, seq), tagLength: TAG_BYTES * 8 },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { v: ENVELOPE_VERSION, seq, iv: encodeBase64Url(iv), ct: encodeBase64Url(new Uint8Array(ciphertext)) };
}

export async function decrypt(key: SessionKey, sessionId: string, input: unknown): Promise<DecryptResult> {
  let parsed: ParsedEnvelope | null;
  try {
    parsed = parseEnvelope(input);
  } catch {
    return { status: 'malformed' };
  }
  if (parsed === null) return { status: 'malformed' };

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: parsed.iv, additionalData: buildAad(sessionId, parsed.seq), tagLength: TAG_BYTES * 8 },
      key,
      parsed.ct,
    );
  } catch {
    return { status: 'integrity_error' };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    return { status: 'ok', text, seq: parsed.seq };
  } catch {
    return { status: 'malformed' };
  }
}
