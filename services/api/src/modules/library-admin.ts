import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { LibraryCategoryInput, LibraryItemInput, LibraryItemPatch } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import * as library from '../library-admin.ts';
import { problem } from '../lib/problem.ts';

/**
 * Authoring the library.
 *
 * Mounted under `/v1/admin`, so `requireAdmin` on the parent guards the whole
 * prefix rather than being remembered on each handler — the same arrangement
 * every other authoring router uses, and the reason none of them has ever
 * leaked a write to a member.
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

export const adminLibraryRoutes = new Hono<AppEnv>()
  .get('/categories', async (c) => c.json({ items: await library.listAdminCategories(c.env, who(c)) }))
  .post('/categories', zValidator('json', LibraryCategoryInput, invalid as never), async (c) =>
    c.json(await library.createCategory(c.env, who(c), c.req.valid('json')), 201),
  )
  .patch('/categories/:id', zValidator('json', LibraryCategoryInput, invalid as never), async (c) => {
    await library.updateCategory(c.env, who(c), c.req.param('id'), c.req.valid('json'));
    return c.body(null, 204);
  })
  .delete('/categories/:id', async (c) => {
    await library.deleteCategory(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  })

  /* The upload ticket sits above `/items/:id`, and its path has a literal
     second segment, so the two cannot collide. `check:routes` enforces that
     rather than trusting it. */
  .post(
    '/items/upload-ticket',
    zValidator('json', z.object({ filename: z.string().min(1).max(255) }), invalid as never),
    async (c) => c.json(await library.itemUploadTicket(c.env, who(c), c.req.valid('json').filename)),
  )
  .get('/items', async (c) =>
    c.json({ items: await library.listAdminItems(c.env, who(c), c.req.query('categoryId')) }),
  )
  .post('/items', zValidator('json', LibraryItemInput, invalid as never), async (c) =>
    c.json(await library.createItem(c.env, who(c), c.req.valid('json')), 201),
  )
  .patch('/items/:id', zValidator('json', LibraryItemPatch, invalid as never), async (c) => {
    await library.updateItem(c.env, who(c), c.req.param('id'), c.req.valid('json'));
    return c.body(null, 204);
  })
  .delete('/items/:id', async (c) => {
    await library.deleteItem(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  });
