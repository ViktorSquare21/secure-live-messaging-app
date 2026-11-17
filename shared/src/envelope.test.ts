import { describe, expect, test } from 'vitest';
import { encodeBase64Url } from './base64url';
import { buildAad, isPositiveSafeSeq, MAX_CIPHERTEXT_CHARS, parseEnvelope } from './envelope';

const iv12 = encodeBase64Url(new Uint8Array(12));
const ct16 = encodeBase64Url(new Uint8Array(16));
const valid = { v: 1, seq: 5, iv: iv12, ct: ct16 };

describe('isPositiveSafeSeq', () => {
  test.each([1, 2, Number.MAX_SAFE_INTEGER])('accepts %s', (value) => {
    expect(isPositiveSafeSeq(value)).toBe(true);
  });

  test.each([0, -0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined])(
    'rejects %s',
    (value) => {
      expect(isPositiveSafeSeq(value)).toBe(false);
    },
  );
});

describe('buildAad', () => {
  test('encodes the versioned session id and seq', () => {
    expect(new TextDecoder().decode(buildAad('abc_-1', 42))).toBe('slm:v1|abc_-1|42');
  });

  test('differs when the session id or the seq differs', () => {
    const base = buildAad('session-a', 5);
    expect(buildAad('session-b', 5)).not.toEqual(base);
    expect(buildAad('session-a', 6)).not.toEqual(base);
  });
});

describe('parseEnvelope', () => {
  test('accepts a well-formed envelope and decodes its bytes', () => {
    const parsed = parseEnvelope(valid);
    expect(parsed?.seq).toBe(5);
    expect(parsed?.iv.length).toBe(12);
    expect(parsed?.ct.length).toBe(16);
  });

  test('accepts a ciphertext of exactly the size cap', () => {
    const ct = encodeBase64Url(new Uint8Array(49_152));
    expect(ct.length).toBe(MAX_CIPHERTEXT_CHARS);
    expect(parseEnvelope({ ...valid, ct })?.ct.length).toBe(49_152);
  });

  test('rejects a well-formed ciphertext just over the size cap', () => {
    const ct = encodeBase64Url(new Uint8Array(49_153));
    expect(ct.length).toBe(MAX_CIPHERTEXT_CHARS + 2);
    expect(parseEnvelope({ ...valid, ct })).toBeNull();
  });

  const { ct: _ct, ...missingCt } = valid;

  class EnvelopeLike {
    v = 1;
    seq = 5;
    iv = iv12;
    ct = ct16;
  }

  test.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'envelope'],
    ['a number', 1],
    ['an array', [1, 5, iv12, ct16]],
    ['a missing field', missingCt],
    ['an extra field', { ...valid, sessionId: 'other' }],
    ['version 2', { ...valid, v: 2 }],
    ['version as a string', { ...valid, v: '1' }],
    ['seq as a string', { ...valid, seq: '5' }],
    ['seq zero', { ...valid, seq: 0 }],
    ['negative seq', { ...valid, seq: -1 }],
    ['fractional seq', { ...valid, seq: 1.5 }],
    ['seq beyond the safe range', { ...valid, seq: Number.MAX_SAFE_INTEGER + 1 }],
    ['iv not a string', { ...valid, iv: 12 }],
    ['ct not a string', { ...valid, ct: null }],
    ['iv of 11 bytes', { ...valid, iv: encodeBase64Url(new Uint8Array(11)) }],
    ['iv of 13 bytes', { ...valid, iv: encodeBase64Url(new Uint8Array(13)) }],
    ['iv not base64url', { ...valid, iv: `${iv12.slice(0, 15)}+` }],
    ['ct not base64url', { ...valid, ct: `${ct16}=` }],
    ['ct shorter than the tag', { ...valid, ct: encodeBase64Url(new Uint8Array(15)) }],
    ['a class instance', new EnvelopeLike()],
  ])('rejects %s', (_, input) => {
    expect(parseEnvelope(input)).toBeNull();
  });
});
