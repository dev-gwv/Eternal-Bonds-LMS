import { sql } from 'drizzle-orm';
import type { Db } from '@ipc/db';

/**
 * The jobs that turn `activity_events` into the numbers members see.
 *
 * Every one of these is a full recompute from the event stream rather than an
 * incremental patch. That is deliberate: a rollup that can only be nudged
 * forward drifts, and there is no way to prove it is right. These can be
 * thrown away and rebuilt at any time.
 */

/** Per-member, per-day minutes and XP. Feeds the activity chart. */
export async function rollupDailyActivity(db: Db, days = 30) {
  const result = await db.execute<{ count: number }>(sql`
    with windowed as (
      select
        user_id,
        (occurred_at at time zone 'Asia/Kolkata')::date as day,
        kind,
        minutes,
        xp
      from activity_events
      where occurred_at >= now() - (${days} || ' days')::interval
    ),
    rolled as (
      select
        user_id,
        day,
        sum(minutes) filter (where kind like 'lesson.%')   as courses_minutes,
        sum(minutes) filter (where kind like 'workshop.%') as workshops_minutes,
        sum(minutes) filter (where kind like 'library.%')  as library_minutes,
        sum(xp) as xp
      from windowed
      group by user_id, day
    ),
    upserted as (
      insert into daily_activity (user_id, day, courses_minutes, workshops_minutes, library_minutes, xp)
      select
        user_id, day,
        coalesce(courses_minutes, 0),
        coalesce(workshops_minutes, 0),
        coalesce(library_minutes, 0),
        coalesce(xp, 0)
      from rolled
      on conflict (user_id, day) do update set
        courses_minutes   = excluded.courses_minutes,
        workshops_minutes = excluded.workshops_minutes,
        library_minutes   = excluded.library_minutes,
        xp                = excluded.xp
      returning 1
    )
    select count(*)::int as count from upserted
  `);
  return { rows: result[0]?.count ?? 0 };
}

/** Totals for the leaderboard and profile. */
export async function rollupMemberStats(db: Db) {
  const result = await db.execute<{ count: number }>(sql`
    with totals as (
      select
        user_id,
        coalesce(sum(xp), 0)::int as xp,
        count(*) filter (where kind = 'lesson.completed')::int   as lessons_completed,
        count(*) filter (where kind = 'post.created')::int       as posts_created,
        count(*) filter (where kind = 'workshop.attended')::int  as workshops_attended
      from activity_events
      group by user_id
    ),
    upserted as (
      insert into member_stats (user_id, xp, lessons_completed, posts_created, workshops_attended, updated_at)
      select user_id, xp, lessons_completed, posts_created, workshops_attended, now() from totals
      on conflict (user_id) do update set
        xp                 = excluded.xp,
        lessons_completed  = excluded.lessons_completed,
        posts_created      = excluded.posts_created,
        workshops_attended = excluded.workshops_attended,
        updated_at         = now()
      returning 1
    )
    select count(*)::int as count from upserted
  `);
  return { members: result[0]?.count ?? 0 };
}

/**
 * Streaks, counted in the member's own timezone.
 *
 * A streak that resets at UTC midnight punishes an Indian member at 5:30am for
 * no reason, so the day boundary comes from `users.timezone`.
 */
export async function recomputeStreaks(db: Db) {
  const result = await db.execute<{ count: number }>(sql`
    with active_days as (
      select distinct
        e.user_id,
        (e.occurred_at at time zone coalesce(u.timezone, 'Asia/Kolkata'))::date as day
      from activity_events e
      join users u on u.id = e.user_id
    ),
    -- Consecutive days share the same (day - row_number) value; that is the
    -- run identifier, and the run length is the streak.
    grouped as (
      select
        user_id,
        day,
        day - (row_number() over (partition by user_id order by day))::int as run_id
      from active_days
    ),
    runs as (
      select user_id, run_id, count(*)::int as length, max(day) as ended_on
      from grouped
      group by user_id, run_id
    ),
    summary as (
      select
        user_id,
        max(length) as longest_days,
        max(case
          when ended_on >= (now() at time zone 'Asia/Kolkata')::date - 1 then length
          else 0
        end) as current_days,
        max(ended_on) as last_active_on
      from runs
      group by user_id
    ),
    upserted as (
      insert into streaks (user_id, current_days, longest_days, last_active_on, updated_at)
      select user_id, coalesce(current_days, 0), coalesce(longest_days, 0), last_active_on, now() from summary
      on conflict (user_id) do update set
        current_days   = excluded.current_days,
        longest_days   = greatest(streaks.longest_days, excluded.longest_days),
        last_active_on = excluded.last_active_on,
        updated_at     = now()
      returning 1
    )
    select count(*)::int as count from upserted
  `);
  return { members: result[0]?.count ?? 0 };
}

/**
 * Counter caches drift — a failed transaction, a manual fix, a bug. Rather
 * than trusting them forever, recompute the truth nightly and correct.
 */
export async function reconcileCounters(db: Db) {
  // The triggers keep these right. This exists because "the triggers keep
  // these right" is a belief until something checks it — a restored backup, a
  // hand-run DELETE, a migration that disabled triggers for a bulk load.
  const [likes] = await db.execute<{ fixed: number }>(sql`
    with corrected as (
      update posts p set likes_count = t.actual
      from (
        select p2.id, (select count(*)::int from post_likes pl where pl.post_id = p2.id) as actual
        from posts p2
      ) t
      where p.id = t.id and p.likes_count <> t.actual
      returning 1
    )
    select count(*)::int as fixed from corrected
  `);

  const [comments] = await db.execute<{ fixed: number }>(sql`
    with corrected as (
      update posts p set comments_count = t.actual
      from (
        select p2.id,
               (select count(*)::int from post_comments pc
                where pc.post_id = p2.id and pc.deleted_at is null) as actual
        from posts p2
      ) t
      where p.id = t.id and p.comments_count <> t.actual
      returning 1
    )
    select count(*)::int as fixed from corrected
  `);

  const [commentLikes] = await db.execute<{ fixed: number }>(sql`
    with corrected as (
      update post_comments pc set likes_count = t.actual
      from (
        select c2.id, (select count(*)::int from comment_likes cl where cl.comment_id = c2.id) as actual
        from post_comments c2
      ) t
      where pc.id = t.id and pc.likes_count <> t.actual
      returning 1
    )
    select count(*)::int as fixed from corrected
  `);

  const fixed =
    Number(likes?.fixed ?? 0) + Number(comments?.fixed ?? 0) + Number(commentLikes?.fixed ?? 0);

  // Worth shouting about: a non-zero result means a trigger is not firing, and
  // the numbers being right afterwards hides that it was ever wrong.
  if (fixed > 0) {
    console.warn(JSON.stringify({ reconcile: 'drift_corrected', ...{ likes: likes?.fixed, comments: comments?.fixed, commentLikes: commentLikes?.fixed } }));
  }

  return { fixed, postLikes: Number(likes?.fixed ?? 0), postComments: Number(comments?.fixed ?? 0), commentLikes: Number(commentLikes?.fixed ?? 0) };
}
