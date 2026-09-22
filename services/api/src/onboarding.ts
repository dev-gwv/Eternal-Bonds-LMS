import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type { Onboarding, OnboardingStep } from '@ipc/contracts';
import type { Env } from './env.ts';
import { getDb } from './repo.ts';

/**
 * The first week.
 *
 * `users.onboarding_completed_at` has existed since the first migration and
 * nothing has ever read or written it — which is the whole problem in one
 * column. A member arrives, lands on a dashboard of charts about a course they
 * have not started, and is given no first move. The live platform's numbers
 * say what happens next: 849 members, zero active in the last seven days.
 *
 * Every step here is **derived**, not tracked. There is no onboarding_progress
 * table, no event to emit, nothing to keep in sync and nothing to backfill:
 * the questions are "have you posted an introduction" and "have you opened a
 * lesson", and the posts and lesson_progress tables already know. A tracking
 * table would only be a second, worse copy of an answer the database already
 * has — and it would be the copy that goes stale.
 *
 * The order is deliberate and it is not arbitrary: profile, then introduction,
 * then a lesson, then a path, then a session. It moves from the cheapest act
 * to the most committing, and the second step is a *social* one on purpose —
 * a member who has been replied to in their first week behaves differently
 * from one who has only watched videos.
 */

type StepDef = {
  key: OnboardingStep['key'];
  title: string;
  hint: string;
  href: string;
  cta: string;
  /** A boolean expression over the member's own rows. */
  done: ReturnType<typeof sql>;
};

const STEPS = (userId: string): StepDef[] => [
  {
    key: 'profile',
    title: 'Say who you are',
    hint: 'A city and a face. Members reply to people, not to avatars with initials.',
    href: '/account',
    cta: 'Fill in your profile',
    done: sql`exists (
      select 1 from users u
      where u.id = ${userId}::uuid and u.city is not null and u.avatar_url is not null
    )`,
  },
  {
    key: 'introduce',
    title: 'Introduce yourself',
    hint: 'Where you shoot and what you are working on. Two lines is enough.',
    href: '/community?channel=introductions',
    cta: 'Post an introduction',
    done: sql`exists (
      select 1 from posts p
      join channels c on c.id = p.channel_id
      where p.author_id = ${userId}::uuid and c.slug = 'introductions'
    )`,
  },
  {
    key: 'first_lesson',
    title: 'Watch one lesson',
    hint: 'Any lesson, any course. The first one is the only hard one.',
    href: '/journeys',
    cta: 'Open a lesson',
    done: sql`exists (select 1 from lesson_progress lp where lp.user_id = ${userId}::uuid)`,
  },
  {
    key: 'journey',
    title: 'Pick a path',
    hint: 'A journey is a named outcome with the courses behind it in order.',
    href: '/journeys',
    cta: 'Choose a journey',
    done: sql`exists (
      select 1 from enrollments e
      join journey_steps js on js.course_id = e.course_id
      where e.user_id = ${userId}::uuid
    )`,
  },
  {
    key: 'session',
    title: 'Come to a live session',
    hint: 'The weekly Think Tank. RSVP and the join link appears on the day.',
    href: '/events',
    cta: 'See what is on',
    done: sql`exists (select 1 from event_rsvps r where r.user_id = ${userId}::uuid)`,
  },
];

export async function getOnboarding(env: Env, userId: string | null): Promise<Onboarding> {
  const db = getDb(env);
  const defs = STEPS(userId ?? '00000000-0000-0000-0000-000000000000');
  const empty = defs.map((d) => ({ ...d, done: false }));

  if (!db || !userId) {
    return {
      steps: empty.map(({ key, title, hint, href, cta }) => ({ key, title, hint, href, cta, done: false })),
      done: 0,
      total: defs.length,
      completedAt: null,
      dismissed: false,
    };
  }

  return withUser(db, userId, async (tx) => {
    // One round trip for all five. Five exists() subqueries in one select is
    // cheaper than five statements, and it cannot half-answer.
    const [row] = await tx.execute<Record<string, boolean | string | null>>(sql`
      select
        ${sql.join(
          defs.map((d) => sql`${d.done} as ${sql.raw(d.key)}`),
          sql`, `,
        )},
        (select u.onboarding_completed_at from users u where u.id = ${userId}::uuid) as completed_at
    `);

    const steps: OnboardingStep[] = defs.map((d) => ({
      key: d.key,
      title: d.title,
      hint: d.hint,
      href: d.href,
      cta: d.cta,
      done: Boolean(row?.[d.key]),
    }));

    const done = steps.filter((s) => s.done).length;
    const completedAt = (row?.completed_at as string | null) ?? null;

    // Stamp it the first time everything is done. A write inside a read is not
    // free, but it happens once per member in their lifetime, and the
    // alternative is a job that scans every member hourly to notice something
    // this query already knows.
    if (done === steps.length && !completedAt) {
      await tx.execute(sql`
        update users set onboarding_completed_at = now()
        where id = ${userId}::uuid and onboarding_completed_at is null
      `);
      return { steps, done, total: steps.length, completedAt: new Date().toISOString(), dismissed: false };
    }

    return { steps, done, total: steps.length, completedAt, dismissed: false };
  });
}
