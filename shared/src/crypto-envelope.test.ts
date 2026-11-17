import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from './base64url';
import {
  decrypt,
  encrypt,
  exportKeyToFragment,
  generateKey,
  importKeyFromFragment,
  type DecryptResult,
  type SessionKey,
} from './crypto-envelope';
import { buildAad, type Envelope } from './envelope';

const SESSION = 'session-a';
const SECRET = 'the secret text';
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

let key: SessionKey;

beforeAll(async () => {
  key = await generateKey();
});

function flipBit(field: string, byteIndex: number): string {
  const bytes = decodeBase64Url(field);
  if (bytes === null) throw new Error('test fixture is not base64url');
  const index = byteIndex < 0 ? bytes.length + byteIndex : byteIndex;
  bytes[index] = (bytes[index] ?? 0) ^ 0x01;
  return encodeBase64Url(bytes);
}

async function importOk(fragment: string): Promise<SessionKey> {
  const result = await importKeyFromFragment(fragment);
  if (result.status !== 'ok') throw new Error('expected the fragment to import');
  return result.key;
}

function expectNoPlaintext(result: DecryptResult, plaintext: string): void {
  expect(result).not.toHaveProperty('text');
  expect(JSON.stringify(result)).not.toContain(plaintext);
}

describe('round-trip', () => {
  test('decrypts with the same key, session and seq', async () => {
    const envelope = await encrypt(key, SESSION, 1, SECRET);
    await expect(decrypt(key, SESSION, envelope)).resolves.toEqual({ status: 'ok', text: SECRET, seq: 1 });
  });

  test('decrypts with the key carried through the link fragment', async () => {
    const receiverKey = await importOk(await exportKeyToFragment(key));
    const envelope = await encrypt(key, SESSION, 3, SECRET);
    await expect(decrypt(receiverKey, SESSION, envelope)).resolves.toEqual({ status: 'ok', text: SECRET, seq: 3 });
  });

  test('accepts a fragment with a leading # (the raw location hash)', async () => {
    const receiverKey = await importOk(`#${await exportKeyToFragment(key)}`);
    const envelope = await encrypt(key, SESSION, 1, SECRET);
    await expect(decrypt(receiverKey, SESSION, envelope)).resolves.toMatchObject({ status: 'ok', text: SECRET });
  });

  test.each([
    ['accents', 'Árvíztűrő tükörfúrógép'],
    ['emoji', 'hello 👋🏽 🔐'],
    ['line breaks', 'line one\nline two\r\n\tline three'],
    ['html', '<script>alert(1)</script>'],
    ['empty text', ''],
  ])('returns %s exactly', async (_, text) => {
    const envelope = await encrypt(key, SESSION, 7, text);
    await expect(decrypt(key, SESSION, envelope)).resolves.toEqual({ status: 'ok', text, seq: 7 });
  });
});

describe('integrity_error', () => {
  let envelope: Envelope;

  beforeAll(async () => {
    envelope = await encrypt(key, SESSION, 5, SECRET);
  });

  test.each<[string, () => Envelope]>([
    ['a flipped ciphertext bit', () => ({ ...envelope, ct: flipBit(envelope.ct, 0) })],
    ['a flipped tag bit', () => ({ ...envelope, ct: flipBit(envelope.ct, -1) })],
    ['a flipped IV bit', () => ({ ...envelope, iv: flipBit(envelope.iv, 0) })],
    ['seq changed upward', () => ({ ...envelope, seq: 6 })],
    ['seq changed downward', () => ({ ...envelope, seq: 4 })],
  ])('for %s', async (_, tamper) => {
    const result = await decrypt(key, SESSION, tamper());
    expect(result).toEqual({ status: 'integrity_error' });
    expectNoPlaintext(result, SECRET);
  });

  test('for a different key', async () => {
    const result = await decrypt(await generateKey(), SESSION, envelope);
    expect(result).toEqual({ status: 'integrity_error' });
    expectNoPlaintext(result, SECRET);
  });

  test('for a different session id than the one encrypted for', async () => {
    const result = await decrypt(key, 'session-b', envelope);
    expect(result).toEqual({ status: 'integrity_error' });
    expectNoPlaintext(result, SECRET);
  });
});

