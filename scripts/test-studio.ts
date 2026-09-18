/**
 * Proves the studio can actually author, and that a member cannot.
 *
 *   bun run db:test-studio
 *
 * It drives the same functions the API routes call, under the same RLS, so a
 * missing policy fails here rather than as an empty screen. Two accounts are
 * created and removed again — including on failure.
 */
import { sql } from 'drizzle-orm';
import { createDb } from '@ipc/db';
import * as studio from '../services/api/src/admin.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

// The studio functions take the parsed Env, exactly as a request handler does.
const env = EnvSchema.parse({ DATABASE_URL: url });
const db = createDb(url, { max: 1 });

const adminId = crypto.randomUUID();
const memberId = crypto.randomUUID();
const stamp = Date.now();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Asserts that a call is refused, whatever shape the refusal takes. */
async function refused(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, 'it was allowed');
  } catch (error) {
    check(label, true, error instanceof Error ? error.message.slice(0, 60) : '');
  }
}

async function createMember(id: string, email: string) {
  await db.execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, '', now(), now(), now(), '{}'::jsonb, ${JSON.stringify({ full_name: email.split('@')[0] })}::jsonb)
  `);
}

let courseId = '';

try {
  console.log('\nSetup');
  await createMember(adminId, `studio-admin-${stamp}@example.test`);
  await createMember(memberId, `studio-member-${stamp}@example.test`);
  await db.execute(sql`update public.users set role = 'admin' where id = ${adminId}`);
  check('one admin and one plain member exist', true);
  check('roleOf reports admin', (await studio.roleOf(env, adminId)) === 'admin');
  check('roleOf reports member', (await studio.roleOf(env, memberId)) === 'member');

  console.log('\nAuthoring');
  const course = await studio.createCourse(env, adminId, {
    slug: `studio-test-${stamp}`,
    title: 'Studio smoke test',
    category: 'business',
    level: 'beginner',
    language: 'hindi',
    minTier: 'diamond',
    summaryMd: null,
    isPublished: false,
  });
  courseId = course.id;
  check('an admin can create a course', Boolean(course.id));
  check('it starts as a draft', course.isPublished === false);

  const mod = await studio.createModule(env, adminId, courseId, { title: 'Module one' });
  check('an admin can add a module', Boolean(mod.id));

  const lessonA = await studio.createLesson(env, adminId, mod.id, {
    slug: 'lesson-a',
    title: 'Lesson A',
    durationSeconds: 300,
    isPreview: false,
    bodyMd: null,
  });
  const lessonB = await studio.createLesson(env, adminId, mod.id, {
    slug: 'lesson-b',
    title: 'Lesson B',
    durationSeconds: 600,
    isPreview: false,
    bodyMd: null,
  });
  check('an admin can add lessons', Boolean(lessonA.id && lessonB.id));
  check('a new lesson has no video', lessonA.videoStatus === 'none', lessonA.videoStatus);

  console.log('\nOrdering');
  await studio.reorder(env, adminId, 'lessons', mod.id, [lessonB.id, lessonA.id]);
  const reordered = await studio.getAdminCourse(env, adminId, courseId);
  check(
    'reordering moves Lesson B first',
    reordered.modules[0]?.lessons[0]?.id === lessonB.id,
    reordered.modules[0]?.lessons.map((l) => l.title).join(' → '),
  );
  await refused('reorder refuses ids from elsewhere', () =>
    studio.reorder(env, adminId, 'lessons', mod.id, [crypto.randomUUID()]),
  );

  console.log('\nPublishing');
  await refused('publishing is refused while lessons have no video', () =>
    studio.setCoursePublished(env, adminId, courseId, true),
  );

  // Pretend the uploads happened; this is the state attachVideo leaves behind.
  await db.execute(sql`
    update public.lessons set video_status = 'ready', video_asset_id = 'lessons/test/x.mp4'
    where module_id = ${mod.id}
  `);
  const published = await studio.setCoursePublished(env, adminId, courseId, true);
  check('it publishes once every lesson has one', published.isPublished === true);
  await refused('a published course cannot be deleted outright', () =>
    studio.deleteCourse(env, adminId, courseId),
  );

  console.log('\nRow Level Security');
  await refused('a plain member cannot create a course', () =>
    studio.createCourse(env, memberId, {
      slug: `sneaky-${stamp}`,
      title: 'Should never exist',
      category: 'business',
      level: 'beginner',
      language: 'hindi',
      minTier: 'free',
      summaryMd: null,
      isPublished: true,
    }),
  );
  await refused('a plain member cannot add a module', () =>
    studio.createModule(env, memberId, courseId, { title: 'Nope' }),
  );
  await refused('a plain member cannot rename a lesson', () =>
    studio.updateLesson(env, memberId, lessonA.id, { title: 'Hijacked' }),
  );

  const [stillNamed] = await db.execute<{ title: string }>(
    sql`select title from public.lessons where id = ${lessonA.id}`,
  );
  check('the lesson kept its title', stillNamed?.title === 'Lesson A', stillNamed?.title);

  const [sneaky] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from public.courses where slug = ${`sneaky-${stamp}`}`,
  );
  check('nothing the member tried was written', Number(sneaky?.n) === 0);

  console.log('\nTeardown checks');
  await studio.setCoursePublished(env, adminId, courseId, false);
  await refused('a module with lessons cannot be deleted', () => studio.deleteModule(env, adminId, mod.id));
  await studio.deleteLesson(env, adminId, lessonA.id);
  await studio.deleteLesson(env, adminId, lessonB.id);
  await studio.deleteModule(env, adminId, mod.id);
  await studio.deleteCourse(env, adminId, courseId);
  courseId = '';
  check('an admin can clean up what they made', true);
} catch (error) {
  console.error('\nThrew:', error instanceof Error ? error.message : error);
  failures += 1;
} finally {
  if (courseId) await db.execute(sql`delete from public.courses where id = ${courseId}`);
  await db.execute(sql`delete from auth.users where id in (${adminId}, ${memberId})`);
  console.log('\nCleaned up both test accounts.');
}

console.log(failures === 0 ? '\nThe studio holds.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
