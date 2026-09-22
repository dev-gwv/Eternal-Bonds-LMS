-- Let an admin write their own audit entries.
--
-- `audit_log` had a select policy and no insert policy, so under RLS nothing
-- could write to it at all. The two places that already do — granting a tier
-- and suspending a member — get away with it only because they run their
-- statements as the service role, which bypasses RLS entirely. That works and
-- it is the wrong tool: the service role also bypasses every other check, so
-- using it for an audit line means using it for the whole function.
--
-- `actor_id = auth.uid()` is the point of the policy. An admin may record what
-- they did; they may not record something under another admin's name, which is
-- exactly the forgery an audit log exists to make impossible. Nothing may
-- update or delete a row: there is no policy for those, and that is deliberate.

begin;

drop policy if exists audit_log_insert_self on public.audit_log;
create policy audit_log_insert_self on public.audit_log
  for insert to authenticated
  with check (public.is_admin() and actor_id = auth.uid());

commit;
