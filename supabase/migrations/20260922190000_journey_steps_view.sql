-- Let a member see the shape of a journey they cannot fully open.
--
-- `journey_steps` joins `courses`, and `courses_select` hides anything above
-- the member's tier. The join therefore does not lock a Diamond step for a
-- free member — it deletes it, so the path silently reads "2 courses" instead
-- of "3, one of which needs Diamond". That is worse than a lock in both
-- directions: the member cannot see what they would be buying, and the step
-- numbers they are given do not match the ones anybody else sees.
--
-- This function is the deliberate exception. It returns a course's *title,
-- slug, tier and length* regardless of entitlement, and nothing else — no
-- lesson titles, no summaries, no video. A catalogue entry is marketing, and
-- the actual gate is unchanged: /courses/:slug and /playback still refuse.
--
-- Scoped to a single journey id rather than being a general course reader, so
-- it cannot be used to enumerate the catalogue.

begin;

create or replace function public.journey_step_catalogue(p_journey uuid)
returns table (
  id            uuid,
  course_id     uuid,
  course_slug   text,
  course_title  text,
  min_tier      public.tier,
  note          text,
  lesson_count  int,
  seconds       int,
  rank          numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    js.id,
    js.course_id,
    c.slug,
    c.title,
    c.min_tier,
    js.note,
    (select count(*)::int from lessons l join modules m on m.id = l.module_id where m.course_id = c.id),
    (select coalesce(sum(l.duration_seconds), 0)::int from lessons l join modules m on m.id = l.module_id where m.course_id = c.id),
    js.rank
  from journey_steps js
  join courses c on c.id = js.course_id
  join journeys j on j.id = js.journey_id
  -- The journey itself still has to be visible. An unpublished journey is not
  -- a catalogue entry, and this must not become a way to read one.
  where js.journey_id = p_journey
    and (j.is_published or public.is_admin())
  order by js.rank asc;
$$;

revoke all on function public.journey_step_catalogue(uuid) from public;
grant execute on function public.journey_step_catalogue(uuid) to authenticated;

commit;
