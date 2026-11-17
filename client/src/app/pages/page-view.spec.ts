import {
  homeErrorMessage,
  lastSentView,
  nextPeerPhase,
  receiverErrorMessage,
  receiverStatusLabel,
  senderErrorView,
  senderPeerLabel,
} from './page-view';

describe('nextPeerPhase', () => {
  it('stays waiting when the join answers that no receiver is there yet', () => {
    expect(nextPeerPhase('waiting', 'disconnected')).toBe('waiting');
    expect(nextPeerPhase('waiting', null)).toBe('waiting');
  });

  it('moves to connected when a receiver joins and to left when it goes', () => {
    expect(nextPeerPhase('waiting', 'connected')).toBe('connected');
    expect(nextPeerPhase('connected', 'disconnected')).toBe('left');
    expect(nextPeerPhase('left', 'connected')).toBe('connected');
  });

  it('keeps the phase while its own connection is down', () => {
    expect(nextPeerPhase('connected', null)).toBe('connected');
    expect(nextPeerPhase('left', null)).toBe('left');
  });
});

describe('senderPeerLabel', () => {
  it('labels each phase and says reconnecting while the sender is offline', () => {
    expect(senderPeerLabel('connected', 'waiting')).toBe('Waiting for receiver');
    expect(senderPeerLabel('reconnected', 'connected')).toBe('Receiver connected');
    expect(senderPeerLabel('connected', 'left')).toBe('Receiver disconnected');
    expect(senderPeerLabel('disconnected', 'connected')).toBe('Reconnecting…');
  });
});

describe('lastSentView', () => {
  it('goes from not sent, to sending, to sent at the ack time', () => {
    expect(lastSentView(false, null)).toEqual({ kind: 'none' });
    expect(lastSentView(true, null)).toEqual({ kind: 'sending' });
    expect(lastSentView(false, 42)).toEqual({ kind: 'sent', at: 42 });
    expect(lastSentView(true, 42)).toEqual({ kind: 'sending' });
  });
});

describe('senderErrorView', () => {
  it('treats unknown session, bad token and a taken slot as fatal, each with its own message', () => {
    const fatal = (['unknown_session', 'bad_token', 'slot_taken'] as const).map(senderErrorView);
    expect(fatal.every((view) => view?.fatal === true)).toBe(true);
    expect(new Set(fatal.map((view) => view?.message)).size).toBe(3);
    expect(senderErrorView('slot_taken')?.message).toBe('This session is already open in another tab.');
  });

  it('keeps typing possible after a rejected update', () => {
    expect(senderErrorView('stale_seq')?.fatal).toBe(false);
    expect(senderErrorView('rate_limited')?.fatal).toBe(false);
    expect(senderErrorView('protocol_error')?.fatal).toBe(false);
    expect(senderErrorView(null)).toBeNull();
  });
});

describe('homeErrorMessage', () => {
  it('gives busy, rate limited and unreachable their own message', () => {
    const messages = (['server_busy', 'rate_limited', 'unreachable', 'protocol_error'] as const).map(homeErrorMessage);
    expect(new Set(messages).size).toBe(4);
    expect(homeErrorMessage(null)).toBeNull();
  });
});

describe('receiver labels', () => {
  it('gives every status a distinct label', () => {
    const labels = (['waiting', 'live', 'disconnected', 'integrity_error'] as const).map(receiverStatusLabel);
    expect(new Set(labels).size).toBe(4);
    expect(receiverStatusLabel('disconnected')).toBe('Disconnected – reconnecting…');
  });

  it('separates a broken key, an unknown session and a taken slot', () => {
    expect(receiverErrorMessage('invalid_key')).toBe('This link is incomplete or damaged. Ask the sender for a new link.');
    expect(receiverErrorMessage('unknown_session')).toBe("This session doesn't exist or has ended.");
    expect(receiverErrorMessage('invalid_payload')).toBe("This session doesn't exist or has ended.");
    expect(receiverErrorMessage('slot_taken')).toBe('Someone else is already viewing this session.');
    expect(receiverErrorMessage(null)).toBeNull();
  });
});
