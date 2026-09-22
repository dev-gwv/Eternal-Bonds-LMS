/**
 * Proves journey sequencing and, above all, its arithmetic.
 *
 *   bun run db:test-journeys
 *
 * Progress is weighted by lessons rather than by step, and that is the whole
 * reason this file exists. A journey whose first course is 2 lectures and
 * whose second is 20 would otherwise read 50% after an afternoon — a number
 * that lies in the direction that hurts most, making the remaining work look
 * small and the eventual stall look like the member's fault.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import * as journeys from '../services/api/src/journeys.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const env = EnvSchema.parse({ DATABASE_URL: url });
const db = createDb(url, { max: 1 });

const admin = crypto.randomUUID();
const member = crypto.randomUUID();
const freebie = crypto.randomUUID();
const everyone = [admin, member, freebie];
const stamp = Date.now();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function createMember(id: string, email: string, tier = 'diamond', role = 'member') {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: email.split('@')[0] })}::jsonb)
  `);
  await db.execute(sql`
    insert into public.memberships (user_id, tier, status, source)
    values (${id}, ${tier}::public.tier, 'active', 'test')
  `);
  if (role !== 'member') await db.execute(sql`update public.users set role = ${role} where id = ${id}`);
}

/** A course with `count` lessons, at a given tier. Returns its id. */
async function makeCourse(title: string, count: number, minTier = 'free') {
  const [c] = await db.execute<{ id: string }>(sql`
    insert into courses (slug, title, summary_md, category, level, min_tier, is_published)
    values (${`${title.toLowerCase().replace(/ /g, '-')}-${stamp}`}, ${title}, 'For the journey suite',
            'general', 'beginner', ${minTier}::public.tier, true)
    returning id
  `);
  const [m] = await db.execute<{ id: string }>(sql`
    insert into modules (course_id, title, rank) values (${c!.id}, 'Only module', 1) returning id
  `);
  for (let i = 1; i <= count; i += 1) {
    await db.execute(sql`
      insert into lessons (module_id, slug, title, rank, duration_seconds)
      values (${m!.id}, ${`${c!.id}-l${i}`}, ${`Lesson ${i}`}, ${i}, 600)
    `);
  }
  return c!.id;
}

const courseIds: string[] = [];
let journeyId = '';
let journeySlug = '';

