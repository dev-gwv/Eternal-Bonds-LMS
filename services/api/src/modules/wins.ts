import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, sql } from 'drizzle-orm';
import { reactions, users, winComments, winMedia, wins, withUser } from '@ipc/db';
import { CreateReport, SubmitWin } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { problem, HttpError } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { getDb } from '../repo.ts';
import { createStorage } from '../lib/storage.ts';

const initials = (n: string) => n.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
const invalid = (result: any, c: any) =>
  result.success ? undefined : problem(c, 422, 'Invalid win', result.error.issues[0]?.message);

function needDb(env: any) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database', 'Set DATABASE_URL.');
  return db;
}

export const winsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env);
    const category = c.req.query('category');
    if (!db) {
      const seed = await import('../data/seed.ts');
      const items = category ? seed.wins.filter((w) => w.category === category) : seed.wins;
      return c.json({ items, nextCursor: null });
    }
    const userId = c.get('userId');
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20)));
    const cursor = c.req.query('cursor');
    return withUser(db, userId, async (tx) => {
      const conds = [eq(wins.status, 'published' as any)];
      if (category) conds.push(eq(wins.category, category));
      const rows = await tx
        .select({
          id: wins.id, slug: wins.slug, title: wins.title, bigIdeaMd: wins.bigIdeaMd,
          howItHappenedMd: wins.howItHappenedMd, category: wins.category, occurredOn: wins.occurredOn,
          tags: wins.tags, status: wins.status, publicShare: wins.publicShare,
          reactions: wins.reactionsCount, comments: wins.commentsCount, createdAt: wins.createdAt,
          authorName: users.fullName, authorTier: sql<string>`public.current_tier(${users.id})`,
          reacted: userId ? sql<boolean>`exists (select 1 from reactions r where r.target_id = ${wins.id} and r.target_type = 'win' and r.user_id = ${userId}::uuid)` : sql<boolean>`false`,
        })
        .from(wins)
        .innerJoin(users, eq(users.id, wins.authorId))
        .where(cursor
          ? and(...conds, sql`${wins.createdAt} < (select created_at from wins where id = ${cursor}::uuid)`)
          : and(...conds))
        .orderBy(desc(wins.createdAt))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const media = page.length
        ? await tx.select().from(winMedia).where(sql`${winMedia.winId} in (${sql.join(page.map((p) => sql`${p.id}::uuid`), sql`, `)})`)
        : [];
      const storage = createStorage(c.env);
      const withUrls = await Promise.all(page.map(async (r) => ({
        id: r.id, slug: r.slug, title: r.title, bigIdeaMd: r.bigIdeaMd,
        howItHappenedMd: r.howItHappenedMd, category: r.category,
        occurredOn: r.occurredOn, tags: r.tags, status: r.status, publicShare: r.publicShare,
        reactions: r.reactions, reactedByMe: Boolean(r.reacted), comments: r.comments,
        media: await Promise.all(media.filter((m) => m.winId === r.id).map(async (m) => ({
          id: m.id, url: await storage.signedDownloadUrl(m.storageKey), mime: m.mime,
        }))),
        author: { name: r.authorName, initials: initials(r.authorName), tier: (r.authorTier ?? 'free') as any },
        createdAt: r.createdAt.toISOString(),
      })));
      return c.json({
        items: withUrls,
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      });
    });
  })
  .get('/:slug', async (c) => {
    const db = getDb(c.env);
    if (!db) {
      const seed = await import('../data/seed.ts');
      const hit = seed.wins.find((w) => w.slug === c.req.param('slug'));
      if (!hit) throw new HttpError(404, 'Win not found');
      return c.json(hit);
    }
    return withUser(db, c.get('userId'), async (tx) => {
      const [r] = await tx.select({ win: wins, authorName: users.fullName, authorTier: sql<string>`public.current_tier(${users.id})` })
        .from(wins).innerJoin(users, eq(users.id, wins.authorId)).where(eq(wins.slug, c.req.param('slug'))).limit(1);
      if (!r || r.win.status !== 'published') throw new HttpError(404, 'Win not found');
      const media = await tx.select().from(winMedia).where(eq(winMedia.winId, r.win.id));
      const storage = createStorage(c.env);
      return c.json({
        id: r.win.id, slug: r.win.slug, title: r.win.title, bigIdeaMd: r.win.bigIdeaMd,
        howItHappenedMd: r.win.howItHappenedMd, category: r.win.category, occurredOn: r.win.occurredOn,
        tags: r.win.tags, status: r.win.status, publicShare: r.win.publicShare,
        reactions: r.win.reactionsCount, reactedByMe: false, comments: r.win.commentsCount,
        media: await Promise.all(media.map(async (m) => ({
          id: m.id, url: await storage.signedDownloadUrl(m.storageKey), mime: m.mime,
        }))),
        author: { name: r.authorName, initials: initials(r.authorName), tier: (r.authorTier ?? 'free') as any },
        createdAt: r.win.createdAt.toISOString(),
      });
    });
  })
  // Structured blueprint, enforced: minimum lengths live in the contract.
  .post('/', requireAuth, rateLimit({ name: 'win', limit: 5, windowSeconds: 3600 }),
    zValidator('json', SubmitWin, invalid), async (c) => {
      const db = needDb(c.env);
      const userId = c.get('userId')!;
      const input = c.req.valid('json');
      return withUser(db, userId, async (tx) => {
        const base = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        const row = (await tx.insert(wins).values({
          authorId: userId, slug: `${base}-${Date.now().toString(36)}`, title: input.title,
          bigIdeaMd: input.bigIdeaMd, howItHappenedMd: input.howItHappenedMd, category: input.category,
          occurredOn: input.occurredOn, tags: input.tags, publicShare: input.publicShare, status: 'pending',
        }).returning())[0]!;
        return c.json({ id: row.id, slug: row.slug }, 201);
      });
    })
  .post('/:id/react', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      await tx.insert(reactions).values({ userId, targetType: 'win', targetId: c.req.param('id'), kind: 'like' }).onConflictDoNothing();
      const [r] = await tx.select({ n: wins.reactionsCount }).from(wins).where(eq(wins.id, c.req.param('id'))).limit(1);
      return c.json({ liked: true, likes: r?.n ?? 1 });
    });
  })
  .delete('/:id/react', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      await tx.delete(reactions).where(and(eq(reactions.targetId, c.req.param('id')), eq(reactions.targetType, 'win'), eq(reactions.userId, userId)));
      const [r] = await tx.select({ n: wins.reactionsCount }).from(wins).where(eq(wins.id, c.req.param('id'))).limit(1);
      return c.json({ liked: false, likes: r?.n ?? 0 });
    });
  })
  .get('/:id/comments', async (c) => {
    const db = needDb(c.env);
    return withUser(db, c.get('userId'), async (tx) => {
      const rows = await tx.select({ c: winComments, name: users.fullName })
        .from(winComments).innerJoin(users, eq(users.id, winComments.authorId))
        .where(eq(winComments.winId, c.req.param('id'))).orderBy(winComments.createdAt);
      return c.json({
        items: rows.filter((r) => !r.c.deletedAt).map((r) => ({
          id: r.c.id, bodyMd: r.c.bodyMd, authorName: r.name, createdAt: r.c.createdAt.toISOString(),
        })),
      });
    });
  })
  .post('/:id/comments', requireAuth, rateLimit({ name: 'comment', limit: 30, windowSeconds: 300 }),
    zValidator('json', CreateReport.pick({ reason: true }), invalid), async (c) => {
      const db = needDb(c.env);
      const userId = c.get('userId')!;
      const { reason: bodyMd } = c.req.valid('json');
      return withUser(db, userId, async (tx) => {
        const row = (await tx.insert(winComments).values({ winId: c.req.param('id'), authorId: userId, bodyMd }).returning())[0]!;
        return c.json({ id: row.id }, 201);
      });
    })
  // Signed upload ticket for win proof media. EXIF is stripped worker-side on read.
  .post('/:id/media-ticket', requireAuth, async (c) => {
    const storage = createStorage(c.env);
    const key = `wins/${c.req.param('id')}/${crypto.randomUUID()}.jpg`;
    const { url, token } = await storage.signedUploadUrl(key);
    return c.json({ key, url, token, method: 'PUT' });
  })
  .post('/:id/media', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    const body = await c.req.json<{ key: string; mime?: string }>();
    return withUser(db, userId, async (tx) => {
      const row = (await tx.insert(winMedia).values({ winId: c.req.param('id'), storageKey: body.key, mime: body.mime ?? 'image/jpeg' }).returning())[0]!;
      return c.json({ id: row.id }, 201);
    });
  });
