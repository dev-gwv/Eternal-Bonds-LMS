import { Hono } from 'hono';
import { etag } from 'hono/etag';
import type { AppEnv } from './context.ts';
import { corsFor } from './lib/cors.ts';
import { HttpError, problem } from './lib/problem.ts';
import { idempotency } from './middleware/idempotency.ts';
import { session } from './middleware/auth.ts';
import { journeyRoutes } from './modules/journeys.ts';
import { challengeRoutes } from './modules/challenges.ts';
import { coverRoutes } from './modules/covers.ts';
import { publicRoutes } from './modules/public.ts';
import { adminRoutes } from './modules/admin.ts';
import { billingRoutes } from './modules/billing.ts';
import { webhookRoutes } from './modules/webhooks.ts';
import { coursesRoutes } from './modules/courses.ts';
import { internalRoutes } from './modules/internal.ts';
import { workshopsRoutes } from './modules/workshops.ts';
import { communityRoutes } from './modules/community.ts';
import { lessonRoutes } from './modules/lessons.ts';
import { libraryRoutes } from './modules/library.ts';
import { meRoutes } from './modules/me.ts';
import { searchRoutes } from './modules/search.ts';
import { thinktankRoutes } from './modules/thinktank.ts';
import { winsRoutes } from './modules/wins.ts';
import { eventsRoutes } from './modules/events.ts';
import { legalRoutes, moderationRoutes } from './modules/moderation.ts';
import { analyticsRoutes } from './modules/analytics.ts';
import { directoryRoutes, learningRoutes } from './modules/platform.ts';
import { usingDatabase } from './repo.ts';

/**
 * One Hono app, no runtime-specific globals: `server.ts` runs it on Bun, and a
 * Workers entrypoint could run the same object unchanged.
 *
 * Conventions here exist so a native client can be added later without
 * reopening the API — see docs/api-conventions.md.
 */
export const API_VERSION = '2026-09-22';

export const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  c.header('x-api-version', API_VERSION);

  const started = performance.now();
  await next();
  console.log(
    JSON.stringify({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      client: c.req.header('x-client') ?? 'web',
      userId: c.get('userId'),
    }),
  );
});

app.use('*', (c, next) => corsFor(c.env)(c, next));
app.use('*', session);
app.use('*', idempotency);
app.use('/v1/*', etag());

/**
 * Postgres codes that mean the *request* was wrong, not the server.
 *
 * `POST /v1/admin/lessons/undefined/video` answered 500. The literal string
 * "undefined" went from the URL into `where lessons.id = $1`, Postgres refused
 * the cast with 22P02, and a client bug came back looking like an outage —
 * which sends whoever sees it to the server logs instead of to the call that
 * built the URL from a value that was never set.
 *
 * Caught here rather than validated per route. There are around eighty `:id`
 * parameters in this API and the failure mode is forgetting one, which is
 * exactly how `/directory/badges` stayed a 500 for every member for a week. A
 * middleware cannot do it either: a `use('*')` handler sees no route params,
 * because the wildcard pattern has none to give it. The database is the one
 * place every id actually arrives.
 *
 * Only codes that are unambiguously the caller's fault. A constraint violation
 * or a deadlock is still a 500, because those are ours.
 */
const BAD_REQUEST_CODES: Record<string, { title: string; detail: string }> = {
  // invalid_text_representation — "undefined" is not a uuid, "abc" is not an int.
  '22P02': {
    title: 'That is not a valid id',
    detail:
      'Something in the address is not the shape it should be. This usually means the step that created the ' +
      'thing failed and its id was never set.',
  },
  // numeric_value_out_of_range
  '22003': { title: 'That number is out of range', detail: 'One of the values is too large to store.' },
};

app.onError((err, c) => {
  if (err instanceof HttpError) return problem(c, err.status, err.title, err.detail);

  // postgres.js puts the driver error on `cause` once Drizzle has wrapped it.
  const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
  const known = code ? BAD_REQUEST_CODES[code] : undefined;
  if (known) return problem(c, 400, known.title, known.detail);

  console.error(JSON.stringify({ requestId: c.get('requestId'), error: String(err), stack: err.stack }));
  return problem(c, 500, 'Internal Server Error');
});

app.notFound((c) => problem(c, 404, 'Not Found', `No route for ${c.req.method} ${c.req.path}`));

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'ipc-api',
    version: API_VERSION,
    source: usingDatabase(c.env) ? 'supabase' : 'seed',
    time: new Date().toISOString(),
  }),
);

const v1 = new Hono<AppEnv>()
  .route('/courses', coursesRoutes)
  .route('/workshops', workshopsRoutes)
  .route('/community', communityRoutes)
  .route('/lessons', lessonRoutes)
  .route('/library', libraryRoutes)
  .route('/me', meRoutes)
  .route('/search', searchRoutes)
  .route('/think-tank', thinktankRoutes)
  .route('/wins', winsRoutes)
  .route('/events', eventsRoutes)
  .route('/moderation', moderationRoutes)
  .route('/legal', legalRoutes)
  .route('/analytics', analyticsRoutes)
  .route('/directory', directoryRoutes)
  .route('/learning', learningRoutes)
  .route('/journeys', journeyRoutes)
  // A prompt with a deadline. Entries go to /v1/wins — see modules/challenges.ts.
  .route('/challenges', challengeRoutes)
  /* The same cover routes as the admin mount, for members.
     Not a weaker copy — the identical router, and the authorisation is the
     RLS policy on whichever table `kind` names. A member setting a cover on
     their own insight passes `insights_update`; the same member reaching for a
     course updates zero rows and gets a 404, because courses are admin-write.
     Putting that decision in one place, in the schema, is what makes a shared
     endpoint safe rather than a shortcut. */
  .route('/covers', coverRoutes)
  // Outside every auth middleware, deliberately. See modules/public.ts.
  .route('/public', publicRoutes)
  .route('/admin', adminRoutes)
  .route('/billing', billingRoutes);

app.route('/v1', v1);
app.route('/internal', internalRoutes);
// Outside /v1 on purpose: a provider cannot be asked to migrate when we bump
// a version, so the webhook path is stable forever.
app.route('/webhooks', webhookRoutes);

export type AppType = typeof app;
