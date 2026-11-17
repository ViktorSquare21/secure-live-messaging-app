export type OriginPolicy =
  | { readonly kind: 'list'; readonly origins: readonly string[] }
  | { readonly kind: 'same-origin' };

export type OriginPolicyResult =
  | { readonly ok: true; readonly policy: OriginPolicy }
  | { readonly ok: false; readonly error: 'invalid_origins' };

export const DEV_ORIGINS: readonly string[] = ['http://localhost:4200', 'http://127.0.0.1:4200'];

export function resolveOriginPolicy(env: Readonly<Record<string, string | undefined>>): OriginPolicyResult {
  const raw = env['ALLOWED_ORIGINS'];
  if (raw === undefined || raw === '') {
    const policy: OriginPolicy =
      env['NODE_ENV'] === 'production' ? { kind: 'same-origin' } : { kind: 'list', origins: DEV_ORIGINS };
    return { ok: true, policy };
  }
  const origins = raw.split(',').map((origin) => origin.trim());
  if (!origins.every(isSerializedOrigin)) {
    return { ok: false, error: 'invalid_origins' };
  }
  return { ok: true, policy: { kind: 'list', origins } };
}

function isSerializedOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

// Browsers always send Origin on a WebSocket handshake, so a request without one is not a browser page we serve.
export function isOriginAllowed(policy: OriginPolicy, origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined || origin === '') return false;
  if (policy.kind === 'list') return policy.origins.includes(origin);
  if (host === undefined || host === '') return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

export function corsOrigins(policy: OriginPolicy): string[] {
  return policy.kind === 'list' ? [...policy.origins] : [];
}
