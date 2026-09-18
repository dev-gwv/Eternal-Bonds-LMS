-- Separate file on purpose: 'none' was added in the previous migration and
-- cannot be used until that transaction has committed.

alter table public.lessons alter column video_status set default 'none';

-- Existing rows that never had an asset were never really uploading.
update public.lessons set video_status = 'none'
where video_asset_id is null and video_status = 'uploading';
