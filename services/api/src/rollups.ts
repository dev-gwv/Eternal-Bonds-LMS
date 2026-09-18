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
      total_workshops: number;
      registrations: number;
      attendees: number;
    }>(sql`
      select
        (select count(*) from workshops)::int as total_workshops,
        (select count(*) from workshop_registrations)::int as registrations,
        (select count(*) from workshop_registrations where attended_minutes > 0)::int as attendees
    `);

    const registrations = Number(row?.registrations ?? 0);
    const attendees = Number(row?.attendees ?? 0);

    return {
      totalWorkshops: Number(row?.total_workshops ?? 0),
      registrations,
      attendees,
      attendanceRate: registrations === 0 ? 0 : Math.round((attendees / registrations) * 10000) / 100,
    };
  });
}
