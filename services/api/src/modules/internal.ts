import { Hono } from 'hono';
import { JOBS, jobByKind, runJob } from '@ipc/worker';
import type { AppEnv } from '../context.ts';
import { problem } from '../lib/problem.ts';
import { getDb } from '../repo.ts';

/**
 * Scheduling as an HTTP endpoint, guarded by a shared secret.
 *
 * This is what keeps the deployment portable: a cron container running curl, a
 * Cloudflare Cron Trigger, a systemd timer or Supabase's pg_cron all drive the
 * same jobs, and none of them requires a `scheduled()` handler in application
 * code (docs/portability-contract.md §5).
 *
 * The long-running worker process does not need this route — it has its own
 * loop. This exists so a deployment without a always-on process still works.
 */
export const internalRoutes = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    const auth = c.req.header('authorization');
    const expected = `Bearer ${c.env.CRON_SECRET}`;
    // Constant-time-ish: compare only after a length check, and never echo it.
    if (!auth || auth.length !== expected.length || auth !== expected) {
      return problem(c, 401, 'Not authorised', 'This endpoint requires the cron secret.');
    }
    await next();
  })
  .get('/cron', (c) =>
    c.json({
      jobs: JOBS.map((j) => ({ kind: j.kind, everySeconds: j.everySeconds ?? null, description: j.description })),
    }),
  )
  .post('/cron/:job', async (c) => {
    const kind = c.req.param('job');
    if (!jobByKind.has(kind)) return problem(c, 404, 'Unknown job', `No job named "${kind}"`);

    const db = getDb(c.env);
    if (!db) {
      return problem(
        c,
        503,
        'No database',
        'DATABASE_URL is empty, so there is nothing to roll up. The API is serving seed data.',
      );
    }

    const outcome = await runJob(db, kind);
    return c.json(outcome, outcome.ok ? 200 : 500);
  });
