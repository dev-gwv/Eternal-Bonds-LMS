import { sql } from 'drizzle-orm';
import { withUser } from '@ipc/db';
import type {
  AdminQuizQuestion,
  Quiz,
  QuizQuestionInput,
  QuizResult,
  QuizSubmission,
} from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { getDb } from './repo.ts';

/**
 * Quizzes: a lesson asking whether it landed.
 *
 * The one rule worth stating is that nothing in this file decides whether an
 * answer is right. Grading happens inside `public.submit_quiz`, a
 * security-definer function, because `quiz_options.is_correct` is not granted
 * to `authenticated` at all — a member's connection cannot select the column,
 * so an answer key cannot leak through a handler that forgot to omit it, and
 * it cannot leak through this one either.
 *
 * The same function is the only writer of `quiz_attempts`, which has no insert
 * policy. A member who could write there could award themselves any score.
 */

const requireDb = (env: Env) => {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Needs a database');
  return db;
};

/** What a member sees before answering: prompts and labels, no answers. */
export async function getQuiz(env: Env, userId: string | null, lessonId: string): Promise<Quiz | null> {
  const db = getDb(env);
  if (!db || !userId) return null;

  return withUser(db, userId, async (tx) => {
    const rows = await tx.execute<{
      question_id: string; prompt: string; rank: string;
      option_id: string | null; label: string | null; option_rank: string | null;
    }>(sql`
      select q.id as question_id, q.prompt, q.rank,
             o.id as option_id, o.label, o.rank as option_rank
      from quiz_questions q
      -- Only the columns the grant allows. Adding is_correct here would not
      -- leak an answer key; it would fail outright with a permission error,
      -- which is the whole point of doing it with a grant.
      left join quiz_options o on o.question_id = q.id
      where q.lesson_id = ${lessonId}::uuid
      order by q.rank asc, o.rank asc
    `);
    if (rows.length === 0) return null;

    const byQuestion = new Map<string, Quiz['questions'][number]>();
    for (const r of rows) {
      let q = byQuestion.get(r.question_id);
      if (!q) {
        q = { id: r.question_id, prompt: r.prompt, options: [] };
        byQuestion.set(r.question_id, q);
      }
      if (r.option_id) q.options.push({ id: r.option_id, label: r.label ?? '' });
    }

    const [last] = await tx.execute<{ score: number; total: number; created_at: string }>(sql`
      select score, total, created_at from quiz_attempts
      where user_id = ${userId}::uuid and lesson_id = ${lessonId}::uuid
      order by created_at desc limit 1
    `);
    const [perfect] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from quiz_attempts
      where user_id = ${userId}::uuid and lesson_id = ${lessonId}::uuid
        and total > 0 and score = total
    `);

    return {
      lessonId,
      questions: [...byQuestion.values()],
      lastAttempt: last
        ? { score: Number(last.score), total: Number(last.total), at: new Date(last.created_at).toISOString() }
        : null,
      everPerfect: Number(perfect?.n ?? 0) > 0,
    };
  });
}

/**
 * Answering.
 *
 * The answers go straight into the database function; nothing is marked here.
 * It runs as the member — `auth.uid()` inside the function is their id — so it
 * cannot be asked to record somebody else's attempt, and it re-checks that the
 * lesson is reachable because a definer function is not subject to the
 * policies that would otherwise do it.
 */
export async function submitQuiz(
  env: Env,
  userId: string,
  lessonId: string,
  input: QuizSubmission,
): Promise<QuizResult> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    const marks = await tx.execute<{
      question_id: string; correct_option_id: string | null;
      chosen_option_id: string | null; was_right: boolean; explanation: string | null;
    }>(sql`select * from public.submit_quiz(${lessonId}::uuid, ${JSON.stringify(input.answers)}::jsonb)`);

    if (marks.length === 0) throw new HttpError(404, 'That lesson has no quiz');

    return {
      score: marks.filter((m) => m.was_right).length,
      total: marks.length,
      marks: marks.map((m) => ({
        questionId: m.question_id,
        correctOptionId: m.correct_option_id,
        chosenOptionId: m.chosen_option_id,
        wasRight: Boolean(m.was_right),
        explanation: m.explanation,
      })),
    };
  });
}

/* ── Authoring ─────────────────────────────────────────────────────────── */

export async function listAdminQuiz(env: Env, userId: string, lessonId: string): Promise<AdminQuizQuestion[]> {
  const db = requireDb(env);
  return withUser(db, userId, async (tx) => {
    /* Through a definer function, for the same reason grading is.
       An admin is not a different Postgres role — they are `authenticated`
       with a claim — so the column grant that hides the answer from members
       hides it from authors too. `admin_quiz` checks `is_admin()` itself
       before returning anything. */
    const rows = await tx.execute<{
      question_id: string; prompt: string; explanation: string | null;
      option_id: string | null; label: string | null; is_correct: boolean | null;
    }>(sql`select * from public.admin_quiz(${lessonId}::uuid)`);

    const byQuestion = new Map<string, AdminQuizQuestion>();
    for (const r of rows) {
      let q = byQuestion.get(r.question_id);
      if (!q) {
        q = { id: r.question_id, prompt: r.prompt, explanation: r.explanation, options: [] };
        byQuestion.set(r.question_id, q);
      }
      if (r.option_id) {
        q.options.push({ id: r.option_id, label: r.label ?? '', isCorrect: Boolean(r.is_correct) });
      }
    }
    return [...byQuestion.values()];
  });
}

export async function addQuestion(
  env: Env,
  userId: string,
  lessonId: string,
  input: QuizQuestionInput,
): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    const [q] = await tx.execute<{ id: string }>(sql`
      insert into quiz_questions (lesson_id, prompt, explanation, rank)
      values (
        ${lessonId}::uuid, ${input.prompt}, ${input.explanation},
        coalesce((select max(rank) from quiz_questions where lesson_id = ${lessonId}::uuid), 0) + 1000
      )
      returning id
    `);
    if (!q) throw new HttpError(500, 'Question was not created');

    // Inserted in one statement, in the same transaction as the question, so a
    // failure halfway cannot leave a question with two of its four options.
    for (const [i, o] of input.options.entries()) {
      await tx.execute(sql`
        insert into quiz_options (question_id, label, is_correct, rank)
        values (${q.id}::uuid, ${o.label}, ${o.isCorrect}, ${String((i + 1) * 100)})
      `);
    }
  });
}

export async function deleteQuestion(env: Env, userId: string, questionId: string): Promise<void> {
  const db = requireDb(env);
  await withUser(db, userId, async (tx) => {
    // Options cascade. Attempts do not reference a question, so past scores
    // survive an author fixing a badly worded one.
    await tx.execute(sql`delete from quiz_questions where id = ${questionId}::uuid`);
  });
}
