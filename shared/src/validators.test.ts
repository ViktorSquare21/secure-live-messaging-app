import { afterEach, describe, expect, test, vi } from 'vitest';
import { encodeBase64Url } from './base64url';
import { IV_BYTES, MAX_CIPHERTEXT_CHARS, TAG_BYTES } from './envelope';
import { SESSION_ID_BYTES, TOKEN_BYTES } from './protocol';
import {
  isSessionId,
  isToken,
  isValidEnvelope,
  isValidPeerStatus,
  isValidReceiverJoin,
  isValidSenderJoin,
} from './validators';

const base64UrlOf = (byteCount: number, fill = 0) => encodeBase64Url(new Uint8Array(byteCount).fill(fill));

const iv = base64UrlOf(IV_BYTES);
const ct = base64UrlOf(TAG_BYTES);
const envelope = { v: 1, seq: 1, iv, ct };

const sessionId = base64UrlOf(SESSION_ID_BYTES, 0xab);
const senderToken = base64UrlOf(TOKEN_BYTES, 0xcd);
const rejoinToken = base64UrlOf(TOKEN_BYTES, 0xef);

const validators = [
  isSessionId,
  isToken,
  isValidEnvelope,
  isValidSenderJoin,
  isValidReceiverJoin,
  isValidPeerStatus,
] as const;

describe('id and token formats', () => {
  test('a session id is 22 characters and a token is 43', () => {
    expect(sessionId).toHaveLength(22);
    expect(senderToken).toHaveLength(43);
    expect(isSessionId(sessionId)).toBe(true);
    expect(isToken(senderToken)).toBe(true);
  });

  test.each<[string, unknown]>([
    ['21 characters', sessionId.slice(1)],
    ['23 characters', `${sessionId}A`],
    ['a "+" character', `+${sessionId.slice(1)}`],
    ['non-zero trailing bits', `${sessionId.slice(0, 21)}B`],
    ['a token in place of an id', senderToken],
    ['a number', 1234],
  ])('a session id with %s is rejected', (_, value) => {
    expect(isSessionId(value)).toBe(false);
  });

  test.each<[string, unknown]>([
    ['42 characters', senderToken.slice(1)],
    ['44 characters', `${senderToken}A`],
    ['a "/" character', `/${senderToken.slice(1)}`],
    ['padding', `${senderToken.slice(0, 42)}=`],
    ['a session id in place of a token', sessionId],
  ])('a token with %s is rejected', (_, value) => {
    expect(isToken(value)).toBe(false);
  });
});

describe('isValidEnvelope', () => {
  test('accepts v 1, seq 1, a 12-byte IV and a 16-byte ciphertext', () => {
    expect(isValidEnvelope(envelope)).toBe(true);
  });

  test('accepts seq at the largest safe integer', () => {
    expect(isValidEnvelope({ ...envelope, seq: Number.MAX_SAFE_INTEGER })).toBe(true);
  });

  test('accepts a ciphertext of exactly 65,536 characters', () => {
    const atCap = 'A'.repeat(MAX_CIPHERTEXT_CHARS);
    expect(atCap).toHaveLength(65_536);
    expect(isValidEnvelope({ ...envelope, ct: atCap })).toBe(true);
  });

  test('rejects a ciphertext of 65,537 characters, a length that is also never valid base64url', () => {
    expect(isValidEnvelope({ ...envelope, ct: 'A'.repeat(MAX_CIPHERTEXT_CHARS + 1) })).toBe(false);
  });

  test('rejects a well-formed ciphertext of 65,538 characters, which only the size cap catches', () => {
    expect(isValidEnvelope({ ...envelope, ct: 'A'.repeat(MAX_CIPHERTEXT_CHARS + 2) })).toBe(false);
  });

  const { iv: _iv, ...missingIv } = envelope;

  test.each<[string, unknown]>([
    ['v as 2', { ...envelope, v: 2 }],
    ['v as "1"', { ...envelope, v: '1' }],
    ['seq as "1"', { ...envelope, seq: '1' }],
    ['seq 0', { ...envelope, seq: 0 }],
    ['seq -1', { ...envelope, seq: -1 }],
    ['seq 1.5', { ...envelope, seq: 1.5 }],
    ['seq NaN', { ...envelope, seq: Number.NaN }],
    ['seq Infinity', { ...envelope, seq: Number.POSITIVE_INFINITY }],
    ['seq beyond the safe range', { ...envelope, seq: Number.MAX_SAFE_INTEGER + 1 }],
    ['iv as a number', { ...envelope, iv: 12 }],
    ['ct as a number', { ...envelope, ct: 16 }],
    ['an IV of 11 bytes', { ...envelope, iv: base64UrlOf(11) }],
    ['an IV of 13 bytes', { ...envelope, iv: base64UrlOf(13) }],
    ['an IV with "="', { ...envelope, iv: `${iv.slice(1)}=` }],
    ['an IV with "+"', { ...envelope, iv: `${iv.slice(1)}+` }],
    ['an IV with "/"', { ...envelope, iv: `${iv.slice(1)}/` }],
    ['a ciphertext of 15 bytes', { ...envelope, ct: base64UrlOf(15) }],
    ['an empty ciphertext', { ...envelope, ct: '' }],
    ['an extra field', { ...envelope, sessionId }],
    ['a missing field', missingIv],
    ['null', null],
    ['an array', [1, 1, iv, ct]],
    ['a string', JSON.stringify(envelope)],
    ['undefined', undefined],
  ])('rejects %s', (_, input) => {
    expect(isValidEnvelope(input)).toBe(false);
  });
});

