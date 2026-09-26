-- Letting the player tell us how long the video is.
--
-- An uploaded video gets its length from the provider's webhook. A YouTube
-- lesson has neither an upload nor a webhook, so nothing on the server ever
-- learns it: a two-hour course displayed "1 lesson · 0h", the lesson row said
-- 0:00, and every progress estimate built on the number was wrong.
--
-- The only thing that knows is the browser — the IFrame API hands over
-- `getDuration()` the moment the video loads. Reading it server-side would
-- mean a YouTube Data API key, a quota and a second failure mode, for a number
-- we are already holding.
--
-- So the player reports it, and this function is what makes accepting that
-- safe. `lessons` is admin-write only, correctly: a member cannot be allowed
-- to edit the catalogue. A definer function is the narrow exception — one
-- column, one direction, under conditions the member cannot influence.

begin;

create or replace function public.report_lesson_duration(p_lesson uuid, p_seconds int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- A definer function bypasses the policies, so the reachability check that
  -- `lessons_select` would have done has to be done here. Without it this is a
  -- write path into any lesson in the catalogue, including unpublished drafts.
  if not exists (
    select 1
    from lessons l
    join modules m on m.id = l.module_id
    join courses c on c.id = m.course_id
    where l.id = p_lesson and c.is_published and public.tier_allows(c.min_tier)
  ) and not public.is_admin() then
    raise exception 'That lesson is not available to you';
  end if;

  /* Only a zero is filled.
     The condition lives in the statement rather than in a prior read, so two
     people opening the lesson at the same moment cannot both write. Once a
     length is known — from here or from a provider webhook, which always
     arrives non-zero — nothing can change it, which is what makes this safe to
     accept from an ordinary member instead of an admin. */
  update lessons
  set duration_seconds = p_seconds, video_duration_source = 'browser'
  where id = p_lesson and coalesce(duration_seconds, 0) = 0;

  select duration_seconds into v_current from lessons where id = p_lesson;
  return coalesce(v_current, 0);
end $$;

revoke all on function public.report_lesson_duration(uuid, int) from public, anon;
grant execute on function public.report_lesson_duration(uuid, int) to authenticated;

commit;
