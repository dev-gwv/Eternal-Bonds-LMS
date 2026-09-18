import { sql } from 'drizzle-orm';
import type { Db } from '@ipc/db';

/**
 * A Postgres job queue.
 *
 * `for update skip locked` lets several workers claim different rows in the
 * same instant without blocking each other, which is the whole reason this
 * does not need Redis. Claiming and marking done are separate statements, so a
 * crash mid-job leaves the row locked-but-unfinished and the reaper returns it.
 */

export type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

/** Claims up to `limit` due jobs for this worker. */
export async function claim(db: Db, workerId: string, limit = 5): Promise<Job[]> {
  const rows = await db.execute<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`
    update jobs set
      locked_at = now(),
      locked_by = ${workerId},
      attempts = attempts + 1
    where id in (
      select id from jobs
      where completed_at is null
        and run_at <= now()
        and (locked_at is null or locked_at < now() - interval '5 minutes')
        and attempts < max_attempts
      order by run_at
      for update skip locked
      limit ${limit}
    )
    returning id, kind, payload, attempts, max_attempts
  `);

  return [...rows].map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload ?? {},
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

export async function complete(db: Db, jobId: string) {
  await db.execute(sql`update jobs set completed_at = now(), last_error = null where id = ${jobId}`);
}

/**
 * Exponential backoff, capped. A job that has exhausted its attempts is left
 * un-completed with its error — visible rather than silently dropped.
 */
export async function fail(db: Db, job: Job, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const backoffSeconds = Math.min(3600, 30 * 2 ** job.attempts);

  if (job.attempts >= job.maxAttempts) {
    await db.execute(sql`update jobs set locked_at = null, last_error = ${message} where id = ${job.id}`);
    return { retrying: false, message };
  }

  await db.execute(sql`
    update jobs set
      locked_at = null,
      last_error = ${message},
      run_at = now() + (${backoffSeconds} || ' seconds')::interval
    where id = ${job.id}
  `);
  return { retrying: true, message, backoffSeconds };
}

/** Enqueue work from anywhere (API, another job, a webhook). */
export async function enqueue(
  db: Db,
  kind: string,
  payload: Record<string, unknown> = {},
  runAt?: Date,
) {
  await db.execute(sql`
    insert into jobs (kind, payload, run_at)
    values (${kind}, ${JSON.stringify(payload)}::jsonb, ${runAt ?? new Date()})
  `);
}
