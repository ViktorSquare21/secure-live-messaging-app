import { parsePublishAck, parseReceiverJoinAck, parseSenderJoinAck, parseSessionCreateAck } from './ack-parsers';
import { randomSessionId, randomToken } from './testing/fake-session-socket';

describe('ack parsers', () => {
  const sessionId = randomSessionId();
  const token = randomToken();

  it('accepts a session create ack with a valid id and token', () => {
    expect(parseSessionCreateAck({ ok: true, sessionId, senderToken: token })).toEqual({
      ok: true,
      sessionId,
      senderToken: token,
    });
  });

  it('accepts every known error code and rejects an unknown one', () => {
    expect(parseSessionCreateAck({ ok: false, error: 'server_busy' })).toEqual({ ok: false, error: 'server_busy' });
    expect(parsePublishAck({ ok: false, error: 'stale_seq' })).toEqual({ ok: false, error: 'stale_seq' });
    expect(parsePublishAck({ ok: false, error: 'boom' })).toBeNull();
    expect(parsePublishAck({ ok: false, error: 'stale_seq', stack: 'x' })).toBeNull();
  });

  it('rejects a session create ack with a bad id, a bad token or an extra field', () => {
    expect(parseSessionCreateAck({ ok: true, sessionId: 'short', senderToken: token })).toBeNull();
    expect(parseSessionCreateAck({ ok: true, sessionId, senderToken: 'x' })).toBeNull();
    expect(parseSessionCreateAck({ ok: true, sessionId, senderToken: token, extra: 1 })).toBeNull();
  });

  it('accepts only the bare ok shape for sender join and publish', () => {
    expect(parseSenderJoinAck({ ok: true })).toEqual({ ok: true });
    expect(parsePublishAck({ ok: true })).toEqual({ ok: true });
    expect(parseSenderJoinAck({ ok: true, role: 'sender' })).toBeNull();
  });

  it('rejects values that are not plain objects', () => {
    for (const input of [null, undefined, 'ok', 1, [], new Date()]) {
      expect(parsePublishAck(input)).toBeNull();
      expect(parseReceiverJoinAck(input)).toBeNull();
    }
  });

  it('returns null instead of throwing for a hostile object', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('trap');
        },
      },
    );
    expect(parseSenderJoinAck(hostile)).toBeNull();
  });

  it('accepts a receiver join ack with and without latest, and leaves latest unvalidated', () => {
    expect(parseReceiverJoinAck({ ok: true, rejoinToken: token })).toEqual({ ok: true, rejoinToken: token });
    const latest = { anything: true };
    expect(parseReceiverJoinAck({ ok: true, rejoinToken: token, latest })).toEqual({ ok: true, rejoinToken: token, latest });
  });

  it('rejects a receiver join ack without a valid rejoin token', () => {
    expect(parseReceiverJoinAck({ ok: true })).toBeNull();
    expect(parseReceiverJoinAck({ ok: true, rejoinToken: 'nope' })).toBeNull();
  });
});
