import { cors } from 'hono/cors';
import type { Env } from '../env.ts';

/**
 * Native apps (Capacitor, and a future Expo build) send either no Origin or a
 * scheme like capacitor://localhost. Allowing those alongside the configured
 * web origins is what keeps this API usable from a phone without reopening it
 * to the whole internet.
 *
 *   https://localhost     Capacitor Android with `androidScheme: 'https'`
 *                         (apps/mobile/capacitor.config.ts).
 *   capacitor://localhost Capacitor iOS.
 *   ionic://localhost     Older Capacitor/Ionic iOS builds.
 *
 * `http://localhost` (no port) is only a dev convenience — Android on the
 * legacy http scheme, or a local proxy — and is not allowed in production.
 */
const NATIVE_ORIGINS = ['https://localhost', 'capacitor://localhost', 'ionic://localhost'];
const DEV_ONLY_ORIGINS = ['http://localhost'];

export function allowedOrigins(env: Env): Set<string> {
  return new Set([
    ...env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    ...NATIVE_ORIGINS,
    ...(env.NODE_ENV === 'production' ? [] : DEV_ONLY_ORIGINS),
  ]);
}

export function corsFor(env: Env) {
  const allowed = allowedOrigins(env);

  return cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-client', 'x-client-version'],
    exposeHeaders: ['x-request-id', 'x-api-version'],
    // Auth is a Bearer header, never a cookie: the web keeps the Supabase
    // session in localStorage and no client sends `credentials: 'include'`.
    // Not allowing credentials means a stray cookie can never authenticate a
    // cross-origin request.
    credentials: false,
    maxAge: 600,
  });
}
