import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EVENTS, isToken, isValidPeerStatus, type AckErrorCode, type PeerState, type SessionKey } from '@slm/shared';
import { catchError, concatMap, EMPTY, filter, from, map, merge, type Observable, of, switchMap, tap } from 'rxjs';
import { parseReceiverJoinAck, type ReceiverJoinResult } from './ack-parsers';
import { initialReceiverState, receiverTransition, type ReceiverEvent, type ReceiverState } from './receiver-state';
import { receiverTokenKey } from './sender-core';
import { SESSION_CRYPTO, SESSION_STORAGE } from './session-env';
import { SessionSocket } from './session-socket';

export type ReceiverError = 'invalid_key' | 'protocol_error' | AckErrorCode;

type InboxItem =
  | { readonly type: 'update' | 'resync'; readonly envelope: unknown }
  | { readonly type: 'disconnected' }
  | { readonly type: 'rejoined' };

@Injectable()
export class ReceiverSessionService {
  private readonly socket = inject(SessionSocket);
  private readonly crypto = inject(SESSION_CRYPTO);
  private readonly storage = inject(SESSION_STORAGE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly stateSignal = signal<ReceiverState>(initialReceiverState);
  private readonly errorSignal = signal<ReceiverError | null>(null);
  private readonly peerSignal = signal<PeerState | null>(null);

  readonly state = this.stateSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly peer = this.peerSignal.asReadonly();

  async open(sessionId: string, keyFragment: string): Promise<void> {
    const imported = await this.crypto.importKeyFromFragment(keyFragment);
    if (imported.status !== 'ok') {
      this.errorSignal.set('invalid_key');
      return;
    }
    const key = imported.key;
    let joined = false;

    const joins$ = this.socket.connection$.pipe(
      filter((state) => state !== 'disconnected'),
      switchMap(() => this.join(sessionId)),
      concatMap((ack) => {
        const items = this.joinItems(sessionId, ack, joined);
        if (ack !== null && ack.ok) joined = true;
        return from(items);
      }),
    );
    const disconnects$ = this.socket.connection$.pipe(
      filter((state) => state === 'disconnected' && joined),
      tap(() => this.peerSignal.set(null)),
      map((): InboxItem => ({ type: 'disconnected' })),
    );
    const updates$ = this.socket
      .on$(EVENTS.messageUpdate)
      .pipe(map((envelope): InboxItem => ({ type: 'update', envelope })));

    merge(joins$, disconnects$, updates$)
      .pipe(
        concatMap((item) => this.withDecryptResult(key, sessionId, item)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => this.stateSignal.update((state) => receiverTransition(state, event)));

    this.socket
      .on$(EVENTS.peerStatus)
      .pipe(filter(isValidPeerStatus), takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.peerSignal.set(status.peer));

    this.socket.connect();
  }

  private join(sessionId: string): Observable<ReceiverJoinResult | null> {
    const stored = this.storage.getItem(receiverTokenKey(sessionId));
    const payload = isToken(stored) ? { sessionId, rejoinToken: stored } : { sessionId };
    return this.socket.emitWithAck(EVENTS.receiverJoin, payload).pipe(
      map(parseReceiverJoinAck),
      catchError(() => EMPTY),
    );
  }

  private joinItems(sessionId: string, ack: ReceiverJoinResult | null, rejoining: boolean): InboxItem[] {
    if (ack === null) {
      this.errorSignal.set('protocol_error');
      return [];
    }
    if (!ack.ok) {
      this.errorSignal.set(ack.error);
      return [];
    }
    this.errorSignal.set(null);
    this.storage.setItem(receiverTokenKey(sessionId), ack.rejoinToken);
    const items: InboxItem[] = rejoining ? [{ type: 'rejoined' }] : [];
    if (ack.latest !== undefined) items.push({ type: 'resync', envelope: ack.latest });
    return items;
  }

  private withDecryptResult(key: SessionKey, sessionId: string, item: InboxItem): Observable<ReceiverEvent> {
    if (item.type === 'disconnected' || item.type === 'rejoined') return of(item);
    return from(this.crypto.decrypt(key, sessionId, item.envelope)).pipe(
      map((result): ReceiverEvent => ({ type: item.type, envelope: item.envelope, result })),
    );
  }
}
