export const DEFAULT_SERVER_PORT = 3000;

// Loopback only: in development and in the container the client dev server proxies to it on the same machine,
// so the server port is never reachable from outside.
export const SERVER_HOST = '127.0.0.1';

export type PortResult =
  | { readonly ok: true; readonly port: number }
  | { readonly ok: false; readonly error: 'invalid_port' };

const DECIMAL_PORT = /^[0-9]{1,5}$/;

export function resolveServerPort(env: Readonly<Record<string, string | undefined>>): PortResult {
  const rawPort = env['PORT'];
  if (rawPort === undefined || rawPort === '') {
    return { ok: true, port: DEFAULT_SERVER_PORT };
  }
  if (!DECIMAL_PORT.test(rawPort)) {
    return { ok: false, error: 'invalid_port' };
  }
  const port = Number(rawPort);
  if (port < 1 || port > 65535) {
    return { ok: false, error: 'invalid_port' };
  }
  return { ok: true, port };
}
