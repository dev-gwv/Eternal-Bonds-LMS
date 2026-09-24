-- Quizzes: a lesson asking whether it landed.
--
-- Not an exam. Nobody is graded, nothing is gated behind a pass, and a wrong
-- answer costs nothing but the explanation you get for it. A course that locks
-- lesson nine until you score 80% on lesson eight teaches people to look up
-- the answers; a course that asks three questions and explains the misses
-- teaches the thing it was about.
--
-- The whole engineering problem here is one line: **the member must not be
-- able to read which option is correct before they answer.** Everything else
-- is three tables.
--
-- Row-level security cannot express that, because it is not about rows — every
-- member may read every option of a lesson they can see. It is about one
-- column. Postgres has exactly the right tool and it is rarely reached for:
-- column-level grants. `authenticated` is granted select on the option's id,
-- question, label and rank, and is *not* granted it on `is_correct`. A member
-- selecting that column gets a permission error rather than an answer key, and
-- no application code has to remember to omit it.
--
-- Grading then has to happen somewhere that can read the column, which is a
-- security-definer function. That function is also the only place a score is
-- written, so a member cannot post themselves a pass.

begin;

create table if not exists public.quiz_questions (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons (id) on delete cascade,
  prompt       text not null,
  -- Shown after answering, right or wrong. The explanation is the reason to
  -- have a quiz at all — the score is just what makes people read it.
  explanation  text,
  rank         numeric not null default 1000,
  created_at   timestamptz not null default now()
);

create index if not exists quiz_questions_lesson_idx on public.quiz_questions (lesson_id, rank);

create table if not exists public.quiz_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  label       text not null,
  is_correct  boolean not null default false,
  rank        numeric not null default 1000
);

create index if not exists quiz_options_question_idx on public.quiz_options (question_id, rank);

create table if not exists public.quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id)   on delete cascade,
  lesson_id  uuid not null references public.lessons (id) on delete cascade,
  score      int not null,
  total      int not null,
  created_at timestamptz not null default now()
);

-- Every attempt is kept, not just the best. "Got it on the third go" is a
-- different fact from "got it", and the first is the one that says the lesson
-- needs rewriting.
create index if not exists quiz_attempts_user_lesson_idx
  on public.quiz_attempts (user_id, lesson_id, created_at desc);

commit;

begin;

alter table public.quiz_questions enable row level security;
alter table public.quiz_options   enable row level security;
alter table public.quiz_attempts  enable row level security;

-- Questions are visible to anybody who can reach the lesson. `lesson_is_open`
-- is the same helper the lesson itself is gated by, so a quiz can never be a
-- way around a drip or a tier.
drop policy if exists quiz_questions_select on public.quiz_questions;
create policy quiz_questions_select on public.quiz_questions
  for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.lessons l
      join public.modules m on m.id = l.module_id
      join public.courses c on c.id = m.course_id
      where l.id = lesson_id and c.is_published and public.tier_allows(c.min_tier)
    )
  );

drop policy if exists quiz_questions_admin_write on public.quiz_questions;
create policy quiz_questions_admin_write on public.quiz_questions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists quiz_options_select on public.quiz_options;
create policy quiz_options_select on public.quiz_options
  for select to authenticated
  using (exists (select 1 from public.quiz_questions q where q.id = question_id));

drop policy if exists quiz_options_admin_write on public.quiz_options;
create policy quiz_options_admin_write on public.quiz_options
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Your own attempts. Admins see all of them, because "everybody misses
-- question two" is the most useful thing a quiz produces and it is invisible
-- from any one member's rows.
drop policy if exists quiz_attempts_own on public.quiz_attempts;
create policy quiz_attempts_own on public.quiz_attempts
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Deliberately no insert policy for `authenticated`. Attempts are written by
-- `submit_quiz` and nowhere else; a member who could insert here could award
-- themselves any score.

commit;

begin;

-- The column-level grant that does the real work.
--
-- Revoke the table-wide select first: a grant on specific columns is additive,
-- so leaving the blanket grant in place would make the whole exercise
-- decorative. Supabase gives `authenticated` table-wide select by default, and
-- that default is exactly what has to go.
revoke select on public.quiz_options from authenticated, anon;
grant select (id, question_id, label, rank) on public.quiz_options to authenticated;

-- Admins read `is_correct` through `submit_quiz` and through the authoring
-- endpoints, both of which run as definer or as a role holding the grant.
grant select on public.quiz_options to service_role;

commit;

begin;

/**
 * Grading, and the only place a score is written.
 *
 * Takes the answers as (question, chosen option) pairs, marks them against the
 * column the caller cannot read, records the attempt, and hands back what was
 * right along with the explanations. Security definer because it must read
 * `is_correct`; it takes the user from `auth.uid()` rather than an argument,
 * so it cannot be asked to record somebody else's attempt.
 */
create or replace function public.submit_quiz(p_lesson uuid, p_answers jsonb)
returns table (question_id uuid, correct_option_id uuid, chosen_option_id uuid, was_right boolean, explanation text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_score int;
  v_total int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  -- The lesson has to be reachable by this member. Without this check the
  -- function is a way to read the answers to any quiz in the catalogue,
  -- because a definer function bypasses the policies above.
  if not exists (
    select 1 from lessons l
    join modules m on m.id = l.module_id
    join courses c on c.id = m.course_id
    where l.id = p_lesson and c.is_published and public.tier_allows(c.min_tier)
  ) and not public.is_admin() then
    raise exception 'That lesson is not available to you';
  end if;

  return query
  with answered as (
    select
      (a ->> 'questionId')::uuid as qid,
      nullif(a ->> 'optionId', '')::uuid as oid
    from jsonb_array_elements(p_answers) a
  ),
  graded as (
    select
      q.id as qid,
      (select o.id from quiz_options o where o.question_id = q.id and o.is_correct limit 1) as correct_id,
      ans.oid as chosen_id,
      q.explanation as why
    from quiz_questions q
    -- Left join: a question left blank is a question got wrong, not a question
    -- that did not count. Otherwise skipping everything scores 0 out of 0.
    left join answered ans on ans.qid = q.id
    where q.lesson_id = p_lesson
  ),
  recorded as (
    insert into quiz_attempts (user_id, lesson_id, score, total)
    select
      v_user, p_lesson,
      count(*) filter (where chosen_id is not null and chosen_id = correct_id)::int,
      count(*)::int
    from graded
    returning score, total
  )
  select
    g.qid, g.correct_id, g.chosen_id,
    (g.chosen_id is not null and g.chosen_id = g.correct_id),
    g.why
  from graded g, recorded;

  select score, total into v_score, v_total
  from quiz_attempts where user_id = v_user and lesson_id = p_lesson
  order by created_at desc limit 1;

  -- XP for a clean sweep, first time only. Rewarding every retake would make
  -- the leaderboard a measure of persistence at one quiz.
  if v_total > 0 and v_score = v_total and not exists (
    select 1 from activity_events
    where user_id = v_user and kind = 'quiz.passed' and payload ->> 'lessonId' = p_lesson::text
  ) then
    insert into activity_events (user_id, kind, payload, xp)
    values (v_user, 'quiz.passed', jsonb_build_object('lessonId', p_lesson), 15);
  end if;
end $$;

revoke all on function public.submit_quiz(uuid, jsonb) from public, anon;
grant execute on function public.submit_quiz(uuid, jsonb) to authenticated;

commit;
