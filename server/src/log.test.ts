import { describe, expect, test } from 'vitest';
import { ackOutcome, formatLogEntry } from './log';

describe('formatLogEntry', () => {
  test('writes only the event name, outcome and count', () => {
    expect(formatLogEntry({ event: 'message:publish', outcome: 'ok' })).toBe('event=message:publish outcome=ok');
    expect(formatLogEntry({ event: 'connect', count: 2 })).toBe('event=connect count=2');
    expect(formatLogEntry({ event: 'sweep', outcome: 'expired', count: 0 })).toBe('event=sweep outcome=expired count=0');
  });

  test('drops any field outside the log entry shape', () => {
    const withExtras = { event: 'message:publish', outcome: 'ok', ct: 'SECRET', senderToken: 'TOKEN' };
    expect(formatLogEntry(withExtras)).toBe('event=message:publish outcome=ok');
  });
});

describe('ackOutcome', () => {
  test('is ok for a successful ack and the error code otherwise, never the ack contents', () => {
    expect(ackOutcome({ ok: true })).toBe('ok');
    expect(ackOutcome({ ok: false, error: 'stale_seq' })).toBe('stale_seq');
    const created = { ok: true as const, sessionId: 'SESSION', senderToken: 'TOKEN' };
    expect(ackOutcome(created)).toBe('ok');
  });
});
