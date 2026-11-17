import { createHash, timingSafeEqual } from 'node:crypto';

export function hashToken(token: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(token, 'utf8').digest());
}

// Comparing fixed-length digests keeps timingSafeEqual from throwing on length mismatch and hides the token length.
export function tokenMatchesHash(token: string, expectedHash: Uint8Array): boolean {
  const presentedHash = hashToken(token);
  return presentedHash.length === expectedHash.length && timingSafeEqual(presentedHash, expectedHash);
}
