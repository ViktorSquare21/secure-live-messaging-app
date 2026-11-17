const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const DECODE_TABLE: readonly number[] = Array.from({ length: 128 }, (_, code) =>
  ALPHABET.indexOf(String.fromCharCode(code)),
);

export function encodeBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const remaining = bytes.length - i;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (remaining > 1) out += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (remaining > 2) out += ALPHABET[b2 & 0x3f];
  }
  return out;
}

export function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length % 4 === 1) return null;
  const sextets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const value = DECODE_TABLE[text.charCodeAt(i)];
    if (value === undefined || value < 0) return null;
    sextets.push(value);
  }
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let byteIndex = 0;
  for (let i = 0; i < sextets.length; i += 4) {
    const s0 = sextets[i] ?? 0;
    const s1 = sextets[i + 1] ?? 0;
    const s2 = sextets[i + 2] ?? 0;
    const s3 = sextets[i + 3] ?? 0;
    const triple = (s0 << 18) | (s1 << 12) | (s2 << 6) | s3;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = triple & 0xff;
  }
  // Non-zero unused bits in the last character would let two strings decode to the same bytes.
  return encodeBase64Url(bytes) === text ? bytes : null;
}
