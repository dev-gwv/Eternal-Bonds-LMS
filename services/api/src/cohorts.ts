import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { Cohort, CohortDetail, CohortInput, CohortMember } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { getDb } from './repo.ts';

/**
 * Cohorts: one start date, shared by a group.
 *
 * Everything a schedule needs derives from that single date — which module
 * opens when, who is behind, when to warn them — which is what makes a cohort
 * the highest-leverage structure a single author can run. Abdullah sets a day;
 * the job scheduler does the rest for twelve weeks.
 *
 * The "behind" flag is the one piece of judgement in here, and it is
 * deliberately generous: a member is behind only when the schedule has opened
 * materially more than they have finished. Flagging somebody who is one lesson
 * short of a Tuesday deadline produces a roster where everybody is red, which
 * is the same as a roster where nobody is.
 */

const requireDb = (env: Env) => {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database');
  return db;
};

/** How far ahead of a member the schedule may be before they count as behind. */
const BEHIND_SLACK = 15;

const COHORT_COLUMNS = sql`
  co.id, co.course_id, co.slug, co.name, co.starts_on, co.ends_on,
  co.capacity, co.is_open, co.created_at, c.title as course_title,
  (select count(*)::int from cohort_members cm where cm.cohort_id = co.id) as member_count
`;

type Row = {
  id: string; course_id: string; course_title: string; slug: string; name: string;
  starts_on: string; ends_on: string | null; capacity: number | null;
  is_open: boolean; created_at: string; member_count: number; average_progress: number | null;
};

const toCohort = (r: Row): Cohort => ({
  id: r.id,
  courseId: r.course_id,
  courseTitle: r.course_title,
  slug: r.slug,
  name: r.name,
  startsOn: String(r.starts_on).slice(0, 10),
  endsOn: r.ends_on ? String(r.ends_on).slice(0, 10) : null,
  capacity: r.capacity,
  isOpen: r.is_open,
  memberCount: Number(r.member_count) || 0,
  averageProgress: Math.round(Number(r.average_progress ?? 0)),
  createdAt: new Date(r.created_at).toISOString(),
});

/** Mean completion across a cohort, in one statement rather than per member. */
const AVERAGE_PROGRESS = sql`
  coalesce((
    select avg(per.pct)
    from (
      select
        case when t.total = 0 then 0 else (t.done::numeric / t.total) * 100 end as pct
      from cohort_members cm2
      cross join lateral (
        select
          count(*) filter (where lp.is_completed)::int as done,
          count(*)::int as total
        from lessons l
        join modules m on m.id = l.module_id
        left join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = cm2.user_id
        where m.course_id = co.course_id
      ) t
      where cm2.cohort_id = co.id
    ) per
  ), 0)
`;

export async function listCohorts(env: Env, userId: string): Promise<Cohort[]> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      select ${COHORT_COLUMNS}, ${AVERAGE_PROGRESS} as average_progress
      from cohorts co
      join courses c on c.id = co.course_id
      order by co.starts_on desc
      limit 100
    `);
    return rows.map(toCohort);
  });
}

export async function createCohort(env: Env, userId: string, input: CohortInput): Promise<Cohort> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      with inserted as (
        insert into cohorts (course_id, slug, name, starts_on, ends_on, capacity, is_open)
        values (
          ${input.courseId}::uuid, ${input.slug}, ${input.name},
          ${input.startsOn}::date, ${input.endsOn}::date,
          ${input.capacity}, ${input.isOpen}
        )
        returning *
      )
      select ${COHORT_COLUMNS}, 0 as average_progress
      from inserted co
      join courses c on c.id = co.course_id
    `);
    const row = rows[0];
    if (!row) throw new HttpError(500, 'Cohort was not created');
    return toCohort(row);
  });
}

export async function updateCohort(
  env: Env,
  userId: string,
  id: string,
  input: CohortInput,
): Promise<Cohort> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      with updated as (
        update cohorts set
          slug      = ${input.slug},
          name      = ${input.name},
          starts_on = ${input.startsOn}::date,
          ends_on   = ${input.endsOn}::date,
          capacity  = ${input.capacity},
          is_open   = ${input.isOpen}
        where id = ${id}::uuid
        returning *
      )
      select ${COHORT_COLUMNS}, ${AVERAGE_PROGRESS} as average_progress
      from updated co
      join courses c on c.id = co.course_id
    `);
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Cohort not found');
    return toCohort(row);
  });
}

export async function getCohort(env: Env, userId: string, id: string): Promise<CohortDetail> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      select ${COHORT_COLUMNS}, ${AVERAGE_PROGRESS} as average_progress
      from cohorts co
      join courses c on c.id = co.course_id
      where co.id = ${id}::uuid
    `);
    const head = rows[0];
    if (!head) throw new HttpError(404, 'Cohort not found');

    const members = await tx.execute<{
      user_id: string; full_name: string; email: string | null; joined_at: string;
      done: number; total: number; last_at: string | null; expected: number;
    }>(sql`
      select
        u.id as user_id, u.full_name, u.email, cm.joined_at,
        t.done, t.total, t.last_at,
        -- How many lessons the schedule has opened by today, which is what
        -- "behind" is measured against rather than a flat percentage.
        (
          select count(*)::int
          from lessons l
          join modules m on m.id = l.module_id
          where m.course_id = co.course_id
            and coalesce(public.module_unlock_at(m.id, u.id), now()) <= now()
        ) as expected
      from cohort_members cm
      join cohorts co on co.id = cm.cohort_id
      join users u on u.id = cm.user_id
      cross join lateral (
        select
          count(*) filter (where lp.is_completed)::int as done,
          count(*)::int as total,
          max(lp.updated_at) as last_at
        from lessons l
        join modules m on m.id = l.module_id
        left join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = u.id
        where m.course_id = co.course_id
      ) t
      where cm.cohort_id = ${id}::uuid
      order by t.done asc, u.full_name asc
    `);

    const schedule = await tx.execute<{
      module_id: string; title: string; opens_on: string | null; lesson_count: number;
    }>(sql`
      select
        m.id as module_id,
        m.title,
        -- The timetable is the cohort's own, not any one member's: computed
        -- from its start date so it reads the same for everybody in it.
        case
          when m.drip_days is null and m.available_from is null then null
          else greatest(
            coalesce(m.available_from, '-infinity'::timestamptz),
            (select co.starts_on::timestamptz from cohorts co where co.id = ${id}::uuid)
              + (coalesce(m.drip_days, 0) || ' days')::interval
          )
        end as opens_on,
        (select count(*)::int from lessons l where l.module_id = m.id) as lesson_count
      from modules m
      where m.course_id = ${head.course_id}::uuid
      order by m.rank asc
    `);

    return {
      ...toCohort(head),
      members: members.map((m): CohortMember => {
        const done = Number(m.done) || 0;
        const total = Number(m.total) || 0;
        const expected = Number(m.expected) || 0;
        return {
          userId: m.user_id,
          fullName: m.full_name,
          initials: m.full_name.split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase(),
          email: m.email,
          joinedAt: new Date(m.joined_at).toISOString(),
          progress: total === 0 ? 0 : Math.round((done / total) * 100),
          lessonsDone: done,
          lessonsTotal: total,
          lastActivityAt: m.last_at ? new Date(m.last_at).toISOString() : null,
          behind: expected - done > Math.max(2, Math.round((expected * BEHIND_SLACK) / 100)),
        };
      }),
      schedule: schedule.map((s) => ({
        moduleId: s.module_id,
        title: s.title,
        opensOn: s.opens_on ? String(s.opens_on).slice(0, 10) : null,
        lessonCount: Number(s.lesson_count) || 0,
      })),
    };
  });
}

