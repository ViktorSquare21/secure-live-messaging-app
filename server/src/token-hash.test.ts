import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashToken, tokenMatchesHash } from './token-hash';

const TOKEN = 'A'.repeat(43);

describe('token hashing', () => {
  it('hashes a token to its 32-byte SHA-256 digest', () => {
    const hash = hashToken(TOKEN);
    expect(hash).toHaveLength(32);
    expect(Buffer.from(hash).equals(createHash('sha256').update(TOKEN).digest())).toBe(true);
    expect(Buffer.from(hash).toString('utf8')).not.toContain(TOKEN);
  });

  it('matches the right token and refuses a wrong, shorter, longer or empty one', () => {
    const stored = hashToken(TOKEN);
    expect(tokenMatchesHash(TOKEN, stored)).toBe(true);
    for (const wrong of ['B'.repeat(43), 'A'.repeat(42), 'A'.repeat(44), '']) {
      expect(tokenMatchesHash(wrong, stored)).toBe(false);
    }
  });

  it('refuses rather than throws when the stored hash has an unexpected length', () => {
    expect(tokenMatchesHash(TOKEN, new Uint8Array(16))).toBe(false);
  });
});
