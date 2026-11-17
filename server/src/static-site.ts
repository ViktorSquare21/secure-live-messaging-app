export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export const INDEX_PATH = '/index.html';

export interface StaticFile {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export type StaticSite = ReadonlyMap<string, StaticFile>;

export type Route =
  | { readonly kind: 'index' }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'method_not_allowed' };

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
};

export function contentTypeFor(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return (extension !== undefined ? CONTENT_TYPES[extension] : undefined) ?? 'application/octet-stream';
}

// Only paths already in the preloaded map can be served, so no request path ever reaches the file system.
export function routeRequest(method: string | undefined, rawUrl: string | undefined, site: StaticSite): Route {
  if (method !== 'GET' && method !== 'HEAD') return { kind: 'method_not_allowed' };
  const path = pathnameOf(rawUrl ?? '/');
  if (path === undefined || path === '/' || path === INDEX_PATH || !site.has(path)) return { kind: 'index' };
  return { kind: 'file', path };
}

function pathnameOf(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

export function responseHeaders(route: Route, file: StaticFile | undefined): Record<string, string> {
  const headers: Record<string, string> = { ...SECURITY_HEADERS };
  if (route.kind === 'method_not_allowed') {
    headers['Allow'] = 'GET, HEAD';
    headers['Cache-Control'] = 'no-store';
    headers['Content-Length'] = '0';
    return headers;
  }
  if (route.kind === 'index') headers['Cache-Control'] = 'no-store';
  if (file !== undefined) {
    headers['Content-Type'] = file.contentType;
    headers['Content-Length'] = String(file.body.byteLength);
  }
  return headers;
}