describe('envelope shape', () => {
  test('has version 1, a 12-byte IV and ciphertext 16 bytes longer than the UTF-8 text', async () => {
    const text = 'naïve 🔐';
    const envelope = await encrypt(key, SESSION, 9, text);
    expect(Object.keys(envelope).sort()).toEqual(['ct', 'iv', 'seq', 'v']);
    expect(envelope.v).toBe(1);
    expect(envelope.seq).toBe(9);
    expect(envelope.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(decodeBase64Url(envelope.iv)?.length).toBe(12);
    expect(decodeBase64Url(envelope.ct)?.length).toBe(new TextEncoder().encode(text).length + 16);
  });
});

describe('IV freshness', () => {
  test('the same input encrypted twice gives different IVs and ciphertexts', async () => {
    const first = await encrypt(key, SESSION, 1, SECRET);
    const second = await encrypt(key, SESSION, 1, SECRET);
    expect(second.iv).not.toBe(first.iv);
    expect(second.ct).not.toBe(first.ct);
  });

  test('1000 encryptions produce 1000 distinct IVs', async () => {
    const envelopes = await Promise.all(Array.from({ length: 1000 }, () => encrypt(key, SESSION, 1, SECRET)));
    expect(new Set(envelopes.map((envelope) => envelope.iv)).size).toBe(1000);
  });
});

describe('encrypt refuses an invalid seq', () => {
  test.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('%s', async (seq) => {
    await expect(encrypt(key, SESSION, seq, SECRET)).rejects.toThrow(RangeError);
  });
});

describe('key fragment', () => {
  test('is 43 base64url characters with no padding or #', async () => {
    const fragment = await exportKeyToFragment(key);
    expect(fragment).toMatch(BASE64URL_43);
  });

  test('the generated sender key is extractable, the imported receiver key is not', async () => {
    expect(key.extractable).toBe(true);
    const receiverKey = await importOk(await exportKeyToFragment(key));
    expect(receiverKey.extractable).toBe(false);
    expect(receiverKey.usages.slice().sort()).toEqual(['decrypt', 'encrypt']);
    await expect(crypto.subtle.exportKey('raw', receiverKey)).rejects.toThrow();
    await expect(exportKeyToFragment(receiverKey)).rejects.toThrow();
  });

  test.each<[string, (valid: string) => string]>([
    ['empty', () => ''],
    ['a lone #', () => '#'],
    ['42 characters', (valid) => valid.slice(0, 42)],
    ['44 characters', (valid) => `${valid}A`],
    ['padded with =', (valid) => `${valid}=`],
    ['a + in place of a character', (valid) => `+${valid.slice(1)}`],
    ['a / in place of a character', (valid) => `/${valid.slice(1)}`],
    ['whitespace', (valid) => ` ${valid.slice(1)}`],
    ['a trailing newline', (valid) => `${valid.slice(1)}\n`],
    ['a non-alphabet character', (valid) => `.${valid.slice(1)}`],
    ['two leading #', (valid) => `##${valid}`],
    ['43 characters with non-zero trailing bits', (valid) => `${valid.slice(0, 42)}B`],
    ['a 32-byte value encoded with padding', (valid) => `${valid.slice(0, 42)}A=`],
    ['a valid-looking value of 33 bytes', () => encodeBase64Url(new Uint8Array(33))],
    ['a valid-looking value of 31 bytes', () => encodeBase64Url(new Uint8Array(31))],
  ])('is malformed when %s, without throwing', async (_, corrupt) => {
    const fragment = corrupt(await exportKeyToFragment(key));
    await expect(importKeyFromFragment(fragment)).resolves.toEqual({ status: 'malformed' });
  });
});

describe('decrypt returns malformed without throwing', () => {
  let envelope: Envelope;

  beforeAll(async () => {
    envelope = await encrypt(key, SESSION, 5, SECRET);
  });

  test.each<[string, () => unknown]>([
    ['null', () => null],
    ['a string', () => JSON.stringify(envelope)],
    ['an array', () => [envelope.v, envelope.seq, envelope.iv, envelope.ct]],
    ['a missing field', () => ({ v: envelope.v, seq: envelope.seq, iv: envelope.iv })],
    ['an extra field', () => ({ ...envelope, sessionId: SESSION })],
    ['version 2', () => ({ ...envelope, v: 2 })],
    ['seq as a string', () => ({ ...envelope, seq: '5' })],
    ['seq zero', () => ({ ...envelope, seq: 0 })],
    ['negative seq', () => ({ ...envelope, seq: -5 })],
    ['fractional seq', () => ({ ...envelope, seq: 5.5 })],
    ['an IV of 11 bytes', () => ({ ...envelope, iv: encodeBase64Url(new Uint8Array(11)) })],
    ['an IV of 13 bytes', () => ({ ...envelope, iv: encodeBase64Url(new Uint8Array(13)) })],
    ['an IV that is not base64url', () => ({ ...envelope, iv: `${envelope.iv.slice(1)}=` })],
    ['a ciphertext that is not base64url', () => ({ ...envelope, ct: `${envelope.ct}!` })],
    ['a ciphertext shorter than the tag', () => ({ ...envelope, ct: envelope.ct.slice(0, 20) })],
    ['a ciphertext over the size cap', () => ({ ...envelope, ct: encodeBase64Url(new Uint8Array(49_153)) })],
    [
      'an object whose field access throws',
      () =>
        new Proxy(envelope, {
          ownKeys: () => {
            throw new Error(SECRET);
          },
        }),
    ],
  ])('for %s', async (_, input) => {
    const result = await decrypt(key, SESSION, input());
    expect(result).toEqual({ status: 'malformed' });
    expectNoPlaintext(result, SECRET);
  });

  test('for authentic bytes that are not valid UTF-8', async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: buildAad(SESSION, 1) },
      key,
      new Uint8Array([0xff, 0xfe, 0xfd]),
    );
    const forged = { v: 1, seq: 1, iv: encodeBase64Url(iv), ct: encodeBase64Url(new Uint8Array(ct)) };
    await expect(decrypt(key, SESSION, forged)).resolves.toEqual({ status: 'malformed' });
  });
});

describe('no side channels out of the module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a full sender-to-receiver flow, including failures, makes no network or console calls', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    const senderKey = await generateKey();
    const receiverKey = await importOk(await exportKeyToFragment(senderKey));
    const envelope = await encrypt(senderKey, SESSION, 1, SECRET);
    await decrypt(receiverKey, SESSION, envelope);
    await decrypt(receiverKey, 'session-b', envelope);
    await decrypt(receiverKey, SESSION, { ...envelope, v: 2 });
    await importKeyFromFragment('not a key');

    expect(fetchSpy).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
