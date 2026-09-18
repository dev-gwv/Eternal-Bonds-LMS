import { cors } from 'hono/cors';
import type { Env } from '../env.ts';

/**
 * Native apps (Capacitor, and a future Expo build) send either no Origin or a
 * scheme like capacitor://localhost. Allowing those alongside the configured
 * web origins is what keeps this API usable from a phone without reopening it
 * to the whole internet.
 */
const NATIVE_ORIGINS = ['capacitor://localhost', 'ionic://localhost', 'http://localhost'];

export function corsFor(env: Env) {
  const allowed = new Set([
    ...env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    ...NATIVE_ORIGINS,
  ]);

  return cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-client', 'x-client-version'],
    exposeHeaders: ['x-request-id', 'x-api-version'],
    credentials: true,
    maxAge: 600,
  });
}
