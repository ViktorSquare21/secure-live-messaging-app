import { EVENTS } from '@slm/shared';
import { firstValueFrom } from 'rxjs';
import { ACK_TIMEOUT_MS, NotConnectedError, SOCKET_OPTIONS, SocketIoSessionSocket, type SocketLike } from './session-socket';

class StubSocket implements SocketLike {
  connected = false;
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly sent: { timeout: number; event: string; args: unknown[] }[] = [];
  ackReply: unknown = { ok: true };

  connect(): void {
    this.connected = true;
    this.fire('connect');
  }

  disconnect(): void {
    this.connected = false;
    this.fire('disconnect');
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  timeout(ms: number): { emitWithAck(event: string, ...args: unknown[]): Promise<unknown> } {
    return {
      emitWithAck: (event, ...args) => {
        this.sent.push({ timeout: ms, event, args });
        return Promise.resolve(this.ackReply);
      },
    };
  }

  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

describe('SocketIoSessionSocket', () => {
  it('uses only the WebSocket transport and waits for an explicit connect', () => {
    expect(SOCKET_OPTIONS.transports).toEqual(['websocket']);
    expect(SOCKET_OPTIONS.autoConnect).toBe(false);
  });

  it('reports connected, disconnected and then reconnected', () => {
    const stub = new StubSocket();
    const socket = new SocketIoSessionSocket(stub);
    const seen: string[] = [];
    const subscription = socket.connection$.subscribe((state) => seen.push(state));

    socket.connect();
    stub.disconnect();
    stub.connect();
    subscription.unsubscribe();

    expect(seen).toEqual(['disconnected', 'connected', 'disconnected', 'reconnected']);
  });

  it('emits with an ack timeout when connected and returns the raw ack', async () => {
    const stub = new StubSocket();
    const socket = new SocketIoSessionSocket(stub);
    socket.connect();
    stub.ackReply = { ok: false, error: 'stale_seq' };

    const ack = await firstValueFrom(socket.emitWithAck(EVENTS.messagePublish, { v: 1 }));

    expect(ack).toEqual({ ok: false, error: 'stale_seq' });
    expect(stub.sent).toEqual([{ timeout: ACK_TIMEOUT_MS, event: EVENTS.messagePublish, args: [{ v: 1 }] }]);
  });

  it('fails at once instead of buffering an emit while disconnected', async () => {
    const stub = new StubSocket();
    const socket = new SocketIoSessionSocket(stub);

    await expect(firstValueFrom(socket.emitWithAck(EVENTS.messagePublish, { v: 1 }))).rejects.toBeInstanceOf(
      NotConnectedError,
    );
    expect(stub.sent).toHaveLength(0);
  });

  it('streams a server event and removes its listener on unsubscribe', () => {
    const stub = new StubSocket();
    const socket = new SocketIoSessionSocket(stub);
    const received: unknown[] = [];
    const subscription = socket.on$(EVENTS.messageUpdate).subscribe((payload) => received.push(payload));

    stub.fire(EVENTS.messageUpdate, { seq: 1 });
    subscription.unsubscribe();
    stub.fire(EVENTS.messageUpdate, { seq: 2 });

    expect(received).toEqual([{ seq: 1 }]);
    expect(stub.listeners.get(EVENTS.messageUpdate)?.size).toBe(0);
  });
});
