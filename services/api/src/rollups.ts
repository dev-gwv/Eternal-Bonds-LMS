import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { ActivityDay, DashboardStats, LeaderboardRow } from '@ipc/contracts';
import type { Env } from './env.ts';
import { getDb } from './repo.ts';
import * as seed from './data/seed.ts';

/**
 * Reads of the worker's output.
 *
 * These endpoints never touch `activity_events` directly — that table only
 * grows, and scanning it per request is how a dashboard gets slow at exactly
 * the moment the club gets big.
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export async function getLeaderboard(env: Env, userId: string | null): Promise<LeaderboardRow[]> {
  const db = getDb(env);
  if (!db) return seed.leaderboard;

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{ full_name: string; xp: number }>(sql`
      select u.full_name, s.xp
      from member_stats s
      join users u on u.id = s.user_id
      where not u.is_suspended
      order by s.xp desc
      limit 10
    `);

    return [...rows].map((r, i) => ({
      rank: i + 1,
      name: r.full_name,
      initials: r.full_name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase(),
      xp: Number(r.xp) || 0,
    }));
  });
}

export async function getActivity(env: Env, userId: string | null): Promise<ActivityDay[]> {
  const db = getDb(env);
  if (!db || !userId) return seed.activity;

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{
      day: string;
      courses_minutes: number;
      workshops_minutes: number;
      library_minutes: number;
    }>(sql`
      select day::text, courses_minutes, workshops_minutes, library_minutes
      from daily_activity
      where user_id = ${userId}
        and day >= (now() at time zone 'Asia/Kolkata')::date - 6
      order by day
    `);

    // The chart always shows seven days; a day with no activity is a real
    // answer, not a gap, so fill rather than omit.
    const byDay = new Map(
      [...rows].map((r) => [DAYS[new Date(r.day).getUTCDay()]!, r]),
    );

    return DAYS.slice(1).concat(DAYS[0]).map((day) => {
      const row = byDay.get(day);
      return {
        day,
        courses: Number(row?.courses_minutes ?? 0),
        workshops: Number(row?.workshops_minutes ?? 0),
        library: Number(row?.library_minutes ?? 0),
      } satisfies ActivityDay;
    });
  });
}

export async function getStats(env: Env, userId: string | null): Promise<DashboardStats> {
  const db = getDb(env);
  if (!db) return seed.dashboardStats;

  return withUser(db, userId, async (tx) => {
    const [row] = await tx.execute<{
      lessons_completed: number;
      courses_in_progress: number;
      minutes_learned: number;
      streak_days: number;
      longest_streak_days: number;
      xp: number;
      rank: number | null;
      workshops_attended: number;
      upcoming_workshops: number;
    }>(sql`
      select
        coalesce(ms.lessons_completed, 0)::int as lessons_completed,

        -- Started but not finished. A course with no progress is not "in
        -- progress", and neither is one that is done.
        (
          select count(*)::int from courses c
          where exists (
            select 1 from modules m join lessons l on l.module_id = m.id
            join lesson_progress lp on lp.lesson_id = l.id
            where m.course_id = c.id and lp.user_id = ${userId}::uuid
          )
          and exists (
            select 1 from modules m join lessons l on l.module_id = m.id
            where m.course_id = c.id and not exists (
              select 1 from lesson_progress lp
              where lp.lesson_id = l.id and lp.user_id = ${userId}::uuid and lp.is_completed
            )
          )
        ) as courses_in_progress,

        -- The same 30-day window the activity chart draws, so the headline
        -- number and the graph under it cannot disagree.
        (
          select coalesce(sum(courses_minutes + workshops_minutes + library_minutes), 0)::int
          from daily_activity
          where user_id = ${userId}::uuid
            and day >= (now() at time zone 'Asia/Kolkata')::date - 30
        ) as minutes_learned,

        coalesce(st.current_days, 0)::int as streak_days,
        coalesce(st.longest_days, 0)::int as longest_streak_days,
        coalesce(ms.xp, 0)::int as xp,

        -- Null rather than a rank when they have no XP: an unranked member is
        -- not "last", and showing them a position they never earned is worse
        -- than showing none.
        case when coalesce(ms.xp, 0) = 0 then null else (
          select count(*)::int + 1 from member_stats other where other.xp > ms.xp
        ) end as rank,

        coalesce(ms.workshops_attended, 0)::int as workshops_attended,
        (select count(*)::int from workshops w where w.ends_at >= now()) as upcoming_workshops
      from (select 1) one
      left join member_stats ms on ms.user_id = ${userId}::uuid
      left join streaks st on st.user_id = ${userId}::uuid
    `);

    return {
      lessonsCompleted: Number(row?.lessons_completed ?? 0),
      coursesInProgress: Number(row?.courses_in_progress ?? 0),
      minutesLearned: Number(row?.minutes_learned ?? 0),
      streakDays: Number(row?.streak_days ?? 0),
      longestStreakDays: Number(row?.longest_streak_days ?? 0),
      xp: Number(row?.xp ?? 0),
      rank: row?.rank == null ? null : Number(row.rank),
      workshopsAttended: Number(row?.workshops_attended ?? 0),
      upcomingWorkshops: Number(row?.upcoming_workshops ?? 0),
    };
  });
}
