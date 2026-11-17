import { TestBed } from '@angular/core/testing';
import { decrypt, EVENTS, importKeyFromFragment, type Envelope } from '@slm/shared';
import { firstValueFrom } from 'rxjs';
import { parseSenderRecord, senderRecordKey } from './sender-core';
import { PUBLISH_DEBOUNCE_MS, SenderSessionService } from './sender-session.service';
import { APP_ORIGIN, CLOCK, SESSION_STORAGE } from './session-env';
import { SessionSocket } from './session-socket';
import { FakeSessionSocket, HOLD, MemoryStorage } from './testing/fake-session-socket';

const ORIGIN = 'https://app.test';

function setup(socket: FakeSessionSocket, storage: Storage): SenderSessionService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      SenderSessionService,
      { provide: SessionSocket, useValue: socket },
      { provide: SESSION_STORAGE, useValue: storage },
      { provide: CLOCK, useValue: () => 1_700_000_000_000 },
      { provide: APP_ORIGIN, useValue: ORIGIN },
    ],
  });
  return TestBed.inject(SenderSessionService);
}

async function startedSession(socket = new FakeSessionSocket(), storage = new MemoryStorage()) {
  const service = setup(socket, storage);
  const sessionId = await firstValueFrom(service.createSession());
  if (sessionId === null) throw new Error('session not created');
  await service.resume(sessionId);
  return { service, socket, storage, sessionId };
}

function envelopeOf(emit: { args: readonly unknown[] }): Envelope {
  return emit.args[0] as Envelope;
}

async function plaintextOf(storage: Storage, sessionId: string, envelope: Envelope): Promise<string> {
  const record = parseSenderRecord(storage.getItem(senderRecordKey(sessionId)));
  if (record === null) throw new Error('no record');
  const imported = await importKeyFromFragment(record.keyFragment);
  if (imported.status !== 'ok') throw new Error('bad key');
  const result = await decrypt(imported.key, sessionId, envelope);
  if (result.status !== 'ok') throw new Error(result.status);
  return result.text;
}

async function type(service: SenderSessionService, text: string, pauseMs = PUBLISH_DEBOUNCE_MS): Promise<void> {
  service.textChanged(text);
  await vi.advanceTimersByTimeAsync(pauseMs);
}

