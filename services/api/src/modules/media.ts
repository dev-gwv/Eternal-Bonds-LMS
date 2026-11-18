import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../context.ts';
import { problem } from '../lib/problem.ts';
import {
  claimJob,
  completeJob,
  failJob,
  reportProgress,
  servePlaylist,
  transcoderAuthorized,
} from '../r2-video.ts';

/**
 * Two surfaces that no signed-in member calls directly.
 *
 * `mediaRoutes` is what the HLS player fetches: the link is the permission
 * (signed, expiring), because a player cannot send a session header.
 *
 * `transcoderRoutes` is what the club's VPS calls, with its own bearer secret.
 */

export const mediaRoutes = new Hono<AppEnv>()
  .get('/hls/:token/:file{.+}', async (c) => servePlaylist(c.env, c.req.param('token'), c.req.param('file')));

const invalid = (result: { success: boolean; error?: z.ZodError }, c: never) => {
  if (result.success) return undefined;
  const first = result.error?.issues[0];
  return problem(c as never, 422, 'Invalid body', first ? `${first.path.join('.')}: ${first.message}` : undefined);
};

export const transcoderRoutes = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    if (!transcoderAuthorized(c.env, c.req.header('authorization'))) {
      return problem(c, 401, 'Not authorised', 'This endpoint requires the transcoder secret.');
    }
    await next();
  })
  .post('/claim', async (c) => c.json({ job: await claimJob(c.env) }))
  .post(
    '/jobs/:id/progress',
    zValidator('json', z.object({ percent: z.number().min(0).max(100) }), invalid as never),
    async (c) => c.json({ keepGoing: await reportProgress(c.env, c.req.param('id'), c.req.valid('json').percent) }),
  )
  .post(
    '/jobs/:id/complete',
    zValidator('json', z.object({ durationSeconds: z.number().nonnegative().nullable().default(null) }), invalid as never),
    async (c) => {
      await completeJob(c.env, c.req.param('id'), c.req.valid('json').durationSeconds);
      return c.body(null, 204);
    },
  )
  .post(
    '/jobs/:id/fail',
    zValidator(
      'json',
      z.object({ error: z.string().min(1).max(2000), permanent: z.boolean().default(false) }),
      invalid as never,
    ),
    async (c) => {
      const { error, permanent } = c.req.valid('json');
      await failJob(c.env, c.req.param('id'), error, permanent);
      return c.body(null, 204);
    },
  );
