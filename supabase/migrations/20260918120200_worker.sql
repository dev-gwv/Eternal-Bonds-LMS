-- Worker tables: a job queue, and the rollups that turn activity_events into
-- the numbers the dashboard shows.
--
-- The queue is Postgres, not Redis. At this size `for update skip locked` is
-- all the concurrency control needed, and it keeps the dependency count at one.

create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  run_at      timestamptz not null default now(),
  attempts    integer not null default 0,
  max_attempts integer not null default 5,
  locked_at   timestamptz,
  locked_by   text,
  completed_at timestamptz,
  last_error  text,
  created_at  timestamptz not null default now()
);

-- The claim query orders by run_at over pending rows; this index is what keeps
-- it off a sequential scan once the table has history in it.
create index if not exists jobs_pending_idx
  on public.jobs (run_at)
  where completed_at is null;

create index if not exists jobs_kind_idx on public.jobs (kind);

-- Last run per scheduled job, so a restart does not re-run everything and a
-- missed window is visible rather than silent.
create table if not exists public.job_schedule (
  kind         text primary key,
  last_run_at  timestamptz,
  last_status  text,
  last_error   text,
  duration_ms  integer
);

/* ── Rollups ─────────────────────────────────────────────────────────────── */

-- One row per member per day. The activity chart reads this, never the raw
-- event stream — that table only grows.
create table if not exists public.daily_activity (
  user_id           uuid not null references public.users (id) on delete cascade,
  day               date not null,
  courses_minutes   integer not null default 0,
  workshops_minutes integer not null default 0,
  library_minutes   integer not null default 0,
  xp                integer not null default 0,
  primary key (user_id, day)
);

create table if not exists public.streaks (
  user_id        uuid primary key references public.users (id) on delete cascade,
  current_days   integer not null default 0,
  longest_days   integer not null default 0,
  last_active_on date,
  updated_at     timestamptz not null default now()
);

-- Denormalised totals for the leaderboard and profile. Rebuilt from
-- activity_events, so it can always be thrown away and recomputed.
create table if not exists public.member_stats (
  user_id             uuid primary key references public.users (id) on delete cascade,
  xp                  integer not null default 0,
  lessons_completed   integer not null default 0,
  posts_created       integer not null default 0,
  workshops_attended  integer not null default 0,
  updated_at          timestamptz not null default now()
);

create index if not exists member_stats_xp_idx on public.member_stats (xp desc);

/* ── RLS ─────────────────────────────────────────────────────────────────── */

alter table public.jobs           enable row level security;
alter table public.job_schedule   enable row level security;
alter table public.daily_activity enable row level security;
alter table public.streaks        enable row level security;
alter table public.member_stats   enable row level security;

-- jobs and job_schedule get no policies at all: only the service role touches
-- them, and no policy means no access for anon or authenticated.

create policy daily_activity_own on public.daily_activity
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy streaks_own on public.streaks
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- The leaderboard is public to members by design — that is the point of it.
create policy member_stats_select on public.member_stats
  for select to authenticated using (true);
