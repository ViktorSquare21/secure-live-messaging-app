import { describe, expect, test } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from './base64url';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('encodeBase64Url', () => {
  test.each([
    [bytes(), ''],
    [bytes(0x66), 'Zg'],
    [bytes(0x66, 0x6f), 'Zm8'],
    [bytes(0x66, 0x6f, 0x6f), 'Zm9v'],
    [bytes(0xfb, 0xff), '-_8'],
    [bytes(0xff, 0xff, 0xff), '____'],
  ])('encodes %o as %s without padding', (input, expected) => {
    expect(encodeBase64Url(input)).toBe(expected);
  });
});

describe('decodeBase64Url', () => {
  test('round-trips every byte value at every remainder length', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (const length of [0, 1, 2, 3, 254, 255, 256]) {
      const input = all.slice(0, length);
      expect(decodeBase64Url(encodeBase64Url(input))).toEqual(input);
    }
  });

  test('decodes the url-safe characters', () => {
    expect(decodeBase64Url('-_8')).toEqual(bytes(0xfb, 0xff));
  });

  test.each([
    ['padding', 'Zg=='],
    ['single padding', 'Zm8='],
    ['standard plus', 'Zm+v'],
    ['standard slash', 'Zm/v'],
    ['space', 'Zm 9v'],
    ['newline', 'Zm9v\n'],
    ['non-alphabet character', 'Zm9v!'],
    ['non-ascii character', 'Zm9é'],
    ['length remainder of one', 'Zm9vZ'],
    ['non-zero trailing bits, two chars', 'Zh'],
    ['non-zero trailing bits, three chars', 'Zm9'],
  ])('rejects %s', (_, input) => {
    expect(decodeBase64Url(input)).toBeNull();
  });
});
