import { randomBytes } from 'node:crypto';
import {
  decodeBase64Url,
  decrypt,
  encodeBase64Url,
  encrypt,
  EVENTS,
  exportKeyToFragment,
  generateKey,
  importKeyFromFragment,
  MAX_CIPHERTEXT_CHARS,
  type Envelope,
} from '@slm/shared';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { startServer, type RunningServer, type StartServerOptions } from './create-server';
import { formatLogEntry } from './log';

const HOST = '127.0.0.1';
const ORIGIN = 'http://localhost:4200';
const TIMEOUT_MS = 2000;

let server: RunningServer | undefined;
let logs: string[] = [];
const clients: Socket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  await server?.close();
  server = undefined;
  logs = [];
  vi.useRealTimers();
});

async function start(overrides: Partial<StartServerOptions> = {}): Promise<RunningServer> {
  server = await startServer({
    port: 0,
    host: HOST,
    originPolicy: { kind: 'list', origins: [ORIGIN] },
    log: (entry) => logs.push(formatLogEntry(entry)),
    ...overrides,
  });
  return server;
}

function open(origin: string | null = ORIGIN): Socket {
  if (server === undefined) throw new Error('server not started');
  const client = connectClient(`http://${HOST}:${server.port}`, {
    transports: ['websocket'],
    reconnection: false,
    ...(origin === null ? {} : { extraHeaders: { origin } }),
  });
  clients.push(client);
  return client;
}

