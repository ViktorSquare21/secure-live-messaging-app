import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startServer, type RunningServer } from './create-server';
import { loadStaticSite, MissingClientBuildError } from './static-files';

const HOST = '127.0.0.1';
const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const INDEX_HTML = '<!doctype html><html><body><app-root></app-root><script src="main-ABC123.js" type="module"></script></body></html>';
const SCRIPT = 'console.log("app");';
const EVENT_TIMEOUT_MS = 2000;

let buildDir: string;
let server: RunningServer | undefined;
const clients: Socket[] = [];

beforeEach(async () => {
  buildDir = await mkdtemp(join(tmpdir(), 'slm-build-'));
  await writeFile(join(buildDir, 'index.html'), INDEX_HTML);
  await writeFile(join(buildDir, 'main-ABC123.js'), SCRIPT);
  await mkdir(join(buildDir, 'media'));
  await writeFile(join(buildDir, 'media', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server?.close();
  server = undefined;
  await rm(buildDir, { recursive: true, force: true });
});

async function startProductionServer(): Promise<string> {
  server = await startServer({
    port: 0,
    host: HOST,
    originPolicy: { kind: 'same-origin' },
    log: () => undefined,
    staticSite: await loadStaticSite(buildDir),
  });
  return `http://${HOST}:${server.port}`;
}

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get('content-security-policy')).toBe(EXPECTED_CSP);
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

function scriptSrcOf(response: Response): string | undefined {
  return response.headers
    .get('content-security-policy')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src '));
}

describe('production static serving', () => {
  test('the index page carries the security headers and no-store', async () => {
    const base = await startProductionServer();

    const response = await fetch(`${base}/`);

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe(INDEX_HTML);
  });

  test('a static script asset carries the security headers', async () => {
    const base = await startProductionServer();

    const response = await fetch(`${base}/main-ABC123.js`);

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await response.text()).toBe(SCRIPT);
  });

  test('the receiver and sender routes fall back to the index page with the security headers', async () => {
    const base = await startProductionServer();

    for (const path of ['/r/abcdefghijklmnopqrstuv', '/s/abcdefghijklmnopqrstuv']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      expectSecurityHeaders(response);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe(INDEX_HTML);
    }
  });

  test('script-src has no unsafe-inline or unsafe-eval, and connect-src is self', async () => {
    const base = await startProductionServer();

    for (const path of ['/', '/main-ABC123.js', '/r/abc']) {
      const response = await fetch(`${base}${path}`);
      expect(scriptSrcOf(response)).toBe("script-src 'self'");
      expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
      expect(response.headers.get('content-security-policy')).not.toMatch(/unsafe-eval/);
    }
  });

  test('HEAD returns the headers without a body', async () => {
    const base = await startProductionServer();

    const response = await fetch(`${base}/`, { method: 'HEAD' });

    expectSecurityHeaders(response);
    expect(response.headers.get('content-length')).toBe(String(INDEX_HTML.length));
    expect(await response.text()).toBe('');
  });

  test('refuses a POST with 405 and still sends the security headers', async () => {
    const base = await startProductionServer();

    const response = await fetch(`${base}/`, { method: 'POST', body: 'x' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expectSecurityHeaders(response);
    expect(await response.text()).toBe('');
  });

  test('a traversal path never serves a file outside the build', async () => {
    const base = await startProductionServer();

    const response = await fetch(`${base}/%2e%2e/%2e%2e/package.json`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
  });

  test('the relay accepts a WebSocket from the page origin on the same server', async () => {
    const base = await startProductionServer();
    const client = connectClient(base, { transports: ['websocket'], reconnection: false, extraHeaders: { origin: base } });
    clients.push(client);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for connect')), EVENT_TIMEOUT_MS);
      client.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    expect(client.io.engine.transport.name).toBe('websocket');
  });

  test('the relay still refuses an HTTP long-polling handshake', async () => {
    const base = await startProductionServer();

    const response = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: { origin: base } });

    expect(response.status).toBe(400);
  });
});

describe('loadStaticSite', () => {
  test('loads nested files under their URL paths', async () => {
    const site = await loadStaticSite(buildDir);

    expect([...site.keys()].sort()).toEqual(['/index.html', '/main-ABC123.js', '/media/icon.svg']);
    expect(site.get('/media/icon.svg')?.contentType).toBe('image/svg+xml');
  });

  test('rejects a build without an index page', async () => {
    await rm(join(buildDir, 'index.html'));

    await expect(loadStaticSite(buildDir)).rejects.toBeInstanceOf(MissingClientBuildError);
  });

  test('rejects a missing build folder', async () => {
    await expect(loadStaticSite(join(buildDir, 'nope'))).rejects.toBeInstanceOf(MissingClientBuildError);
  });
});
