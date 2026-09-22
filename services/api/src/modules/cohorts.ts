import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { CohortInput } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import * as cohorts from '../cohorts.ts';
import { problem } from '../lib/problem.ts';

/**
 * The cohort console, mounted under /v1/admin/cohorts.
 *
 * `requireAdmin` runs on the parent router and every query underneath also
 * runs under RLS as the calling admin, which is the same two-lock arrangement
 * the rest of the studio uses.
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

export const cohortRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ items: await cohorts.listCohorts(c.env, who(c)) }))
  .post('/', zValidator('json', CohortInput, invalid as never), async (c) =>
    c.json(await cohorts.createCohort(c.env, who(c), c.req.valid('json')), 201),
  )
  .get('/:id', async (c) => c.json(await cohorts.getCohort(c.env, who(c), c.req.param('id'))))
  .patch('/:id', zValidator('json', CohortInput, invalid as never), async (c) =>
    c.json(await cohorts.updateCohort(c.env, who(c), c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/:id', async (c) => {
    await cohorts.deleteCohort(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  })
  // A list rather than one id: an admin filling a cohort is pasting a roster,
  // and twenty round trips would be twenty chances to half-finish.
  .post(
    '/:id/members',
    zValidator('json', z.object({ userIds: z.array(z.uuid()).min(1).max(500) }), invalid as never),
    async (c) =>
      c.json(await cohorts.addCohortMembers(c.env, who(c), c.req.param('id'), c.req.valid('json').userIds)),
  )
  .delete('/:id/members/:userId', async (c) => {
    await cohorts.removeCohortMember(c.env, who(c), c.req.param('id'), c.req.param('userId'));
    return c.body(null, 204);
  });
