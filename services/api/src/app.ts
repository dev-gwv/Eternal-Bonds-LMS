import { Hono } from 'hono';
import { etag } from 'hono/etag';
import type { AppEnv } from './context.ts';
import { corsFor } from './lib/cors.ts';
import { HttpError, problem } from './lib/problem.ts';
import { idempotency } from './middleware/idempotency.ts';
import { session } from './middleware/auth.ts';
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
import { photolancerRoutes } from './modules/photolancer.ts';
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
export const API_VERSION = '2026-09-20';

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

app.onError((err, c) => {
  if (err instanceof HttpError) return problem(c, err.status, err.title, err.detail);
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
  .route('/photolancer', photolancerRoutes)
  .route('/moderation', moderationRoutes)
  .route('/legal', legalRoutes)
  .route('/analytics', analyticsRoutes)
  .route('/directory', directoryRoutes)
  .route('/learning', learningRoutes)
  .route('/admin', adminRoutes)
  .route('/billing', billingRoutes);

app.route('/v1', v1);
app.route('/internal', internalRoutes);
// Outside /v1 on purpose: a provider cannot be asked to migrate when we bump
// a version, so the webhook path is stable forever.
app.route('/webhooks', webhookRoutes);

export type AppType = typeof app;
