import type { IncomingMessage } from 'node:http';
import { describe, expect, test } from 'vitest';
import type { OriginPolicy } from './origin-policy';
import { MAX_HTTP_BUFFER_BYTES, socketServerOptions } from './socket-options';

const POLICY: OriginPolicy = { kind: 'list', origins: ['http://localhost:4200'] };

function allows(policy: OriginPolicy, headers: Record<string, string>): boolean {
  const allowRequest = socketServerOptions(policy).allowRequest;
  let allowed: boolean | undefined;
  allowRequest?.({ headers } as unknown as IncomingMessage, (_error, success) => {
    allowed = success;
  });
  if (allowed === undefined) throw new Error('allowRequest did not answer');
  return allowed;
}

describe('socketServerOptions', () => {
  test('allows WebSocket as the only transport', () => {
    expect(socketServerOptions(POLICY).transports).toEqual(['websocket']);
  });

  test('does not serve the client bundle and turns off per-message compression', () => {
    const options = socketServerOptions(POLICY);
    expect(options.serveClient).toBe(false);
    expect(options.perMessageDeflate).toBe(false);
  });

  test('leaves connection state recovery off', () => {
    expect(socketServerOptions(POLICY).connectionStateRecovery).toBeUndefined();
  });

  test('caps a frame at 80 KB, just above the 64 KB envelope limit', () => {
    expect(MAX_HTTP_BUFFER_BYTES).toBe(81_920);
    expect(socketServerOptions(POLICY).maxHttpBufferSize).toBe(81_920);
  });

  test('sets cors.origin to the explicit allow-list, never a wildcard', () => {
    expect(socketServerOptions(POLICY).cors).toEqual({ origin: ['http://localhost:4200'] });
    expect(socketServerOptions({ kind: 'same-origin' }).cors).toEqual({ origin: [] });
  });

  test('allows a handshake only from an allowed origin', () => {
    expect(allows(POLICY, { origin: 'http://localhost:4200', host: 'localhost:3000' })).toBe(true);
    expect(allows(POLICY, { origin: 'http://evil.example', host: 'localhost:3000' })).toBe(false);
    expect(allows(POLICY, { host: 'localhost:3000' })).toBe(false);
    expect(allows({ kind: 'same-origin' }, { origin: 'https://app.example', host: 'app.example' })).toBe(true);
    expect(allows({ kind: 'same-origin' }, { origin: 'https://evil.example', host: 'app.example' })).toBe(false);
  });
});
