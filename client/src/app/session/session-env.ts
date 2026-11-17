import { DOCUMENT, InjectionToken, inject } from '@angular/core';
import {
  decrypt,
  encrypt,
  exportKeyToFragment,
  generateKey,
  importKeyFromFragment,
  type DecryptResult,
  type Envelope,
  type ImportKeyResult,
  type SessionKey,
} from '@slm/shared';

export interface SessionCrypto {
  generateKey(): Promise<SessionKey>;
  exportKeyToFragment(key: SessionKey): Promise<string>;
  importKeyFromFragment(fragment: string): Promise<ImportKeyResult>;
  encrypt(key: SessionKey, sessionId: string, seq: number, plaintext: string): Promise<Envelope>;
  decrypt(key: SessionKey, sessionId: string, input: unknown): Promise<DecryptResult>;
}

export const SESSION_CRYPTO = new InjectionToken<SessionCrypto>('SESSION_CRYPTO', {
  providedIn: 'root',
  factory: () => ({ generateKey, exportKeyToFragment, importKeyFromFragment, encrypt, decrypt }),
});

export const SESSION_STORAGE = new InjectionToken<Storage>('SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => sessionStorage,
});

export const CLOCK = new InjectionToken<() => number>('CLOCK', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});

export const APP_ORIGIN = new InjectionToken<string>('APP_ORIGIN', {
  providedIn: 'root',
  factory: () => inject(DOCUMENT).location.origin,
});
