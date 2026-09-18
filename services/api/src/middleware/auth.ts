import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context.ts';
import type { Env } from '../env.ts';
import { problem } from '../lib/problem.ts';
import { roleOf } from '../admin.ts';

/**
 * Supabase issues the session; this API only verifies it.
 *
 * Deliberately **Bearer-first**: a native app cannot rely on cookies, and an
 * API that only reads cookies has to be retrofitted when the mobile build
 * lands. The cookie path exists purely as a convenience for the web client.
 */

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySet(env: Env) {
  const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  let set = jwks.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000 });
    jwks.set(url, set);
  }
  return set;
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

function cookieToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /(?:^|;\s*)sb-access-token=([^;]+)/.exec(header);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export type Session = { userId: string; email: string | null; claims: JWTPayload };

async function verify(env: Env, token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, keySet(env), {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
    });
    if (!payload.sub) return null;
    return { userId: payload.sub, email: (payload.email as string) ?? null, claims: payload };
  } catch {
    return null;
  }
}

/** Populates `userId` when a valid token is present; never rejects. */
export const session = createMiddleware<AppEnv>(async (c, next) => {
  c.set('userId', null);

  const token = bearer(c.req.header('authorization')) ?? cookieToken(c.req.header('cookie'));
  if (token && c.env.SUPABASE_URL) {
    const s = await verify(c.env, token);
    if (s) {
      c.set('userId', s.userId);
      c.set('session', s);
    }
  }
  await next();
});

/**
 * Guards a route. Returns problem+json, never a redirect — an app can't follow one.
 *
 * When Supabase is not configured the API is running on seed data for local
 * development, and there is no session to require; the guard steps aside so a
 * clean checkout still works. It is active the moment SUPABASE_URL is set.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.env.SUPABASE_URL) return next();
  if (!c.get('userId')) {
    c.header('WWW-Authenticate', 'Bearer realm="ipc", error="invalid_token"');
    return problem(c, 401, 'Not authenticated', 'Send a Supabase access token as `Authorization: Bearer <token>`.');
  }
  await next();
});

/**
 * Guards the authoring routes.
 *
 * This is the second of two locks, not the only one: every admin query runs
 * under RLS with `is_admin()` policies, so a bug here would produce an empty
 * result rather than an unauthorised write. What it adds is a clear 403 and
 * one round trip saved.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.env.SUPABASE_URL) return next(); // Local seed mode; nothing real to protect.

  const userId = c.get('userId');
  if (!userId) {
    c.header('WWW-Authenticate', 'Bearer realm="ipc", error="invalid_token"');
    return problem(c, 401, 'Not authenticated');
  }

  const role = await roleOf(c.env, userId);
  if (role !== 'admin') {
    return problem(
      c,
      403,
      'Not allowed',
      'Authoring is limited to admins. Ask someone who already is to promote your account.',
    );
  }
  c.set('role', role);
  await next();
});
