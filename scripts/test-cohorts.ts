/**
 * Proves cohorts, drip and the two scheduled messages, against the real
 * database.
 *
 *   bun run db:test-cohorts
 *
 * The check that matters most is the gate: a locked lesson must be refused by
 * the API, not merely greyed out in the syllabus. Everything else here is
 * schedule arithmetic, which is easy to get subtly wrong and impossible to
 * notice by looking at a page.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import { getCourseDetail, getPlaybackTicket } from '../services/api/src/lessons.ts';
import * as cohorts from '../services/api/src/cohorts.ts';
import { announceUnlocks, warnCohortDeadlines } from '../services/worker/src/jobs/learning.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const env = EnvSchema.parse({ DATABASE_URL: url });
const db = createDb(url, { max: 1 });

const admin = crypto.randomUUID();
const early = crypto.randomUUID();
const behind = crypto.randomUUID();
const everyone = [admin, early, behind];
const stamp = Date.now();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function refused(label: string, fn: () => Promise<unknown>, expect: number) {
  try {
    await fn();
    check(label, false, 'it was allowed');
  } catch (error) {
    const status = (error as { status?: number }).status;
    check(label, status === expect, `status ${status ?? '?'}, wanted ${expect}`);
  }
}

async function createMember(id: string, email: string, role = 'member') {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: email.split('@')[0] })}::jsonb)
  `);
  await db.execute(sql`
    insert into public.memberships (user_id, tier, status, source) values (${id}, 'diamond', 'active', 'test')
  `);
  if (role !== 'member') await db.execute(sql`update public.users set role = ${role} where id = ${id}`);
}

let courseId = '';
let courseSlug = '';
let openLesson = '';
let lockedLesson = '';
let cohortId = '';

try {
  console.log('\nSetup');
  await createMember(admin, `cohort-admin-${stamp}@example.test`, 'admin');
  await createMember(early, `cohort-early-${stamp}@example.test`);
  await createMember(behind, `cohort-behind-${stamp}@example.test`);

  courseSlug = `cohort-test-${stamp}`;
  const [course] = await db.execute<{ id: string }>(sql`
    insert into courses (slug, title, summary_md, category, level, min_tier, is_published)
    values (${courseSlug}, 'Cohort Test Course', 'For the cohort suite', 'general', 'beginner', 'free', true)
    returning id
  `);
  courseId = course!.id;

  // Week one opens immediately; week two on day 7.
  const [m1] = await db.execute<{ id: string }>(sql`
    insert into modules (course_id, title, rank, drip_days) values (${courseId}, 'Week one', 1, null) returning id
  `);
  const [m2] = await db.execute<{ id: string }>(sql`
    insert into modules (course_id, title, rank, drip_days) values (${courseId}, 'Week two', 2, 7) returning id
  `);
  const [l1] = await db.execute<{ id: string }>(sql`
    insert into lessons (module_id, slug, title, rank, duration_seconds, video_status, video_asset_id)
    values (${m1!.id}, ${`open-${stamp}`}, 'Lesson one', 1, 600, 'ready', 'test-asset')
    returning id
  `);
  const [l2] = await db.execute<{ id: string }>(sql`
    insert into lessons (module_id, slug, title, rank, duration_seconds, video_status, video_asset_id)
    values (${m2!.id}, ${`locked-${stamp}`}, 'Lesson two', 1, 600, 'ready', 'test-asset')
    returning id
  `);
  openLesson = l1!.id;
  lockedLesson = l2!.id;

  // Six more in week one. A two-lesson course can never trip the "behind"
  // threshold, which has a floor of two lessons on purpose — so a fixture that
  // small would test the arithmetic against a case that cannot occur in a real
  // course of 30-odd lectures.
  for (let i = 2; i <= 7; i += 1) {
    await db.execute(sql`
      insert into lessons (module_id, slug, title, rank, duration_seconds, video_status, video_asset_id)
      values (${m1!.id}, ${`open-${stamp}-${i}`}, ${`Lesson ${i}`}, ${i}, 600, 'ready', 'test-asset')
    `);
  }
  check('a two-module course exists, one of them dripped', Boolean(openLesson && lockedLesson));

  console.log('\nCreating the cohort');
  const created = await cohorts.createCohort(env, admin, {
    courseId,
    slug: `cohort-${stamp}`,
    name: 'January group',
    // Started three days ago, so week one is open and week two is not.
    startsOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
    endsOn: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
    capacity: 2,
    isOpen: true,
  });
  cohortId = created.id;
  check('the cohort was created', Boolean(cohortId), created.name);

  const added = await cohorts.addCohortMembers(env, admin, cohortId, [early, behind]);
  check('both members were added', added.added === 2, `added=${added.added}`);

  const [enrolled] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from enrollments where course_id = ${courseId}
  `);
  check('and adding them enrolled them too', Number(enrolled!.n) === 2, `enrolled=${enrolled!.n}`);

  // Capacity of two is now full.
  const spare = crypto.randomUUID();
  await createMember(spare, `cohort-spare-${stamp}@example.test`);
  everyone.push(spare);
  await refused('a third member is refused when the cohort is full', () =>
    cohorts.addCohortMembers(env, admin, cohortId, [spare]), 409);

  console.log('\nThe drip');
  const detail = await getCourseDetail(env, early, courseSlug);
  const weekOne = detail.modules.find((m) => m.title === 'Week one');
  const weekTwo = detail.modules.find((m) => m.title === 'Week two');
  check('week one is open', weekOne?.unlocksAt === null && weekOne?.lessons[0]?.locked === false);
  check('week two is not', weekTwo?.unlocksAt !== null && weekTwo?.lessons[0]?.locked === true, String(weekTwo?.unlocksAt));

  // Four days from a start three days ago.
  const opensIn = weekTwo?.unlocksAt ? (Date.parse(weekTwo.unlocksAt) - Date.now()) / 86_400_000 : NaN;
  check('and it opens four days from now', opensIn > 3.5 && opensIn < 4.5, `${opensIn.toFixed(1)} days`);

  console.log('\nThe gate, which is the part that has to hold');
  await refused('playing a locked lesson is refused', () => getPlaybackTicket(env, early, lockedLesson), 403);

  // An open lesson still fails for a different reason in this environment (no
  // video provider configured), so assert the *absence* of the drip refusal
  // rather than a success it cannot have.
  let openStatus = 0;
  try {
    await getPlaybackTicket(env, early, openLesson);
  } catch (error) {
    openStatus = (error as { status?: number }).status ?? 0;
  }
  check('an open lesson is not refused by the drip', openStatus !== 403, `status ${openStatus}`);

  console.log('\nThe unlock announcement');
  const quiet = await announceUnlocks(db);
  check('nothing is announced while week two is still shut', quiet.announced === 0, `announced=${quiet.announced}`);

  // Move the cohort back so week two opened an hour ago.
  await db.execute(sql`
    update cohorts set starts_on = current_date - 7 where id = ${cohortId}
  `);
  const announced = await announceUnlocks(db);
  check('once it opens, both members are told', announced.announced === 2, `announced=${announced.announced}`);

  const again = await announceUnlocks(db);
  check('and told exactly once', again.announced === 0, `announced=${again.announced}`);

  const [notice] = await db.execute<{ title: string; link: string }>(sql`
    select title, link from notifications where user_id = ${early} and kind = 'learning.unlocked'
  `);
  check('the message names the module', notice!.title.includes('Week two'), notice!.title);

  const openNow = await getCourseDetail(env, early, courseSlug);
  check(
    'and the lesson is now playable',
    openNow.modules.find((m) => m.title === 'Week two')?.lessons[0]?.locked === false,
  );

  console.log('\nThe deadline warning');
  // One member finishes everything; the other does nothing.
  await db.execute(sql`
    insert into lesson_progress (user_id, lesson_id, is_completed, watch_seconds, completed_at, updated_at)
    select ${early}, id, true, 600, now(), now() from lessons
    where module_id in (select id from modules where course_id = ${courseId})
  `);
  await db.execute(sql`update cohorts set ends_on = current_date + 3 where id = ${cohortId}`);

  const warned = await warnCohortDeadlines(db);
  check('the member who is behind is warned', warned.warned === 1, `warned=${warned.warned}`);
  const [caughtUp] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from notifications where user_id = ${early} and kind = 'cohort.deadline'
  `);
  check('the member who finished is not', Number(caughtUp!.n) === 0);

  const warnedAgain = await warnCohortDeadlines(db);
  check('and nobody is warned twice', warnedAgain.warned === 0, `warned=${warnedAgain.warned}`);

  console.log('\nThe roster');
  const roster = await cohorts.getCohort(env, admin, cohortId);
  check('the roster lists both members', roster.members.length === 2, `${roster.members.length}`);
  check('it flags the one who is behind', roster.members.filter((m) => m.behind).length === 1);
  check('it does not flag the one who finished', roster.members.find((m) => m.progress === 100)?.behind === false);
  check('the schedule has both modules', roster.schedule.length === 2);
  check(
    'and the behind member is short the lessons the schedule opened',
    (roster.members.find((m) => m.behind)?.lessonsDone ?? -1) === 0,
  );
  check('with a date on the dripped one', Boolean(roster.schedule.find((s) => s.title === 'Week two')?.opensOn));

  console.log('\nDeleting');
  await refused('a cohort with members cannot be deleted', () => cohorts.deleteCohort(env, admin, cohortId), 409);
  await cohorts.removeCohortMember(env, admin, cohortId, early);
  await cohorts.removeCohortMember(env, admin, cohortId, behind);
  const [stillEnrolled] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from enrollments where course_id = ${courseId}
  `);
  check('removing somebody keeps their enrolment', Number(stillEnrolled!.n) === 2, `enrolled=${stillEnrolled!.n}`);
  await cohorts.deleteCohort(env, admin, cohortId);
  check('an empty cohort deletes', true);
} finally {
  console.log('\nCleanup');
  await db.execute(sql`delete from cohorts where id = ${cohortId || null}`);
  await db.execute(sql`delete from courses where id = ${courseId || null}`);
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nAll cohort checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
