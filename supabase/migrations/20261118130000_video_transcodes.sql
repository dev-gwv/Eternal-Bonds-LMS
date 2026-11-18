-- The queue the club's VPS works through.
--
-- A lesson video uploaded to R2 is the original file, whatever the camera or
-- Zoom produced. The VPS turns it into HLS (360p/720p/1080p) beside it. This
-- table is how it finds out there is work: it claims a row over the API,
-- heartbeats while ffmpeg runs, and reports done or failed.
--
-- A claim is a lease, not a lock: a VPS that reboots mid-job simply stops
-- heartbeating, the lease runs out, and the job is claimable again — up to
-- three attempts, after which the lesson shows the last error in Studio.
--
-- `kind = 'delete'` is the same queue used for cleanup: removing a video's
-- thousands of segments is a job for the machine that has the bandwidth and
-- no request time limit, not for an API request.

begin;

create table if not exists public.video_transcodes (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'transcode' check (kind in ('transcode', 'delete')),
  lesson_id     uuid references public.lessons (id) on delete set null,
  asset_id      text not null,
  source_key    text,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  progress      smallint not null default 0 check (progress between 0 and 100),
  attempts      smallint not null default 0,
  leased_until  timestamptz,
  error         text,
  duration_seconds integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists video_transcodes_queue_idx
  on public.video_transcodes (created_at) where status in ('queued', 'running');
create index if not exists video_transcodes_lesson_idx on public.video_transcodes (lesson_id);

-- Written only by the API as the database owner (for the VPS). Admins can
-- read it, which is how Studio shows "Processing 40%" on a lesson.
alter table public.video_transcodes enable row level security;
revoke all on public.video_transcodes from anon, authenticated;
grant select on public.video_transcodes to authenticated;
drop policy if exists video_transcodes_admin_select on public.video_transcodes;
create policy video_transcodes_admin_select on public.video_transcodes
  for select to authenticated using (public.is_admin());

commit;
