import { describe, expect, test } from 'vitest';
import {
  ACK_ERROR_CODES,
  EVENTS,
  MAX_CIPHERTEXT_CHARS,
  PEER_STATES,
  SESSION_ID_LENGTH,
  TOKEN_LENGTH,
  type AckErrorCode,
  type EventName,
} from './index';

describe('protocol contract from the shared entry point', () => {
  test('names exactly the six Socket.IO events', () => {
    const names: EventName[] = Object.values(EVENTS);
    expect(names).toEqual([
      'session:create',
      'sender:join',
      'receiver:join',
      'message:publish',
      'message:update',
      'peer:status',
    ]);
  });

  test('names exactly the eight ack error codes', () => {
    const codes: readonly AckErrorCode[] = ACK_ERROR_CODES;
    expect(codes).toEqual([
      'unknown_session',
      'bad_token',
      'slot_taken',
      'not_sender',
      'invalid_payload',
      'stale_seq',
      'server_busy',
      'rate_limited',
    ]);
  });

  test('names the two peer states', () => {
    expect(PEER_STATES).toEqual(['connected', 'disconnected']);
  });

  test('exports the length limits the server transport is sized from', () => {
    expect(SESSION_ID_LENGTH).toBe(22);
    expect(TOKEN_LENGTH).toBe(43);
    expect(MAX_CIPHERTEXT_CHARS).toBe(65_536);
  });
});
