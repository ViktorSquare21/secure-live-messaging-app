import { Injectable } from '@angular/core';
import { EVENTS } from '@slm/shared';
import { BehaviorSubject, defer, from, Observable, throwError } from 'rxjs';
import { io, type ManagerOptions, type SocketOptions } from 'socket.io-client';

export type ConnectionState = 'disconnected' | 'connected' | 'reconnected';

export type ClientEventName =
  | typeof EVENTS.sessionCreate
  | typeof EVENTS.senderJoin
  | typeof EVENTS.receiverJoin
  | typeof EVENTS.messagePublish;

export type ServerEventName = typeof EVENTS.messageUpdate | typeof EVENTS.peerStatus;

export const SOCKET_OPTIONS: Partial<ManagerOptions & SocketOptions> = {
  transports: ['websocket'],
  autoConnect: false,
};

export const ACK_TIMEOUT_MS = 5_000;

export class NotConnectedError extends Error {
  constructor() {
    super('not_connected');
  }
}

export interface SocketLike {
  readonly connected: boolean;
  connect(): unknown;
  disconnect(): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  timeout(ms: number): { emitWithAck(event: string, ...args: unknown[]): Promise<unknown> };
}

@Injectable({ providedIn: 'root', useFactory: () => new SocketIoSessionSocket(io(SOCKET_OPTIONS)) })
export abstract class SessionSocket {
  abstract readonly connection$: Observable<ConnectionState>;
  abstract connect(): void;
  abstract disconnect(): void;
  abstract emitWithAck(event: ClientEventName, ...args: unknown[]): Observable<unknown>;
  abstract on$(event: ServerEventName): Observable<unknown>;
}

export class SocketIoSessionSocket extends SessionSocket {
  private readonly state = new BehaviorSubject<ConnectionState>('disconnected');
  private hasConnected = false;
  readonly connection$ = this.state.asObservable();

  constructor(private readonly socket: SocketLike) {
    super();
    socket.on('connect', () => {
      this.state.next(this.hasConnected ? 'reconnected' : 'connected');
      this.hasConnected = true;
    });
    socket.on('disconnect', () => this.state.next('disconnected'));
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  // socket.io buffers an emit made while offline and flushes it on reconnect, before any rejoin; a stale publish would then hit a socket that is not the sender yet.
  emitWithAck(event: ClientEventName, ...args: unknown[]): Observable<unknown> {
    return defer(() =>
      this.socket.connected
        ? from(this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, ...args))
        : throwError(() => new NotConnectedError()),
    );
  }

  on$(event: ServerEventName): Observable<unknown> {
    return new Observable<unknown>((subscriber) => {
      const listener = (payload: unknown): void => subscriber.next(payload);
      this.socket.on(event, listener);
      return () => this.socket.off(event, listener);
    });
  }
}
