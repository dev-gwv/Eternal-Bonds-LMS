-- Columns a real video provider needs.
--
-- Until now a lesson's asset was a storage key and `ready` meant "the file
-- finished uploading". With a provider, "uploaded" and "playable" are two
-- different moments minutes apart, and only the provider knows when the second
-- one arrives.

alter table public.lessons
  -- The provider's handle on the *upload*, which is not always the same as its
  -- handle on the finished asset. Cloudflare Stream reuses the uid; Bunny does
  -- not necessarily.
  add column if not exists video_upload_id text,
  -- Why a transcode failed, shown to the admin who uploaded it. Without this
  -- the studio can only say "failed", which is not actionable.
  add column if not exists video_error text,
  add column if not exists video_ready_at timestamptz,
  -- Set from the provider's probe rather than the browser's guess, once it has
  -- actually looked at the file.
  add column if not exists video_duration_source text;

create index if not exists lessons_video_asset_idx on public.lessons (video_asset_id)
  where video_asset_id is not null;

-- Lessons still waiting on a transcode, for the poller.
create index if not exists lessons_video_pending_idx on public.lessons (video_status)
  where video_status in ('uploading', 'processing');

insert into public.job_schedule (kind) values ('video.poll')
on conflict (kind) do nothing;
