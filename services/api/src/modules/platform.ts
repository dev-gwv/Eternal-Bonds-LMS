import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import {
  activityEvents, badgeDefs, certificates, courses, enrollments, lessonNotes, lessonQuestions,
  lessonResources, memberProfiles, memberStats, userBadges, users, withUser,
} from '@ipc/db';
import type { AppEnv } from '../context.ts';
import { problem, HttpError } from '../lib/problem.ts';
import { requireAuth } from '../middleware/auth.ts';
import { getDb } from '../repo.ts';
import { createStorage } from '../lib/storage.ts';

const initials = (n: string) => n.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
const invalid = (result: any, c: any) =>
  result.success ? undefined : problem(c, 422, 'Invalid request', result.error.issues[0]?.message);

function needDb(env: any) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database', 'Set DATABASE_URL.');
  return db;
}

/** Member directory + own profile editing. */
export const directoryRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env);
    if (!db) return c.json({ items: [], nextCursor: null });
    const q = (c.req.query('q') ?? '').trim();
    const expertise = c.req.query('expertise');
    return withUser(db, c.get('userId'), async (tx) => {
      let rows = await tx.select({ u: users, p: memberProfiles })
        .from(users).leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(eq(memberProfiles.showInDirectory, true)).limit(60);
      if (q) rows = rows.filter((r) =>
        r.u.fullName.toLowerCase().includes(q.toLowerCase()) ||
        (r.u.city ?? '').toLowerCase().includes(q.toLowerCase()));
      if (expertise) rows = rows.filter((r) => (r.p?.expertise ?? []).includes(expertise));
      return c.json({
        items: rows.map((r) => ({
          id: r.u.id, fullName: r.u.fullName, initials: initials(r.u.fullName),
          tier: 'free' as const, city: r.u.city, expertise: r.p?.expertise ?? [], bioMd: r.p?.bioMd ?? null,
        })),
        nextCursor: null,
      });
    });
  })
  // Reading your own profile back. The editor needs somewhere to start from,
  // and the directory listing only returns members who opted into it — so a
  // member who has not opted in could not see their own row.
  .get('/me', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      const [row] = await tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1);
      return c.json({
        bioMd: row?.bioMd ?? null,
        expertise: row?.expertise ?? [],
        showInDirectory: row?.showInDirectory ?? false,
      });
    });
  })
  /* Another member's profile. Only members who opted into the directory are
     visible — that is the consent they gave, and honouring it on one page but
     not another would be a bait-and-switch. */
  .get('/:id', requireAuth, async (c) => {
    const { getPublicMember } = await import('../profiles.ts');
    return c.json(await getPublicMember(c.env, c.get('userId'), c.req.param('id')));
  })
  .put('/me', requireAuth, zValidator('json', z.object({
    bioMd: z.string().max(2000).nullable().optional(),
    expertise: z.array(z.string().max(40)).max(10).optional(),
    showInDirectory: z.boolean().optional(),
  }), invalid), async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      await tx.insert(memberProfiles).values({ userId, ...c.req.valid('json') })
        .onConflictDoUpdate({ target: memberProfiles.userId, set: { ...c.req.valid('json'), updatedAt: new Date() } });
      return c.json({ ok: true });
    });
  })
  .get('/badges', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      const defs = await tx.select().from(badgeDefs);
      const mine = new Map((await tx.select().from(userBadges).where(eq(userBadges.userId, userId)))
        .map((b) => [b.badgeId, b.awardedAt]));
      return c.json({
        items: defs.map((d) => ({
          id: d.id, name: d.name, description: d.description, icon: d.icon,
          earned: mine.has(d.id), awardedAt: mine.get(d.id)?.toISOString() ?? null,
        })),
      });
    });
  });

