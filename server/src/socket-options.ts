import type { ServerOptions } from 'socket.io';

export function socketServerOptions(): Partial<ServerOptions> {
  return {
    transports: ['websocket'],
    serveClient: false,
    perMessageDeflate: false,
  };
}
