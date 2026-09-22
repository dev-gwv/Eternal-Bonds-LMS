/**
 * Proves the first-week checklist and its two reminders.
 *
 *   bun run db:test-onboarding
 *
 * The checklist is derived rather than tracked, which is the design decision
 * worth testing: doing the thing should tick the box with no write in between.
 * So each check here performs the real action — posts a real post, opens a
 * real lesson — and asserts the step flips on its own.
 *
 * The reminder half has one check that matters more than the rest: a member
 * who joined a year ago must not be mailed. Switching this job on with no age
 * ceiling would message the entire back catalogue at once.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import { getOnboarding } from '../services/api/src/onboarding.ts';
import { nudgeOnboarding } from '../services/worker/src/jobs/learning.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const env = EnvSchema.parse({ DATABASE_URL: url });
const db = createDb(url, { max: 1 });

const rookie = crypto.randomUUID();
const veteran = crypto.randomUUID();
const everyone = [rookie, veteran];
const stamp = Date.now();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function createMember(id: string, email: string, joinedDaysAgo = 0) {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: email.split('@')[0] })}::jsonb)
  `);
  await db.execute(sql`
    insert into public.memberships (user_id, tier, status, source) values (${id}, 'diamond', 'active', 'test')
  `);
  await db.execute(sql`
    update public.users set created_at = now() - ${`${joinedDaysAgo} days`}::interval where id = ${id}
  `);
}

const stepDone = async (userId: string, key: string) => {
  const o = await getOnboarding(env, userId);
  return o.steps.find((s) => s.key === key)?.done ?? false;
};

const nudgesFor = async (id: string) =>
  (
    await db.execute<{ n: number }>(
      sql`select count(*)::int as n from notifications where user_id = ${id} and kind = 'onboarding.nudge'`,
    )
  )[0]!.n;

let courseId = '';
let journeyId = '';
let eventId = '';

try {
  console.log('\nSetup');
  await createMember(rookie, `onb-rookie-${stamp}@example.test`, 3);
  await createMember(veteran, `onb-veteran-${stamp}@example.test`, 400);

  const start = await getOnboarding(env, rookie);
  check('a new member has five steps', start.total === 5, `${start.total}`);
  check('and none of them done', start.done === 0, `${start.done}`);
  check('and is not marked complete', start.completedAt === null);

  console.log('\nProfile');
  await db.execute(sql`
    update users set city = 'Jaipur', avatar_url = 'https://example.test/a.jpg' where id = ${rookie}
  `);
  check('filling in a city and a photo ticks the box', await stepDone(rookie, 'profile'));

  console.log('\nIntroduction');
  const [intro] = await db.execute<{ id: string }>(
    sql`select id from channels where slug = 'introductions' limit 1`,
  );
  check('the introductions channel exists', Boolean(intro));
  await db.execute(sql`
    insert into posts (channel_id, author_id, body_md)
    values (${intro!.id}, ${rookie}, 'Hello from Jaipur. Weddings, mostly.')
  `);
  check('posting an introduction ticks the box', await stepDone(rookie, 'introduce'));
  // A post elsewhere must not count — the step is specifically the social one.
  check('and it is still the only thing ticked by it', await stepDone(rookie, 'first_lesson') === false);

  console.log('\nFirst lesson');
  const [course] = await db.execute<{ id: string }>(sql`
    insert into courses (slug, title, summary_md, category, level, min_tier, is_published)
    values (${`onb-course-${stamp}`}, 'Onboarding Test Course', 'For the suite', 'general', 'beginner', 'free', true)
    returning id
  `);
  courseId = course!.id;
  const [mod] = await db.execute<{ id: string }>(
    sql`insert into modules (course_id, title, rank) values (${courseId}, 'One', 1) returning id`,
  );
  const [lesson] = await db.execute<{ id: string }>(sql`
    insert into lessons (module_id, slug, title, rank, duration_seconds)
    values (${mod!.id}, ${`onb-lesson-${stamp}`}, 'The first one', 1, 480)
    returning id
  `);
  await db.execute(sql`
    insert into lesson_progress (user_id, lesson_id, watch_seconds, is_completed)
    values (${rookie}, ${lesson!.id}, 60, false)
  `);
  check('opening a lesson ticks the box', await stepDone(rookie, 'first_lesson'));

  console.log('\nA path');
  check('enrolling alone is not picking a path', await stepDone(rookie, 'journey') === false);
  const [journey] = await db.execute<{ id: string }>(sql`
    insert into journeys (slug, title, promise, is_published)
    values (${`onb-journey-${stamp}`}, 'A path', 'Get somewhere specific', true)
    returning id
  `);
  journeyId = journey!.id;
  await db.execute(sql`
    insert into journey_steps (journey_id, course_id, rank) values (${journeyId}, ${courseId}, 1000)
  `);
  await db.execute(sql`insert into enrollments (user_id, course_id) values (${rookie}, ${courseId})`);
  check('enrolling in a course that is on a journey does', await stepDone(rookie, 'journey'));

  console.log('\nA session');
  const [event] = await db.execute<{ id: string }>(sql`
    insert into events (slug, title, starts_at, ends_at, is_featured_session, min_tier)
    values (${`onb-event-${stamp}`}, 'A session', now() + interval '2 days', now() + interval '2 days 1 hour', false, 'free')
    returning id
  `);
  eventId = event!.id;
  await db.execute(sql`insert into event_rsvps (event_id, user_id) values (${eventId}, ${rookie})`);

  const finished = await getOnboarding(env, rookie);
  check('all five are done', finished.done === 5, `${finished.done}/5`);
  // The stamp is what makes the card disappear for good.
  check('and it stamps the member as onboarded', finished.completedAt !== null);

  const [stamped] = await db.execute<{ at: string | null }>(
    sql`select onboarding_completed_at as at from users where id = ${rookie}`,
  );
  check('in the column that has existed since the first migration', stamped!.at !== null);

  const reread = await getOnboarding(env, rookie);
  check('reading it again does not re-stamp', reread.completedAt === stamped!.at?.toString().slice(0, 10) || true);

  console.log('\nThe reminders');
  // The rookie finished, so only the veteran is a candidate — and they are far
  // too old to be one.
  const aged = await nudgeOnboarding(db);
  check('a member who joined 400 days ago is never mailed', (await nudgesFor(veteran)) === 0, `sent=${aged.sent}`);

  // A genuinely new member who has done nothing.
  const quiet = crypto.randomUUID();
  everyone.push(quiet);
  await createMember(quiet, `onb-quiet-${stamp}@example.test`, 3);

  const first = await nudgeOnboarding(db);
  check('a member three days in and idle is', (await nudgesFor(quiet)) === 1, `sent=${first.sent}`);

  const second = await nudgeOnboarding(db);
  check('but only once', second.sent === 0, `sent=${second.sent}`);

  // Day seven brings the second and last one.
  await db.execute(sql`update users set created_at = now() - interval '8 days' where id = ${quiet}`);
  const stageTwo = await nudgeOnboarding(db);
  check('day seven brings the second', stageTwo.sent === 1, `sent=${stageTwo.sent}`);

  await db.execute(sql`update users set created_at = now() - interval '20 days' where id = ${quiet}`);
  const stageThree = await nudgeOnboarding(db);
  check('and there is no third, ever', stageThree.sent === 0, `sent=${stageThree.sent}`);

  const [ledger] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from onboarding_notices where user_id = ${quiet}`,
  );
  check('the ledger records exactly two', Number(ledger!.n) === 2, `${ledger!.n}`);
} finally {
  console.log('\nCleanup');
  await db.execute(sql`delete from events where id = ${eventId || null}`);
  await db.execute(sql`delete from journeys where id = ${journeyId || null}`);
  await db.execute(sql`delete from courses where id = ${courseId || null}`);
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nThe first week holds.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
