import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ChallengeInput } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import * as challenges from '../challenges.ts';
import { problem } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';

/**
 * Challenges, read by members and written by admins.
 *
 * Nothing here accepts an entry, because an entry is a win: it goes to
 * `POST /v1/wins` with a `challengeSlug`, through the same moderation and the
 * same media pipeline as any other. A second submit endpoint would be a second
 * thing to keep in step with the first.
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

export const challengeRoutes = new Hono<AppEnv>()
  .get('/', requireAuth, async (c) =>
    c.json({ items: await challenges.listChallenges(c.env, c.get('userId')) }),
  )
  .get('/:slug', requireAuth, async (c) =>
    c.json(await challenges.getChallenge(c.env, c.get('userId'), c.req.param('slug'))),
  );

export const adminChallengeRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ items: await challenges.listChallenges(c.env, who(c)) }))
  .post('/', zValidator('json', ChallengeInput, invalid as never), async (c) =>
    c.json(await challenges.createChallenge(c.env, who(c), c.req.valid('json')), 201),
  )
  .get('/:slug', async (c) => c.json(await challenges.getChallenge(c.env, who(c), c.req.param('slug'))))
  .patch('/:id', zValidator('json', ChallengeInput, invalid as never), async (c) =>
    c.json(await challenges.updateChallenge(c.env, who(c), c.req.param('id'), c.req.valid('json'))),
  )
  // Null clears it, because an admin who picked the wrong entry needs a way
  // back that is not deleting the challenge.
  .post(
    '/:id/winner',
    zValidator('json', z.object({ winSlug: z.string().nullable() }), invalid as never),
    async (c) => c.json(await challenges.pickWinner(c.env, who(c), c.req.param('id'), c.req.valid('json').winSlug)),
  )
  .delete('/:id', async (c) => {
    await challenges.deleteChallenge(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  });