/**
 * Adding somebody to a cohort, which also enrols them.
 *
 * Both halves, because a cohort member who is not enrolled has a schedule for
 * a course they cannot open — a state with no useful meaning that would show
 * up later as a support message rather than an error.
 */
export async function addCohortMembers(
  env: Env,
  userId: string,
  cohortId: string,
  userIds: string[],
): Promise<{ added: number; skipped: number }> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const [cohort] = await tx.execute<{ course_id: string; capacity: number | null; taken: number; is_open: boolean }>(
      sql`
        select co.course_id, co.capacity, co.is_open,
               (select count(*)::int from cohort_members cm where cm.cohort_id = co.id) as taken
        from cohorts co where co.id = ${cohortId}::uuid
      `,
    );
    if (!cohort) throw new HttpError(404, 'Cohort not found');
    if (!cohort.is_open) throw new HttpError(409, 'That cohort is closed', 'Reopen it before adding members.');

    const room = cohort.capacity === null ? userIds.length : cohort.capacity - Number(cohort.taken);
    if (room <= 0) throw new HttpError(409, 'That cohort is full');
    const take = userIds.slice(0, room);

    // An array unnested into rows. `values (a, b)` would be one row of two
    // columns, which is a different and silently wrong query.
    const ids = sql`unnest(array[${sql.join(take.map((u) => sql`${u}`), sql`, `)}]::uuid[])`;

    // Enrol first. A member already enrolled keeps their original enrolment
    // date, which is right: the cohort start overrides it for drip anyway.
    await tx.execute(sql`
      insert into enrollments (user_id, course_id)
      select id, ${cohort.course_id}::uuid from (select ${ids} as id) as v
      on conflict (user_id, course_id) do nothing
    `);

    const inserted = await tx.execute<{ user_id: string }>(sql`
      insert into cohort_members (cohort_id, user_id, course_id)
      select ${cohortId}::uuid, id, ${cohort.course_id}::uuid from (select ${ids} as id) as v
      -- Already in this cohort, or already in a different one for the same
      -- course. Either way it is a no-op, not an error: an admin adding a
      -- pasted list should not have it rejected wholesale over one duplicate.
      on conflict do nothing
      returning user_id
    `);

    await tx.execute(sql`
      insert into audit_log (actor_id, action, target_type, target_id, meta)
      values (${userId}::uuid, 'cohort.members_added', 'cohort', ${cohortId}::uuid,
              ${JSON.stringify({ requested: userIds.length, added: inserted.length })}::jsonb)
    `);

    return { added: inserted.length, skipped: userIds.length - inserted.length };
  });
}

export async function removeCohortMember(
  env: Env,
  userId: string,
  cohortId: string,
  memberId: string,
): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    // The enrolment stays. Taking somebody off a schedule should not delete
    // the progress they made on it.
    await tx.execute(sql`
      delete from cohort_members where cohort_id = ${cohortId}::uuid and user_id = ${memberId}::uuid
    `);
    await tx.execute(sql`
      insert into audit_log (actor_id, action, target_type, target_id, meta)
      values (${userId}::uuid, 'cohort.member_removed', 'cohort', ${cohortId}::uuid,
              ${JSON.stringify({ userId: memberId })}::jsonb)
    `);
  });
}

export async function deleteCohort(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const [used] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from cohort_members where cohort_id = ${id}::uuid`,
    );
    // Deleting a cohort with people in it silently moves every one of them
    // back onto enrolment-based drip, which would reshuffle their schedule
    // without telling them. Empty it first, deliberately.
    if (Number(used?.n ?? 0) > 0) {
      throw new HttpError(409, 'That cohort still has members', 'Remove them first, or close it instead.');
    }
    await tx.execute(sql`delete from cohorts where id = ${id}::uuid`);
  });
}
