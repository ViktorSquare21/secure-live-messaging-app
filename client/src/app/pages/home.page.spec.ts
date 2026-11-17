import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { EVENTS } from '@slm/shared';
import { SESSION_STORAGE } from '../session/session-env';
import { SessionSocket } from '../session/session-socket';
import { FakeSessionSocket, HOLD, MemoryStorage, randomSessionId, randomToken } from '../session/testing/fake-session-socket';
import { HomePage } from './home.page';

async function render(socket: FakeSessionSocket): Promise<{ fixture: ComponentFixture<HomePage>; navigate: ReturnType<typeof vi.fn> }> {
  TestBed.configureTestingModule({
    imports: [HomePage],
    providers: [
      provideRouter([]),
      { provide: SessionSocket, useValue: socket },
      { provide: SESSION_STORAGE, useValue: new MemoryStorage() },
    ],
  });
  const navigate = vi.fn(async () => true);
  TestBed.inject(Router).navigate = navigate;
  const fixture = TestBed.createComponent(HomePage);
  await fixture.whenStable();
  return { fixture, navigate };
}

function button(fixture: ComponentFixture<HomePage>): HTMLButtonElement {
  const found = (fixture.nativeElement as HTMLElement).querySelector('button');
  if (found?.textContent?.trim() !== 'New session') throw new Error('no New session button');
  return found;
}

async function settle(fixture: ComponentFixture<HomePage>, check: () => void): Promise<void> {
  await vi.waitFor(async () => {
    await fixture.whenStable();
    check();
  });
}

describe('HomePage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('creates one session per click while the request is in flight and opens its sender page', async () => {
    const socket = new FakeSessionSocket();
    socket.responder = () => HOLD;
    const { fixture, navigate } = await render(socket);

    button(fixture).click();
    const create = await socket.waitForEmit(EVENTS.sessionCreate, 1);
    await settle(fixture, () => expect(button(fixture).disabled).toBe(true));
    button(fixture).click();
    const sessionId = randomSessionId();
    create.respond({ ok: true, sessionId, senderToken: randomToken() });

    await settle(fixture, () => expect(navigate).toHaveBeenCalledExactlyOnceWith(['/s', sessionId]));
    expect(socket.emitsOf(EVENTS.sessionCreate)).toHaveLength(1);
  });

  it('shows a short error and enables the button again when the server is busy', async () => {
    const socket = new FakeSessionSocket();
    socket.responder = () => ({ ok: false, error: 'server_busy' });
    const { fixture, navigate } = await render(socket);

    button(fixture).click();

    const element = fixture.nativeElement as HTMLElement;
    await settle(fixture, () =>
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('The server is busy. Try again in a moment.'),
    );
    expect(button(fixture).disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
