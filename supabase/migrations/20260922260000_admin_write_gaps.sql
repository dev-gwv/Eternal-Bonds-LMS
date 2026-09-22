-- The admin policies that were never written.
--
-- This is the fifth, sixth and seventh instance of one shape: a table gets a
-- policy for the member case, an admin endpoint is written against it, and
-- nobody checks that the admin can actually reach the table. The endpoint
-- compiles, typechecks, and returns 500 the first time somebody presses the
-- button.
--
-- Found by walking the app as an admin and pressing everything:
--
--   feature_flags       SELECT only  → PUT /moderation/flags/:key was a 500.
--                       A kill switch that cannot be written is not a kill
--                       switch, and this one had a working UI in front of it.
--   events              SELECT only  → POST /v1/events was a 500, so the
--                       scheduler on the moderation page had never once
--                       created an event. The two events that exist were made
--                       by the seed script as the service role.
--   channel_moderators  SELECT only  → POST /moderation/moderators was a 500.
--
-- Each is admin-write, member-read, which is the correct shape for all three:
-- a member needs to see which events exist and who moderates a channel, and
-- has no business changing either.
--
-- The general rule, written down because it has now cost seven bugs: any table
-- an admin screen touches needs its own `is_admin()` policy. A `*_select_own`
-- or a bare `select ... using (true)` is a member policy, and a member policy
-- is not an admin policy.

begin;

drop policy if exists feature_flags_admin_write on public.feature_flags;
create policy feature_flags_admin_write on public.feature_flags
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists events_admin_write on public.events;
create policy events_admin_write on public.events
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists channel_moderators_admin_write on public.channel_moderators;
create policy channel_moderators_admin_write on public.channel_moderators
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Linking an insight to a session is part of creating the session, so it needs
-- the same rights.
drop policy if exists event_insights_admin_write on public.event_insights;
create policy event_insights_admin_write on public.event_insights
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Lesson resources are authored in the studio alongside the lesson itself.
drop policy if exists lesson_resources_admin_write on public.lesson_resources;
create policy lesson_resources_admin_write on public.lesson_resources
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;
