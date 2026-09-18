import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ProgressUpdate } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { getPlaybackTicket } from '../lessons.ts';
import { problem } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';
import { saveProgress } from '../writes.ts';

export const lessonRoutes = new Hono<AppEnv>()
  /**
   * The gate. Entitlement is checked here and a short-lived URL is minted;
   * nothing playable is ever stored on the lesson row.
   */
  .get('/:id/playback', requireAuth, async (c) => {
    const ticket = await getPlaybackTicket(c.env, c.get('userId'), c.req.param('id'));
    // A ticket is per-member and expires: never let a proxy hold one.
    c.header('cache-control', 'private, no-store');
    return c.json(ticket);
  })
  .put(
    '/:id/progress',
    requireAuth,
    zValidator('json', ProgressUpdate, (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid progress', result.error.issues[0]?.message),
    ),
    async (c) => c.json(await saveProgress(c.env, c.get('userId'), c.req.param('id'), c.req.valid('json'))),
  );
