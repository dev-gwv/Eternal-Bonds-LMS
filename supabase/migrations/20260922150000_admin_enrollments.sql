-- Admins may enrol somebody other than themselves.
--
-- `enrollments_own` is exactly right for a member: you enrol yourself and
-- nobody else. It also meant an admin adding twenty people to a January cohort
-- was refused by RLS, because putting a member on a schedule for a course they
-- are not enrolled in is a state with no useful meaning.
--
-- Deliberately narrower than the member policy in one respect: this grants
-- insert and select, not delete. Un-enrolling somebody destroys the row that
-- carries their progress and their certificate key, and that should not be a
-- side effect of tidying up a cohort. Removing somebody from a cohort leaves
-- the enrolment standing, which is the behaviour the API relies on.

begin;

create policy enrollments_admin_read on public.enrollments
  for select to authenticated
  using (public.is_admin());

create policy enrollments_admin_enrol on public.enrollments
  for insert to authenticated
  with check (public.is_admin());

commit;
