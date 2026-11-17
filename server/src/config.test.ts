import { describe, expect, test } from 'vitest';
import { DEFAULT_SERVER_PORT, resolveServerPort } from './config';

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
