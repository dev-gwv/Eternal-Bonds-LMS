import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { Journey, JourneyDetail, JourneyInput, JourneyStep, JourneyStepInput } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { getDb } from './repo.ts';

/**
 * Journeys: the ordered answer to "what do I do first?"
 *
 * Progress is weighted by lessons, not by step. A journey whose first course
 * is four lectures and whose second is sixty would otherwise read as 50% done
 * after an afternoon, which is a number that lies in the direction that hurts
 * most: it makes the remaining work look small and the eventual stall look
 * like the member's failure rather than the plan's.
 *
 * `reachable` is about tier, and it is reported rather than enforced. A locked
 * step still shows its title and its place in the sequence, because a member
 * who can see what Diamond contains is a member who might buy Diamond.
 */

const requireDb = (env: Env) => {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database');
  return db;
};

type Row = {
  id: string; slug: string; title: string; promise: string; description_md: string | null;
  min_tier: string; is_published: boolean;
  step_count: number; steps_done: number;
  lessons_total: number; lessons_done: number;
  next_slug: string | null; next_title: string | null;
  started_at: string | null; completed_at: string | null;
};

/**
 * One expression, used by both the list and the detail, so the number on a
 * card and the number on the page it opens can never disagree.
 */
const PROGRESS = (userId: string) => sql`
  cross join lateral (
    select
      count(*)::int as step_count,
      coalesce(sum(cat.lesson_count), 0)::int as lessons_total,
      coalesce(sum(prog.done), 0)::int as lessons_done,
      count(*) filter (where cat.lesson_count > 0 and prog.done >= cat.lesson_count)::int as steps_done
    from public.journey_step_catalogue(j.id) cat
    cross join lateral (
      select count(*) filter (where lp.is_completed)::int as done
      from lessons l
      join modules m on m.id = l.module_id
      left join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = ${userId}::uuid
      where m.course_id = cat.course_id
    ) prog
  ) agg
  -- The next step to open: first in order that is unfinished *and* reachable.
  -- Pointing a free member at a Diamond course is a worse answer than pointing
  -- them at the next one they can actually start.
  left join lateral (
    select cat.course_slug as slug, cat.course_title as title
    from public.journey_step_catalogue(j.id) cat
    cross join lateral (
      select count(*) filter (where lp.is_completed)::int as done
      from lessons l
      join modules m on m.id = l.module_id
      left join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = ${userId}::uuid
      where m.course_id = cat.course_id
    ) prog
    where (cat.lesson_count = 0 or prog.done < cat.lesson_count)
      and public.tier_allows(cat.min_tier)
    order by cat.rank asc
    limit 1
  ) nxt on true
  -- Left join, not a filter: the list is every journey, with the member's own
  -- one marked. Filtering here would hide the fifteen they have not picked,
  -- which is the entire point of the page.
  left join journey_members jm on jm.journey_id = j.id and jm.user_id = ${userId}::uuid
`;

const toJourney = (r: Row): Journey => {
  const total = Number(r.lessons_total) || 0;
  const done = Number(r.lessons_done) || 0;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    promise: r.promise,
    descriptionMd: r.description_md,
    minTier: r.min_tier as Journey['minTier'],
    isPublished: r.is_published,
    stepCount: Number(r.step_count) || 0,
    stepsDone: Number(r.steps_done) || 0,
    progress: total === 0 ? 0 : Math.round((done / total) * 100),
    nextCourseSlug: r.next_slug,
    nextCourseTitle: r.next_title,
    following: r.started_at !== null,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  };
};

