import { sql } from 'drizzle-orm';
import type { Db } from '@ipc/db';
import { readEnv, type Env } from './env.ts';
import { expireMemberships, reprocessWebhooks } from './jobs/billing.ts';
import { buildWeeklyDigest, purgeDeletedAccounts, sweepExpired } from './jobs/lifecycle.ts';
import { guardPublishedCourses, pollVideoStatus } from './jobs/media.ts';
import { deliverNotifications, drainOutbox } from './jobs/notify.ts';
import {
  reconcileCounters,
  recomputeStreaks,
  rollupDailyActivity,
  rollupMemberStats,
} from './jobs/rollups.ts';

/**
 * One registry, three ways to run a job: the worker loop, the `run <job>` CLI,
 * and the API's `/internal/cron/:job` endpoint.
 *
 * That is the portability contract in practice (docs/portability-contract.md):
 * scheduling is an interface, so a cron container, a Workers Cron Trigger or a
 * systemd timer all drive the same code.
 *
 * Jobs receive a context rather than just a handle, because delivery jobs need
 * credentials. The database-only ones ignore the env, which keeps the boring
 * majority boring.
 */
// Re-exported because registry.ts is the package entry: the API's Workers
// entrypoint needs to build a worker Env from its bindings.
export { readEnv, type Env } from './env.ts';

export type JobResult = Record<string, unknown>;
export type JobContext = { db: Db; env: Env };
export type JobFn = (ctx: JobContext) => Promise<JobResult>;

export type JobDefinition = {
  kind: string;
  description: string;
  /** How often the loop should run it. Omit for enqueue-only jobs. */
  everySeconds?: number;
  run: JobFn;
};

export const JOBS: JobDefinition[] = [
  {
    kind: 'outbox.drain',
    description: 'Turn events the API wrote transactionally into notifications',
    everySeconds: 30,
    run: ({ db }) => drainOutbox(db),
  },
  {
    kind: 'notifications.deliver',
    description: 'Send the email and push copies, honouring preferences and quiet hours',
    everySeconds: 60,
    run: ({ db, env }) => deliverNotifications(db, env),
  },
  {
    kind: 'rollup.daily_activity',
    description: 'Per-member, per-day minutes and XP for the activity chart',
    everySeconds: 300,
    run: ({ db }) => rollupDailyActivity(db),
  },
  {
    kind: 'rollup.member_stats',
    description: 'XP totals and counts behind the leaderboard',
    everySeconds: 300,
    run: ({ db }) => rollupMemberStats(db),
  },
  {
    kind: 'streaks.recompute',
    description: 'Daily streaks, counted in each member’s own timezone',
    everySeconds: 3600,
    run: ({ db }) => recomputeStreaks(db),
  },
  {
    kind: 'video.poll',
    description: 'Ask the provider about transcodes whose webhook never arrived',
    everySeconds: 120,
    run: ({ db, env }) => pollVideoStatus(db, env),
  },
  {
    kind: 'courses.guard',
    description: 'Unpublish a course whose lesson video has broken, before a member finds it',
    everySeconds: 900,
    run: ({ db }) => guardPublishedCourses(db),
  },
  {
    kind: 'webhooks.process',
    description: 'Replay webhook deliveries whose handler threw',
    everySeconds: 300,
    run: ({ db }) => reprocessWebhooks(db),
  },
  {
    kind: 'memberships.expire',
    description: 'Expire lapsed memberships and warn the ones ending this week',
    everySeconds: 3600,
    run: ({ db }) => expireMemberships(db),
  },
  {
    kind: 'counters.reconcile',
    description: 'Correct drifted like and comment counts against the source of truth',
    everySeconds: 86400,
    run: ({ db }) => reconcileCounters(db),
  },
  {
    kind: 'accounts.purge',
    description: 'Anonymise and remove accounts past their 30-day grace period',
    everySeconds: 3600,
    run: ({ db }) => purgeDeletedAccounts(db),
  },
  {
    kind: 'sweep.expired',
    description: 'Collect spent idempotency records and rolled-over rate-limit windows',
    everySeconds: 3600,
    run: ({ db }) => sweepExpired(db),
  },
  {
    kind: 'digest.weekly',
    description: 'Compose weekly digests and queue them for delivery',
    everySeconds: 86400,
    run: ({ db }) => buildWeeklyDigest(db),
  },
];

export const jobByKind = new Map(JOBS.map((j) => [j.kind, j]));

/** Runs one job and records the outcome, whether it succeeded or not. */
export async function runJob(
  db: Db,
  kind: string,
  env?: Env,
): Promise<{ kind: string; ok: boolean; ms: number; result?: JobResult; error?: string }> {
  const job = jobByKind.get(kind);
  if (!job) throw new Error(`Unknown job: ${kind}`);

  const started = performance.now();
  try {
    const result = await job.run({ db, env: env ?? readEnv() });
    const ms = Math.round(performance.now() - started);
    await record(db, kind, 'ok', ms, null);
    return { kind, ok: true, ms, result };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    const message = error instanceof Error ? error.message : String(error);
    await record(db, kind, 'error', ms, message);
    return { kind, ok: false, ms, error: message };
  }
}

async function record(db: Db, kind: string, status: string, ms: number, error: string | null) {
  await db.execute(sql`
    insert into job_schedule (kind, last_run_at, last_status, last_error, duration_ms)
    values (${kind}, now(), ${status}, ${error}, ${ms})
    on conflict (kind) do update set
      last_run_at = now(),
      last_status = excluded.last_status,
      last_error  = excluded.last_error,
      duration_ms = excluded.duration_ms
  `);
}

/** Which scheduled jobs are due, based on their recorded last run. */
export async function dueJobs(db: Db): Promise<string[]> {
  const rows = await db.execute<{ kind: string; last_run_at: string | null }>(sql`
    select kind, last_run_at from job_schedule
  `);
  const lastRun = new Map(rows.map((r) => [r.kind, r.last_run_at ? Date.parse(r.last_run_at) : 0]));

  const now = Date.now();
  return JOBS.filter((j) => j.everySeconds !== undefined)
    .filter((j) => now - (lastRun.get(j.kind) ?? 0) >= j.everySeconds! * 1000)
    .map((j) => j.kind);
}
