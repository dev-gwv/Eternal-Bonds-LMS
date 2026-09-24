-- Letting the author see the answer.
--
-- The previous migration revoked table-wide select on `quiz_options` from
-- `authenticated` and granted back every column except `is_correct`. That does
-- exactly what it should for a member, and it also hits the admin — because an
-- admin is not a different Postgres role. They connect as `authenticated` with
-- a claim, which is what makes `is_admin()` work in policies, and a grant is
-- checked against the role, not the claim.
--
-- So the authoring read needs the same treatment as grading: a
-- security-definer function that checks `is_admin()` itself. That is the price
-- of using a column grant, and it is still the right trade — the alternative
-- is every read path remembering to omit one column, forever, including the
-- ones nobody has written yet.

begin;

create or replace function public.admin_quiz(p_lesson uuid)
returns table (
  question_id uuid,
  prompt      text,
  explanation text,
  option_id   uuid,
  label       text,
  is_correct  boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The whole guard. A definer function bypasses RLS, so without this it is a
  -- public answer key with an official-looking name.
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;

  return query
  select q.id, q.prompt, q.explanation, o.id, o.label, o.is_correct
  from quiz_questions q
  left join quiz_options o on o.question_id = q.id
  where q.lesson_id = p_lesson
  order by q.rank asc, o.rank asc;
end $$;

revoke all on function public.admin_quiz(uuid) from public, anon;
grant execute on function public.admin_quiz(uuid) to authenticated;

commit;
