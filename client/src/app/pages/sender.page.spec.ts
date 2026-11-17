import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { EVENTS, exportKeyToFragment, generateKey } from '@slm/shared';
import { senderRecordKey, serializeSenderRecord } from '../session/sender-core';
import { APP_ORIGIN, CLIPBOARD, CLOCK, SESSION_STORAGE, type ClipboardWriter } from '../session/session-env';
import { SessionSocket } from '../session/session-socket';
import { FakeSessionSocket, HOLD, MemoryStorage, randomSessionId, randomToken } from '../session/testing/fake-session-socket';
import { SenderPage } from './sender.page';

const ORIGIN = 'https://app.test';
const SENT_AT = new Date(2026, 10, 17, 14, 5, 9).getTime();

interface Rendered {
  readonly fixture: ComponentFixture<SenderPage>;
  readonly element: HTMLElement;
  readonly socket: FakeSessionSocket;
  readonly sessionId: string;
  readonly senderToken: string;
  readonly keyFragment: string;
}

async function render(
  options: { stored?: boolean; socket?: FakeSessionSocket; clipboard?: ClipboardWriter | null } = {},
): Promise<Rendered> {
  const socket = options.socket ?? new FakeSessionSocket();
  const storage = new MemoryStorage();
  const sessionId = randomSessionId();
  const senderToken = randomToken();
  const keyFragment = await exportKeyToFragment(await generateKey());
  if (options.stored !== false) {
    storage.setItem(senderRecordKey(sessionId), serializeSenderRecord({ senderToken, keyFragment, lastSeq: 0 }));
  }
  TestBed.configureTestingModule({
    imports: [SenderPage],
    providers: [
      provideRouter([]),
      { provide: SessionSocket, useValue: socket },
      { provide: SESSION_STORAGE, useValue: storage },
      { provide: CLOCK, useValue: () => SENT_AT },
      { provide: APP_ORIGIN, useValue: ORIGIN },
      { provide: CLIPBOARD, useValue: options.clipboard === undefined ? vi.fn(async () => undefined) : options.clipboard },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ sessionId }) } } },
    ],
  });
  const fixture = TestBed.createComponent(SenderPage);
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, socket, sessionId, senderToken, keyFragment };
}

async function settle(rendered: Rendered, check: () => void): Promise<void> {
  await vi.waitFor(async () => {
    await rendered.fixture.whenStable();
    check();
  });
}

function byLabel(element: HTMLElement, role: string, label: string): HTMLElement | null {
  return element.querySelector(`[role="${role}"][aria-label="${label}"]`);
}

function textarea(element: HTMLElement): HTMLTextAreaElement {
  const found = element.querySelector('textarea');
  if (found === null) throw new Error('no textarea');
  return found;
}

function linkInput(element: HTMLElement): HTMLInputElement {
  const found = element.querySelector<HTMLInputElement>('input[readonly]');
  if (found === null) throw new Error('no link input');
  return found;
}

