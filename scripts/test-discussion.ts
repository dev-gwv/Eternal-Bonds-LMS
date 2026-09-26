/**
 * The conversation under a lesson, and the message that makes it one.
 *
 *   bun run db:test-discussion
 *
 * `lesson_questions` carried threading, a resolved flag and a soft-delete
 * column from the day it was written, and the interface reached none of them.
 * The genuinely missing piece was not any of those three: it was that nobody
 * was ever told their question had been answered. A question asked into
 * silence is asked once.
 *
 * What is pinned here is mostly what the database refuses, because that is
 * what survives a rewrite of the panel:
 *
 *   - a reply belongs to the same lesson as the question it answers
 *   - replies are one level deep, not a tree
 *   - answering your own question notifies nobody
 *   - resolving and deleting are the author's, enforced by RLS rather than by
 *     the button being hidden
 */
import { sql } from 'drizzle-orm';
import { createDb, withUser } from '@ipc/db';
import { drainOutbox } from '../services/worker/src/jobs/notify.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const db = createDb(url, { max: 1 });

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const stamp = Date.now();
const asker = crypto.randomUUID();
const answerer = crypto.randomUUID();
const everyone = [asker, answerer];
let courseId = '';
let otherCourseId = '';

async function createUser(id: string, email: string, name: string) {
  await db.execute(sql`
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, aud, role)
    values (${id}::uuid, ${email}, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
    on conflict (id) do nothing
  `);
  await db.execute(sql`update users set role = 'member', full_name = ${name} where id = ${id}::uuid`);
}

/** A free published course with one lesson, so tier gating is not in the way. */
async function makeLesson(slug: string) {
  const [c] = await db.execute<{ id: string }>(sql`
    insert into courses (slug, title, category, level, language, min_tier, is_published)
    values (${slug}, 'Discussion fixture', 'business', 'beginner', 'english', 'free', true)
    returning id
  `);
  const [m] = await db.execute<{ id: string }>(sql`
    insert into modules (course_id, title, rank) values (${c!.id}::uuid, 'M', 1000) returning id
  `);
  const [l] = await db.execute<{ id: string }>(sql`
    insert into lessons (module_id, slug, title, rank, duration_seconds)
    values (${m!.id}::uuid, ${slug + '-l'}, 'L', 1000, 60) returning id
  `);
  return { courseId: c!.id, lessonId: l!.id };
}

const post = (who: string, lesson: string, body: string, parent: string | null = null) =>
  withUser(db, who, async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into lesson_questions (lesson_id, author_id, body_md, parent_id)
      values (${lesson}::uuid, ${who}::uuid, ${body}, ${parent}::uuid)
      returning id
    `);
    return row!.id;
  });

const refused = async (label: string, fn: () => Promise<unknown>, expect: RegExp) => {
  try {
    await fn();
    check(label, false, 'it was allowed');
  } catch (e) {
    const msg = (e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message;
    check(label, expect.test(msg), msg.slice(0, 64));
  }
};

try {
  console.log('\nSetup');
  await createUser(asker, `disc-asker-${stamp}@example.test`, 'Asha Asker');
  await createUser(answerer, `disc-ans-${stamp}@example.test`, 'Arun Answerer');
  const main = await makeLesson(`disc-${stamp}`);
  const other = await makeLesson(`disc-other-${stamp}`);
  courseId = main.courseId;
  otherCourseId = other.courseId;
  check('two members and two lessons exist', true);

  console.log('\nAsking and answering');
  const question = await post(asker, main.lessonId, 'Why does the close rate double?');
  check('a member can ask', Boolean(question));
  const answer = await post(answerer, main.lessonId, 'Because the quote arrives before they cool off.', question);
  check('another member can reply', Boolean(answer));

  console.log('\nThe notification that was missing');
  const drained = await drainOutbox(db);
  check('the outbox delivered it', Number(drained.notified ?? 0) > 0, JSON.stringify(drained));
  const [note] = await db.execute<{ title: string; body: string; link: string }>(sql`
    select title, body, link from notifications
    where user_id = ${asker}::uuid and kind = 'lesson.answered'
  `);
  check('the asker is told', Boolean(note), note?.title);
  check('by name', note?.title?.includes('Arun Answerer') === true, note?.title);
  check('with the answer in it', note?.body?.includes('cool off') === true);
  check('linking to the lesson', note?.link?.startsWith('/learn/') === true, note?.link);

  console.log('\nAnswering yourself');
  await post(asker, main.lessonId, 'Never mind, I worked it out.', question);
  await drainOutbox(db);
  const [count] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from notifications where user_id = ${asker}::uuid and kind = 'lesson.answered'
  `);
  check('notifies nobody', Number(count?.n) === 1, `${count?.n} notification(s), still just the one`);

  console.log('\nWhat the database refuses');
  await refused(
    'a reply on a different lesson',
    () => post(answerer, other.lessonId, 'Wrong lesson', question),
    /same lesson/i,
  );
  await refused(
    'a reply to a reply',
    () => post(asker, main.lessonId, 'Nested', answer),
    /nested/i,
  );
  await refused(
    'a reply to a question that does not exist',
    () => post(asker, main.lessonId, 'Ghost', crypto.randomUUID()),
    /does not exist/i,
  );

  console.log('\nResolving belongs to the asker');
  const closeAsOther = await withUser(db, answerer, (tx) =>
    tx.execute<{ id: string }>(sql`
      update lesson_questions set resolved = true where id = ${question}::uuid returning id
    `),
  );
  check('somebody else cannot close the thread', closeAsOther.length === 0);

  await withUser(db, asker, (tx) =>
    tx.execute(sql`update lesson_questions set resolved = true where id = ${question}::uuid`),
  );
  const [state] = await db.execute<{ resolved: boolean }>(
    sql`select resolved from lesson_questions where id = ${question}::uuid`,
  );
  check('the asker can', state?.resolved === true);

  console.log('\nDeleting');
  const deleteOther = await withUser(db, asker, (tx) =>
    tx.execute<{ id: string }>(sql`
      update lesson_questions set deleted_at = now()
      where id = ${answer}::uuid and deleted_at is null returning id
    `),
  );
  check("you cannot delete somebody else's answer", deleteOther.length === 0);

  const deleteOwn = await withUser(db, answerer, (tx) =>
    tx.execute<{ id: string }>(sql`
      update lesson_questions set deleted_at = now()
      where id = ${answer}::uuid and deleted_at is null returning id
    `),
  );
  check('you can delete your own', deleteOwn.length === 1);
} finally {
  console.log('\nCleanup');
  for (const id of [courseId, otherCourseId].filter(Boolean)) {
    await db.execute(sql`delete from courses where id = ${id}::uuid`);
  }
  await db.execute(sql`delete from auth.users where id in ${sql.raw(`('${everyone.join("','")}')`)}`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nThe discussion holds.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
