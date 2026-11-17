import { encodeBase64Url, EVENTS, SESSION_ID_BYTES, TOKEN_BYTES } from '@slm/shared';
import { BehaviorSubject, Observable, Subject, throwError } from 'rxjs';
import { NotConnectedError, SessionSocket, type ClientEventName, type ConnectionState, type ServerEventName } from '../session-socket';

export interface RecordedEmit {
  readonly event: ClientEventName;
  readonly args: readonly unknown[];
  settled: boolean;
  respond(ack: unknown): void;
}

export type Responder = (event: ClientEventName, args: readonly unknown[]) => unknown;

export const HOLD = Symbol('hold');

export function randomId(byteCount: number): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

export function randomSessionId(): string {
  return randomId(SESSION_ID_BYTES);
}

export function randomToken(): string {
  return randomId(TOKEN_BYTES);
}

export function defaultResponder(event: ClientEventName): unknown {
  switch (event) {
    case EVENTS.sessionCreate:
      return { ok: true, sessionId: randomSessionId(), senderToken: randomToken() };
    case EVENTS.receiverJoin:
      return { ok: true, rejoinToken: randomToken() };
    default:
      return { ok: true };
  }
}

export class FakeSessionSocket extends SessionSocket {
  private readonly state = new BehaviorSubject<ConnectionState>('disconnected');
  private readonly serverEvents = new Map<ServerEventName, Subject<unknown>>();
  private readonly pending = new Set<{ fail: () => void }>();
  private waiters: { event: ClientEventName; count: number; resolve: (emit: RecordedEmit) => void }[] = [];
  private everConnected = false;

  readonly connection$ = this.state.asObservable();
  readonly emits: RecordedEmit[] = [];
  connectCalls = 0;
  responder: Responder = (event) => defaultResponder(event);

  connect(): void {
    this.connectCalls++;
    if (this.state.value === 'disconnected' && !this.everConnected) {
      this.everConnected = true;
      this.state.next('connected');
    }
  }

  disconnect(): void {
    this.drop();
  }

  drop(): void {
    for (const entry of [...this.pending]) entry.fail();
    this.state.next('disconnected');
  }

  reconnect(): void {
    this.state.next('reconnected');
  }

  emitWithAck(event: ClientEventName, ...args: unknown[]): Observable<unknown> {
    if (this.state.value === 'disconnected') return throwError(() => new NotConnectedError());
    return new Observable<unknown>((subscriber) => {
      const entry = {
        fail: () => {
          this.pending.delete(entry);
          subscriber.error(new Error('socket has been disconnected'));
        },
      };
      this.pending.add(entry);
      const recorded: RecordedEmit = {
        event,
        args,
        settled: false,
        respond: (ack) => {
          if (!this.pending.has(entry)) return;
          this.pending.delete(entry);
          recorded.settled = true;
          subscriber.next(ack);
          subscriber.complete();
        },
      };
      this.emits.push(recorded);
      this.notifyWaiters();
      const ack = this.responder(event, args);
      if (ack !== HOLD) recorded.respond(ack);
    });
  }

  on$(event: ServerEventName): Observable<unknown> {
    return this.subjectFor(event).asObservable();
  }

  serverEmit(event: ServerEventName, payload: unknown): void {
    this.subjectFor(event).next(payload);
  }

  emitsOf(event: ClientEventName): RecordedEmit[] {
    return this.emits.filter((emit) => emit.event === event);
  }

  waitForEmit(event: ClientEventName, count: number): Promise<RecordedEmit> {
    return new Promise((resolve) => {
      this.waiters.push({ event, count, resolve });
      this.notifyWaiters();
    });
  }

  private notifyWaiters(): void {
    this.waiters = this.waiters.filter((waiter) => {
      const emit = this.emitsOf(waiter.event)[waiter.count - 1];
      if (emit === undefined) return true;
      waiter.resolve(emit);
      return false;
    });
  }

  private subjectFor(event: ServerEventName): Subject<unknown> {
    let subject = this.serverEvents.get(event);
    if (subject === undefined) {
      subject = new Subject<unknown>();
      this.serverEvents.set(event, subject);
    }
    return subject;
  }
}

export class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