try {
  console.log('\nSetup');
  await createMember(admin, `j-admin-${stamp}@example.test`, 'diamond', 'admin');
  await createMember(member, `j-member-${stamp}@example.test`);
  await createMember(freebie, `j-free-${stamp}@example.test`, 'free');

  // Deliberately lopsided: 2 lessons then 18. Weighting by step would make
  // finishing the short one read as 50%.
  const short = await makeCourse('Short Start', 2);
  const long = await makeCourse('The Long Middle', 18);
  const paid = await makeCourse('Diamond Only', 4, 'diamond');
  courseIds.push(short, long, paid);
  check('three courses exist, 2 / 18 / 4 lessons', courseIds.length === 3);

  console.log('\nBuilding the journey');
  journeySlug = `journey-${stamp}`;
  const created = await journeys.createJourney(env, admin, {
    slug: journeySlug,
    title: 'Zero to first paid shoot',
    promise: 'Book your first paid wedding within three months',
    descriptionMd: null,
    minTier: 'free',
    isPublished: true,
  });
  journeyId = created.id;
  check('the journey was created', Boolean(journeyId));
  check('and starts empty', created.stepCount === 0 && created.progress === 0);

  await journeys.addStep(env, admin, journeyId, { courseId: short, note: 'Start here.' });
  await journeys.addStep(env, admin, journeyId, { courseId: long, note: 'The real work.' });
  await journeys.addStep(env, admin, journeyId, { courseId: paid, note: 'For Diamond members.' });

  // Adding the same course again must not create a second step.
  await journeys.addStep(env, admin, journeyId, { courseId: short, note: 'Changed my mind about the note.' });

  const built = await journeys.getJourney(env, admin, journeySlug);
  check('it has three steps, not four', built.steps.length === 3, `${built.steps.length}`);
  check('and re-adding updated the note instead', built.steps[0]?.note === 'Changed my mind about the note.');
  check('in the order they were added', built.steps[1]?.courseTitle === 'The Long Middle');

  console.log('\nThe arithmetic, which is the point');
  const fresh = await journeys.getJourney(env, member, journeySlug);
  check('nothing started reads 0%', fresh.progress === 0, `${fresh.progress}%`);
  check('and points at the first course', fresh.nextCourseTitle === 'Short Start', String(fresh.nextCourseTitle));

  // Finish the 2-lesson course. 2 of 24 lessons = 8%, not 33%.
  await db.execute(sql`
    insert into lesson_progress (user_id, lesson_id, is_completed, watch_seconds, completed_at, updated_at)
    select ${member}, l.id, true, 600, now(), now()
    from lessons l join modules m on m.id = l.module_id
    where m.course_id = ${short}
  `);

  const afterShort = await journeys.getJourney(env, member, journeySlug);
  check('finishing the short course counts one step', afterShort.stepsDone === 1, `${afterShort.stepsDone}`);
  check(
    'but weights by lessons, not by step',
    afterShort.progress === 8,
    `${afterShort.progress}% — by step it would say 33%`,
  );
  check('and points at the next course', afterShort.nextCourseTitle === 'The Long Middle', String(afterShort.nextCourseTitle));
  check('the finished step is marked done', afterShort.steps[0]?.completed === true);
  check('the next one is not', afterShort.steps[1]?.completed === false);

  console.log('\nTier');
  check('a Diamond member can reach the paid step', afterShort.steps[2]?.reachable === true);
  const free = await journeys.getJourney(env, freebie, journeySlug);
  check('a free member cannot', free.steps[2]?.reachable === false);
  check('but still sees it in the path', free.steps.length === 3, `${free.steps.length}`);

  console.log('\nOrdering');
  const ids = built.steps.map((s) => s.id);
  await journeys.reorderSteps(env, admin, journeyId, [ids[1]!, ids[0]!, ids[2]!]);
  const reordered = await journeys.getJourney(env, admin, journeySlug);
  check('steps can be reordered', reordered.steps[0]?.courseTitle === 'The Long Middle', String(reordered.steps[0]?.courseTitle));

  console.log('\nPublishing');
  await journeys.updateJourney(env, admin, journeyId, {
    slug: journeySlug,
    title: 'Zero to first paid shoot',
    promise: 'Book your first paid wedding within three months',
    descriptionMd: null,
    minTier: 'free',
    isPublished: false,
  });
  const hidden = await journeys.listJourneys(env, member);
  check(
    'an unpublished journey disappears for members',
    !hidden.some((j) => j.slug === journeySlug),
    `${hidden.length} visible`,
  );
  const stillVisible = await journeys.listJourneys(env, admin);
  check('but an admin still sees it', stillVisible.some((j) => j.slug === journeySlug));

  console.log('\nRemoving a step');
  // Republish first: the section above deliberately hid it from members, and
  // the recount below is checked from a member's point of view.
  await journeys.updateJourney(env, admin, journeyId, {
    slug: journeySlug,
    title: 'Zero to first paid shoot',
    promise: 'Book your first paid wedding within three months',
    descriptionMd: null,
    minTier: 'free',
    isPublished: true,
  });
  await journeys.removeStep(env, admin, ids[2]!);
  const trimmed = await journeys.getJourney(env, admin, journeySlug);
  check('the step is gone', trimmed.steps.length === 2, `${trimmed.steps.length}`);
  // 2 of 20 now, because the 4-lesson course left with it.
  const recounted = await journeys.getJourney(env, member, journeySlug);
  check('and the percentage recounts against what is left', recounted.progress === 10, `${recounted.progress}%`);
} finally {
  console.log('\nCleanup');
  await db.execute(sql`delete from journeys where id = ${journeyId || null}`);
  if (courseIds.length) {
    await db.execute(sql`delete from courses where id in ${sql.raw(`('${courseIds.join("','")}')`)}`);
  }
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nAll journey checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
