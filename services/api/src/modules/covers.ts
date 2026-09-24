import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../context.ts';
import { coverTicket, isCoverKind, setCover } from '../covers.ts';
import { problem, HttpError } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';

/**
 * Cover images, for every kind of thing that has one.
 *
 * One path, `/v1/covers`, for admins and members alike — not an admin mount
 * and a member mount, because that is two lists of who-may-do-what that drift
 * apart. The authorisation that matters is the RLS policy on whichever table
 * `kind` names: an author setting a cover on their own insight passes
 * `insights_update`, and the same member reaching for a course updates zero
 * rows and gets a 404, because courses are admin-write. One decision, in the
 * schema, where the rest of this application already keeps them.
 *
 * `kind` itself is validated against the allowlist in `covers.ts` before it
 * reaches a query. It arrives from the browser, and an unchecked one would
 * make this an arbitrary-table-update endpoint with a friendly name.
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

const kindOf = (raw: string) => {
  if (!isCoverKind(raw)) throw new HttpError(404, 'Nothing of that kind has a cover');
  return raw;
};

export const coverRoutes = new Hono<AppEnv>()
  .post(
    '/:kind/:id/ticket',
    requireAuth,
    zValidator('json', z.object({ mime: z.enum(['image/jpeg', 'image/png', 'image/webp']) }), invalid as never),
    async (c) =>
      c.json(await coverTicket(c.env, kindOf(c.req.param('kind')), c.req.param('id'), c.req.valid('json').mime)),
  )
  .put(
    '/:kind/:id',
    requireAuth,
    zValidator('json', z.object({ key: z.string().min(1).max(500) }), invalid as never),
    async (c) =>
      c.json(await setCover(c.env, who(c), kindOf(c.req.param('kind')), c.req.param('id'), c.req.valid('json').key)),
  )
  .delete('/:kind/:id', requireAuth, async (c) =>
    c.json(await setCover(c.env, who(c), kindOf(c.req.param('kind')), c.req.param('id'), null)),
  );
