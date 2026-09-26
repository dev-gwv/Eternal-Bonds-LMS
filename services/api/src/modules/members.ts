import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { GrantTier, SetRole, SetSuspended } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { problem } from '../lib/problem.ts';
import { getMember, grantTier, listMembers, setRole, setSuspended } from '../members.ts';
import { requireAdmin } from '../middleware/auth.ts';

/**
 * The members console, mounted under /v1/admin/members.
 *
 * Behind `requireAdmin`, and every query underneath also runs under RLS as the
 * calling admin — the same two locks the authoring routes use, for the same
 * reason: this surface can see every member's email and progress.
 */
const invalid = (result: { success: boolean; error?: z.ZodError }, c: never) => {
  if (result.success) return undefined;
  const first = result.error?.issues[0];
  return problem(c as never, 422, 'That does not look right',
    first ? `${first.path.join('.') || 'body'}: ${first.message}` : undefined);
};

export const membersRoutes = new Hono<AppEnv>()
  .use('*', requireAdmin)

  .get('/', async (c) => {
    const q = c.req.query('q');
    const risk = c.req.query('risk');
    const tier = c.req.query('tier');
    const suspended = c.req.query('suspended');
    return c.json(
      await listMembers(c.env, c.get('userId') ?? '', {
        q: q || undefined,
        risk: risk && risk !== 'all' ? risk : undefined,
        tier: tier && tier !== 'all' ? tier : undefined,
        suspended: suspended === undefined ? undefined : suspended === 'true',
        cursor: c.req.query('cursor') || undefined,
        limit: Number(c.req.query('limit')) || undefined,
      }),
    );
  })

  .get('/:id', async (c) => c.json(await getMember(c.env, c.get('userId') ?? '', c.req.param('id'))))

  .post('/:id/tier', zValidator('json', GrantTier, invalid as never), async (c) => {
    await grantTier(c.env, c.get('userId') ?? '', c.req.param('id'), c.req.valid('json'));
    return c.json(await getMember(c.env, c.get('userId') ?? '', c.req.param('id')));
  })

  .post('/:id/suspension', zValidator('json', SetSuspended, invalid as never), async (c) => {
    await setSuspended(c.env, c.get('userId') ?? '', c.req.param('id'), c.req.valid('json'));
    return c.json(await getMember(c.env, c.get('userId') ?? '', c.req.param('id')));
  })

  /* Promoting somebody. The guards are in `setRole` rather than here, because
     the last-admin check has to be part of the update statement and not a
     read-then-write in a handler. */
  .post('/:id/role', zValidator('json', SetRole, invalid as never), async (c) => {
    await setRole(c.env, c.get('userId') ?? '', c.req.param('id'), c.req.valid('json'));
    return c.json(await getMember(c.env, c.get('userId') ?? '', c.req.param('id')));
  });
