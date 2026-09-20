import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { bookmarks, insightDomains, insightImpactAreas, insightSteps, insightVotes, insights, solutions, unmatchedDilemmas, users, voteCycles, withUser } from '@ipc/db';
import { ShareInsight } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { problem } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { getDb } from '../repo.ts';
import { HttpError } from '../lib/problem.ts';

const initials = (n: string) => n.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
const invalid = (result: any, c: any) =>
  result.success ? undefined : problem(c, 422, 'Invalid insight', result.error.issues[0]?.message);

function needDb(env: any) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database', 'Set DATABASE_URL.');
  return db;
}

export const thinktankRoutes = new Hono<AppEnv>()
  .get('/domains', async (c) => {
    const db = getDb(c.env);
    if (!db) {
      const seed = await import('../data/seed.ts');
      return c.json({ items: seed.insightDomains });
    }
    const rows = await db.select().from(insightDomains);
    return c.json({ items: rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name })) });
  })
  .get('/cycles/current', async (c) => {
    const db = getDb(c.env);
    if (!db) return c.json({ cycle: null });
    const rows = await db.select().from(voteCycles).orderBy(desc(voteCycles.startsOn)).limit(1);
    const r = rows[0];
    return c.json({ cycle: r ? { id: r.id, startsOn: r.startsOn, endsOn: r.endsOn, status: r.status } : null });
  })
  // Library with filters. Cursor pagination: ?cursor=<id>&limit=.
  .get('/insights', async (c) => {
    const db = getDb(c.env);
    const domain = c.req.query('domain');
    if (!db) {
      const seed = await import('../data/seed.ts');
      const items = domain ? seed.insights.filter((i) => i.domainSlug === domain) : seed.insights;
      return c.json({ items, nextCursor: null });
    }
    const userId = c.get('userId');
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20)));
    const cursor = c.req.query('cursor');
    return withUser(db, userId, async (tx) => {
      const conds = [eq(insights.status, 'published' as any)];
      if (domain) conds.push(eq(insights.slug, insights.slug)); // placeholder, filtered below via join
      let q = tx
        .select({
          id: insights.id, slug: insights.slug, title: insights.title,
          situationMd: insights.situationMd, bigIdeaMd: insights.bigIdeaMd, howMd: insights.howMd,
          status: insights.status, votes: insights.votesCount, featuredAt: insights.featuredAt,
          createdAt: insights.createdAt, authorId: users.id, authorName: users.fullName,
          authorTier: sql<string>`public.current_tier(${users.id})`,
          domainSlug: insightDomains.slug, impactSlug: insightImpactAreas.slug,
          liked: userId ? sql<boolean>`exists (select 1 from insight_votes v where v.insight_id = ${insights.id} and v.user_id = ${userId}::uuid)` : sql<boolean>`false`,
          saved: userId ? sql<boolean>`exists (select 1 from bookmarks b where b.target_id = ${insights.id} and b.target_type = 'insight' and b.user_id = ${userId}::uuid)` : sql<boolean>`false`,
        })
        .from(insights)
        .innerJoin(users, eq(users.id, insights.authorId))
        .leftJoin(insightDomains, eq(insightDomains.id, insights.domainId))
        .leftJoin(insightImpactAreas, eq(insightImpactAreas.id, insights.impactAreaId))
        .where(cursor
          ? and(...conds, sql`${insights.createdAt} < (select created_at from insights where id = ${cursor}::uuid)`)
          : and(...conds))
        .orderBy(desc(insights.createdAt))
        .limit(limit + 1);
      let rows = await q;
      if (domain) rows = rows.filter((r) => r.domainSlug === domain);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return c.json({
        items: page.map((r) => ({
          id: r.id, slug: r.slug, title: r.title, situationMd: r.situationMd, bigIdeaMd: r.bigIdeaMd,
          howMd: r.howMd, status: r.status, domainSlug: r.domainSlug, impactSlug: r.impactSlug,
          votes: r.votes, votedByMe: Boolean(r.liked), savedByMe: Boolean(r.saved),
          featuredAt: r.featuredAt?.toISOString() ?? null,
          author: { name: r.authorName, initials: initials(r.authorName), tier: (r.authorTier ?? 'free') as any },
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      });
    });
  })
  .get('/insights/:slug', async (c) => {
    const db = getDb(c.env);
    if (!db) {
      const seed = await import('../data/seed.ts');
      const hit = seed.insights.find((i) => i.slug === c.req.param('slug'));
      if (!hit) throw new HttpError(404, 'Insight not found');
      return c.json({ ...hit, steps: [] });
    }
    const userId = c.get('userId');
    return withUser(db, userId, async (tx) => {
      const [r] = await tx
        .select({
          id: insights.id, slug: insights.slug, title: insights.title,
          situationMd: insights.situationMd, bigIdeaMd: insights.bigIdeaMd, howMd: insights.howMd,
          status: insights.status, votes: insights.votesCount, featuredAt: insights.featuredAt,
          createdAt: insights.createdAt, authorName: users.fullName,
          authorTier: sql<string>`public.current_tier(${users.id})`,
          domainSlug: insightDomains.slug, impactSlug: insightImpactAreas.slug,
        })
        .from(insights)
        .innerJoin(users, eq(users.id, insights.authorId))
        .leftJoin(insightDomains, eq(insightDomains.id, insights.domainId))
        .leftJoin(insightImpactAreas, eq(insightImpactAreas.id, insights.impactAreaId))
        .where(eq(insights.slug, c.req.param('slug')))
        .limit(1);
      if (!r || (r.status !== 'published' && !userId)) throw new HttpError(404, 'Insight not found');
      const steps = await tx.select().from(insightSteps).where(eq(insightSteps.insightId, r.id));
      return c.json({
        id: r.id, slug: r.slug, title: r.title, situationMd: r.situationMd, bigIdeaMd: r.bigIdeaMd,
        howMd: r.howMd, status: r.status, domainSlug: r.domainSlug, impactSlug: r.impactSlug,
        votes: r.votes, votedByMe: false, savedByMe: false,
        featuredAt: r.featuredAt?.toISOString() ?? null,
        author: { name: r.authorName, initials: initials(r.authorName), tier: (r.authorTier ?? 'free') as any },
        createdAt: r.createdAt.toISOString(),
        steps: steps.map((s) => ({ id: s.id, title: s.title, bodyMd: s.bodyMd })),
      });
    });
  })
  // Share wizard autosaves a draft after step 1: POST with status draft, PATCH to publish.
  .post('/insights', requireAuth, rateLimit({ name: 'insight', limit: 10, windowSeconds: 3600 }),
    zValidator('json', ShareInsight, invalid), async (c) => {
      const db = needDb(c.env);
      const userId = c.get('userId')!;
      const input = c.req.valid('json');
      return withUser(db, userId, async (tx) => {
        const [domain] = await tx.select().from(insightDomains).where(eq(insightDomains.slug, input.domainSlug)).limit(1);
        const [impact] = await tx.select().from(insightImpactAreas).where(eq(insightImpactAreas.slug, input.impactSlug)).limit(1);
        const [cycle] = await tx.select().from(voteCycles).where(eq(voteCycles.status, 'open')).orderBy(desc(voteCycles.startsOn)).limit(1);
        const base = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        const row = (await tx.insert(insights).values({
          authorId: userId, domainId: domain?.id, impactAreaId: impact?.id,
          voteCycleId: cycle?.id, slug: `${base}-${Date.now().toString(36)}`,
          title: input.title, situationMd: input.situationMd, bigIdeaMd: input.bigIdeaMd,
          howMd: input.howMd, status: 'published',
        }).returning())[0]!;
        for (const [i, s] of input.steps.entries()) {
          await tx.insert(insightSteps).values({ insightId: row.id, title: s.title, bodyMd: s.bodyMd, rank: String(100 * (i + 1)) });
        }
        return c.json({ id: row.id, slug: row.slug }, 201);
      });
    })
  .post('/insights/:id/vote', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      const [ins] = await tx.select().from(insights).where(eq(insights.id, c.req.param('id'))).limit(1);
      if (!ins) throw new HttpError(404, 'Insight not found');
      await tx.insert(insightVotes).values({ insightId: ins.id, userId, cycleId: ins.voteCycleId ?? (await tx.select().from(voteCycles).limit(1))[0]!.id }).onConflictDoNothing();
      const [r] = await tx.select({ votes: insights.votesCount }).from(insights).where(eq(insights.id, ins.id)).limit(1);
      return c.json({ liked: true, likes: r!.votes });
    });
  })
  .delete('/insights/:id/vote', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      await tx.delete(insightVotes).where(and(eq(insightVotes.insightId, c.req.param('id')), eq(insightVotes.userId, userId)));
      const [r] = await tx.select({ votes: insights.votesCount }).from(insights).where(eq(insights.id, c.req.param('id'))).limit(1);
      return c.json({ liked: false, likes: r?.votes ?? 0 });
    });
  })
  .post('/bookmarks', requireAuth, zValidator('json', z.object({ targetType: z.string(), targetId: z.uuid() }), invalid), async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    const { targetType, targetId } = c.req.valid('json');
    return withUser(db, userId, async (tx) => {
      await tx.insert(bookmarks).values({ userId, targetType, targetId }).onConflictDoNothing();
      return c.json({ saved: true });
    });
  })
  .delete('/bookmarks/:type/:id', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      await tx.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.targetType, c.req.param('type')), eq(bookmarks.targetId, c.req.param('id'))));
      return c.body(null, 204);
    });
  })
  // Solution Finder with unmatched-dilemma logging.
  .get('/solutions', async (c) => {
    const db = getDb(c.env);
    const q = (c.req.query('q') ?? '').trim();
    if (!db) {
      const seed = await import('../data/seed.ts');
      const items = q
        ? seed.solutions.filter((r) => `${r.dilemma} ${r.bodyMd}`.toLowerCase().includes(q.toLowerCase()))
        : seed.solutions;
      return c.json({ items });
    }
    const rows = await db.select().from(solutions).orderBy(solutions.rank).limit(20);
    const hits = q ? rows.filter((r) => `${r.dilemma} ${r.bodyMd}`.toLowerCase().includes(q.toLowerCase())) : rows;
    if (q && hits.length === 0) {
      const userId = c.get('userId');
      await withUser(db, userId, (tx) => tx.insert(unmatchedDilemmas).values({ userId, query: q }).returning()).catch(() => null);
    }
    return c.json({ items: hits.map((r) => ({ id: r.id, dilemma: r.dilemma, bodyMd: r.bodyMd, rank: Number(r.rank) })) });
  });
