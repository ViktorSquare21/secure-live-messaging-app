import { afterEach, describe, expect, test } from 'vitest';
import { io as connectClient, type Socket } from 'socket.io-client';
import * as shared from '@slm/shared';
import { startServer, type RunningServer } from './create-server';

const HOST = '127.0.0.1';
const ORIGIN = 'http://localhost:4200';
const OPTIONS = { port: 0, host: HOST, originPolicy: { kind: 'list', origins: [ORIGIN] }, log: () => undefined } as const;
const EVENT_TIMEOUT_MS = 2000;

let server: RunningServer | undefined;
const clients: Socket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  await server?.close();
  server = undefined;
});

function waitFor<T>(register: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for event')), EVENT_TIMEOUT_MS);
    register((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

describe('startServer', () => {
  test('resolves the shared workspace by its package name', () => {
    expect(shared).toBeTypeOf('object');
  });

  test('accepts a Socket.IO connection over WebSocket', async () => {
    server = await startServer(OPTIONS);
    const client = connectClient(`http://${HOST}:${server.port}`, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { origin: ORIGIN },
    });
    clients.push(client);

    await waitFor<void>((resolve) => client.once('connect', () => resolve()));

    expect(client.connected).toBe(true);
    expect(client.io.engine.transport.name).toBe('websocket');
  });

  test('refuses an HTTP long-polling handshake', async () => {
    server = await startServer(OPTIONS);

    const response = await fetch(`http://${HOST}:${server.port}/socket.io/?EIO=4&transport=polling`, { headers: { origin: ORIGIN } });
    const body: unknown = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: 0, message: 'Transport unknown' });
  });

  test('refuses a client that only offers long-polling', async () => {
    server = await startServer(OPTIONS);
    const client = connectClient(`http://${HOST}:${server.port}`, {
      transports: ['polling'],
      reconnection: false,
      extraHeaders: { origin: ORIGIN },
    });
    clients.push(client);

    const error = await waitFor<Error>((resolve) => client.once('connect_error', resolve));

    expect(error).toBeInstanceOf(Error);
    expect(client.connected).toBe(false);
  });

  test('does not serve the Socket.IO client bundle', async () => {
    server = await startServer(OPTIONS);

    const response = await fetch(`http://${HOST}:${server.port}/socket.io/socket.io.js`);
    await response.arrayBuffer();

    expect(response.status).not.toBe(200);
  });
});
