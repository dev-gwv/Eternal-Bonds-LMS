import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { JourneyInput, JourneyStepInput } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import * as journeys from '../journeys.ts';
import { problem } from '../lib/problem.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.ts';

/**
 * Journeys, read by members and written by admins.
 *
 * Two routers rather than one: the member half is mounted at /v1/journeys and
 * the authoring half under /v1/admin, so the admin middleware guards a whole
 * prefix rather than being remembered per handler.
 */

const invalid = (result: { success: boolean; error?: z.ZodError }, c: never) => {
  if (result.success) return undefined;
  const first = result.error?.issues[0];
  return problem(
    c as never,
    422,
    'That does not look right',
    first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Check the fields and try again.',
  );
};

const who = (c: { get: (k: 'userId') => string | null }) => c.get('userId') ?? 'seed-admin';

/** What a member sees. RLS hides unpublished journeys from them. */
export const journeyRoutes = new Hono<AppEnv>()
  .get('/', requireAuth, async (c) => c.json({ items: await journeys.listJourneys(c.env, c.get('userId')) }))
  .get('/:slug', requireAuth, async (c) =>
    c.json(await journeys.getJourney(c.env, c.get('userId'), c.req.param('slug'))),
  )
  // Both return the whole journey rather than 204, so the card that was
  // pressed re-renders from the response instead of a second round trip.
  .post('/:slug/follow', requireAuth, async (c) =>
    c.json(await journeys.followJourney(c.env, c.get('userId')!, c.req.param('slug'))),
  )
  .delete('/:slug/follow', requireAuth, async (c) =>
    c.json(await journeys.unfollowJourney(c.env, c.get('userId')!, c.req.param('slug'))),
  );

export const adminJourneyRoutes = new Hono<AppEnv>()
  .use('*', requireAdmin)
  .get('/', async (c) => c.json({ items: await journeys.listJourneys(c.env, who(c)) }))
  .post('/', zValidator('json', JourneyInput, invalid as never), async (c) =>
    c.json(await journeys.createJourney(c.env, who(c), c.req.valid('json')), 201),
  )
  .get('/:slug', async (c) => c.json(await journeys.getJourney(c.env, who(c), c.req.param('slug'))))
  .patch('/:id', zValidator('json', JourneyInput, invalid as never), async (c) =>
    c.json(await journeys.updateJourney(c.env, who(c), c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/:id', async (c) => {
    await journeys.deleteJourney(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/:id/steps', zValidator('json', JourneyStepInput, invalid as never), async (c) => {
    await journeys.addStep(c.env, who(c), c.req.param('id'), c.req.valid('json'));
    return c.body(null, 204);
  })
  .post(
    '/:id/steps/order',
    zValidator('json', z.object({ ids: z.array(z.uuid()).min(1).max(50) }), invalid as never),
    async (c) => {
      await journeys.reorderSteps(c.env, who(c), c.req.param('id'), c.req.valid('json').ids);
      return c.body(null, 204);
    },
  )
  .delete('/steps/:stepId', async (c) => {
    await journeys.removeStep(c.env, who(c), c.req.param('stepId'));
    return c.body(null, 204);
  });
