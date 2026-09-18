import { createDb } from '@ipc/db';
import { readEnv } from './env.ts';
import { claim, complete, fail } from './queue.ts';
import { dueJobs, JOBS, jobByKind, runJob } from './registry.ts';

/**
 * The worker process.
 *
 *   bun src/main.ts            run the loop
 *   bun src/main.ts run <job>  run one job and exit (what cron calls)
 *   bun src/main.ts list       print the registry
 *
 * Anything slow, retryable or scheduled crosses this boundary rather than
 * happening in a request — the one process split that pays for itself
 * immediately (PLAN §9).
 */

const env = readEnv();
const [command, argument] = process.argv.slice(2);

const log = (event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ worker: env.WORKER_ID, event, ...data }));

if (command === 'list') {
  for (const job of JOBS) {
    console.log(
      `${job.kind.padEnd(24)} ${job.everySeconds ? `every ${job.everySeconds}s`.padEnd(14) : 'on demand'.padEnd(14)} ${job.description}`,
    );
  }
  process.exit(0);
}

// Validate the job name before anything else: "unknown job" is more useful
// feedback than "no database", and a typo should not look like a config problem.
if (command === 'run' && (!argument || !jobByKind.has(argument))) {
  console.error(`Unknown job "${argument ?? ''}". Known: ${JOBS.map((j) => j.kind).join(', ')}`);
  process.exit(1);
}

if (!env.DATABASE_URL) {
  log('no_database', {
    message:
      'DATABASE_URL is empty. The worker has nothing to roll up — the API is serving seed data. Set it to run for real.',
    jobs: JOBS.map((j) => j.kind),
  });
  process.exit(0);
}

const db = createDb(env.DATABASE_URL, { max: 2 });

if (command === 'run') {
  // The name was validated above, before the database was required.
  const outcome = await runJob(db, argument!, env);
  log('job', outcome);
  process.exit(outcome.ok ? 0 : 1);
}

/* ── The loop ──────────────────────────────────────────────────────────────
   Each tick does two things: run any scheduled job that has come due, then
   drain whatever is on the queue. Both are guarded so one bad job cannot
   take the process down. */

let running = true;
const stop = (signal: string) => {
  log('shutdown', { signal });
  running = false;
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

log('start', { tickSeconds: env.TICK_SECONDS, jobs: JOBS.length });

while (running) {
  try {
    for (const kind of await dueJobs(db)) {
      const outcome = await runJob(db, kind, env);
      log('scheduled', outcome);
    }

    const batch = await claim(db, env.WORKER_ID);
    for (const job of batch) {
      const definition = jobByKind.get(job.kind);
      if (!definition) {
        await fail(db, job, new Error(`Unknown job kind: ${job.kind}`));
        continue;
      }
      try {
        const result = await definition.run({ db, env });
        await complete(db, job.id);
        log('queued', { kind: job.kind, id: job.id, result });
      } catch (error) {
        const outcome = await fail(db, job, error);
        log('queued_failed', { kind: job.kind, id: job.id, ...outcome });
      }
    }
  } catch (error) {
    // A tick that throws — a dropped connection, say — must not kill the loop.
    log('tick_error', { error: error instanceof Error ? error.message : String(error) });
  }

  await Bun.sleep(env.TICK_SECONDS * 1000);
}

log('stopped');
process.exit(0);
