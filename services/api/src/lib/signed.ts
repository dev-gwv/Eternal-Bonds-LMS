/**
 * Short, URL-safe, HMAC-signed tokens: `<base64url json>.<base64url sig>`.
 *
 * Used wherever a link has to work without a session — a `<video>` element
 * or an HLS player cannot send an Authorization header, so the link itself is
 * the permission, and it has to be unforgeable and expire.
 *
 * Every caller passes its own `label`, which is mixed into the key. A token
 * minted for one purpose therefore never verifies for another, even when both
 * are derived from the same secret.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string, label: string) {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`${label}:${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** `payload.e` is the expiry, in Unix seconds. */
export async function signToken(secret: string, label: string, payload: { e: number } & Record<string, unknown>) {
  if (!secret) throw new Error('signToken needs a secret');
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, label), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** The payload, or null for anything forged, altered, expired or malformed. */
export async function verifyToken<T extends { e: number }>(secret: string, label: string, token: string): Promise<T | null> {
  if (!secret) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, label), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64url(body))) as T;
    if (typeof payload.e !== 'number' || payload.e * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
