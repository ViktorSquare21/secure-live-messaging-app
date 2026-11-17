import type { ServerOptions } from 'socket.io';
import { corsOrigins, isOriginAllowed, type OriginPolicy } from './origin-policy';

// Just above the 64 KB envelope cap, so a slightly oversize envelope still reaches the validator and gets invalid_payload.
export const MAX_HTTP_BUFFER_BYTES = 80 * 1024;

export function socketServerOptions(policy: OriginPolicy): Partial<ServerOptions> {
  return {
    transports: ['websocket'],
    serveClient: false,
    perMessageDeflate: false,
    maxHttpBufferSize: MAX_HTTP_BUFFER_BYTES,
    cors: { origin: corsOrigins(policy) },
    // The cors option only shapes HTTP responses; WebSocket upgrades are guarded here or not at all.
    allowRequest: (request, callback) => {
      callback(null, isOriginAllowed(policy, request.headers.origin, request.headers.host));
    },
  };
}