export async function listJourneys(env: Env, userId: string | null): Promise<Journey[]> {
  const db = getDb(env);
  if (!db || !userId) return [];

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      select
        j.id, j.slug, j.title, j.promise, j.description_md, j.min_tier, j.is_published,
        agg.step_count, agg.steps_done, agg.lessons_total, agg.lessons_done,
        nxt.slug as next_slug, nxt.title as next_title,
        jm.started_at, jm.completed_at
      from journeys j
      ${PROGRESS(userId)}
      order by j.rank asc, j.created_at asc
    `);
    return rows.map(toJourney);
  });
}

export async function getJourney(env: Env, userId: string | null, slug: string): Promise<JourneyDetail> {
  const db = requireDb(env);
  if (!userId) throw new HttpError(401, 'Not authenticated');

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      select
        j.id, j.slug, j.title, j.promise, j.description_md, j.min_tier, j.is_published,
        agg.step_count, agg.steps_done, agg.lessons_total, agg.lessons_done,
        nxt.slug as next_slug, nxt.title as next_title,
        jm.started_at, jm.completed_at
      from journeys j
      ${PROGRESS(userId)}
      where j.slug = ${slug}
    `);
    const head = rows[0];
    if (!head) throw new HttpError(404, 'Journey not found');

    // Read through the catalogue function rather than joining `courses`
    // directly. A plain join is filtered by tier, which does not lock a
    // Diamond step for a free member — it deletes it, so the path reads
    // "2 courses" and their step numbers stop matching everybody else's.
    const steps = await tx.execute<{
      id: string; course_id: string; course_slug: string; course_title: string;
      min_tier: string; note: string | null; lesson_count: number; seconds: number;
      done: number; reachable: boolean;
    }>(sql`
      select
        cat.id, cat.course_id, cat.course_slug, cat.course_title, cat.min_tier, cat.note,
        cat.lesson_count, cat.seconds,
        prog.done,
        public.tier_allows(cat.min_tier) as reachable
      from public.journey_step_catalogue(${head.id}::uuid) cat
      cross join lateral (
        select count(*) filter (where lp.is_completed)::int as done
        from lessons l
        join modules m on m.id = l.module_id
        left join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = ${userId}::uuid
        where m.course_id = cat.course_id
      ) prog
      order by cat.rank asc
    `);

    return {
      ...toJourney(head),
      steps: steps.map((s): JourneyStep => {
        const total = Number(s.lesson_count) || 0;
        const done = Number(s.done) || 0;
        return {
          id: s.id,
          courseId: s.course_id,
          courseSlug: s.course_slug,
          courseTitle: s.course_title,
          note: s.note,
          lessonCount: total,
          durationMinutes: Math.round((Number(s.seconds) || 0) / 60),
          progress: total === 0 ? 0 : Math.round((done / total) * 100),
          completed: total > 0 && done >= total,
          reachable: Boolean(s.reachable),
        };
      }),
    };
  });
}

/* ── Authoring ─────────────────────────────────────────────────────────── */

