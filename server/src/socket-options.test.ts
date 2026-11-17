import { describe, expect, test } from 'vitest';
import { socketServerOptions } from './socket-options';

describe('socketServerOptions', () => {
  test('allows WebSocket as the only transport', () => {
    expect(socketServerOptions().transports).toEqual(['websocket']);
  });

  test('does not serve the client bundle and turns off per-message compression', () => {
    const options = socketServerOptions();
    expect(options.serveClient).toBe(false);
    expect(options.perMessageDeflate).toBe(false);
  });

  test('leaves connection state recovery off', () => {
    expect(socketServerOptions().connectionStateRecovery).toBeUndefined();
  });
});
