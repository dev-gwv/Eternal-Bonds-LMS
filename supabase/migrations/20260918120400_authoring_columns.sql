-- Columns the studio needs that the read-only schema never had a reason for.

-- A lesson that has just been created has no video at all. Recording that as
-- 'uploading' would make every draft look like a stuck upload, so there is now
-- an honest empty state. (Adding the value is its own migration: Postgres will
-- not let a new enum label be *used* in the transaction that adds it.)
alter type public.video_status add value if not exists 'none' before 'uploading';

-- "What did I touch last?" is the first question the course list has to answer.
alter table public.courses
  add column if not exists updated_at timestamptz not null default now();

-- A live cohort call has a real seat limit; a recorded webinar does not.
-- Null means unlimited rather than zero.
alter table public.workshops
  add column if not exists capacity integer;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists courses_touch_updated_at on public.courses;
create trigger courses_touch_updated_at
  before update on public.courses
  for each row execute function public.touch_updated_at();
