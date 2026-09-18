-- The bucket lesson videos land in.
--
-- Private on purpose. Everything that reads from it does so through a signed
-- URL minted by the API after it has checked the member's tier, so a public
-- bucket would quietly undo the entire access model — the object key would be
-- the only thing standing between a free member and a paid course.
--
-- No storage policies are needed: the API signs with the service role, and a
-- signed URL carries its own authorisation.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ipc-media',
  'ipc-media',
  false,
  5368709120,  -- 5 GiB; a two-hour lecture at a sane bitrate fits comfortably.
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
