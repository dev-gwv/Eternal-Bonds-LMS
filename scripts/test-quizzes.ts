/**
 * Proves a member cannot see the answers, and cannot award themselves a pass.
 *
 *   bun run db:test-quizzes
 *
 * Everything else about a quiz is three tables. The two properties worth a
 * test are the two that would be quietly catastrophic:
 *
 *   - `quiz_options.is_correct` is not granted to `authenticated`, so an
 *     answer key cannot leak through a handler that forgot to omit the column.
 *     Selecting it is a permission error, not a row.
 *   - `quiz_attempts` has no insert policy. Scores are written by
 *     `submit_quiz` and nowhere else, so a member cannot post themselves full
 *     marks.
 *
 * Both are database facts rather than API behaviour, which is the point: they
 * survive a refactor of the handlers that currently happen to be careful.
 */
import { sql } from 'drizzle-orm';
import { createDb, withUser } from '@ipc/db';
import * as quizzes from '../services/api/src/quizzes.ts';
import { EnvSchema } from '../services/api/src/env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const env = EnvSchema.parse(process.env);
const db = createDb(url, { max: 1 });

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const stamp = Date.now();
const admin = crypto.randomUUID();
const member = crypto.randomUUID();
let lessonId = '';
let courseId = '';

async function createUser(id: string, email: string, role: 'admin' | 'member') {
  await db.execute(sql`
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, aud, role)
    values (${id}::uuid, ${email}, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
    on conflict (id) do nothing
  `);
  await db.execute(sql`update users set role = ${role}, full_name = ${'Quiz ' + role} where id = ${id}::uuid`);
}

try {
  console.log('\nSetup');
  await createUser(admin, `quiz-admin-${stamp}@example.test`, 'admin');
  await createUser(member, `quiz-member-${stamp}@example.test`, 'member');
  /* Its own course rather than whichever one the seed happens to have left
     lying around. Every seeded course is Diamond, so borrowing one made this
     test a test of tier gating by accident — and it would have started failing
     the day somebody changed the seed. */
  const [course] = await db.execute<{ id: string }>(sql`
    insert into courses (slug, title, category, level, language, min_tier, is_published)
    values (${'quiz-fixture-' + stamp}, 'Quiz fixture', 'business', 'beginner', 'english', 'free', true)
    returning id
  `);
  courseId = course!.id;
  const [mod] = await db.execute<{ id: string }>(sql`
    insert into modules (course_id, title, rank) values (${courseId}::uuid, 'Only module', 1000) returning id
  `);
  const [lesson] = await db.execute<{ id: string }>(sql`
    insert into lessons (module_id, slug, title, rank, duration_seconds)
    values (${mod!.id}::uuid, ${'quiz-lesson-' + stamp}, 'Only lesson', 1000, 60)
    returning id
  `);
  lessonId = lesson!.id;
  check('there is a free, published lesson to attach a quiz to', true);

  console.log('\nAuthoring');
  await quizzes.addQuestion(env, admin, lessonId, {
    prompt: 'What is the cheapest light in a room?',
    explanation: 'A window. It is free and it is already there.',
    options: [
      { label: 'A window', isCorrect: true },
      { label: 'A softbox', isCorrect: false },
      { label: 'A ring light', isCorrect: false },
    ],
  });
  const authored = await quizzes.listAdminQuiz(env, admin, lessonId);
  check('an admin can add a question', authored.length === 1);
  check('and can see which option is right', authored[0]?.options.some((o) => o.isCorrect) === true);

  console.log('\nWhat the member gets');
  const quiz = await quizzes.getQuiz(env, member, lessonId);
  check('the quiz is readable', quiz?.questions.length === 1);
  check('with all the options', quiz?.questions[0]?.options.length === 3);
  // About the data, not the type: nothing in the payload may hint at the answer.
  const payload = JSON.stringify(quiz?.questions ?? []);
  check('and nothing that says which is right', !/isCorrect|is_correct/.test(payload), payload.slice(0, 90));
  check('no attempt yet', quiz?.lastAttempt === null && quiz?.everPerfect === false);

  console.log('\nThe column grant');
  // Caught around the whole transaction, not inside it. A failed statement
  // poisons the transaction, so swallowing the error in the callback only
  // moves the throw to the commit.
  let denied = '';
  try {
    await withUser(db, member, async (tx) => {
      await tx.execute(sql`select is_correct from quiz_options limit 1`);
    });
  } catch (e) {
    denied = (e as { cause?: { message?: string } }).cause?.message ?? String(e);
  }
  check('selecting is_correct as a member is a permission error', /permission denied/i.test(denied), denied.slice(0, 60));

  console.log('\nAnswering');
  const q = quiz!.questions[0]!;
  const wrongOption = q.options.find((o) => o.label !== 'A window')!;
  const wrong = await quizzes.submitQuiz(env, member, lessonId, {
    answers: [{ questionId: q.id, optionId: wrongOption.id }],
  });
  check('a wrong answer scores zero', wrong.score === 0 && wrong.total === 1, `${wrong.score}/${wrong.total}`);
  check('and the explanation comes back', wrong.marks[0]?.explanation?.includes('window') === true);
  check('along with the right option', wrong.marks[0]?.correctOptionId !== null);

  const rightOption = q.options.find((o) => o.label === 'A window')!;
  const right = await quizzes.submitQuiz(env, member, lessonId, {
    answers: [{ questionId: q.id, optionId: rightOption.id }],
  });
  check('a right answer scores', right.score === 1 && right.total === 1, `${right.score}/${right.total}`);

  // Blank is wrong, not absent — otherwise skipping everything is 0 out of 0.
  const blank = await quizzes.submitQuiz(env, member, lessonId, {
    answers: [{ questionId: q.id, optionId: null }],
  });
  check('a skipped question counts against the total', blank.total === 1 && blank.score === 0);

  const after = await quizzes.getQuiz(env, member, lessonId);
  check('the last attempt is remembered', after?.lastAttempt?.total === 1);
  check('and a perfect run is remembered separately', after?.everPerfect === true);

  console.log('\nXP');
  const [xp] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from activity_events
    where user_id = ${member}::uuid and kind = 'quiz.passed'
  `);
  check('a clean sweep pays once and only once', Number(xp?.n) === 1, String(xp?.n));

  console.log('\nWriting a score directly');
  let blocked = false;
  try {
    await withUser(db, member, async (tx) => {
      await tx.execute(sql`
        insert into quiz_attempts (user_id, lesson_id, score, total)
        values (${member}::uuid, ${lessonId}::uuid, 99, 99)
      `);
    });
  } catch {
    blocked = true;
  }
  check('is refused by RLS', blocked);

  console.log('\nRemoving a question');
  await quizzes.deleteQuestion(env, admin, authored[0]!.id);
  check('it goes', (await quizzes.listAdminQuiz(env, admin, lessonId)).length === 0);
  const [kept] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from quiz_attempts where user_id = ${member}::uuid
  `);
  check('and past attempts survive it', Number(kept?.n) === 3, String(kept?.n));
} finally {
  console.log('\nCleanup');
  if (lessonId) await db.execute(sql`delete from quiz_questions where lesson_id = ${lessonId}::uuid`);
  if (courseId) await db.execute(sql`delete from courses where id = ${courseId}::uuid`);
  await db.execute(sql`delete from auth.users where id in (${admin}::uuid, ${member}::uuid)`);
  await db.$client.end({ timeout: 5 });
}

console.log(failures === 0 ? '\nThe answers stay hidden.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