export async function createJourney(env: Env, userId: string, input: JourneyInput): Promise<Journey> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      with inserted as (
        insert into journeys (slug, title, promise, description_md, min_tier, is_published)
        values (${input.slug}, ${input.title}, ${input.promise}, ${input.descriptionMd},
                ${input.minTier}::public.tier, ${input.isPublished})
        returning *
      )
      select
        j.id, j.slug, j.title, j.promise, j.description_md, j.min_tier, j.is_published,
        0 as step_count, 0 as steps_done, 0 as lessons_total, 0 as lessons_done,
        null::text as next_slug, null::text as next_title,
        null::timestamptz as started_at, null::timestamptz as completed_at
      from inserted j
    `);
    const row = rows[0];
    if (!row) throw new HttpError(500, 'Journey was not created');
    return toJourney(row);
  });
}

export async function updateJourney(
  env: Env,
  userId: string,
  id: string,
  input: JourneyInput,
): Promise<Journey> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<Row>(sql`
      with updated as (
        update journeys set
          slug = ${input.slug}, title = ${input.title}, promise = ${input.promise},
          description_md = ${input.descriptionMd}, min_tier = ${input.minTier}::public.tier,
          is_published = ${input.isPublished}, updated_at = now()
        where id = ${id}::uuid
        returning *
      )
      select
        j.id, j.slug, j.title, j.promise, j.description_md, j.min_tier, j.is_published,
        agg.step_count, agg.steps_done, agg.lessons_total, agg.lessons_done,
        nxt.slug as next_slug, nxt.title as next_title,
        jm.started_at, jm.completed_at
      from updated j
      ${PROGRESS(userId)}
    `);
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Journey not found');
    return toJourney(row);
  });
}

export async function deleteJourney(env: Env, userId: string, id: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    // Steps and memberships cascade; lesson progress does not live here, so a
    // member who was following this path keeps every lesson they finished and
    // simply stops being on a path. That is a safe delete in a way that
    // deleting a course is not.
    await tx.execute(sql`delete from journeys where id = ${id}::uuid`);
  });
}

export async function addStep(
  env: Env,
  userId: string,
  journeyId: string,
  input: JourneyStepInput,
): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    await tx.execute(sql`
      insert into journey_steps (journey_id, course_id, note, rank)
      values (
        ${journeyId}::uuid, ${input.courseId}::uuid, ${input.note},
        coalesce((select max(rank) from journey_steps where journey_id = ${journeyId}::uuid), 0) + 1000
      )
      -- Already in this journey. Adding it twice is always a mistake and
      -- would make "step 3 of 6" ambiguous, so it is quietly a no-op.
      on conflict (journey_id, course_id) do update set note = excluded.note
    `);
  });
}

export async function removeStep(env: Env, userId: string, stepId: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    await tx.execute(sql`delete from journey_steps where id = ${stepId}::uuid`);
  });
}

/** Reorder by rewriting ranks in the order given. */
export async function reorderSteps(
  env: Env,
  userId: string,
  journeyId: string,
  stepIds: string[],
): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    for (const [i, stepId] of stepIds.entries()) {
      await tx.execute(sql`
        update journey_steps set rank = ${String((i + 1) * 1000)}
        where id = ${stepId}::uuid and journey_id = ${journeyId}::uuid
      `);
    }
  });
}

/* ── Following ─────────────────────────────────────────────────────────── */

/**
 * Picking a path.
 *
 * "Pick a path" navigated and nothing else for as long as journeys have
 * existed, which meant the choice left no trace: no way to show a member the
 * one path that is theirs, no moment at which finishing it could be noticed,
 * and no way to answer whether journeys work at all.
 *
 * Idempotent, because the button is on a card people press twice, and because
 * re-picking a path you are already on should not reset the day you started
 * it — that date is the honest answer to "how long has this taken me".
 */
export async function followJourney(env: Env, userId: string, slug: string): Promise<Journey> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const done = await tx.execute<{ id: string }>(sql`
      insert into journey_members (user_id, journey_id)
      select ${userId}::uuid, j.id from journeys j where j.slug = ${slug}
      on conflict (user_id, journey_id) do nothing
      returning journey_id as id
    `);
    // Nothing inserted is either "already following" or "no such journey" —
    // and the insert policy makes an unpublished draft behave like the latter.
    // Only the second is an error, so check which it was.
    if (done.length === 0) {
      const [exists] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from journey_members jm
        join journeys j on j.id = jm.journey_id
        where jm.user_id = ${userId}::uuid and j.slug = ${slug}
      `);
      if (!exists || Number(exists.n) === 0) throw new HttpError(404, 'Journey not found');
    }
  });
  // Re-read rather than construct: the caller wants the card to update, and
  // that card carries progress numbers this function never computed.
  return getJourney(env, userId, slug);
}

/**
 * Dropping a path.
 *
 * Deliberately loses nothing. Lesson progress is not stored here, so a member
 * who unfollows and follows again a month later finds the same three courses
 * still ticked — which is what makes stepping off a path cheap enough to step
 * onto one in the first place.
 */
export async function unfollowJourney(env: Env, userId: string, slug: string): Promise<Journey> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    await tx.execute(sql`
      delete from journey_members jm
      using journeys j
      where j.id = jm.journey_id and j.slug = ${slug} and jm.user_id = ${userId}::uuid
    `);
  });
  return getJourney(env, userId, slug);
}
