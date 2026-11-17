import type { DecryptResult } from '@slm/shared';
import { initialReceiverState, receiverTransition, type ReceiverEvent, type ReceiverState } from './receiver-state';

const validEnvelope = (seq: number) => ({ v: 1, seq, iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA' });

function ok(seq: number, text: string): DecryptResult {
  return { status: 'ok', seq, text };
}

function update(seq: number, text: string): ReceiverEvent {
  return { type: 'update', envelope: validEnvelope(seq), result: ok(seq, text) };
}

function resync(seq: number, text: string): ReceiverEvent {
  return { type: 'resync', envelope: validEnvelope(seq), result: ok(seq, text) };
}

const live: ReceiverState = { text: 'hello', lastSeq: 3, status: 'live', integrityWarning: false };

describe('receiverTransition', () => {
  it('starts as waiting with empty text and no accepted seq', () => {
    expect(initialReceiverState).toEqual({ text: '', lastSeq: null, status: 'waiting', integrityWarning: false });
  });

  it('moves waiting to live with the text and seq of a valid first envelope', () => {
    expect(receiverTransition(initialReceiverState, update(1, 'first'))).toEqual({
      text: 'first',
      lastSeq: 1,
      status: 'live',
      integrityWarning: false,
    });
  });

  it('accepts a higher seq and replaces the text', () => {
    expect(receiverTransition(live, update(4, 'next'))).toEqual({
      text: 'next',
      lastSeq: 4,
      status: 'live',
      integrityWarning: false,
    });
  });

  it('accepts a seq gap, since only the order matters', () => {
    expect(receiverTransition(live, update(9, 'later'))).toEqual({
      text: 'later',
      lastSeq: 9,
      status: 'live',
      integrityWarning: false,
    });
  });

  it('keeps the text and seq and sets integrity error on an integrity error result', () => {
    const event: ReceiverEvent = { type: 'update', envelope: validEnvelope(4), result: { status: 'integrity_error' } };
    expect(receiverTransition(live, event)).toEqual({
      text: 'hello',
      lastSeq: 3,
      status: 'integrity_error',
      integrityWarning: true,
    });
  });

  it('keeps the text and sets integrity error on a malformed result', () => {
    const event: ReceiverEvent = { type: 'update', envelope: validEnvelope(4), result: { status: 'malformed' } };
    expect(receiverTransition(live, event)).toEqual({
      text: 'hello',
      lastSeq: 3,
      status: 'integrity_error',
      integrityWarning: true,
    });
  });

  it('rejects an envelope that fails the validator even if the result says ok', () => {
    const event: ReceiverEvent = { type: 'update', envelope: { ...validEnvelope(4), extra: 1 }, result: ok(4, 'forged') };
    const next = receiverTransition(live, event);
    expect(next).toEqual({ text: 'hello', lastSeq: 3, status: 'integrity_error', integrityWarning: true });
    expect(JSON.stringify(next)).not.toContain('forged');
  });

  it('rejects a replayed update with the same seq as the last accepted one', () => {
    expect(receiverTransition(live, update(3, 'replay'))).toEqual({
      text: 'hello',
      lastSeq: 3,
      status: 'integrity_error',
      integrityWarning: true,
    });
  });

  it('rejects an out-of-order update with a lower seq after a higher one was accepted', () => {
    const afterHigher = receiverTransition(receiverTransition(initialReceiverState, update(5, 'five')), update(4, 'four'));
    expect(afterHigher).toEqual({ text: 'five', lastSeq: 5, status: 'integrity_error', integrityWarning: true });
  });

  it('returns to live with the new text on a valid newer update after an integrity error', () => {
    const broken: ReceiverState = { ...live, status: 'integrity_error', integrityWarning: true };
    expect(receiverTransition(broken, update(4, 'recovered'))).toEqual({
      text: 'recovered',
      lastSeq: 4,
      status: 'live',
      integrityWarning: false,
    });
  });

  it('keeps the state without a warning on a resync with the same seq', () => {
    expect(receiverTransition(live, resync(3, 'hello'))).toEqual(live);
  });

  it('sets integrity error on a resync with a lower seq', () => {
    expect(receiverTransition(live, resync(2, 'old'))).toEqual({
      text: 'hello',
      lastSeq: 3,
      status: 'integrity_error',
      integrityWarning: true,
    });
  });

  it('accepts a resync with a higher seq', () => {
    expect(receiverTransition(live, resync(5, 'missed'))).toEqual({
      text: 'missed',
      lastSeq: 5,
      status: 'live',
      integrityWarning: false,
    });
  });

  it('accepts the first resync when nothing was accepted yet', () => {
    expect(receiverTransition(initialReceiverState, resync(7, 'latest'))).toEqual({
      text: 'latest',
      lastSeq: 7,
      status: 'live',
      integrityWarning: false,
    });
  });

  it('sets integrity error on a resync that fails decryption', () => {
    const event: ReceiverEvent = { type: 'resync', envelope: validEnvelope(3), result: { status: 'integrity_error' } };
    expect(receiverTransition(live, event)).toEqual({ ...live, status: 'integrity_error', integrityWarning: true });
  });

  it('keeps the text and sets disconnected on disconnect', () => {
    expect(receiverTransition(live, { type: 'disconnected' })).toEqual({
      text: 'hello',
      lastSeq: 3,
      status: 'disconnected',
      integrityWarning: false,
    });
  });

  it('returns to live on rejoin when text was accepted, and to waiting when not', () => {
    expect(receiverTransition({ ...live, status: 'disconnected' }, { type: 'rejoined' }).status).toBe('live');
    expect(receiverTransition({ ...initialReceiverState, status: 'disconnected' }, { type: 'rejoined' }).status).toBe(
      'waiting',
    );
  });

  it('never mutates the state it is given and always returns a new object', () => {
    const frozen = Object.freeze({ ...live });
    const events: ReceiverEvent[] = [
      update(4, 'next'),
      update(3, 'replay'),
      { type: 'update', envelope: validEnvelope(4), result: { status: 'integrity_error' } },
      resync(3, 'hello'),
      resync(2, 'old'),
      { type: 'disconnected' },
      { type: 'rejoined' },
    ];
    for (const event of events) {
      const next = receiverTransition(frozen, event);
      expect(next).not.toBe(frozen);
    }
    expect(frozen).toEqual(live);
  });

  it('keeps the integrity warning through a disconnect and a rejoin until an update is accepted', () => {
    const rejected = receiverTransition(live, update(3, 'replay'));
    const rejoined = receiverTransition(receiverTransition(rejected, { type: 'disconnected' }), { type: 'rejoined' });
    expect(rejoined).toEqual({ text: 'hello', lastSeq: 3, status: 'live', integrityWarning: true });
    expect(receiverTransition(rejoined, resync(3, 'hello')).integrityWarning).toBe(true);
    expect(receiverTransition(rejoined, update(4, 'next')).integrityWarning).toBe(false);
  });
});
