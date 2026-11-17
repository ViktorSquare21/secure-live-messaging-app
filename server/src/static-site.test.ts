import { describe, expect, test } from 'vitest';
import {
  CONTENT_SECURITY_POLICY,
  contentTypeFor,
  responseHeaders,
  routeRequest,
  SECURITY_HEADERS,
  type StaticFile,
  type StaticSite,
} from './static-site';

const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

const file = (body: string, contentType: string): StaticFile => ({ body: new TextEncoder().encode(body), contentType });

const SITE: StaticSite = new Map([
  ['/index.html', file('<!doctype html>', 'text/html; charset=utf-8')],
  ['/main-ABC123.js', file('console.log(1)', 'text/javascript; charset=utf-8')],
  ['/media/logo.svg', file('<svg/>', 'image/svg+xml')],
]);

function directive(name: string): string | undefined {
  return CONTENT_SECURITY_POLICY.split('; ').find((part) => part.startsWith(`${name} `));
}

describe('security headers', () => {
  test('carry the exact policy and headers', () => {
    expect(SECURITY_HEADERS).toEqual({
      'Content-Security-Policy': EXPECTED_CSP,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  test('script-src allows neither inline scripts nor eval', () => {
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('script-src')).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(directive('default-src')).toBe("default-src 'none'");
  });

  test('the page may connect, frame-embed and load from its own origin only', () => {
    expect(directive('connect-src')).toBe("connect-src 'self'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:|wss?:|\*/);
  });
});

describe('routeRequest', () => {
  test('serves the index page for the root and for index.html', () => {
    expect(routeRequest('GET', '/', SITE)).toEqual({ kind: 'index' });
    expect(routeRequest('GET', '/index.html', SITE)).toEqual({ kind: 'index' });
  });

  test('falls back to the index page for the sender and receiver routes', () => {
    expect(routeRequest('GET', '/s/abc', SITE)).toEqual({ kind: 'index' });
    expect(routeRequest('GET', '/r/abc', SITE)).toEqual({ kind: 'index' });
    expect(routeRequest('GET', '/r/abc?x=1', SITE)).toEqual({ kind: 'index' });
  });

  test('serves a known static file, ignoring the query string', () => {
    expect(routeRequest('GET', '/main-ABC123.js', SITE)).toEqual({ kind: 'file', path: '/main-ABC123.js' });
    expect(routeRequest('HEAD', '/media/logo.svg?v=2', SITE)).toEqual({ kind: 'file', path: '/media/logo.svg' });
  });

  test('falls back to the index page for an unknown asset path', () => {
    expect(routeRequest('GET', '/missing-XYZ.js', SITE)).toEqual({ kind: 'index' });
  });

  test('never resolves a path outside the preloaded files', () => {
    for (const url of ['/../package.json', '/%2e%2e/server/src/main.ts', '/media/../../etc/passwd', '//evil.example/x.js']) {
      expect(routeRequest('GET', url, SITE)).toEqual({ kind: 'index' });
    }
  });

  test('a dot-segment path that normalises to a known file serves that file only', () => {
    expect(routeRequest('GET', '/media/../main-ABC123.js', SITE)).toEqual({ kind: 'file', path: '/main-ABC123.js' });
  });

  test('refuses methods other than GET and HEAD', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', undefined]) {
      expect(routeRequest(method, '/', SITE)).toEqual({ kind: 'method_not_allowed' });
    }
  });

  test('treats a missing URL as the root', () => {
    expect(routeRequest('GET', undefined, SITE)).toEqual({ kind: 'index' });
  });
});

describe('responseHeaders', () => {
  const index = SITE.get('/index.html');
  const script = SITE.get('/main-ABC123.js');

  test('the index page gets the security headers and no-store', () => {
    expect(responseHeaders({ kind: 'index' }, index)).toEqual({
      ...SECURITY_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': '15',
    });
  });

  test('a static asset gets the security headers without no-store', () => {
    const headers = responseHeaders({ kind: 'file', path: '/main-ABC123.js' }, script);
    expect(headers).toMatchObject(SECURITY_HEADERS);
    expect(headers['Content-Type']).toBe('text/javascript; charset=utf-8');
    expect(headers['Cache-Control']).toBeUndefined();
  });

  test('a refused method still gets the security headers', () => {
    expect(responseHeaders({ kind: 'method_not_allowed' }, undefined)).toEqual({
      ...SECURITY_HEADERS,
      Allow: 'GET, HEAD',
      'Cache-Control': 'no-store',
      'Content-Length': '0',
    });
  });
});

describe('contentTypeFor', () => {
  test('maps the build file types', () => {
    expect(contentTypeFor('/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('/main-ABC.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/styles-ABC.CSS')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('/favicon.ico')).toBe('image/x-icon');
    expect(contentTypeFor('/media/font.woff2')).toBe('font/woff2');
  });

  test('falls back to a binary type that nosniff keeps from executing', () => {
    expect(contentTypeFor('/3rdpartylicenses')).toBe('application/octet-stream');
    expect(contentTypeFor('/file.exe')).toBe('application/octet-stream');
  });
});
