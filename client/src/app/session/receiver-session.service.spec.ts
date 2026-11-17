import { TestBed } from '@angular/core/testing';
import {
  decrypt,
  encrypt,
  EVENTS,
  exportKeyToFragment,
  generateKey,
  importKeyFromFragment,
  type DecryptResult,
  type Envelope,
  type SessionKey,
} from '@slm/shared';
import { ReceiverSessionService } from './receiver-session.service';
import { receiverTokenKey } from './sender-core';
import { SESSION_CRYPTO, SESSION_STORAGE, type SessionCrypto } from './session-env';
import { SessionSocket } from './session-socket';
import { FakeSessionSocket, MemoryStorage, randomSessionId, randomToken } from './testing/fake-session-socket';

const realCrypto: SessionCrypto = { generateKey, exportKeyToFragment, importKeyFromFragment, encrypt, decrypt };

interface Fixture {
  readonly service: ReceiverSessionService;
  readonly socket: FakeSessionSocket;
  readonly storage: MemoryStorage;
  readonly sessionId: string;
  readonly key: SessionKey;
  readonly fragment: string;
}

async function fixture(options: { crypto?: Partial<SessionCrypto>; storage?: MemoryStorage } = {}): Promise<Fixture> {
  const socket = new FakeSessionSocket();
  const storage = options.storage ?? new MemoryStorage();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ReceiverSessionService,
      { provide: SessionSocket, useValue: socket },
      { provide: SESSION_STORAGE, useValue: storage },
      { provide: SESSION_CRYPTO, useValue: { ...realCrypto, ...options.crypto } },
    ],
  });
  const key = await generateKey();
  const fragment = await exportKeyToFragment(key);
  return { service: TestBed.inject(ReceiverSessionService), socket, storage, sessionId: randomSessionId(), key, fragment };
}

function joinAck(latest?: unknown, rejoinToken = randomToken()): Record<string, unknown> {
  return latest === undefined ? { ok: true, rejoinToken } : { ok: true, rejoinToken, latest };
}

