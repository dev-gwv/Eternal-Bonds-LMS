-- Cohorts and drip.
--
-- Two problems, one mechanism.
--
-- The first is that a course of 40 lessons dropped on somebody all at once is
-- how 18 courses and 572 lectures end up with nobody finishing anything. A
-- drip turns "sometime" into "Tuesday", which is the only deadline most people
-- respond to.
--
-- The second is that Abdullah is the only author. A cohort is the highest-
-- leverage thing a single person can run: one start date, one schedule, and
-- everything after that — unlock notices, deadline warnings, the sense of
-- other people being at the same place — is the job scheduler's problem.
--
-- `modules.available_from` has existed since the first migration and is read
-- by nothing. It stays, and means what it says: a hard date before which
-- nobody sees the module regardless of cohort. `drip_days` is the relative
-- half — days after *this member's* clock, which is their cohort start if they
-- are in one and their enrolment otherwise. Evergreen and cohort courses then
-- use the same column, and an evergreen course is simply a cohort of one that
-- starts when you do.

begin;

alter table public.modules
  add column if not exists drip_days smallint;

comment on column public.modules.drip_days is
  'Days after the member''s cohort start (or enrolment) before this module unlocks. Null unlocks immediately.';

create table if not exists public.cohorts (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  slug       text not null unique,
  name       text not null,
  starts_on  date not null,
  -- The date the group is expected to be finished by. Drives the deadline
  -- warnings; null means the cohort runs until people stop.
  ends_on    date,
  -- Null is unlimited. A number is enforced when somebody is added.
  capacity   integer,
  -- Closed cohorts keep their members and stop taking new ones.
  is_open    boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists cohorts_course_idx on public.cohorts (course_id, starts_on desc);

create table if not exists public.cohort_members (
  cohort_id uuid not null references public.cohorts (id) on delete cascade,
  user_id   uuid not null references public.users (id)   on delete cascade,
  -- Denormalised from the cohort, and kept honest by a trigger. It is here
  -- only so the rule below can be an index: a member belongs to at most one
  -- cohort per course, because otherwise "when does this module unlock for
  -- you" has more than one answer and the drip becomes undefined.
  course_id uuid not null references public.courses (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (cohort_id, user_id)
);

create index if not exists cohort_members_user_idx on public.cohort_members (user_id);

create unique index if not exists cohort_members_one_per_course_idx
  on public.cohort_members (user_id, course_id);

-- Nothing writing to this table should have to remember the denormalised
-- column, and nothing should be able to set it wrong.
create or replace function public.cohort_member_course()
returns trigger
language plpgsql
as $$
begin
  select c.course_id into new.course_id from public.cohorts c where c.id = new.cohort_id;
  if new.course_id is null then
    raise exception 'Cohort % does not exist', new.cohort_id;
  end if;
  return new;
end;
$$;

drop trigger if exists cohort_members_course_trg on public.cohort_members;
create trigger cohort_members_course_trg
  before insert or update on public.cohort_members
  for each row execute function public.cohort_member_course();

commit;

begin;

-- The one place that decides when a member's clock for a course started.
-- Cohort start wins over enrolment, because the point of a cohort is that
-- everybody in it is on the same day regardless of when they signed up.
create or replace function public.course_clock_start(p_course uuid, p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.starts_on::timestamptz
       from cohort_members cm
       join cohorts c on c.id = cm.cohort_id
      where cm.user_id = p_user and c.course_id = p_course
      order by c.starts_on desc
      limit 1),
    (select e.enrolled_at from enrollments e
      where e.user_id = p_user and e.course_id = p_course),
    now()
  );
$$;

-- When a module opens for a member: the later of its hard date and its drip.
-- Null means "already open", which keeps the common case free of arithmetic.
create or replace function public.module_unlock_at(p_module uuid, p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    greatest(
      coalesce(m.available_from, '-infinity'::timestamptz),
      case
        when m.drip_days is null then '-infinity'::timestamptz
        else public.course_clock_start(m.course_id, p_user) + (m.drip_days || ' days')::interval
      end
    ),
    '-infinity'::timestamptz
  )
  from modules m
  where m.id = p_module;
$$;

commit;

begin;

alter table public.cohorts        enable row level security;
alter table public.cohort_members enable row level security;

-- Members see cohorts at all — a schedule is not a secret, and seeing that a
-- January group exists is how somebody asks to be in it.
drop policy if exists cohorts_select on public.cohorts;
create policy cohorts_select on public.cohorts
  for select to authenticated using (true);

drop policy if exists cohorts_admin_write on public.cohorts;
create policy cohorts_admin_write on public.cohorts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Membership is narrower: your own, or an admin's view of everyone's.
drop policy if exists cohort_members_select on public.cohort_members;
create policy cohort_members_select on public.cohort_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists cohort_members_admin_write on public.cohort_members;
create policy cohort_members_admin_write on public.cohort_members
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;
