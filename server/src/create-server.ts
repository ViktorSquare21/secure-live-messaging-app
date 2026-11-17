import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import type { RateLimits } from './event-intake';
import { formatLogEntry, type Logger } from './log';
import type { OriginPolicy } from './origin-policy';
import { DEFAULT_RATE_LIMITS } from './rate-limiter';
import { attachRelay } from './relay';
import { DEFAULT_SESSION_CONFIG, type SessionConfig } from './session-core';
import { socketServerOptions } from './socket-options';

export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export interface StartServerOptions {
  readonly port: number;
  readonly host: string;
  readonly originPolicy: OriginPolicy;
  readonly sessionConfig?: SessionConfig;
  readonly rateLimits?: RateLimits;
  readonly sweepIntervalMs?: number;
  readonly now?: () => number;
  readonly log?: Logger;
}

export type RunningServer = {
  readonly io: Server;
  readonly http: HttpServer;
  readonly port: number;
  close(): Promise<void>;
};

const consoleLogger: Logger = (entry) => console.log(formatLogEntry(entry));

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const http = createServer();
  const io = new Server(http, socketServerOptions(options.originPolicy));
  const relay = attachRelay(io, {
    sessionConfig: options.sessionConfig ?? DEFAULT_SESSION_CONFIG,
    rateLimits: options.rateLimits ?? DEFAULT_RATE_LIMITS,
    sweepIntervalMs: options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
    now: options.now ?? Date.now,
    log: options.log ?? consoleLogger,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(options.port, options.host, () => {
        http.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    relay.stop();
    throw error;
  }

  const address = http.address() as AddressInfo;

  return {
    io,
    http,
    port: address.port,
    close: () => {
      relay.stop();
      return new Promise<void>((resolve, reject) => {
        io.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
