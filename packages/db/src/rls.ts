import { sql } from 'drizzle-orm';
import type { Db } from './client.ts';

/**
 * Runs `fn` inside a transaction that adopts the caller's identity, so Supabase
 * RLS policies decide access rather than scattered `where user_id = ?` clauses.
 *
 * Supabase's `auth.uid()` reads the `request.jwt.claims` GUC, so we set that —
 * the same policies then apply whether a request arrives through PostgREST,
 * supabase-js, or this API.
 */
export async function withUser<T>(
  db: Db,
  userId: string | null,
  fn: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (userId) {
      await tx.execute(sql`set local role authenticated`);
      await tx.execute(
        sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`,
      );
    } else {
      await tx.execute(sql`set local role anon`);
      await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
    }
    return fn(tx);
  });
}

/** Escape hatch for jobs and webhooks that legitimately run as the service role. */
export async function asService<T>(db: Db, fn: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);
    return fn(tx);
  });
}
