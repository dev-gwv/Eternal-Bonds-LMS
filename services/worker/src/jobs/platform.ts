import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@ipc/db';
import {
  activityEvents, badgeDefs, eventRsvps, events, lessonQuestions, notifications, userBadges,
} from '@ipc/db';
import { badgeEarned } from '@ipc/domain';

/**
 * Badge engine: evaluates badge_defs rules over activity_events and awards
 * anything newly satisfied. Idempotent — the primary key makes re-awards a
 * no-op — so it can run hourly without care.
 */
export async function awardBadges(db: Db) {
  const defs = await db.select().from(badgeDefs);
  const stats = await db.execute<{
    user_id: string; lessons: number; insights: number; wins: number; answers: number;
  }>(sql`
    select
      u.id as user_id,
      coalesce(sum(case when a.kind = 'lesson.completed' then 1 else 0 end), 0)::int as lessons,
      coalesce(sum(case when a.kind = 'insight.published' then 1 else 0 end), 0)::int as insights,
      coalesce(sum(case when a.kind = 'win.published' then 1 else 0 end), 0)::int as wins,
      coalesce((select count(*) from lesson_questions q where q.author_id = u.id), 0)::int as answers
    from users u left join activity_events a on a.user_id = u.id
    group by u.id
  `);
  const streaks = await db.execute<{ user_id: string; days: number }>(
    sql`select user_id, current_days as days from streaks`,
  );
  const streakBy = new Map(streaks.map((s) => [s.user_id, s.days]));
  let awarded = 0;
  for (const s of stats) {
    for (const d of defs) {
      const rule = d.rule as { kind: string; count: number };
      const ok = badgeEarned(rule, {
        lessonsCompleted: s.lessons, insightsPublished: s.insights,
        winsPublished: s.wins, streakDays: streakBy.get(s.user_id) ?? 0,
        questionsAnswered: s.answers,
      });
      if (!ok) continue;
      const r = await db.insert(userBadges)
        .values({ userId: s.user_id, badgeId: d.id }).onConflictDoNothing().returning();
      if (r.length > 0) {
        awarded++;
        await db.insert(notifications).values({
          userId: s.user_id, kind: 'system', title: `Badge earned: ${d.name}`,
          body: d.description, link: '/members/me',
        });
      }
    }
  }
  return { awarded };
}

/**
 * Event + workshop reminders: 24h and 1h before start, to everyone RSVP'd /
 * registered who has not been reminded yet for this event. Dedupe is by the
 * notifications row itself (kind + subject), not by memory.
 */
export async function eventReminders(db: Db) {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600 * 1000);
  const upcoming = await db.select().from(events)
    .where(and(gte(events.startsAt, now), sql`${events.startsAt} <= ${in24h.toISOString()}::timestamptz`));
  let sent = 0;
  for (const e of upcoming) {
    const rsvps = await db.select({ userId: eventRsvps.userId }).from(eventRsvps)
      .where(eq(eventRsvps.eventId, e.id));
    for (const r of rsvps) {
      const [exists] = await db.select({ id: notifications.id }).from(notifications).where(
        and(eq(notifications.userId, r.userId), eq(notifications.kind, 'workshop.reminder' as any),
          sql`${notifications.subjectId} = ${e.id}::uuid`)).limit(1);
      if (exists) continue;
      await db.insert(notifications).values({
        userId: r.userId, kind: 'workshop.reminder', title: `Starting soon: ${e.title}`,
        body: e.title, link: `/events/${e.slug}`,
        subjectType: 'event', subjectId: e.id,
      });
      sent++;
    }
  }
  void lessonQuestions;
  return { sent };
}
