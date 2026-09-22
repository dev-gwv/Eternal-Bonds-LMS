-- Admins may read progress, and only read it.
--
-- `lesson_progress_own` says user_id = auth.uid() for all operations, which is
-- exactly right for a member and left an admin unable to see how anybody is
-- doing. That is the entire premise of the members console and the cohort
-- roster: "stopped at lesson 4 of 22, six weeks ago" is a message you can
-- write, and without this policy the query returns zero for everybody, which
-- looks like data rather than an error — a cohort roster where everyone is
-- flagged as behind, quietly and wrongly.
--
-- Read only. Nothing should let one person mark another person's lesson
-- complete: the progress row is the member's own record of their own work, and
-- an admin who could write it could manufacture a certificate.
--
-- The members console currently reaches this data by running its statements as
-- the service role, which bypasses RLS wholesale. This policy is what lets
-- that stop being necessary.

begin;

create policy lesson_progress_admin_read on public.lesson_progress
  for select to authenticated
  using (public.is_admin());

commit;
