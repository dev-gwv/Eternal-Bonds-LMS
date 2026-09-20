import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { desc, eq, sql } from 'drizzle-orm';
import { freelanceApplications, freelanceBriefs, withUser } from '@ipc/db';
import { CreateBrief } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { problem, HttpError } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { getDb } from '../repo.ts';

const invalid = (result: any, c: any) =>
  result.success ? undefined : problem(c, 422, 'Invalid brief', result.error.issues[0]?.message);

function needDb(env: any) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database', 'Set DATABASE_URL.');
  return db;
}

/** Photolancer: clients post briefs, members apply, terms agreed up front. */
export const photolancerRoutes = new Hono<AppEnv>()
  .get('/briefs', async (c) => {
    const db = getDb(c.env);
    if (!db) {
      const seed = await import('../data/seed.ts');
      return c.json({ items: seed.briefs });
    }
    const userId = c.get('userId');
    const status = c.req.query('status') ?? 'open';
    return withUser(db, userId, async (tx) => {
      const rows = await tx.select().from(freelanceBriefs)
        .where(eq(freelanceBriefs.status, status as any)).orderBy(desc(freelanceBriefs.createdAt)).limit(50);
      const counts = await tx.select({
        briefId: freelanceApplications.briefId, n: sql<number>`count(*)`,
      }).from(freelanceApplications).groupBy(freelanceApplications.briefId);
      const byBrief = new Map(counts.map((r) => [r.briefId, Number(r.n)]));
      const mine = userId
        ? new Set((await tx.select({ briefId: freelanceApplications.briefId })
            .from(freelanceApplications).where(eq(freelanceApplications.applicantId, userId))).map((r) => r.briefId))
        : new Set<string>();
      return c.json({
        items: rows.map((b) => ({
          id: b.id, title: b.title, bodyMd: b.bodyMd, city: b.city,
          budgetPaise: b.budgetPaise, shootOn: b.shootOn, status: b.status,
          applicationCount: byBrief.get(b.id) ?? 0, appliedByMe: mine.has(b.id),
          createdAt: b.createdAt.toISOString(),
        })),
      });
    });
  })
  .post('/briefs', requireAuth, rateLimit({ name: 'brief', limit: 5, windowSeconds: 3600 }),
    zValidator('json', CreateBrief, invalid), async (c) => {
      const db = needDb(c.env);
      const userId = c.get('userId')!;
      const input = c.req.valid('json');
      return withUser(db, userId, async (tx) => {
        const row = (await tx.insert(freelanceBriefs).values({
          authorId: userId, title: input.title, bodyMd: input.bodyMd, city: input.city,
          budgetPaise: input.budgetPaise, shootOn: input.shootOn, status: 'open',
        }).returning())[0]!;
        return c.json({ id: row.id }, 201);
      });
    })
  .post('/briefs/:id/apply', requireAuth,
    zValidator('json', (await import('@ipc/contracts')).CreateComment.pick({ bodyMd: true }), invalid), async (c) => {
      const db = needDb(c.env);
      const userId = c.get('userId')!;
      const { bodyMd } = c.req.valid('json') as { bodyMd: string };
      return withUser(db, userId, async (tx) => {
        await tx.insert(freelanceApplications).values({
          briefId: c.req.param('id'), applicantId: userId, pitchMd: bodyMd,
        }).onConflictDoNothing();
        return c.json({ applied: true });
      });
    })
  .get('/briefs/:id/applications', requireAuth, async (c) => {
    const db = needDb(c.env);
    return withUser(db, c.get('userId'), async (tx) => {
      const rows = await tx.select().from(freelanceApplications)
        .where(eq(freelanceApplications.briefId, c.req.param('id')));
      return c.json({ items: rows });
    });
  });