function copyButton(element: HTMLElement): HTMLButtonElement {
  const found = [...element.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Copy link');
  if (found === undefined) throw new Error('no copy button');
  return found;
}

function typeText(element: HTMLElement, text: string): void {
  const field = textarea(element);
  field.value = text;
  field.dispatchEvent(new Event('input'));
}

describe('SenderPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((container) => container.remove());
  });

  it('shows the receiver link with the key in the fragment, labelled and with a hint', async () => {
    const r = await render();

    await settle(r, () => expect(linkInput(r.element).value).toBe(`${ORIGIN}/r/${r.sessionId}#${r.keyFragment}`));
    expect(r.element.textContent).toContain('Receiver link');
    expect(r.element.textContent).toContain('Send this link to your receiver');
  });

  it('copies exactly the receiver link and confirms without showing the key', async () => {
    const clipboard = vi.fn(async (_text: string) => undefined);
    const r = await render({ clipboard });
    await settle(r, () => expect(linkInput(r.element).value).not.toBe(''));

    copyButton(r.element).click();

    await settle(r, () => expect(document.body.textContent).toContain('Link copied'));
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/r/${r.sessionId}#${r.keyFragment}`);
    const snackBar = document.querySelector('.cdk-overlay-container')?.textContent ?? '';
    expect(snackBar).not.toContain(r.keyFragment);
  });

  it.each([
    ['unavailable', null],
    ['refused', vi.fn(async () => Promise.reject(new Error('denied')))],
  ])('selects the link text when the clipboard is %s', async (_name, clipboard) => {
    const r = await render({ clipboard });
    await settle(r, () => expect(linkInput(r.element).value).not.toBe(''));

    copyButton(r.element).click();

    const input = linkInput(r.element);
    await settle(r, () => expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]));
    expect(document.body.textContent).not.toContain('Link copied');
  });

  it('has exactly one editable field, the text input', async () => {
    const r = await render();
    await settle(r, () => expect(linkInput(r.element).value).not.toBe(''));

    const editable = r.element.querySelectorAll('textarea, input:not([readonly]), select, [contenteditable]');
    expect(editable).toHaveLength(1);
    expect(editable[0]?.tagName).toBe('TEXTAREA');
    expect(r.element.textContent).toContain('Your text');
  });

  it('follows the peer through waiting, connected and disconnected, and says reconnecting when offline', async () => {
    const r = await render();
    const chip = (): string => byLabel(r.element, 'status', 'Receiver status')?.textContent?.trim() ?? '';
    await settle(r, () => expect(r.socket.emitsOf(EVENTS.senderJoin)).toHaveLength(1));

    r.socket.serverEmit(EVENTS.peerStatus, { peer: 'disconnected' });
    await settle(r, () => expect(chip()).toBe('Waiting for receiver'));
    r.socket.serverEmit(EVENTS.peerStatus, { peer: 'connected' });
    await settle(r, () => expect(chip()).toBe('Receiver connected'));
    r.socket.serverEmit(EVENTS.peerStatus, { peer: 'disconnected' });
    await settle(r, () => expect(chip()).toBe('Receiver disconnected'));
    r.socket.drop();
    await settle(r, () => expect(chip()).toBe('Reconnecting…'));
  });

  it('shows not sent yet, then sending while the ack is held, then the local time of the ack', async () => {
    const socket = new FakeSessionSocket();
    const r = await render({ socket });
    const lastSent = (): string => byLabel(r.element, 'status', 'Last sent')?.textContent?.trim() ?? '';
    await settle(r, () => expect(socket.emitsOf(EVENTS.senderJoin)).toHaveLength(1));
    expect(lastSent()).toBe('Not sent yet');
    socket.responder = () => HOLD;

    typeText(r.element, 'hello');
    const publish = await socket.waitForEmit(EVENTS.messagePublish, 1);
    await settle(r, () => expect(lastSent()).toBe('Sending…'));

    publish.respond({ ok: true });
    await settle(r, () => expect(lastSent()).toMatch(/^Sent at 2:05:09\s?PM$/));
  });

  it('never renders the sender token', async () => {
    const r = await render();
    await settle(r, () => expect(linkInput(r.element).value).not.toBe(''));
    typeText(r.element, 'hello');
    await r.socket.waitForEmit(EVENTS.messagePublish, 1);
    await r.fixture.whenStable();

    expect(r.element.innerHTML).not.toContain(r.senderToken);
    expect(linkInput(r.element).value).not.toContain(r.senderToken);
  });

  it('shows that the session cannot be resumed here, with no text input, when the tab has nothing stored', async () => {
    const r = await render({ stored: false });

    await settle(r, () =>
      expect(byLabel(r.element, 'alert', 'Session error')?.textContent).toContain("This session can't be resumed here."),
    );
    expect(r.element.querySelector('textarea')).toBeNull();
    expect(r.element.querySelector('a[href="/"]')).not.toBeNull();
    expect(r.socket.emitsOf(EVENTS.senderJoin)).toHaveLength(0);
  });

  it.each([
    ['unknown_session', "This session doesn't exist or has ended."],
    ['bad_token', "This session can't be opened from this tab."],
    ['slot_taken', 'This session is already open in another tab.'],
  ])('disables the text input and links home when the join is refused with %s', async (error, message) => {
    const socket = new FakeSessionSocket();
    socket.responder = () => ({ ok: false, error });
    const r = await render({ socket });

    await settle(r, () => expect(byLabel(r.element, 'alert', 'Session error')?.textContent).toContain(message));
    expect(textarea(r.element).disabled).toBe(true);
    expect(byLabel(r.element, 'alert', 'Session error')?.querySelector('a[href="/"]')).not.toBeNull();
  });

  it('keeps typing possible after a rejected update', async () => {
    const socket = new FakeSessionSocket();
    const r = await render({ socket });
    await settle(r, () => expect(socket.emitsOf(EVENTS.senderJoin)).toHaveLength(1));
    socket.responder = () => ({ ok: false, error: 'stale_seq' });

    typeText(r.element, 'hello');

    await settle(r, () =>
      expect(byLabel(r.element, 'alert', 'Session error')?.textContent).toContain('The server did not accept the last update.'),
    );
    expect(textarea(r.element).disabled).toBe(false);
  });
});
