import { describe, expect, test } from 'vitest';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, isProductionMode, resolveServerHost, resolveServerPort } from './config';

describe('resolveServerPort', () => {
  test('uses the default development port when PORT is not set', () => {
    expect(resolveServerPort({})).toEqual({ ok: true, port: DEFAULT_SERVER_PORT });
    expect(DEFAULT_SERVER_PORT).toBe(3000);
  });

  test('uses the default development port when PORT is empty', () => {
    expect(resolveServerPort({ PORT: '' })).toEqual({ ok: true, port: 3000 });
  });

  test('takes the port from PORT when it is a valid decimal port', () => {
    expect(resolveServerPort({ PORT: '3100' })).toEqual({ ok: true, port: 3100 });
  });

  test('accepts the lowest and highest valid ports', () => {
    expect(resolveServerPort({ PORT: '1' })).toEqual({ ok: true, port: 1 });
    expect(resolveServerPort({ PORT: '65535' })).toEqual({ ok: true, port: 65535 });
  });

  test('rejects port 0 and ports above 65535', () => {
    expect(resolveServerPort({ PORT: '0' })).toEqual({ ok: false, error: 'invalid_port' });
    expect(resolveServerPort({ PORT: '65536' })).toEqual({ ok: false, error: 'invalid_port' });
  });

  test('rejects values that are not plain decimal digits', () => {
    for (const value of ['abc', '30.5', '-1', ' 3000', '0x10', '1e3', '123456']) {
      expect(resolveServerPort({ PORT: value })).toEqual({ ok: false, error: 'invalid_port' });
    }
  });
});

describe('resolveServerHost', () => {
  test('binds to loopback when HOST is not set or blank', () => {
    expect(DEFAULT_SERVER_HOST).toBe('127.0.0.1');
    expect(resolveServerHost({})).toBe('127.0.0.1');
    expect(resolveServerHost({ HOST: '' })).toBe('127.0.0.1');
    expect(resolveServerHost({ HOST: '   ' })).toBe('127.0.0.1');
  });

  test('takes the host from HOST, trimmed', () => {
    expect(resolveServerHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveServerHost({ HOST: ' ::1 ' })).toBe('::1');
  });
});

describe('isProductionMode', () => {
  test('is on with the --production argument', () => {
    expect(isProductionMode(['--production'], {})).toBe(true);
  });

  test('is on with NODE_ENV=production', () => {
    expect(isProductionMode([], { NODE_ENV: 'production' })).toBe(true);
  });

  test('is off without either', () => {
    expect(isProductionMode([], {})).toBe(false);
    expect(isProductionMode(['--prod', 'production'], { NODE_ENV: 'development' })).toBe(false);
  });
});
