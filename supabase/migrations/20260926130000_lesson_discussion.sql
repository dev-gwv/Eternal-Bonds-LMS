-- Finishing the discussion under a lesson.
--
-- `lesson_questions` has carried threading, a resolved flag and a soft-delete
-- column since it was built, and the interface reached none of them: the API
-- accepts a `parentId` that nothing could send, `/questions/:id/resolve`
-- existed and nothing called it — so the "Resolved" chip in the panel could
-- never turn on — and `deleted_at` had no endpoint at all.
--
-- The missing piece that actually matters is none of those. It is that nobody
-- was ever told their question had been answered. A question asked into
-- silence is asked once; the reply is the whole reason to come back, and it
-- was the one thing the pipeline did not carry.

begin;

alter type public.notification_kind add value if not exists 'lesson.answered';

commit;

begin;

/**
 * Somebody replied to a question.
 *
 * A trigger rather than a call in the handler, matching every other event in
 * this system: the outbox row is written in the same transaction as the reply,
 * so the event cannot exist without the reply or the reply without the event.
 * `emit_outbox` is a definer function because `outbox` has RLS and no insert
 * policy for members — deliberately, since a member who could write to it
 * could make the club send anything to anyone.
 *
 * Only replies. A top-level question has nobody to notify, and notifying the
 * asker of their own reply is noise.
 */
create or replace function public.on_lesson_answer()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_asker uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select author_id into v_asker from lesson_questions where id = new.parent_id;

  -- Answering your own question is a note to yourself, not an answer.
  if v_asker is null or v_asker = new.author_id then
    return new;
  end if;

  perform public.emit_outbox(
    'lesson.answered',
    jsonb_build_object('answerId', new.id, 'askerId', v_asker)
  );
  return new;
end $$;

drop trigger if exists lesson_questions_emit_answer on public.lesson_questions;
create trigger lesson_questions_emit_answer
  after insert on public.lesson_questions
  for each row execute function public.on_lesson_answer();

commit;

begin;

/* A reply belongs to the thread it answers, not to another lesson.
   Nothing enforced that, so a crafted request could hang a reply off a
   question in a different course entirely — and it would then appear under
   both, because the panel groups by lesson and threads by parent. */
create or replace function public.lesson_answer_matches_thread()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_lesson uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select lesson_id into v_parent_lesson from lesson_questions where id = new.parent_id;
  if v_parent_lesson is null then
    raise exception 'That question does not exist';
  end if;
  if v_parent_lesson <> new.lesson_id then
    raise exception 'A reply has to be on the same lesson as the question';
  end if;

  -- One level. A reply to a reply turns a readable thread into a tree that the
  -- panel cannot render and nobody can follow.
  if exists (select 1 from lesson_questions where id = new.parent_id and parent_id is not null) then
    raise exception 'Replies cannot be nested further';
  end if;

  return new;
end $$;

drop trigger if exists lesson_questions_thread_check on public.lesson_questions;
create trigger lesson_questions_thread_check
  before insert on public.lesson_questions
  for each row execute function public.lesson_answer_matches_thread();

commit;
