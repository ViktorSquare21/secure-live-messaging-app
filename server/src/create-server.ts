import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { socketServerOptions } from './socket-options';

export type RunningServer = {
  readonly io: Server;
  readonly http: HttpServer;
  readonly port: number;
  close(): Promise<void>;
};

export async function startServer(port: number, host: string): Promise<RunningServer> {
  const http = createServer();
  const io = new Server(http, socketServerOptions());

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, () => {
      http.off('error', reject);
      resolve();
    });
  });

  const address = http.address() as AddressInfo;

  return {
    io,
    http,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        io.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
