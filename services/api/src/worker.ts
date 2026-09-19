import { app } from './app.ts';
import { EnvSchema } from './env.ts';

/**
 * The Cloudflare Workers entrypoint.
 *
 * It is the mirror image of `server.ts`: the same Hono app, a different way of
 * getting config into it. Everything underneath takes `c.env` and knows
 * nothing about which of the two started it — that is the whole point of the
 * portability contract (docs/portability-contract.md §1).
 *
 * Two Workers-specific details live here and nowhere else:
 *
 *   1. **Hyperdrive.** Workers cannot open an arbitrary TCP connection to
 *      Postgres from a handler without it, and going direct from the edge
 *      would mean a new connection per request against a database that pools
 *      badly. When the binding exists its connection string wins over
 *      DATABASE_URL. `nodejs_compat` must be on for postgres.js to run.
 *
 *   2. **Cron Triggers.** `scheduled()` runs the same jobs the worker loop and
 *      `/internal/cron/:job` run, called in-process rather than over HTTP —
 *      there is no reason to make a Worker call itself.
 */

type Bindings = Record<string, unknown> & {
  HYPERDRIVE?: { connectionString: string };
};

function envFrom(bindings: Bindings) {
  return EnvSchema.parse({
    ...bindings,
    DATABASE_URL: bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? '',
  });
}

export default {
  async fetch(request: Request, bindings: Bindings, ctx: ExecutionContext) {
    // A fresh Env object per request, which is what gives each request its own
    // database connection — see the note on `getDb` in repo.ts. Sharing a
    // socket between requests throws "Cannot perform I/O on behalf of a
    // different request", intermittently, only under load.
    const env = envFrom(bindings);
    const response = await app.fetch(request, env, ctx);

    // Hand the socket back after the response is built. Responses here are
    // buffered JSON, so nothing is still reading from the database by now.
    const { releaseDb } = await import('./repo.ts');
    ctx.waitUntil(releaseDb(env));

    return response;
  },

  async scheduled(event: ScheduledController, bindings: Bindings, ctx: ExecutionContext) {
    const env = envFrom(bindings);
    // Imported lazily so a plain request never pays for the worker package.
    const { dueJobs, runJob, readEnv } = await import('@ipc/worker');
    const { getDb } = await import('./repo.ts');

    const db = getDb(env);
    if (!db) {
      console.warn(JSON.stringify({ cron: event.cron, skipped: 'no DATABASE_URL' }));
      return;
    }

    // The worker parses its own slice of the config. On Bun that comes from
    // process.env; here there is no process, so the bindings are handed over
    // explicitly — the one place the two schemas meet.
    const jobEnv = readEnv({ ...bindings, DATABASE_URL: env.DATABASE_URL });
    const { releaseDb } = await import('./repo.ts');

    // waitUntil, so a slow rollup is not cut off when the handler returns.
    ctx.waitUntil(
      (async () => {
        try {
          for (const kind of await dueJobs(db)) {
            const outcome = await runJob(db, kind, jobEnv);
            console.log(JSON.stringify({ cron: event.cron, ...outcome }));
          }
        } finally {
          // The cron invocation owns this socket too, and it fires every
          // minute — leaking one per tick would exhaust the pooler by morning.
          await releaseDb(env);
        }
      })(),
    );
  },
};