/** Lesson Q&A, notes, resources, certificates. */
export const learningRoutes = new Hono<AppEnv>()
  .get('/lessons/:id/questions', async (c) => {
    const db = needDb(c.env);
    return withUser(db, c.get('userId'), async (tx) => {
      const rows = await tx.select({ q: lessonQuestions, name: users.fullName })
        .from(lessonQuestions).innerJoin(users, eq(users.id, lessonQuestions.authorId))
        .where(and(eq(lessonQuestions.lessonId, c.req.param('id')), sql`${lessonQuestions.deletedAt} is null`))
        .orderBy(lessonQuestions.createdAt);
      const byId = new Map(rows.map((r) => [r.q.id, {
        id: r.q.id, lessonId: r.q.lessonId,
        author: { name: r.name, initials: initials(r.name) },
        bodyMd: r.q.bodyMd, resolved: r.q.resolved, mine: r.q.authorId === c.get('userId'),
        createdAt: r.q.createdAt.toISOString(), replies: [] as any[],
      }]));
      const roots: any[] = [];
      for (const r of rows) {
        const node = byId.get(r.q.id)!;
        if (r.q.parentId && byId.has(r.q.parentId)) {
          byId.get(r.q.parentId)!.replies.push({
            id: node.id, bodyMd: node.bodyMd, authorName: node.author.name, createdAt: node.createdAt,
          });
        } else roots.push(node);
      }
      return c.json({ items: roots });
    });
  })
  .post('/lessons/:id/questions', requireAuth,
    zValidator('json', z.object({ bodyMd: z.string().trim().min(4).max(2000), parentId: z.uuid().nullable().optional() }), invalid),
    async (c) => {
      const db = needDb(c.env);
      const userId = c.get('userId')!;
      return withUser(db, userId, async (tx) => {
        const row = (await tx.insert(lessonQuestions).values({
          lessonId: c.req.param('id'), authorId: userId,
          bodyMd: c.req.valid('json').bodyMd, parentId: c.req.valid('json').parentId ?? null,
        }).returning())[0]!;
        await tx.insert(activityEvents).values({
          userId, kind: 'question.asked', payload: { lessonId: c.req.param('id') }, xp: 5,
        });
        return c.json({ id: row.id }, 201);
      });
    })
  .post('/questions/:id/resolve', requireAuth, async (c) => {
    const db = needDb(c.env);
    return withUser(db, c.get('userId'), async (tx) => {
      await tx.update(lessonQuestions).set({ resolved: true }).where(eq(lessonQuestions.id, c.req.param('id')));
      return c.json({ ok: true });
    });
  })
  .get('/lessons/:id/notes', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      const [row] = await tx.select().from(lessonNotes)
        .where(and(eq(lessonNotes.userId, userId), eq(lessonNotes.lessonId, c.req.param('id')))).limit(1);
      return c.json({ lessonId: c.req.param('id'), bodyMd: row?.bodyMd ?? '' });
    });
  })
  .put('/lessons/:id/notes', requireAuth, zValidator('json', z.object({ bodyMd: z.string().max(10000) }), invalid), async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      await tx.insert(lessonNotes).values({ userId, lessonId: c.req.param('id'), bodyMd: c.req.valid('json').bodyMd })
        .onConflictDoUpdate({ target: [lessonNotes.userId, lessonNotes.lessonId], set: { bodyMd: c.req.valid('json').bodyMd, updatedAt: new Date() } });
      return c.json({ ok: true });
    });
  })
  .get('/lessons/:id/resources', async (c) => {
    const db = getDb(c.env);
    if (!db) return c.json({ items: [] });
    return withUser(db, c.get('userId'), async (tx) => {
      const rows = await tx.select().from(lessonResources).where(eq(lessonResources.lessonId, c.req.param('id')));
      const storage = createStorage(c.env);
      return c.json({
        items: await Promise.all(rows.map(async (r) => ({
          id: r.id, title: r.title, mime: r.mime, sizeBytes: r.sizeBytes,
          url: await storage.signedDownloadUrl(r.storageKey), downloadCount: r.downloadCount,
        }))),
      });
    });
  })
  .get('/certificates', requireAuth, async (c) => {
    const db = needDb(c.env);
    return withUser(db, c.get('userId'), async (tx) => {
      const rows = await tx.select({ cert: certificates, title: courses.title })
        .from(certificates).leftJoin(courses, eq(courses.id, certificates.courseId))
        .where(eq(certificates.userId, c.get('userId')!));
      const storage = createStorage(c.env);
      return c.json({
        items: await Promise.all(rows.map(async (r) => ({
          id: r.cert.id, courseTitle: r.title ?? 'Course', code: r.cert.code,
          issuedAt: r.cert.issuedAt.toISOString(),
          url: r.cert.pdfKey ? await storage.signedDownloadUrl(r.cert.pdfKey) : null,
        }))),
      });
    });
  })
  // Completion → certificate. Idempotent: one certificate per member per course.
  .post('/courses/:id/certificate', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      const [existing] = await tx.select().from(certificates)
        .where(and(eq(certificates.userId, userId), eq(certificates.courseId, c.req.param('id')))).limit(1);
      if (existing) return c.json({ id: existing.id, code: existing.code });
      const code = `EB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const row = (await tx.insert(certificates).values({ userId, courseId: c.req.param('id'), code }).returning())[0]!;
      await tx.insert(activityEvents).values({ userId, kind: 'certificate.issued', payload: { courseId: c.req.param('id') }, xp: 50 });
      return c.json({ id: row.id, code }, 201);
    });
  });
