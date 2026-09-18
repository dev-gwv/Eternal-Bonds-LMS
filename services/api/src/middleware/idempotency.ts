import { and, eq, sql } from 'drizzle-orm';
import { idempotencyKeys } from '@ipc/db';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context.ts';
import { getDb } from '../repo.ts';

/**
 * A phone on a flaky train retries POSTs. Without this the member ends up
 * registered twice, or with two copies of the same post.
 *
 * The record lives in Postgres rather than in this process, so the replay is
 * still found after a restart, behind a second instance, or when the retry
 * lands on a different edge node — none of which are hypothetical once the API
 * is deployed anywhere but a laptop. Without a database (seed mode) it falls
 * back to a per-process map, which is all a single dev server needs.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

type Entry = { status: number; body: string; at: number };
const memory = new Map<string, Entry>();

export const idempotency = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header('idempotency-key');
  if (!key || !['POST', 'PATCH'].includes(c.req.method)) return next();

  const userId = c.get('userId');
  const db = getDb(c.env);
  // The path is part of the key: the same random UUID reused against a
  // different endpoint is a different intention, not a retry.
  const path = `${userId ?? 'anon'}:${c.req.path}`;

  const replay = (status: number, body: string) => {
    c.header('idempotent-replay', 'true');
    return c.body(body, status as 200, { 'content-type': 'application/json' });
  };

  if (!db) {
    const hit = memory.get(`${path}:${key}`);
    if (hit && Date.now() - hit.at < TTL_MS) return replay(hit.status, hit.body);
    await next();
    if (c.res.status < 500) {
      memory.set(`${path}:${key}`, { status: c.res.status, body: await c.res.clone().text(), at: Date.now() });
    }
    return;
  }

  const [hit] = await db
    .select({ status: idempotencyKeys.status, body: idempotencyKeys.body })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.key, key),
        eq(idempotencyKeys.path, path),
        sql`${idempotencyKeys.createdAt} > now() - interval '24 hours'`,
      ),
    )
    .limit(1);
  if (hit) return replay(hit.status, hit.body);

  await next();

  // 5xx is not recorded: a server error is exactly the case where the client
  // *should* be able to try again and get a different answer.
  if (c.res.status < 500) {
    const body = await c.res.clone().text();
    await db
      .insert(idempotencyKeys)
      .values({ key, path, userId: userId ?? null, status: c.res.status, body })
      // Two retries can race each other into here; the first one wins and the
      // second is a no-op rather than a 500.
      .onConflictDoNothing();
  }
});
