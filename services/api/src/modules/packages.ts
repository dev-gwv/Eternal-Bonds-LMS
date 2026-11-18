import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { GrantPackageInput, PackageCoursesInput, PackageInput } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import * as packages from '../packages.ts';
import { problem } from '../lib/problem.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.ts';

/**
 * Packages, read by members and written by admins — two routers, like
 * journeys, so the admin guard covers a whole prefix.
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

export const packageRoutes = new Hono<AppEnv>()
  .get('/', requireAuth, async (c) => c.json({ items: await packages.listPackages(c.env, c.get('userId')) }))
  .get('/for-course/:slug', requireAuth, async (c) => {
    const rows = await packages.packagesForCourse(c.env, c.get('userId')!, c.req.param('slug'));
    return c.json({ items: rows.map((r) => ({ slug: r.slug, title: r.title, pricePaise: Number(r.price_paise) })) });
  })
  .get('/:slug', requireAuth, async (c) => c.json(await packages.getPackage(c.env, c.get('userId'), c.req.param('slug'))));

export const adminPackageRoutes = new Hono<AppEnv>()
  .use('*', requireAdmin)
  .get('/', async (c) => c.json({ items: await packages.listPackages(c.env, who(c)) }))
  .post('/', zValidator('json', PackageInput, invalid as never), async (c) =>
    c.json(await packages.createPackage(c.env, who(c), c.req.valid('json')), 201),
  )
  // Grants first: `/grants` must not be read as a package id.
  .get('/grants', async (c) =>
    c.json({
      items: await packages.listGrants(c.env, who(c), {
        packageId: c.req.query('packageId') || undefined,
        memberId: c.req.query('memberId') || undefined,
      }),
    }),
  )
  .delete('/grants/:grantId', async (c) => {
    await packages.revokeGrant(c.env, who(c), c.req.param('grantId'));
    return c.body(null, 204);
  })
  .get('/:id', async (c) => c.json(await packages.getPackage(c.env, who(c), c.req.param('id'))))
  .patch('/:id', zValidator('json', PackageInput, invalid as never), async (c) =>
    c.json(await packages.updatePackage(c.env, who(c), c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/:id', async (c) => {
    await packages.deletePackage(c.env, who(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .put('/:id/courses', zValidator('json', PackageCoursesInput, invalid as never), async (c) =>
    c.json(await packages.setPackageCourses(c.env, who(c), c.req.param('id'), c.req.valid('json').courseIds)),
  )
  .post('/:id/grants', zValidator('json', GrantPackageInput, invalid as never), async (c) =>
    c.json(await packages.grantPackage(c.env, who(c), c.req.param('id'), c.req.valid('json')), 201),
  );
