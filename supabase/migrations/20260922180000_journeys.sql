-- Journeys: an ordered answer to "what do I do first?"
--
-- Eighteen courses and 572 lectures, presented as a grid, is not a curriculum.
-- It is a library, and a library asks the newest member — the one least able
-- to answer it — to design their own syllabus. That is most of why the last
-- seven days showed zero active members: not that the material is bad, but
-- that nothing says where to start.
--
-- A journey is a named outcome with courses in order behind it. "Zero to your
-- first ₹1L" is a promise; Course 3 of 6 is a position inside it. Both are
-- things a member can hold in their head, which a grid of eighteen tiles is
-- not.
--
-- Deliberately *not* a gate. Steps are a recommended order, not a lock: a
-- wedding photographer who already prices well should be able to skip ahead,
-- and a sequence that refuses them teaches them the platform is in their way.
-- Drip locks content; a journey only suggests.

begin;

create table if not exists public.journeys (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  -- The outcome, in the member's words. This is the whole product: "Book your
  -- first paid wedding" sells, "Photography Fundamentals Track" does not.
  promise       text not null,
  description_md text,
  min_tier      public.tier not null default 'free',
  is_published  boolean not null default false,
  rank          numeric not null default 1000,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.journey_steps (
  id         uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  course_id  uuid not null references public.courses (id)  on delete cascade,
  -- Why this course, here. One line, shown under the step — the connective
  -- tissue that turns a list of courses into a path.
  note       text,
  rank       numeric not null default 1000
);

-- A course appears at most once in a given journey. Twice is always a mistake,
-- and it makes "step 3 of 6" ambiguous.
create unique index if not exists journey_steps_unique_idx
  on public.journey_steps (journey_id, course_id);

create index if not exists journey_steps_order_idx on public.journey_steps (journey_id, rank);

commit;

begin;

alter table public.journeys      enable row level security;
alter table public.journey_steps enable row level security;

-- Published journeys are visible to anyone signed in, whatever their tier.
-- Seeing the path that Diamond unlocks is the argument for buying Diamond;
-- hiding it means the upgrade has to be explained rather than shown.
drop policy if exists journeys_select on public.journeys;
create policy journeys_select on public.journeys
  for select to authenticated
  using (is_published or public.is_admin());

drop policy if exists journeys_admin_write on public.journeys;
create policy journeys_admin_write on public.journeys
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists journey_steps_select on public.journey_steps;
create policy journey_steps_select on public.journey_steps
  for select to authenticated
  using (exists (
    select 1 from public.journeys j
    where j.id = journey_id and (j.is_published or public.is_admin())
  ));

drop policy if exists journey_steps_admin_write on public.journey_steps;
create policy journey_steps_admin_write on public.journey_steps
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;
