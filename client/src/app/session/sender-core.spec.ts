import { MAX_CIPHERTEXT_CHARS, TAG_BYTES } from '@slm/shared';
import {
  base64UrlLength,
  buildReceiverLink,
  envelopeFits,
  nextSenderConnection,
  parseSenderRecord,
  receiverTokenKey,
  senderRecordKey,
  serializeSenderRecord,
  withLastSeq,
} from './sender-core';
import { randomSessionId, randomToken } from './testing/fake-session-socket';

const fragment = 'A'.repeat(43);

describe('sender core', () => {
  it('builds the receiver link with the key only in the fragment', () => {
    const sessionId = randomSessionId();
    const link = buildReceiverLink('https://app.test', sessionId, fragment);
    expect(link).toBe(`https://app.test/r/${sessionId}#${fragment}`);
    expect(new URL(link).search).toBe('');
    expect(new URL(link).pathname).not.toContain(fragment);
  });

  it('keeps sender and receiver storage keys apart', () => {
    expect(senderRecordKey('x')).not.toBe(receiverTokenKey('x'));
  });

  it('fits text right up to the ciphertext cap and refuses one byte more', () => {
    const maxPlaintextBytes = Math.floor((MAX_CIPHERTEXT_CHARS * 3) / 4) - TAG_BYTES;
    expect(base64UrlLength(maxPlaintextBytes + TAG_BYTES)).toBeLessThanOrEqual(MAX_CIPHERTEXT_CHARS);
    expect(envelopeFits('a'.repeat(maxPlaintextBytes))).toBe(true);
    expect(envelopeFits('a'.repeat(maxPlaintextBytes + 1))).toBe(false);
  });

  it('counts UTF-8 bytes, not characters', () => {
    const maxPlaintextBytes = Math.floor((MAX_CIPHERTEXT_CHARS * 3) / 4) - TAG_BYTES;
    expect(envelopeFits('é'.repeat(Math.ceil((maxPlaintextBytes + 1) / 2)))).toBe(false);
  });

  it('allows empty text', () => {
    expect(envelopeFits('')).toBe(true);
  });

  it('round-trips a sender record and updates the seq without mutating', () => {
    const record = { senderToken: randomToken(), keyFragment: fragment, lastSeq: 0 };
    expect(parseSenderRecord(serializeSenderRecord(record))).toEqual(record);
    const next = withLastSeq(record, 5);
    expect(next.lastSeq).toBe(5);
    expect(record.lastSeq).toBe(0);
  });

  it('rejects a missing, corrupt or invalid sender record', () => {
    const senderToken = randomToken();
    expect(parseSenderRecord(null)).toBeNull();
    expect(parseSenderRecord('{not json')).toBeNull();
    expect(parseSenderRecord('null')).toBeNull();
    expect(parseSenderRecord(JSON.stringify({ senderToken: 'x', keyFragment: fragment, lastSeq: 0 }))).toBeNull();
    expect(parseSenderRecord(JSON.stringify({ senderToken, keyFragment: 'short', lastSeq: 0 }))).toBeNull();
    expect(parseSenderRecord(JSON.stringify({ senderToken, keyFragment: fragment, lastSeq: -1 }))).toBeNull();
    expect(parseSenderRecord(JSON.stringify({ senderToken, keyFragment: fragment, lastSeq: 1.5 }))).toBeNull();
  });

  it('stays connecting until the first connect, then follows every state including a drop', () => {
    expect(nextSenderConnection('connecting', 'disconnected')).toBe('connecting');
    expect(nextSenderConnection('connecting', 'connected')).toBe('connected');
    expect(nextSenderConnection('connected', 'disconnected')).toBe('disconnected');
    expect(nextSenderConnection('disconnected', 'reconnected')).toBe('reconnected');
  });
});
