import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ProgressUpdate } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { getPlaybackTicket, setDuration } from '../lessons.ts';
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
  )

  /**
   * How long the video actually is, reported by the player that just loaded it.
   *
   * An uploaded video gets its length from the provider's webhook. A YouTube
   * lesson has no webhook and no upload, so nothing ever filled it in and the
   * length sat at zero — a two-hour course displaying "1 lesson · 0h", and
   * every progress estimate built on it wrong.
   *
   * Reported by the browser because that is the only place that knows: the
   * IFrame API hands us `getDuration()` once the video loads, and reading it
   * server-side would mean a YouTube Data API key for a number we are already
   * holding.
   *
   * Accepted from any member, which is safe only because of how `setDuration`
   * applies it: it fills a zero and never overwrites a known value. The worst
   * a bad actor can do is set the length of a lesson nobody had opened yet, to
   * a number between one second and twelve hours.
   */
  .post(
    '/:id/duration',
    requireAuth,
    zValidator('json', z.object({ seconds: z.int().positive().max(12 * 60 * 60) }), (result, c) =>
      result.success ? undefined : problem(c, 422, 'Invalid duration', result.error.issues[0]?.message),
    ),
    async (c) =>
      c.json(await setDuration(c.env, c.get('userId'), c.req.param('id'), c.req.valid('json').seconds)),
  );