describe('SenderSessionService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('creates a session, stores token, key and seq 0, and joins as sender with the token', async () => {
    const { service, socket, storage, sessionId } = await startedSession();

    const record = parseSenderRecord(storage.getItem(senderRecordKey(sessionId)));
    expect(record?.lastSeq).toBe(0);
    expect(socket.emitsOf(EVENTS.senderJoin)[0]?.args[0]).toEqual({ sessionId, senderToken: record?.senderToken });
    expect(service.receiverLink()).toBe(`${ORIGIN}/r/${sessionId}#${record?.keyFragment}`);
    expect(service.error()).toBeNull();
  });

  it('keeps the sender token out of the receiver link and every payload but the sender join', async () => {
    const { service, socket, storage, sessionId } = await startedSession();
    await type(service, 'hello');
    await socket.waitForEmit(EVENTS.messagePublish, 1);

    const token = parseSenderRecord(storage.getItem(senderRecordKey(sessionId)))?.senderToken ?? '';
    expect(service.receiverLink()).not.toContain(token);
    const others = socket.emits.filter((emit) => emit.event !== EVENTS.senderJoin);
    expect(JSON.stringify(others.map((emit) => emit.args))).not.toContain(token);
  });

  it('publishes once with only the latest text when several values are typed within 300 ms', async () => {
    const { service, socket, storage, sessionId } = await startedSession();
    await type(service, 'h', 100);
    await type(service, 'he', 100);
    await type(service, 'hel', 100);
    await type(service, 'hell', PUBLISH_DEBOUNCE_MS);

    const emit = await socket.waitForEmit(EVENTS.messagePublish, 1);
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS * 3);
    expect(socket.emitsOf(EVENTS.messagePublish)).toHaveLength(1);
    expect(envelopeOf(emit).seq).toBe(1);
    expect(await plaintextOf(storage, sessionId, envelopeOf(emit))).toBe('hell');
  });

  it('publishes seq n and n+1 for two debounced changes and does not republish the same text', async () => {
    const { service, socket, storage, sessionId } = await startedSession();
    await type(service, 'one');
    const first = await socket.waitForEmit(EVENTS.messagePublish, 1);
    await type(service, 'two');
    const second = await socket.waitForEmit(EVENTS.messagePublish, 2);
    await type(service, 'twox', 100);
    await type(service, 'two');
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);

    expect(envelopeOf(first).seq).toBe(1);
    expect(envelopeOf(second).seq).toBe(2);
    expect(await plaintextOf(storage, sessionId, envelopeOf(second))).toBe('two');
    expect(socket.emitsOf(EVENTS.messagePublish)).toHaveLength(2);
    expect(service.lastSentAt()).toBe(1_700_000_000_000);
  });

  it('serialises publishes behind a held ack and skips the middle text that went stale', async () => {
    const { service, socket, storage, sessionId } = await startedSession();
    socket.responder = (event) => (event === EVENTS.messagePublish ? HOLD : { ok: true });

    await type(service, 'first');
    const first = await socket.waitForEmit(EVENTS.messagePublish, 1);
    await type(service, 'second');
    await type(service, 'third');
    expect(socket.emitsOf(EVENTS.messagePublish)).toHaveLength(1);

    first.respond({ ok: true });
    const second = await socket.waitForEmit(EVENTS.messagePublish, 2);
    second.respond({ ok: true });
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);

    const publishes = socket.emitsOf(EVENTS.messagePublish);
    expect(publishes).toHaveLength(2);
    expect(publishes.map((emit) => envelopeOf(emit).seq)).toEqual([1, 2]);
    expect(await plaintextOf(storage, sessionId, envelopeOf(second))).toBe('third');
    expect(publishes.every((emit) => emit.settled)).toBe(true);
    expect(service.lastSentAt()).not.toBeNull();
  });

  it('publishes a text again that was skipped as stale and then typed back', async () => {
    const { service, socket, storage, sessionId } = await startedSession();
    socket.responder = (event) => (event === EVENTS.messagePublish ? HOLD : { ok: true });

    await type(service, 'a');
    const first = await socket.waitForEmit(EVENTS.messagePublish, 1);
    await type(service, 'ab');
    service.textChanged('abc');
    first.respond({ ok: true });
    await type(service, 'ab');

    const second = await socket.waitForEmit(EVENTS.messagePublish, 2);
    expect(await plaintextOf(storage, sessionId, envelopeOf(second))).toBe('ab');
  });

  it('surfaces a stale seq rejection even when a newer text followed', async () => {
    const { service, socket } = await startedSession();
    socket.responder = (event) => (event === EVENTS.messagePublish ? HOLD : { ok: true });

    await type(service, 'old');
    const first = await socket.waitForEmit(EVENTS.messagePublish, 1);
    await type(service, 'new');
    first.respond({ ok: false, error: 'stale_seq' });
    const second = await socket.waitForEmit(EVENTS.messagePublish, 2);
    second.respond({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(service.error()).toBe('stale_seq');
  });

  it.each(['not_sender', 'rate_limited', 'unknown_session'] as const)('surfaces a %s publish rejection', async (code) => {
    const { service, socket } = await startedSession();
    socket.responder = (event) => (event === EVENTS.messagePublish ? { ok: false, error: code } : { ok: true });
    await type(service, 'text');
    await socket.waitForEmit(EVENTS.messagePublish, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.error()).toBe(code);
  });

  it('treats a malformed publish ack as a protocol error', async () => {
    const { service, socket } = await startedSession();
    socket.responder = (event) => (event === EVENTS.messagePublish ? { ok: true, extra: 'x' } : { ok: true });
    await type(service, 'text');
    await socket.waitForEmit(EVENTS.messagePublish, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.error()).toBe('protocol_error');
    expect(service.lastSentAt()).toBeNull();
  });

  it('publishes empty text so clearing the box clears the receiver', async () => {
    const { service, socket, storage, sessionId } = await startedSession();
    await type(service, 'x');
    await socket.waitForEmit(EVENTS.messagePublish, 1);
    await type(service, '');
    const cleared = await socket.waitForEmit(EVENTS.messagePublish, 2);
    expect(await plaintextOf(storage, sessionId, envelopeOf(cleared))).toBe('');
  });

  it('does not publish text whose envelope would exceed the size cap and reports too long', async () => {
    const { service, socket } = await startedSession();
    await type(service, 'a'.repeat(50_000));
    await vi.advanceTimersByTimeAsync(0);
    expect(service.tooLong()).toBe(true);
    expect(socket.emitsOf(EVENTS.messagePublish)).toHaveLength(0);

    await type(service, 'short');
    const emit = await socket.waitForEmit(EVENTS.messagePublish, 1);
    expect(envelopeOf(emit).seq).toBe(1);
    expect(service.tooLong()).toBe(false);
  });

  it('rejoins with its token after a reconnect and republishes the unacknowledged text with a higher seq', async () => {
    const { service, socket, storage, sessionId } = await startedSession();
    socket.responder = (event) => (event === EVENTS.messagePublish ? HOLD : { ok: true });

    await type(service, 'lost');
    const lost = await socket.waitForEmit(EVENTS.messagePublish, 1);
    socket.drop();
    expect(lost.settled).toBe(false);

    socket.responder = () => ({ ok: true });
    socket.reconnect();
    const resent = await socket.waitForEmit(EVENTS.messagePublish, 2);

    const joins = socket.emitsOf(EVENTS.senderJoin);
    expect(joins).toHaveLength(2);
    expect(joins[1]?.args).toEqual(joins[0]?.args);
    expect(envelopeOf(resent).seq).toBeGreaterThan(envelopeOf(lost).seq);
    expect(await plaintextOf(storage, sessionId, envelopeOf(resent))).toBe('lost');
    await vi.advanceTimersByTimeAsync(0);
    expect(service.lastSentAt()).not.toBeNull();
    expect(service.error()).toBeNull();
  });

  it('does not republish after a reconnect when the last text was acknowledged', async () => {
    const { service, socket } = await startedSession();
    await type(service, 'done');
    await socket.waitForEmit(EVENTS.messagePublish, 1);
    await vi.advanceTimersByTimeAsync(0);

    socket.drop();
    socket.reconnect();
    await socket.waitForEmit(EVENTS.senderJoin, 2);
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);
    expect(socket.emitsOf(EVENTS.messagePublish)).toHaveLength(1);
  });

  it('holds text typed while disconnected and sends it after the rejoin', async () => {
    const { service, socket } = await startedSession();
    socket.drop();
    await type(service, 'offline');
    expect(socket.emitsOf(EVENTS.messagePublish)).toHaveLength(0);

    socket.reconnect();
    const emit = await socket.waitForEmit(EVENTS.messagePublish, 1);
    expect(envelopeOf(emit).seq).toBe(1);
  });

  it('resumes after a reload from sessionStorage and publishes with a higher seq than before', async () => {
    const storage = new MemoryStorage();
    const first = await startedSession(new FakeSessionSocket(), storage);
    await type(first.service, 'before reload');
    await first.socket.waitForEmit(EVENTS.messagePublish, 1);
    await type(first.service, 'still before');
    const lastBefore = await first.socket.waitForEmit(EVENTS.messagePublish, 2);
    const linkBefore = first.service.receiverLink();

    const socket = new FakeSessionSocket();
    const reloaded = setup(socket, storage);
    await reloaded.resume(first.sessionId);
    expect(reloaded.notResumable()).toBe(false);
    expect(reloaded.receiverLink()).toBe(linkBefore);
    const record = parseSenderRecord(storage.getItem(senderRecordKey(first.sessionId)));
    expect(socket.emitsOf(EVENTS.senderJoin)[0]?.args[0]).toEqual({
      sessionId: first.sessionId,
      senderToken: record?.senderToken,
    });

    await type(reloaded, 'after reload');
    const after = await socket.waitForEmit(EVENTS.messagePublish, 1);
    expect(envelopeOf(after).seq).toBeGreaterThan(envelopeOf(lastBefore).seq);
    expect(await plaintextOf(storage, first.sessionId, envelopeOf(after))).toBe('after reload');
  });

  it('reserves the seq in storage before the publish leaves', async () => {
    const { service, socket, storage, sessionId } = await startedSession();
    socket.responder = (event) => (event === EVENTS.messagePublish ? HOLD : { ok: true });
    await type(service, 'pending');
    await socket.waitForEmit(EVENTS.messagePublish, 1);
    expect(parseSenderRecord(storage.getItem(senderRecordKey(sessionId)))?.lastSeq).toBe(1);
  });

  it('reports that a session with nothing stored cannot be resumed and never joins', async () => {
    const socket = new FakeSessionSocket();
    const service = setup(socket, new MemoryStorage());
    await service.resume('AAAAAAAAAAAAAAAAAAAAAA');
    expect(service.notResumable()).toBe(true);
    expect(socket.connectCalls).toBe(0);
    expect(socket.emits).toHaveLength(0);
  });

  it.each(['server_busy', 'rate_limited'] as const)('reports %s when the session cannot be created', async (code) => {
    const socket = new FakeSessionSocket();
    socket.responder = () => ({ ok: false, error: code });
    const service = setup(socket, new MemoryStorage());
    expect(await firstValueFrom(service.createSession())).toBeNull();
    expect(service.error()).toBe(code);
  });

  it.each(['bad_token', 'slot_taken', 'unknown_session'] as const)('reports a %s sender join failure', async (code) => {
    const socket = new FakeSessionSocket();
    const storage = new MemoryStorage();
    const service = setup(socket, storage);
    const sessionId = await firstValueFrom(service.createSession());
    socket.responder = () => ({ ok: false, error: code });
    await service.resume(sessionId ?? '');
    expect(service.error()).toBe(code);
  });

  it('never emits the plaintext or the key fragment, and logs nothing', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { service, socket, storage, sessionId } = await startedSession();
    const secretText = 'the secret plaintext <b>42</b>';
    await type(service, secretText);
    await socket.waitForEmit(EVENTS.messagePublish, 1);
    socket.drop();
    socket.reconnect();
    await type(service, `${secretText} again`);
    await socket.waitForEmit(EVENTS.messagePublish, 2);

    const fragment = parseSenderRecord(storage.getItem(senderRecordKey(sessionId)))?.keyFragment ?? '';
    const wire = JSON.stringify(socket.emits.map((emit) => [emit.event, emit.args]));
    expect(fragment).toHaveLength(43);
    expect(wire).not.toContain(fragment);
    expect(wire).not.toContain('secret');
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});
