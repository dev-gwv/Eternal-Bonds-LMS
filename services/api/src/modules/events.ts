import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, sql } from 'drizzle-orm';
import { auditLog, eventInsights, eventRsvps, events, insights, withUser } from '@ipc/db';
import { EventInput } from '@ipc/contracts';
import type { AppEnv } from '../context.ts';
import { problem, HttpError } from '../lib/problem.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.ts';
import { getDb } from '../repo.ts';

/**
 * Turn recording lesson ids into something linkable.
 *
 * `events.recording_lesson_id` is the last leg of the Think Tank loop, and on
 * its own it is unusable: /learn needs a course slug *and* a lesson slug. One
 * query for the page rather than one per event.
 */
async function recordingRoutes(
  tx: { execute: (q: never) => Promise<unknown> },
  lessonIds: (string | null)[],
): Promise<Map<string, { courseSlug: string; lessonSlug: string }>> {
  const ids = lessonIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return new Map();

  const rows = (await tx.execute(sql`
    select l.id as lesson_id, c.slug as course_slug, l.slug as lesson_slug
    from lessons l
    join modules m on m.id = l.module_id
    join courses c on c.id = m.course_id
    where l.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
  ` as never)) as { lesson_id: string; course_slug: string; lesson_slug: string }[];
  return new Map(rows.map((r) => [r.lesson_id, { courseSlug: r.course_slug, lessonSlug: r.lesson_slug }]));
}

const invalid = (result: any, c: any) =>
  result.success ? undefined : problem(c, 422, 'Invalid event', result.error.issues[0]?.message);

function needDb(env: any) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database', 'Set DATABASE_URL.');
  return db;
}

export const eventsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env);
    if (!db) {
      const seed = await import('../data/seed.ts');
      return c.json({ items: seed.clubEvents });
    }
    const userId = c.get('userId');
    return withUser(db, userId, async (tx) => {
      const rows = await tx.select().from(events).orderBy(desc(events.startsAt)).limit(50);
      // A lesson id alone cannot be linked to: /learn wants a course slug and
      // a lesson slug. Resolved here, once for the page, rather than making
      // the client fetch each one.
      const recordings = await recordingRoutes(tx, rows.map((e) => e.recordingLessonId));
      const rsvps = userId
        ? await tx.select({ eventId: eventRsvps.eventId }).from(eventRsvps).where(eq(eventRsvps.userId, userId))
        : [];
      const mine = new Set(rsvps.map((r) => r.eventId));
      const counts = await tx.select({ eventId: eventRsvps.eventId, n: sql<number>`count(*)` })
        .from(eventRsvps).groupBy(eventRsvps.eventId);
      const countBy = new Map(counts.map((r) => [r.eventId, Number(r.n)]));
      return c.json({
        items: rows.map((e) => ({
          id: e.id, slug: e.slug, title: e.title, descriptionMd: e.descriptionMd,
          startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(),
          joinUrl: mine.has(e.id) ? e.joinUrl : null,
          rsvpd: mine.has(e.id), rsvpCount: countBy.get(e.id) ?? 0,
          isFeaturedSession: e.isFeaturedSession,
          recordingLessonId: e.recordingLessonId ?? null,
          recordingCourseSlug: recordings.get(e.recordingLessonId ?? '')?.courseSlug ?? null,
          recordingLessonSlug: recordings.get(e.recordingLessonId ?? '')?.lessonSlug ?? null,
          featuredInsights: [],
        })),
      });
    });
  })
  .get('/:slug', async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId');
    return withUser(db, userId, async (tx) => {
      const [e] = await tx.select().from(events).where(eq(events.slug, c.req.param('slug'))).limit(1);
      if (!e) throw new HttpError(404, 'Event not found');
      const linked = await tx.select({ id: insights.id, slug: insights.slug, title: insights.title })
        .from(eventInsights).innerJoin(insights, eq(insights.id, eventInsights.insightId))
        .where(eq(eventInsights.eventId, e.id));
      const rsvpd = userId
        ? (await tx.select().from(eventRsvps).where(and(eq(eventRsvps.eventId, e.id), eq(eventRsvps.userId, userId))).limit(1)).length > 0
        : false;
      const recordings = await recordingRoutes(tx, [e.recordingLessonId]);
      return c.json({
        id: e.id, slug: e.slug, title: e.title, descriptionMd: e.descriptionMd,
        startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(),
        joinUrl: rsvpd ? e.joinUrl : null, rsvpd, rsvpCount: 0,
        isFeaturedSession: e.isFeaturedSession,
        recordingLessonId: e.recordingLessonId ?? null,
        recordingCourseSlug: recordings.get(e.recordingLessonId ?? '')?.courseSlug ?? null,
        recordingLessonSlug: recordings.get(e.recordingLessonId ?? '')?.lessonSlug ?? null,
        featuredInsights: linked,
      });
    });
  })
  .post('/:id/rsvp', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      await tx.insert(eventRsvps).values({ eventId: c.req.param('id'), userId }).onConflictDoNothing();
      return c.json({ rsvpd: true });
    });
  })
  .delete('/:id/rsvp', requireAuth, async (c) => {
    const db = needDb(c.env);
    const userId = c.get('userId')!;
    return withUser(db, userId, async (tx) => {
      await tx.delete(eventRsvps).where(and(eq(eventRsvps.eventId, c.req.param('id')), eq(eventRsvps.userId, userId)));
      return c.body(null, 204);
    });
  })
  // Studio: schedule, link featured insights, recording promotes into a lesson.
  .post('/', requireAdmin, zValidator('json', EventInput, invalid), async (c) => {
    const db = needDb(c.env);
    const adminId = c.get('userId');
    const input = c.req.valid('json');
    return withUser(db, adminId, async (tx) => {
      const row = (await tx.insert(events).values({
        slug: input.slug, title: input.title, descriptionMd: input.descriptionMd,
        startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt),
        joinUrl: input.joinUrl, minTier: input.minTier as any, isFeaturedSession: input.isFeaturedSession,
      }).returning())[0]!;
      for (const id of input.insightIds) {
        await tx.insert(eventInsights).values({ eventId: row.id, insightId: id }).onConflictDoNothing();
      }
      await tx.insert(auditLog).values({ actorId: adminId, action: 'event.create', targetType: 'event', targetId: row.id });
      return c.json({ id: row.id, slug: row.slug }, 201);
    });
  })
  .post('/:id/promote-recording', requireAdmin, zValidator('json',
    (await import('zod')).z.object({ lessonId: (await import('zod')).z.uuid() }),
    invalid), async (c) => {
      const db = needDb(c.env);
      return withUser(db, c.get('userId'), async (tx) => {
        await tx.update(events).set({ recordingLessonId: c.req.valid('json').lessonId }).where(eq(events.id, c.req.param('id')));
        return c.json({ ok: true });
      });
    });