function withTimeout<T>(register: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for event')), TIMEOUT_MS);
    register((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function connect(origin: string | null = ORIGIN): Promise<Socket> {
  const client = open(origin);
  await withTimeout<void>((resolve) => client.once('connect', () => resolve()));
  return client;
}

function nextEvent<T = unknown>(client: Socket, event: string): Promise<T> {
  return withTimeout<T>((resolve) => client.once(event, resolve));
}

function collect<T = unknown>(client: Socket, event: string): T[] {
  const received: T[] = [];
  client.on(event, (payload: T) => received.push(payload));
  return received;
}

function emit(client: Socket, event: string, ...args: unknown[]): Promise<unknown> {
  return client.timeout(TIMEOUT_MS).emitWithAck(event, ...args);
}

function stringField(ack: unknown, name: string): string {
  const value: unknown = typeof ack === 'object' && ack !== null ? Reflect.get(ack, name) : undefined;
  if (typeof value !== 'string') throw new Error(`ack has no ${name}`);
  return value;
}

// The server writes any relay to a socket before it acks the event that caused it, so once this round trip
// on the receiver socket completes, every update the server sent it earlier has arrived.
async function flush(client: Socket): Promise<void> {
  await expect(emit(client, EVENTS.senderJoin, {})).resolves.toEqual({ ok: false, error: 'invalid_payload' });
}

function envelope(seq: number): Envelope {
  return {
    v: 1,
    seq,
    iv: encodeBase64Url(new Uint8Array(randomBytes(12))),
    ct: encodeBase64Url(new Uint8Array(randomBytes(32))),
  };
}

async function createSession(client: Socket): Promise<{ sessionId: string; senderToken: string }> {
  const ack = await emit(client, EVENTS.sessionCreate);
  expect(ack).toMatchObject({ ok: true });
  return { sessionId: stringField(ack, 'sessionId'), senderToken: stringField(ack, 'senderToken') };
}

async function senderSession() {
  const sender = await connect();
  const { sessionId, senderToken } = await createSession(sender);
  await expect(emit(sender, EVENTS.senderJoin, { sessionId, senderToken })).resolves.toEqual({ ok: true });
  return { sender, sessionId, senderToken };
}

async function joinedSession() {
  const session = await senderSession();
  const receiver = await connect();
  const ack = await emit(receiver, EVENTS.receiverJoin, { sessionId: session.sessionId });
  expect(ack).toMatchObject({ ok: true });
  return { ...session, receiver, rejoinToken: stringField(ack, 'rejoinToken') };
}

describe('relay: sender to receiver', () => {
  test('relays two consecutive updates in seq order, unchanged, over WebSocket only', async () => {
    await start();
    const { sender, receiver } = await joinedSession();
    const updates = collect<Envelope>(receiver, EVENTS.messageUpdate);
    const first = envelope(1);
    const second = envelope(2);

    await expect(emit(sender, EVENTS.messagePublish, first)).resolves.toEqual({ ok: true });
    await expect(emit(sender, EVENTS.messagePublish, second)).resolves.toEqual({ ok: true });
    await flush(receiver);

    expect(updates).toEqual([first, second]);
    expect(sender.io.engine.transport.name).toBe('websocket');
    expect(receiver.io.engine.transport.name).toBe('websocket');
  });

  test('issues a 16-byte session id and 32-byte tokens, fresh every time', async () => {
    await start();
    const client = await connect();
    const a = await createSession(client);
    const b = await createSession(client);

    expect(decodeBase64Url(a.sessionId)?.length).toBe(16);
    expect(decodeBase64Url(a.senderToken)?.length).toBe(32);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.senderToken).not.toBe(b.senderToken);

    const receiver = await connect();
    const ack = await emit(receiver, EVENTS.receiverJoin, { sessionId: a.sessionId });
    expect(decodeBase64Url(stringField(ack, 'rejoinToken'))?.length).toBe(32);
  });

  test('gives a late receiver the latest envelope in its join ack, and nothing older', async () => {
    await start();
    const { sender, sessionId } = await senderSession();
    const second = envelope(2);
    await emit(sender, EVENTS.messagePublish, envelope(1));
    await emit(sender, EVENTS.messagePublish, second);

    const receiver = await connect();
    const updates = collect(receiver, EVENTS.messageUpdate);
    const ack = await emit(receiver, EVENTS.receiverJoin, { sessionId });
    await flush(receiver);

    expect(ack).toEqual({ ok: true, rejoinToken: expect.any(String), latest: second });
    expect(updates).toEqual([]);
  });

  test('tells both sides the peer is connected when the second party joins', async () => {
    await start();
    const { sender, sessionId } = await senderSession();
    const senderStatus = nextEvent(sender, EVENTS.peerStatus);
    const receiver = open();
    const receiverStatus = nextEvent(receiver, EVENTS.peerStatus);
    await emit(receiver, EVENTS.receiverJoin, { sessionId });

    await expect(senderStatus).resolves.toEqual({ peer: 'connected' });
    await expect(receiverStatus).resolves.toEqual({ peer: 'connected' });
  });

  test('relays a tampered envelope byte for byte, and the shared decrypt reports an integrity error', async () => {
    await start();
    const { sender, receiver, sessionId } = await joinedSession();
    const key = await generateKey();
    const imported = await importKeyFromFragment(await exportKeyToFragment(key));
    if (imported.status !== 'ok') throw new Error('key import failed');
    const real = await encrypt(key, sessionId, 1, 'hello receiver');
    const ct = decodeBase64Url(real.ct);
    if (ct === null) throw new Error('bad ciphertext');
    ct[0] = (ct[0] ?? 0) ^ 0x01;
    const tampered: Envelope = { ...real, ct: encodeBase64Url(ct) };

    const update = nextEvent<Envelope>(receiver, EVENTS.messageUpdate);
    await expect(emit(sender, EVENTS.messagePublish, tampered)).resolves.toEqual({ ok: true });
    const received = await update;

    expect(received).toEqual(tampered);
    expect(await decrypt(imported.key, sessionId, received)).toEqual({ status: 'integrity_error' });
    expect(await decrypt(imported.key, sessionId, real)).toEqual({ status: 'ok', text: 'hello receiver', seq: 1 });
  });
});

describe('relay: refusals', () => {
  test('refuses a publish from the receiver socket or a socket that never joined, and relays nothing', async () => {
    await start();
    const { sender, receiver } = await joinedSession();
    const stranger = await connect();
    const senderUpdates = collect(sender, EVENTS.messageUpdate);
    const receiverUpdates = collect(receiver, EVENTS.messageUpdate);

    await expect(emit(receiver, EVENTS.messagePublish, envelope(1))).resolves.toEqual({ ok: false, error: 'not_sender' });
    await expect(emit(stranger, EVENTS.messagePublish, envelope(1))).resolves.toEqual({ ok: false, error: 'not_sender' });
    await flush(sender);
    await flush(receiver);

    expect(senderUpdates).toEqual([]);
    expect(receiverUpdates).toEqual([]);
  });

  test('answers bad_token, slot_taken and unknown_session', async () => {
    await start();
    const { sessionId } = await joinedSession();
    const other = await connect();

    const wrongToken = encodeBase64Url(new Uint8Array(randomBytes(32)));
    await expect(emit(other, EVENTS.senderJoin, { sessionId, senderToken: wrongToken })).resolves.toEqual({
      ok: false,
      error: 'bad_token',
    });
    await expect(emit(other, EVENTS.receiverJoin, { sessionId })).resolves.toEqual({ ok: false, error: 'slot_taken' });
    const unknownId = encodeBase64Url(new Uint8Array(randomBytes(16)));
    await expect(emit(other, EVENTS.receiverJoin, { sessionId: unknownId })).resolves.toEqual({
      ok: false,
      error: 'unknown_session',
    });
  });

  test('refuses a stale or duplicate seq without relaying it', async () => {
    await start();
    const { sender, receiver } = await joinedSession();
    await emit(sender, EVENTS.messagePublish, envelope(2));
    await flush(receiver);
    const updates = collect(receiver, EVENTS.messageUpdate);

    await expect(emit(sender, EVENTS.messagePublish, envelope(2))).resolves.toEqual({ ok: false, error: 'stale_seq' });
    await expect(emit(sender, EVENTS.messagePublish, envelope(1))).resolves.toEqual({ ok: false, error: 'stale_seq' });
    await flush(receiver);

    expect(updates).toEqual([]);
  });

  test('answers invalid_payload for malformed payloads and keeps serving other sockets', async () => {
    await start();
    const { sender, receiver } = await joinedSession();
    const updates = collect(receiver, EVENTS.messageUpdate);
    const malformed: unknown[] = [
      { ...envelope(1), extra: true },
      { ...envelope(1), seq: 'one' },
      { ...envelope(1), ct: 'A'.repeat(MAX_CIPHERTEXT_CHARS + 1) },
      'not an envelope',
    ];
    for (const payload of malformed) {
      await expect(emit(sender, EVENTS.messagePublish, payload)).resolves.toEqual({ ok: false, error: 'invalid_payload' });
    }
    await expect(emit(sender, EVENTS.sessionCreate, {})).resolves.toEqual({ ok: false, error: 'invalid_payload' });

    const next = envelope(1);
    await expect(emit(sender, EVENTS.messagePublish, next)).resolves.toEqual({ ok: true });
    await flush(receiver);
    expect(updates).toEqual([next]);
  });

  test('drops a socket whose frame exceeds the buffer cap, and keeps serving the others', async () => {
    await start();
    const { sender, receiver } = await joinedSession();
    const dropped = nextEvent(sender, 'disconnect');

    sender.emit(EVENTS.messagePublish, { ...envelope(1), ct: 'A'.repeat(100 * 1024) }, () => undefined);
    await dropped;

    const other = await connect();
    await expect(emit(other, EVENTS.sessionCreate)).resolves.toMatchObject({ ok: true });
    await flush(receiver);
  });

  test('ignores an event sent without an ack callback', async () => {
    await start({ sessionConfig: { idleTtlMs: 60_000, maxSessions: 1 } });
    const client = await connect();

    client.emit(EVENTS.sessionCreate);
    await expect(emit(client, EVENTS.sessionCreate)).resolves.toMatchObject({ ok: true });

    expect(logs).toContain('event=session:create outcome=no_ack');
  });

  test('refuses a session create beyond the session cap with server_busy', async () => {
    await start({ sessionConfig: { idleTtlMs: 60_000, maxSessions: 1 } });
    const first = await connect();
    const second = await connect();

    await expect(emit(first, EVENTS.sessionCreate)).resolves.toMatchObject({ ok: true });
    await expect(emit(second, EVENTS.sessionCreate)).resolves.toEqual({ ok: false, error: 'server_busy' });
  });
});

describe('relay: rate limits', () => {
  const rateLimits = {
    sessionCreate: { maxEvents: 2, windowMs: 60_000 },
    messagePublish: { maxEvents: 2, windowMs: 60_000 },
  };

  test('refuses creates beyond the per-socket limit, without affecting another socket', async () => {
    await start({ rateLimits });
    const busy = await connect();
    const other = await connect();

    await expect(emit(busy, EVENTS.sessionCreate)).resolves.toMatchObject({ ok: true });
    await expect(emit(busy, EVENTS.sessionCreate)).resolves.toMatchObject({ ok: true });
    await expect(emit(busy, EVENTS.sessionCreate)).resolves.toEqual({ ok: false, error: 'rate_limited' });
    await expect(emit(other, EVENTS.sessionCreate)).resolves.toMatchObject({ ok: true });
  });

  test('refuses publishes beyond the per-socket limit and relays none of them', async () => {
    await start({ rateLimits });
    const { sender, receiver } = await joinedSession();
    const updates = collect<Envelope>(receiver, EVENTS.messageUpdate);
    const sent = [envelope(1), envelope(2)];

    for (const item of sent) {
      await expect(emit(sender, EVENTS.messagePublish, item)).resolves.toEqual({ ok: true });
    }
    await expect(emit(sender, EVENTS.messagePublish, envelope(3))).resolves.toEqual({ ok: false, error: 'rate_limited' });
    await flush(receiver);
    expect(updates).toEqual(sent);

    const otherSender = await senderSession();
    await expect(emit(otherSender.sender, EVENTS.messagePublish, envelope(1))).resolves.toEqual({ ok: true });
  });
});

describe('relay: reconnects', () => {
  test('a reconnecting sender can publish again, and the receiver sees disconnected then connected', async () => {
    await start();
    const { sender, receiver, sessionId, senderToken } = await joinedSession();
    await emit(sender, EVENTS.messagePublish, envelope(1));
    await flush(receiver);
    const statuses = collect(receiver, EVENTS.peerStatus);
    const updates = collect<Envelope>(receiver, EVENTS.messageUpdate);

    const gone = nextEvent(receiver, EVENTS.peerStatus);
    sender.close();
    await gone;

    const back = await connect();
    const reconnected = nextEvent(receiver, EVENTS.peerStatus);
    await expect(emit(back, EVENTS.senderJoin, { sessionId, senderToken })).resolves.toEqual({ ok: true });
    await reconnected;
    const next = envelope(2);
    await expect(emit(back, EVENTS.messagePublish, next)).resolves.toEqual({ ok: true });
    await flush(receiver);

    expect(statuses).toEqual([{ peer: 'disconnected' }, { peer: 'connected' }]);
    expect(updates).toEqual([next]);
  });

  test('a receiver rejoins with its token while the old socket is still open, and the old socket is dropped', async () => {
    await start();
    const { sender, receiver, sessionId, rejoinToken } = await joinedSession();
    const oldDropped = nextEvent<string>(receiver, 'disconnect');

    const fresh = await connect();
    const updates = collect<Envelope>(fresh, EVENTS.messageUpdate);
    await expect(emit(fresh, EVENTS.receiverJoin, { sessionId, rejoinToken })).resolves.toEqual({
      ok: true,
      rejoinToken,
    });
    await expect(oldDropped).resolves.toBe('io server disconnect');

    const next = envelope(1);
    await emit(sender, EVENTS.messagePublish, next);
    await flush(fresh);
    expect(updates).toEqual([next]);

    const third = await connect();
    await expect(emit(third, EVENTS.receiverJoin, { sessionId })).resolves.toEqual({ ok: false, error: 'slot_taken' });
  });
});

describe('relay: connection policy', () => {
  test('refuses a client from an origin outside the allow-list', async () => {
    await start();
    const client = open('http://evil.example');
    await expect(nextEvent(client, 'connect_error')).resolves.toBeInstanceOf(Error);
    expect(client.connected).toBe(false);
  });

  test('refuses a client that sends no Origin header', async () => {
    await start();
    const client = open(null);
    await expect(nextEvent(client, 'connect_error')).resolves.toBeInstanceOf(Error);
    expect(client.connected).toBe(false);
  });

  test('refuses a client forcing long-polling', async () => {
    await start();
    if (server === undefined) throw new Error('server not started');
    const client = connectClient(`http://${HOST}:${server.port}`, {
      transports: ['polling'],
      reconnection: false,
      extraHeaders: { origin: ORIGIN },
    });
    clients.push(client);
    await expect(nextEvent(client, 'connect_error')).resolves.toBeInstanceOf(Error);
    expect(client.connected).toBe(false);
  });
});

describe('relay: expiry sweep', () => {
  test('removes an idle unbound session on the sweep, keeps a bound one, and stops with the server', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const ttl = 1_000;
    let clock = 0;
    const running = await start({
      sessionConfig: { idleTtlMs: ttl, maxSessions: 10 },
      sweepIntervalMs: 500,
      now: () => clock,
    });
    expect(vi.getTimerCount()).toBe(1);

    const creator = await connect();
    const idle = await createSession(creator);
    const kept = await createSession(creator);

    clock = ttl;
    vi.advanceTimersByTime(500);
    const receiver = await connect();
    await expect(emit(receiver, EVENTS.receiverJoin, { sessionId: kept.sessionId })).resolves.toMatchObject({ ok: true });

    clock = ttl + 1;
    vi.advanceTimersByTime(500);
    const late = await connect();
    await expect(emit(late, EVENTS.receiverJoin, { sessionId: idle.sessionId })).resolves.toEqual({
      ok: false,
      error: 'unknown_session',
    });
    await expect(emit(late, EVENTS.receiverJoin, { sessionId: kept.sessionId })).resolves.toEqual({
      ok: false,
      error: 'slot_taken',
    });
    expect(logs).toContain('event=sweep outcome=expired count=0');
    expect(logs).toContain('event=sweep outcome=expired count=1');

    await running.close();
    server = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('relay: logging', () => {
  test('logs the number of connected sockets after each connect and disconnect', async () => {
    await start();
    const { sender, receiver } = await joinedSession();
    sender.close();
    await nextEvent(receiver, EVENTS.peerStatus);

    const counts = logs.filter((line) => /^event=(connect|disconnect) /.test(line));
    expect(counts).toEqual(['event=connect count=1', 'event=connect count=2', 'event=disconnect count=1']);
  });

  test('logs only event names, outcomes and counts, never ids, tokens, IVs, ciphertext or keys', async () => {
    await start();
    const { sender, receiver, sessionId, senderToken, rejoinToken } = await joinedSession();
    const key = await generateKey();
    const fragment = await exportKeyToFragment(key);
    const sent = [await encrypt(key, sessionId, 1, 'first'), await encrypt(key, sessionId, 2, 'second')];
    for (const item of sent) {
      await emit(sender, EVENTS.messagePublish, item);
    }
    await emit(sender, EVENTS.messagePublish, sent[0]);
    await emit(sender, EVENTS.messagePublish, { ...sent[1], seq: 3, extra: senderToken });
    await emit(receiver, EVENTS.receiverJoin, { sessionId, rejoinToken });
    sender.close();
    await nextEvent(receiver, EVENTS.peerStatus);

    const secrets = [sessionId, senderToken, rejoinToken, fragment, ...sent.flatMap((item) => [item.iv, item.ct])];
    expect(logs.length).toBeGreaterThan(5);
    for (const line of logs) {
      expect(line).toMatch(/^event=[a-z:_]+( outcome=[a-z_]+)?( count=\d+)?$/);
      for (const secret of secrets) {
        expect(line).not.toContain(secret);
      }
    }
    expect(logs).toContain('event=message:publish outcome=stale_seq');
    expect(logs).toContain('event=message:publish outcome=invalid_payload');
  });
});