function tamper(envelope: Envelope): Envelope {
  const flipped = envelope.ct.startsWith('A') ? 'B' : 'A';
  return { ...envelope, ct: flipped + envelope.ct.slice(1) };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ReceiverSessionService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('joins as receiver and shows the latest envelope it gets on join', async () => {
    const f = await fixture();
    const latest = await encrypt(f.key, f.sessionId, 4, 'latest text');
    f.socket.responder = () => joinAck(latest);

    await f.service.open(f.sessionId, f.fragment);

    expect(f.socket.emitsOf(EVENTS.receiverJoin)[0]?.args[0]).toEqual({ sessionId: f.sessionId });
    await vi.waitFor(() => expect(f.service.state()).toEqual({ text: 'latest text', lastSeq: 4, status: 'live' }));
    expect(f.service.error()).toBeNull();
  });

  it('stays waiting when the session has no latest yet, then goes live on the first update', async () => {
    const f = await fixture();
    await f.service.open(f.sessionId, f.fragment);
    expect(f.service.state().status).toBe('waiting');

    f.socket.serverEmit(EVENTS.messageUpdate, await encrypt(f.key, f.sessionId, 1, 'hi'));
    await vi.waitFor(() => expect(f.service.state()).toEqual({ text: 'hi', lastSeq: 1, status: 'live' }));
  });

  it('keeps the text and shows integrity error for a tampered update, then recovers on a valid newer one', async () => {
    const f = await fixture();
    await f.service.open(f.sessionId, f.fragment);
    f.socket.serverEmit(EVENTS.messageUpdate, await encrypt(f.key, f.sessionId, 1, 'good'));
    f.socket.serverEmit(EVENTS.messageUpdate, tamper(await encrypt(f.key, f.sessionId, 2, 'evil')));
    await vi.waitFor(() => expect(f.service.state()).toEqual({ text: 'good', lastSeq: 1, status: 'integrity_error' }));
    expect(JSON.stringify(f.service.state())).not.toContain('evil');

    f.socket.serverEmit(EVENTS.messageUpdate, await encrypt(f.key, f.sessionId, 3, 'fixed'));
    await vi.waitFor(() => expect(f.service.state()).toEqual({ text: 'fixed', lastSeq: 3, status: 'live' }));
  });

  it('rejects a replayed update and one that fails the validator without throwing', async () => {
    const f = await fixture();
    await f.service.open(f.sessionId, f.fragment);
    const first = await encrypt(f.key, f.sessionId, 1, 'one');
    f.socket.serverEmit(EVENTS.messageUpdate, first);
    await vi.waitFor(() => expect(f.service.state().status).toBe('live'));

    f.socket.serverEmit(EVENTS.messageUpdate, first);
    await vi.waitFor(() => expect(f.service.state()).toEqual({ text: 'one', lastSeq: 1, status: 'integrity_error' }));

    f.socket.serverEmit(EVENTS.messageUpdate, { ...(await encrypt(f.key, f.sessionId, 2, 'two')), extra: true });
    f.socket.serverEmit(EVENTS.messageUpdate, 'not an envelope');
    f.socket.serverEmit(EVENTS.messageUpdate, await encrypt(f.key, f.sessionId, 3, 'three'));
    await vi.waitFor(() => expect(f.service.state().text).toBe('three'));
  });

  it('applies updates strictly in arrival order even when the first decrypt is slower', async () => {
    const slow = deferred<void>();
    const order: number[] = [];
    let calls = 0;
    const f = await fixture({
      crypto: {
        decrypt: async (key, sessionId, input): Promise<DecryptResult> => {
          const call = ++calls;
          if (call === 1) await slow.promise;
          const result = await decrypt(key, sessionId, input);
          order.push(call);
          return result;
        },
      },
    });
    await f.service.open(f.sessionId, f.fragment);
    f.socket.serverEmit(EVENTS.messageUpdate, await encrypt(f.key, f.sessionId, 1, 'older'));
    f.socket.serverEmit(EVENTS.messageUpdate, await encrypt(f.key, f.sessionId, 2, 'newer'));
    slow.resolve();

    await vi.waitFor(() => expect(f.service.state()).toEqual({ text: 'newer', lastSeq: 2, status: 'live' }));
    expect(order).toEqual([1, 2]);
  });

  it('keeps the text on disconnect, then rejoins with the token from its first join and shows no false warning', async () => {
    const f = await fixture();
    const firstToken = randomToken();
    const latest = await encrypt(f.key, f.sessionId, 5, 'same text');
    f.socket.responder = () => joinAck(latest, firstToken);
    await f.service.open(f.sessionId, f.fragment);
    await vi.waitFor(() => expect(f.service.state().status).toBe('live'));

    f.socket.drop();
    expect(f.service.state()).toEqual({ text: 'same text', lastSeq: 5, status: 'disconnected' });

    f.socket.responder = () => joinAck(latest);
    f.socket.reconnect();
    await vi.waitFor(() => expect(f.socket.emitsOf(EVENTS.receiverJoin)).toHaveLength(2));

    expect(f.socket.emitsOf(EVENTS.receiverJoin)[1]?.args[0]).toEqual({ sessionId: f.sessionId, rejoinToken: firstToken });
    await vi.waitFor(() => expect(f.service.state()).toEqual({ text: 'same text', lastSeq: 5, status: 'live' }));
  });

  it('applies a newer latest on rejoin and flags an older one', async () => {
    const f = await fixture();
    f.socket.responder = () => joinAck();
    await f.service.open(f.sessionId, f.fragment);
    f.socket.serverEmit(EVENTS.messageUpdate, await encrypt(f.key, f.sessionId, 3, 'three'));
    await vi.waitFor(() => expect(f.service.state().text).toBe('three'));

    const missed = await encrypt(f.key, f.sessionId, 4, 'four');
    f.socket.drop();
    f.socket.responder = () => joinAck(missed);
    f.socket.reconnect();
    await vi.waitFor(() => expect(f.service.state()).toEqual({ text: 'four', lastSeq: 4, status: 'live' }));

    const older = await encrypt(f.key, f.sessionId, 2, 'two');
    f.socket.drop();
    f.socket.responder = () => joinAck(older);
    f.socket.reconnect();
    await vi.waitFor(() => expect(f.service.state()).toEqual({ text: 'four', lastSeq: 4, status: 'integrity_error' }));
  });

  it('keeps the rejoin token in sessionStorage so a reload rejoins with it', async () => {
    const storage = new MemoryStorage();
    const f = await fixture({ storage });
    const token = randomToken();
    f.socket.responder = () => joinAck(undefined, token);
    await f.service.open(f.sessionId, f.fragment);
    expect(storage.getItem(receiverTokenKey(f.sessionId))).toBe(token);

    const reloaded = await fixture({ storage });
    await reloaded.service.open(f.sessionId, reloaded.fragment);
    expect(reloaded.socket.emitsOf(EVENTS.receiverJoin)[0]?.args[0]).toEqual({ sessionId: f.sessionId, rejoinToken: token });
  });

  it('ignores a stored rejoin token that is not a valid token', async () => {
    const storage = new MemoryStorage();
    const f = await fixture({ storage });
    storage.setItem(receiverTokenKey(f.sessionId), 'tampered');
    await f.service.open(f.sessionId, f.fragment);
    expect(f.socket.emitsOf(EVENTS.receiverJoin)[0]?.args[0]).toEqual({ sessionId: f.sessionId });
  });

  it.each(['', 'not-a-key', '#AAAA', 'A'.repeat(44)])('enters key error and never joins for the fragment %j', async (bad) => {
    const f = await fixture();
    await f.service.open(f.sessionId, bad);
    expect(f.service.error()).toBe('invalid_key');
    expect(f.socket.connectCalls).toBe(0);
    expect(f.socket.emits).toHaveLength(0);
  });

  it.each(['unknown_session', 'slot_taken'] as const)('surfaces a %s join failure as an error state', async (code) => {
    const f = await fixture();
    f.socket.responder = () => ({ ok: false, error: code });
    await f.service.open(f.sessionId, f.fragment);
    expect(f.service.error()).toBe(code);
    expect(f.service.state().status).toBe('waiting');
  });

  it('treats a malformed join ack as a protocol error', async () => {
    const f = await fixture();
    f.socket.responder = () => ({ ok: true });
    await f.service.open(f.sessionId, f.fragment);
    expect(f.service.error()).toBe('protocol_error');
  });

  it('exposes peer status separately without changing the receiver status', async () => {
    const f = await fixture();
    await f.service.open(f.sessionId, f.fragment);
    f.socket.serverEmit(EVENTS.peerStatus, { peer: 'connected' });
    expect(f.service.peer()).toBe('connected');
    f.socket.serverEmit(EVENTS.peerStatus, { peer: 'disconnected' });
    f.socket.serverEmit(EVENTS.peerStatus, { peer: 'hacked' });
    expect(f.service.peer()).toBe('disconnected');
    expect(f.service.state().status).toBe('waiting');
  });

  it('sends nothing but join payloads, never the key fragment or any plaintext', async () => {
    const f = await fixture();
    const latest = await encrypt(f.key, f.sessionId, 1, 'private words');
    f.socket.responder = () => joinAck(latest);
    await f.service.open(f.sessionId, f.fragment);
    await vi.waitFor(() => expect(f.service.state().text).toBe('private words'));
    f.socket.drop();
    f.socket.reconnect();
    await vi.waitFor(() => expect(f.socket.emits).toHaveLength(2));

    expect(f.socket.emits.every((emit) => emit.event === EVENTS.receiverJoin)).toBe(true);
    const wire = JSON.stringify(f.socket.emits.map((emit) => emit.args));
    expect(wire).not.toContain(f.fragment);
    expect(wire).not.toContain('private');
  });
});
