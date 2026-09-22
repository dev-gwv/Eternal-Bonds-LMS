/**
 * Proves the completion-nudge job sends the right message once and then stops.
 *
 *   bun run db:test-nudges
 *
 * A nudge job is dangerous in a way most jobs are not: its failure mode is
 * mailing hundreds of paying members the same reminder every hour. So the
 * checks that matter here are the negative ones — run it twice, run it for
 * somebody already nudged, run it for somebody who finished — and each must
 * produce nothing.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import { sendLearningNudges } from '../services/worker/src/jobs/learning.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const db = createDb(url, { max: 1 });

const stalled = crypto.randomUUID();
const fresh = crypto.randomUUID();
const finished = crypto.randomUUID();
const never = crypto.randomUUID();
const everyone = [stalled, fresh, finished, never];
const stamp = Date.now();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function createMember(id: string, email: string) {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: email.split('@')[0] })}::jsonb)
  `);
  await db.execute(sql`
    insert into public.memberships (user_id, tier, status, source) values (${id}, 'diamond', 'active', 'test')
  `);
}

const nudgesFor = async (id: string) =>
  (
    await db.execute<{ n: number }>(
      sql`select count(*)::int as n from notifications where user_id = ${id} and kind = 'learning.nudge'`,
    )
  )[0]!.n;

let courseId = '';
let lessonId = '';

try {
  console.log('\nSetup');
  for (const [i, id] of everyone.entries()) await createMember(id, `nudge-${i}-${stamp}@example.test`);

  const [course] = await db.execute<{ id: string }>(sql`
    insert into courses (slug, title, summary_md, category, level, min_tier, is_published)
    values (${`nudge-test-${stamp}`}, 'Nudge Test Course', 'A course for the nudge suite', 'general', 'beginner', 'free', true)
    returning id
  `);
  courseId = course!.id;
  const [mod] = await db.execute<{ id: string }>(sql`
    insert into modules (course_id, title, rank) values (${courseId}, 'Module one', 1) returning id
  `);
  const [lesson] = await db.execute<{ id: string }>(sql`
    insert into lessons (module_id, slug, title, rank, duration_seconds)
    values (${mod!.id}, ${`nudge-lesson-${stamp}`}, 'Framing the shot', 1, 480)
    returning id
  `);
  lessonId = lesson!.id;
  check('a published course with a lesson exists', Boolean(courseId && lessonId));

  // Stalled: started, last touched a fortnight ago.
  await db.execute(sql`
    insert into enrollments (user_id, course_id, enrolled_at, last_lesson_id)
    values (${stalled}, ${courseId}, now() - interval '30 days', ${lessonId})
  `);
  await db.execute(sql`
    insert into lesson_progress (user_id, lesson_id, watch_seconds, is_completed, updated_at)
    values (${stalled}, ${lessonId}, 200, false, now() - interval '14 days')
  `);

  // Fresh: started yesterday. Must not be touched.
  await db.execute(sql`
    insert into enrollments (user_id, course_id, enrolled_at, last_lesson_id)
    values (${fresh}, ${courseId}, now() - interval '30 days', ${lessonId})
  `);
  await db.execute(sql`
    insert into lesson_progress (user_id, lesson_id, watch_seconds, is_completed, updated_at)
    values (${fresh}, ${lessonId}, 200, false, now() - interval '1 day')
  `);

  // Finished: quiet for months, but done. Must never be nudged.
  await db.execute(sql`
    insert into enrollments (user_id, course_id, enrolled_at, completed_at, last_lesson_id)
    values (${finished}, ${courseId}, now() - interval '90 days', now() - interval '60 days', ${lessonId})
  `);

  // Never started: enrolled a fortnight ago, no progress row at all.
  await db.execute(sql`
    insert into enrollments (user_id, course_id, enrolled_at)
    values (${never}, ${courseId}, now() - interval '14 days')
  `);

  console.log('\nFirst run');
  const first = await sendLearningNudges(db);
  check('it sent something', first.sent > 0, `sent=${first.sent}`);
  check('the stalled member was nudged', (await nudgesFor(stalled)) === 1);
  check('the never-started member was nudged', (await nudgesFor(never)) === 1);
  check('the member who is still active was left alone', (await nudgesFor(fresh)) === 0);
  check('the member who finished was left alone', (await nudgesFor(finished)) === 0);

  const [text] = await db.execute<{ title: string; body: string; link: string }>(sql`
    select title, body, link from notifications where user_id = ${stalled} and kind = 'learning.nudge'
  `);
  check('the message names the course', text!.title.includes('Nudge Test Course'), text!.title);
  check('and the lesson they stopped on', text!.body.includes('Framing the shot'), text!.body);
  check('and links at the resume route, which is a real one', text!.link.startsWith('/courses/'), text!.link);

  console.log('\nRunning it again — the part that matters');
  const second = await sendLearningNudges(db);
  check('a second run sends nothing', second.sent === 0, `sent=${second.sent}`);
  check('and the stalled member still has exactly one', (await nudgesFor(stalled)) === 1);

  const third = await sendLearningNudges(db);
  check('nor does a third', third.sent === 0, `sent=${third.sent}`);

  console.log('\nThe five-day floor');
  // Age the stage-1 ledger row past its stage but keep it inside the floor,
  // then check the member is still left alone.
  await db.execute(sql`
    update learning_nudges set sent_at = now() - interval '2 days' where user_id = ${stalled}
  `);
  await db.execute(sql`
    update lesson_progress set updated_at = now() - interval '40 days'
    where user_id = ${stalled} and lesson_id = ${lessonId}
  `);
  const inFloor = await sendLearningNudges(db);
  check('a member nudged two days ago is not nudged again', inFloor.sent === 0, `sent=${inFloor.sent}`);

  // Now push the last send outside the floor. Stage 2 becomes due.
  await db.execute(sql`
    update learning_nudges set sent_at = now() - interval '9 days' where user_id = ${stalled}
  `);
  const nextStage = await sendLearningNudges(db);
  check('once past the floor the next stage fires', nextStage.sent > 0, `sent=${nextStage.sent}`);

  const [stages] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from learning_nudges where user_id = ${stalled}`,
  );
  check('and it is recorded as a separate stage', stages!.n === 2, `stages=${stages!.n}`);

  const [after] = await db.execute<{ title: string }>(sql`
    select title from notifications where user_id = ${stalled} and kind = 'learning.nudge'
  `);
  check('the member still has one notification, not two', (await nudgesFor(stalled)) === 1, after!.title);

  console.log('\nPreferences');
  await db.execute(sql`update notification_prefs set in_app = false where user_id = ${never}`);
  await db.execute(sql`delete from learning_nudges where user_id = ${never}`);
  await db.execute(sql`delete from notifications where user_id = ${never}`);
  const muted = await sendLearningNudges(db);
  check('a member with in-app off is never nudged', (await nudgesFor(never)) === 0, `sent=${muted.sent}`);
} finally {
  console.log('\nCleanup');
  await db.execute(sql`delete from courses where id = ${courseId || null}`);
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nAll nudge checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
