import { describe, expect, test } from 'vitest';
import { corsOrigins, DEV_ORIGINS, isOriginAllowed, resolveOriginPolicy, type OriginPolicy } from './origin-policy';

describe('resolveOriginPolicy', () => {
  test('defaults to the local Angular dev server origins outside production', () => {
    expect(resolveOriginPolicy({})).toEqual({ ok: true, policy: { kind: 'list', origins: DEV_ORIGINS } });
    expect(DEV_ORIGINS).toEqual(['http://localhost:4200', 'http://127.0.0.1:4200']);
  });

  test('defaults to same-origin in production', () => {
    expect(resolveOriginPolicy({ NODE_ENV: 'production' })).toEqual({ ok: true, policy: { kind: 'same-origin' } });
  });

  test('takes a comma-separated allow-list from ALLOWED_ORIGINS in any environment', () => {
    const expected = { ok: true, policy: { kind: 'list', origins: ['https://a.example', 'http://b.example:8080'] } };
    expect(resolveOriginPolicy({ ALLOWED_ORIGINS: 'https://a.example, http://b.example:8080' })).toEqual(expected);
    expect(
      resolveOriginPolicy({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://a.example,http://b.example:8080' }),
    ).toEqual(expected);
  });

  test('rejects wildcards, paths, other schemes and anything that is not an exact origin', () => {
    for (const value of ['*', 'true', 'https://a.example/', 'https://a.example/path', 'ftp://a.example', 'a.example', 'https://A.example', 'https://a.example,']) {
      expect(resolveOriginPolicy({ ALLOWED_ORIGINS: value })).toEqual({ ok: false, error: 'invalid_origins' });
    }
  });
});

describe('isOriginAllowed', () => {
  const list: OriginPolicy = { kind: 'list', origins: ['http://localhost:4200'] };
  const sameOrigin: OriginPolicy = { kind: 'same-origin' };

  test('accepts a listed origin and refuses any other', () => {
    expect(isOriginAllowed(list, 'http://localhost:4200', 'localhost:3000')).toBe(true);
    expect(isOriginAllowed(list, 'http://evil.example', 'localhost:3000')).toBe(false);
    expect(isOriginAllowed(list, 'http://localhost:4201', 'localhost:3000')).toBe(false);
    expect(isOriginAllowed(list, 'null', 'localhost:3000')).toBe(false);
  });

  test('refuses a request without an Origin header under either policy', () => {
    expect(isOriginAllowed(list, undefined, 'localhost:3000')).toBe(false);
    expect(isOriginAllowed(list, '', 'localhost:3000')).toBe(false);
    expect(isOriginAllowed(sameOrigin, undefined, 'app.example')).toBe(false);
  });

  test('same-origin accepts only an Origin whose host equals the request Host', () => {
    expect(isOriginAllowed(sameOrigin, 'https://app.example', 'app.example')).toBe(true);
    expect(isOriginAllowed(sameOrigin, 'http://localhost:8080', 'localhost:8080')).toBe(true);
    expect(isOriginAllowed(sameOrigin, 'https://evil.example', 'app.example')).toBe(false);
    expect(isOriginAllowed(sameOrigin, 'http://localhost:8081', 'localhost:8080')).toBe(false);
    expect(isOriginAllowed(sameOrigin, 'https://app.example', undefined)).toBe(false);
    expect(isOriginAllowed(sameOrigin, 'not a url', 'app.example')).toBe(false);
  });
});

describe('corsOrigins', () => {
  test('is the explicit list, and empty for same-origin, never a wildcard', () => {
    expect(corsOrigins({ kind: 'list', origins: ['http://localhost:4200'] })).toEqual(['http://localhost:4200']);
    expect(corsOrigins({ kind: 'same-origin' })).toEqual([]);
  });
});
