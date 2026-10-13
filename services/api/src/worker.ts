import { app } from './app.ts';
import { ConfigError, parseEnv, type Env } from './env.ts';

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
  return parseEnv({
    ...bindings,
    DATABASE_URL: bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL ?? '',
  });
}

/**
 * Bad config must not look like a crash. An uncaught throw here is a bare 500
 * with no CORS headers, which the browser reports as a network error and hides
 * the cause. Instead: log which keys are wrong (never their values) and answer
 * every request with a 503 problem+json the client can read.
 */
function misconfigured(request: Request, error: ConfigError) {
  console.error(JSON.stringify({ config: 'invalid', problems: error.problems }));
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'content-type': 'application/problem+json',
    'cache-control': 'no-store',
    'retry-after': '60',
  };
  // Echo the origin so the browser lets the app read the 503. The body says
  // nothing a caller could use; the details are in the log.
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: 'Service misconfigured',
      status: 503,
      detail: 'The API is not configured correctly. This has been logged.',
    }),
    { status: 503, headers },
  );
}

export default {
  async fetch(request: Request, bindings: Bindings, ctx: ExecutionContext) {
    // A fresh Env object per request, which is what gives each request its own
    // database connection — see the note on `getDb` in repo.ts. Sharing a
    // socket between requests throws "Cannot perform I/O on behalf of a
    // different request", intermittently, only under load.
    let env: Env;
    try {
      env = envFrom(bindings);
    } catch (error) {
      if (error instanceof ConfigError) return misconfigured(request, error);
      throw error;
    }
    const response = await app.fetch(request, env, ctx);

    // Hand the socket back after the response is built. Responses here are
    // buffered JSON, so nothing is still reading from the database by now.
    const { releaseDb } = await import('./repo.ts');
    ctx.waitUntil(releaseDb(env));

    return response;
  },

  async scheduled(event: ScheduledController, bindings: Bindings, ctx: ExecutionContext) {
    let env: Env;
    try {
      env = envFrom(bindings);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      console.error(JSON.stringify({ cron: event.cron, config: 'invalid', problems: error.problems }));
      return;
    }
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
