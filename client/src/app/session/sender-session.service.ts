import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EVENTS, isValidPeerStatus, type PeerState, type SessionKey } from '@slm/shared';
import {
  catchError,
  concatMap,
  debounceTime,
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  from,
  map,
  merge,
  type Observable,
  of,
  Subject,
  switchMap,
  take,
  tap,
  throwError,
  timeout,
} from 'rxjs';
import { parsePublishAck, parseSenderJoinAck, parseSessionCreateAck } from './ack-parsers';
import {
  buildReceiverLink,
  envelopeFits,
  parseSenderRecord,
  senderRecordKey,
  serializeSenderRecord,
  withLastSeq,
  type SenderError,
  type SenderRecord,
} from './sender-core';
import { APP_ORIGIN, CLOCK, SESSION_CRYPTO, SESSION_STORAGE } from './session-env';
import { SessionSocket, type ConnectionState } from './session-socket';

export const PUBLISH_DEBOUNCE_MS = 300;
export const CONNECT_TIMEOUT_MS = 5_000;

class UnreachableError extends Error {}

interface ActiveSession {
  readonly sessionId: string;
  readonly key: SessionKey;
  record: SenderRecord;
}

@Injectable()
export class SenderSessionService {
  private readonly socket = inject(SessionSocket);
  private readonly crypto = inject(SESSION_CRYPTO);
  private readonly storage = inject(SESSION_STORAGE);
  private readonly clock = inject(CLOCK);
  private readonly origin = inject(APP_ORIGIN);
  private readonly destroyRef = inject(DestroyRef);

  private readonly receiverLinkSignal = signal<string | null>(null);
  private readonly lastSentAtSignal = signal<number | null>(null);
  private readonly peerSignal = signal<PeerState | null>(null);
  private readonly errorSignal = signal<SenderError | null>(null);
  private readonly tooLongSignal = signal(false);
  private readonly notResumableSignal = signal(false);
  private readonly sendingSignal = signal(false);
  private readonly connectionSignal = signal<ConnectionState>('disconnected');

  readonly receiverLink = this.receiverLinkSignal.asReadonly();
  readonly lastSentAt = this.lastSentAtSignal.asReadonly();
  readonly peer = this.peerSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly tooLong = this.tooLongSignal.asReadonly();
  readonly notResumable = this.notResumableSignal.asReadonly();
  readonly sending = this.sendingSignal.asReadonly();
  readonly connection = this.connectionSignal.asReadonly();

  private readonly typed = new Subject<string>();
  private readonly republish = new Subject<string>();
  private session: ActiveSession | null = null;
  private joined = false;
  private latestTyped: string | null = null;
  private lastSentText: string | null = null;
  private lastAckedText: string | null = null;

  constructor() {
    merge(
      this.typed.pipe(
        debounceTime(PUBLISH_DEBOUNCE_MS),
        // A text skipped as stale was never sent, so typing it again must still publish it.
        distinctUntilChanged((previous, current) => previous === current && current === this.lastSentText),
      ),
      this.republish,
    )
      .pipe(
        concatMap((text) => this.publishStep(text)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  createSession(): Observable<string | null> {
    return defer(() => {
      this.errorSignal.set(null);
      this.socket.connect();
      return this.socket.connection$;
    }).pipe(
      filter((state) => state !== 'disconnected'),
      take(1),
      timeout({ first: CONNECT_TIMEOUT_MS, with: () => throwError(() => new UnreachableError()) }),
      switchMap(() => this.socket.emitWithAck(EVENTS.sessionCreate)),
      map(parseSessionCreateAck),
      switchMap((ack) => {
        if (ack === null) return this.fail('protocol_error');
        if (!ack.ok) return this.fail(ack.error);
        return from(this.storeNewSession(ack.sessionId, ack.senderToken));
      }),
      catchError((error: unknown) => this.fail(error instanceof UnreachableError ? 'unreachable' : 'protocol_error')),
    );
  }

  async resume(sessionId: string): Promise<void> {
    const record = parseSenderRecord(this.storage.getItem(senderRecordKey(sessionId)));
    const imported = record === null ? null : await this.crypto.importKeyFromFragment(record.keyFragment);
    if (record === null || imported === null || imported.status !== 'ok') {
      this.notResumableSignal.set(true);
      return;
    }
    this.session = { sessionId, key: imported.key, record };
    this.receiverLinkSignal.set(buildReceiverLink(this.origin, sessionId, record.keyFragment));

    this.socket.connection$
      .pipe(
        tap((state) => {
          this.connectionSignal.set(state);
          if (state !== 'disconnected') return;
          this.joined = false;
          this.peerSignal.set(null);
        }),
        filter((state) => state !== 'disconnected'),
        switchMap(() =>
          this.socket
            .emitWithAck(EVENTS.senderJoin, { sessionId, senderToken: record.senderToken })
            .pipe(catchError(() => EMPTY)),
        ),
        map(parseSenderJoinAck),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((ack) => {
        if (ack === null) return this.errorSignal.set('protocol_error');
        if (!ack.ok) return this.errorSignal.set(ack.error);
        this.errorSignal.set(null);
        this.joined = true;
        if (this.latestTyped !== null && this.latestTyped !== this.lastAckedText) this.republish.next(this.latestTyped);
      });

    this.socket
      .on$(EVENTS.peerStatus)
      .pipe(filter(isValidPeerStatus), takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.peerSignal.set(status.peer));

    this.socket.connect();
  }

  textChanged(text: string): void {
    this.latestTyped = text;
    this.typed.next(text);
  }

  private async storeNewSession(sessionId: string, senderToken: string): Promise<string> {
    const key = await this.crypto.generateKey();
    const keyFragment = await this.crypto.exportKeyToFragment(key);
    const record: SenderRecord = { senderToken, keyFragment, lastSeq: 0 };
    this.storage.setItem(senderRecordKey(sessionId), serializeSenderRecord(record));
    return sessionId;
  }

  private fail(error: SenderError): Observable<null> {
    this.errorSignal.set(error);
    return of(null);
  }

  private publishStep(text: string): Observable<void> {
    return defer(() => {
      const session = this.session;
      if (session === null || !this.joined || text !== this.latestTyped) return EMPTY;
      if (!envelopeFits(text)) {
        this.tooLongSignal.set(true);
        return EMPTY;
      }
      this.tooLongSignal.set(false);
      const seq = session.record.lastSeq + 1;
      session.record = withLastSeq(session.record, seq);
      this.storage.setItem(senderRecordKey(session.sessionId), serializeSenderRecord(session.record));
      return from(this.crypto.encrypt(session.key, session.sessionId, seq, text)).pipe(
        concatMap((envelope) => {
          this.lastSentText = text;
          this.sendingSignal.set(true);
          return this.socket.emitWithAck(EVENTS.messagePublish, envelope);
        }),
        map((raw) => this.handlePublishAck(parsePublishAck(raw), text)),
        catchError(() => EMPTY),
        finalize(() => this.sendingSignal.set(false)),
      );
    });
  }

  private handlePublishAck(ack: ReturnType<typeof parsePublishAck>, text: string): void {
    if (ack === null) return this.errorSignal.set('protocol_error');
    if (!ack.ok) return this.errorSignal.set(ack.error);
    this.lastAckedText = text;
    this.lastSentAtSignal.set(this.clock());
  }
}
