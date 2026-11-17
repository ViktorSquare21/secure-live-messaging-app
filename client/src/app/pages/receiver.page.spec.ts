import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { encrypt, EVENTS, exportKeyToFragment, generateKey, type Envelope, type SessionKey } from '@slm/shared';
import { SESSION_STORAGE } from '../session/session-env';
import { SessionSocket } from '../session/session-socket';
import { FakeSessionSocket, MemoryStorage, randomSessionId } from '../session/testing/fake-session-socket';
import { ReceiverPage } from './receiver.page';

interface Rendered {
  readonly fixture: ComponentFixture<ReceiverPage>;
  readonly element: HTMLElement;
  readonly socket: FakeSessionSocket;
  readonly sessionId: string;
  readonly key: SessionKey;
}

async function render(options: { hash?: (fragment: string) => string; socket?: FakeSessionSocket } = {}): Promise<Rendered> {
  const socket = options.socket ?? new FakeSessionSocket();
  const sessionId = randomSessionId();
  const key = await generateKey();
  const fragment = await exportKeyToFragment(key);
  window.location.hash = options.hash ? options.hash(fragment) : `#${fragment}`;
  TestBed.configureTestingModule({
    imports: [ReceiverPage],
    providers: [
      { provide: SessionSocket, useValue: socket },
      { provide: SESSION_STORAGE, useValue: new MemoryStorage() },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ sessionId }) } } },
    ],
  });
  const fixture = TestBed.createComponent(ReceiverPage);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, socket, sessionId, key };
}

async function settle(rendered: Rendered, check: () => void): Promise<void> {
  await vi.waitFor(async () => {
    await rendered.fixture.whenStable();
    check();
  });
}

function textOf(element: HTMLElement): string | null {
  return element.querySelector('[role="region"][aria-label="Received text"] .text')?.textContent ?? null;
}

function byLabel(element: HTMLElement, role: string, label: string): HTMLElement | null {
  return element.querySelector(`[role="${role}"][aria-label="${label}"]`);
}

function tamper(envelope: Envelope): Envelope {
  const flipped = envelope.ct.startsWith('A') ? 'B' : 'A';
  return { ...envelope, ct: flipped + envelope.ct.slice(1) };
}