describe('isValidSenderJoin', () => {
  test('accepts a session id and a sender token', () => {
    expect(isValidSenderJoin({ sessionId, senderToken })).toBe(true);
  });

  test.each<[string, unknown]>([
    ['a 21-character id', { sessionId: sessionId.slice(1), senderToken }],
    ['a 23-character id', { sessionId: `${sessionId}A`, senderToken }],
    ['an id that is not base64url', { sessionId: `${sessionId.slice(1)}!`, senderToken }],
    ['a missing token', { sessionId }],
    ['a malformed token', { sessionId, senderToken: senderToken.slice(1) }],
    ['a claimed role', { sessionId, senderToken, role: 'sender' }],
    ['the rejoin token field instead', { sessionId, rejoinToken: senderToken }],
    ['null', null],
  ])('rejects %s', (_, input) => {
    expect(isValidSenderJoin(input)).toBe(false);
  });
});

describe('isValidReceiverJoin', () => {
  test('accepts a session id alone', () => {
    expect(isValidReceiverJoin({ sessionId })).toBe(true);
  });

  test('accepts a session id with a rejoin token', () => {
    expect(isValidReceiverJoin({ sessionId, rejoinToken })).toBe(true);
  });

  test.each<[string, unknown]>([
    ['a 21-character id', { sessionId: sessionId.slice(1) }],
    ['a 23-character id', { sessionId: `${sessionId}A` }],
    ['an id that is not base64url', { sessionId: `${sessionId.slice(1)}=` }],
    ['a missing id', { rejoinToken }],
    ['a malformed rejoin token', { sessionId, rejoinToken: rejoinToken.slice(1) }],
    ['a rejoin token set to undefined', { sessionId, rejoinToken: undefined }],
    ['a rejoin token set to null', { sessionId, rejoinToken: null }],
    ['a claimed role', { sessionId, role: 'sender' }],
    ['a sender token', { sessionId, senderToken }],
    ['an array', [sessionId]],
  ])('rejects %s', (_, input) => {
    expect(isValidReceiverJoin(input)).toBe(false);
  });
});

describe('isValidPeerStatus', () => {
  test.each(['connected', 'disconnected'])('accepts %s', (peer) => {
    expect(isValidPeerStatus({ peer })).toBe(true);
  });

  test.each<[string, unknown]>([
    ['another value', { peer: 'joined' }],
    ['a different case', { peer: 'Connected' }],
    ['a boolean', { peer: true }],
    ['an extra field', { peer: 'connected', sessionId }],
    ['no field', {}],
    ['the bare string', 'connected'],
  ])('rejects %s', (_, input) => {
    expect(isValidPeerStatus(input)).toBe(false);
  });
});

describe('every validator answers false instead of throwing', () => {
  const deeplyNested = Array.from({ length: 10_000 }).reduce<unknown>((inner) => ({ inner }), {});

  class PlainLooking {
    sessionId = sessionId;
    senderToken = senderToken;
  }

  const hostileInputs: [string, () => unknown][] = [
    ['null', () => null],
    ['undefined', () => undefined],
    ['an empty array', () => []],
    ['a nested array', () => [[[envelope]]]],
    ['a 10,000-level nested object', () => deeplyNested],
    ['a symbol', () => Symbol('x')],
    ['a bigint', () => 1n],
    ['a function', () => () => envelope],
    ['a class instance with valid fields', () => new PlainLooking()],
    [
      'a proxy whose every trap throws',
      () =>
        new Proxy(
          {},
          {
            getPrototypeOf: () => {
              throw new Error(senderToken);
            },
            ownKeys: () => {
              throw new Error(senderToken);
            },
            get: () => {
              throw new Error(senderToken);
            },
          },
        ),
    ],
    [
      'an object whose getter throws',
      () =>
        Object.defineProperty({ sessionId, senderToken: '' }, 'senderToken', {
          enumerable: true,
          get: () => {
            throw new Error(senderToken);
          },
        }),
    ],
  ];

  const cases = validators.flatMap((validator) =>
    hostileInputs.map(([inputName, input]) => ({ name: validator.name, inputName, validator, input })),
  );

  test.each(cases)('$name with $inputName', ({ validator, input }) => {
    expect(validator(input())).toBe(false);
  });

  test('a plain object with no prototype is still judged by its fields', () => {
    const payload = Object.assign(Object.create(null) as object, { sessionId, senderToken });
    expect(isValidSenderJoin(payload)).toBe(true);
  });
});

describe('validators leave no trace and change nothing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('no console method is called for valid or invalid payloads carrying a token', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const payloads: unknown[] = [
      { sessionId, senderToken },
      { sessionId, senderToken, role: 'sender' },
      { sessionId, rejoinToken: `${rejoinToken}=` },
      { ...envelope, ct: 'A'.repeat(MAX_CIPHERTEXT_CHARS + 2) },
      { peer: senderToken },
    ];
    for (const validator of validators) for (const payload of payloads) validator(payload);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  test('inputs are left exactly as they were, and frozen inputs are accepted', () => {
    const inputs = [
      Object.freeze({ ...envelope }),
      Object.freeze({ sessionId, senderToken }),
      Object.freeze({ sessionId, rejoinToken }),
      Object.freeze({ peer: 'connected' }),
      Object.freeze({ ...envelope, extra: { nested: [1, 2, 3] } }),
    ];
    const before = structuredClone(inputs);
    for (const validator of validators) for (const input of inputs) validator(input);
    expect(inputs).toEqual(before);
    expect(isValidEnvelope(inputs[0])).toBe(true);
    expect(isValidSenderJoin(inputs[1])).toBe(true);
    expect(isValidReceiverJoin(inputs[2])).toBe(true);
    expect(isValidPeerStatus(inputs[3])).toBe(true);
  });
});
