import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { ActivityDay, DashboardStats, LeaderboardRow, Performance, Workshop } from '@ipc/contracts';
import type { Env } from './env.ts';
import { getDb } from './repo.ts';
import { listWorkshops } from './repo.ts';
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
      -- Wide enough that the dashboard can find the member directly above
      -- anyone at a realistic rank; the client renders the top 10 and uses
      -- the rest only to compute the gap honestly.
      limit 50
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

        -- Started but not finished, straight from the purpose-built table:
        -- enrollments are upserted on every progress write, with completed_at
        -- set the moment a course hits 100%.
        (
          select count(*)::int from enrollments e
          where e.user_id = ${userId}::uuid and e.completed_at is null
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

/**
 * The whole dashboard in one round trip.
 *
 * The page used to fire five parallel queries — fine on fibre, five TLS
 * handshakes on a phone over 4G before first paint. The reads run
 * concurrently server-side (all indexed, all small) and arrive as one JSON
 * body. The individual endpoints stay for the pages that own them.
 */
export async function getDashboard(env: Env, userId: string | null) {
  const [stats, activity, performance, leaderboard, workshops] = await Promise.all([
    getStats(env, userId),
    getActivity(env, userId),
    getPerformance(env, userId),
    getLeaderboard(env, userId),
    listWorkshops(env, userId, 'upcoming'),
  ]);
  return { stats, activity, performance, leaderboard, workshops };
}

/**
 * Momentum — the honest replacement for the exam-score gauge.
 *
 * There are no quizzes, so participation/quiz/exam splits were fiction served
 * as data. Every input here is a real rollup: active days, finished-vs-started
 * lessons, and the longest streak held against a 30-day scale. The monthly
 * trend reads the same daily_activity rows the chart reads.
 */
export async function getPerformance(env: Env, userId: string | null): Promise<Performance> {
  const db = getDb(env);
  if (!db || !userId) return seed.performance;

  return withUser(db, userId, async (tx) => {
    const [row] = await tx.execute<{
      active_days: number; started: number; completed: number; longest: number;
    }>(sql`
      select
        (select count(*)::int from daily_activity
          where user_id = ${userId}::uuid
            and day >= (now() at time zone 'Asia/Kolkata')::date - 30
            and (courses_minutes + workshops_minutes + library_minutes) > 0) as active_days,
        (select count(*)::int from lesson_progress where user_id = ${userId}::uuid) as started,
        (select count(*)::int from lesson_progress
          where user_id = ${userId}::uuid and is_completed) as completed,
        (select coalesce(longest_days, 0)::int from streaks where user_id = ${userId}::uuid) as longest
    `);

    const active = Number(row?.active_days ?? 0);
    const started = Number(row?.started ?? 0);
    const completed = Number(row?.completed ?? 0);
    const longest = Number(row?.longest ?? 0);
    const consistency = Math.min(100, Math.round((active / 30) * 100));
    const completion = started === 0 ? 0 : Math.min(100, Math.round((completed / started) * 100));
    const streak = Math.min(100, Math.round((longest / 30) * 100));

    const months = await tx.execute<{ label: string; active: number; days: number }>(sql`
      select
        to_char(day, 'Mon') as label,
        count(*)::int as active,
        -- Days in that month. Subtracting two timestamps yields an interval,
        -- and Postgres cannot cast an interval to integer — that threw 42846
        -- on every call. Taking the day-of-month of the month's last day gives
        -- 28/29/30/31 directly, and gets February right in a leap year.
        extract(day from (date_trunc('month', max(day)) + interval '1 month - 1 day'))::int as days
      from daily_activity
      where user_id = ${userId}::uuid
        and (courses_minutes + workshops_minutes + library_minutes) > 0
      group by date_trunc('month', day), to_char(day, 'Mon')
      order by date_trunc('month', day)
      limit 6
    `);

    return {
      totalScore: Math.round(consistency * 0.4 + completion * 0.4 + streak * 0.2),
      breakdown: { consistency, completion, streak },
      trend: [...months].map((m) => ({
        label: m.label,
        value: Math.min(100, Math.round((Number(m.active) / Math.max(1, Number(m.days))) * 100)),
      })),
    };
  });
}
