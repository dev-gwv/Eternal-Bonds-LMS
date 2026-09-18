import { sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context.ts';
import { problem } from '../lib/problem.ts';
import { getDb } from '../repo.ts';

/**
 * Fixed-window limiter, keyed per member (or per IP when anonymous).
 *
 * This exists before OTP does on purpose: unprotected OTP endpoints get farmed
 * for premium-rate SMS traffic and the bill lands on us (PLAN §10.5). The same
 * middleware caps posting, which is the other thing that gets abused first.
 *
 * The counter lives in Postgres. An in-memory counter behind N instances is a
 * limit of N × limit, which for the SMS case is the difference between a cap
 * and a suggestion. Without a database (seed mode) it falls back to a map,
 * which is all one dev server needs.
 */

type Window = { count: number; resetAt: number };
const memory = new Map<string, Window>();

export function rateLimit({ limit, windowSeconds, name }: { limit: number; windowSeconds: number; name: string }) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const who =
      c.get('userId') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'anon';
    const bucket = `${name}:${who}`;
    const db = getDb(c.env);

    let count: number;
    let resetInSeconds: number;

    if (!db) {
      const now = Date.now();
      let w = memory.get(bucket);
      if (!w || w.resetAt <= now) {
        w = { count: 0, resetAt: now + windowSeconds * 1000 };
        memory.set(bucket, w);
      }
      // Bounded by hand, since there is no sweep job in seed mode.
      if (memory.size > 5000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
      w.count += 1;
      count = w.count;
      resetInSeconds = Math.ceil((w.resetAt - now) / 1000);
    } else {
      // One statement, so two concurrent requests cannot both read the same
      // count and both decide they are under the limit. The CASE is what
      // rolls the window over without a separate read.
      const [row] = await db.execute<{ count: number; reset_in: number }>(sql`
        insert into rate_limits (bucket, count, reset_at)
        values (${bucket}, 1, now() + ${`${windowSeconds} seconds`}::interval)
        on conflict (bucket) do update set
          count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
          reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end
        returning count, ceil(extract(epoch from (reset_at - now())))::int as reset_in
      `);
      count = Number(row?.count ?? 1);
      resetInSeconds = Math.max(0, Number(row?.reset_in ?? windowSeconds));
    }

    c.header('ratelimit-limit', String(limit));
    c.header('ratelimit-remaining', String(Math.max(0, limit - count)));
    c.header('ratelimit-reset', String(resetInSeconds));

    if (count > limit) {
      c.header('retry-after', String(resetInSeconds));
      return problem(c, 429, 'Too many requests', `Try again in ${resetInSeconds}s.`);
    }

    await next();
  });
}