describe('ReceiverPage', () => {
  afterEach(() => {
    window.location.hash = '';
    TestBed.resetTestingModule();
  });

  it('shows the joined text live and updates it without a reload, keeping line breaks', async () => {
    const r = await render();
    await settle(r, () => expect(byLabel(r.element, 'status', 'Session status')?.textContent).toContain('Waiting for the sender'));

    r.socket.serverEmit(EVENTS.messageUpdate, await encrypt(r.key, r.sessionId, 1, 'first'));
    await settle(r, () => expect(textOf(r.element)).toBe('first'));
    r.socket.serverEmit(EVENTS.messageUpdate, await encrypt(r.key, r.sessionId, 2, 'line one\nline two'));

    await settle(r, () => expect(textOf(r.element)).toBe('line one\nline two'));
    expect(byLabel(r.element, 'status', 'Session status')?.textContent).toContain('Live');
  });

  it('has no input, textarea or other editable element', async () => {
    const r = await render();
    r.socket.serverEmit(EVENTS.messageUpdate, await encrypt(r.key, r.sessionId, 1, 'read only'));
    await settle(r, () => expect(textOf(r.element)).toBe('read only'));

    expect(r.element.querySelectorAll('input, textarea, select, button, [contenteditable]')).toHaveLength(0);
  });

  it('shows the integrity banner and keeps the previous text exactly when an update fails verification', async () => {
    const r = await render();
    r.socket.serverEmit(EVENTS.messageUpdate, await encrypt(r.key, r.sessionId, 1, 'verified text'));
    await settle(r, () => expect(textOf(r.element)).toBe('verified text'));

    r.socket.serverEmit(EVENTS.messageUpdate, tamper(await encrypt(r.key, r.sessionId, 2, 'forged text')));

    await settle(r, () => expect(byLabel(r.element, 'alert', 'Integrity warning')).not.toBeNull());
    expect(byLabel(r.element, 'alert', 'Integrity warning')?.textContent).toContain(
      'An update could not be verified and was ignored. Showing the last verified text.',
    );
    expect(textOf(r.element)).toBe('verified text');
    expect(r.element.textContent).not.toContain('forged');
  });

  it('keeps the previous text and warns on a replayed seq, and the next valid update clears the banner', async () => {
    const r = await render();
    const first = await encrypt(r.key, r.sessionId, 1, 'one');
    r.socket.serverEmit(EVENTS.messageUpdate, first);
    await settle(r, () => expect(textOf(r.element)).toBe('one'));

    r.socket.serverEmit(EVENTS.messageUpdate, first);
    await settle(r, () => expect(byLabel(r.element, 'alert', 'Integrity warning')).not.toBeNull());
    expect(textOf(r.element)).toBe('one');

    r.socket.serverEmit(EVENTS.messageUpdate, await encrypt(r.key, r.sessionId, 2, 'two'));
    await settle(r, () => expect(textOf(r.element)).toBe('two'));
    expect(byLabel(r.element, 'alert', 'Integrity warning')).toBeNull();
  });

  it('keeps the integrity banner through a disconnect and rejoin until the next valid update', async () => {
    const r = await render();
    const first = await encrypt(r.key, r.sessionId, 1, 'one');
    r.socket.serverEmit(EVENTS.messageUpdate, first);
    await settle(r, () => expect(textOf(r.element)).toBe('one'));
    r.socket.serverEmit(EVENTS.messageUpdate, first);
    await settle(r, () => expect(byLabel(r.element, 'alert', 'Integrity warning')).not.toBeNull());

    r.socket.drop();
    r.socket.reconnect();
    await settle(r, () => expect(byLabel(r.element, 'status', 'Session status')?.textContent).toContain('Live'));
    expect(byLabel(r.element, 'alert', 'Integrity warning')).not.toBeNull();

    r.socket.serverEmit(EVENTS.messageUpdate, await encrypt(r.key, r.sessionId, 2, 'two'));
    await settle(r, () => expect(textOf(r.element)).toBe('two'));
    expect(byLabel(r.element, 'alert', 'Integrity warning')).toBeNull();
  });

  it('shows markup in the received text literally and creates no elements from it', async () => {
    const r = await render();
    const hostile = '<script>window.slmHacked = 1</script><img src="x" onerror="window.slmHacked = 1">';
    r.socket.serverEmit(EVENTS.messageUpdate, await encrypt(r.key, r.sessionId, 1, hostile));

    await settle(r, () => expect(textOf(r.element)).toBe(hostile));
    const region = byLabel(r.element, 'region', 'Received text');
    expect(region?.querySelectorAll('script, img')).toHaveLength(0);
    expect((window as { slmHacked?: number }).slmHacked).toBeUndefined();
  });

  it.each([
    ['missing', () => ''],
    ['truncated', (fragment: string) => `#${fragment.slice(0, 20)}`],
    ['corrupted', (fragment: string) => `#${fragment.slice(0, -1)}!`],
  ])('shows the key error when the key is %s, shows no text and never joins', async (_name, hash) => {
    const r = await render({ hash });

    await settle(r, () =>
      expect(byLabel(r.element, 'alert', 'Session error')?.textContent).toContain(
        'This link is incomplete or damaged. Ask the sender for a new link.',
      ),
    );
    expect(byLabel(r.element, 'region', 'Received text')).toBeNull();
    expect(r.socket.emitsOf(EVENTS.receiverJoin)).toHaveLength(0);
    expect(r.socket.connectCalls).toBe(0);
  });

  it.each([
    ['unknown_session', "This session doesn't exist or has ended."],
    ['slot_taken', 'Someone else is already viewing this session.'],
  ])('shows its own message when the join is refused with %s, and no text display', async (error, message) => {
    const socket = new FakeSessionSocket();
    socket.responder = () => ({ ok: false, error });
    const r = await render({ socket });

    await settle(r, () => expect(byLabel(r.element, 'alert', 'Session error')?.textContent).toContain(message));
    expect(byLabel(r.element, 'region', 'Received text')).toBeNull();
  });

  it('keeps the text and says reconnecting while its own connection is down', async () => {
    const r = await render();
    r.socket.serverEmit(EVENTS.messageUpdate, await encrypt(r.key, r.sessionId, 1, 'still here'));
    await settle(r, () => expect(textOf(r.element)).toBe('still here'));

    r.socket.drop();

    await settle(r, () =>
      expect(byLabel(r.element, 'status', 'Session status')?.textContent).toContain('Disconnected – reconnecting…'),
    );
    expect(textOf(r.element)).toBe('still here');
  });
});
