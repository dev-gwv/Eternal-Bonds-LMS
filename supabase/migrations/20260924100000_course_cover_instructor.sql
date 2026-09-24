-- A course needs a face and an author.
--
-- Two fields the studio could not set, which is why every course card in the
-- app renders a coloured gradient rectangle. For a photographers' club that is
-- an unusually poor look: the one product where the cover image is part of the
-- pitch, shipped without one.
--
-- `cover_key` is a storage key, not a URL, for the same reason every other
-- image in this schema is: the bucket is private and links are signed per
-- request. `instructor_name` is free text rather than a foreign key to users
-- on purpose — a guest teaching one course is a name on a card, not an account
-- somebody has to create first.

begin;

alter table public.courses
  add column if not exists cover_key       text,
  add column if not exists instructor_name text;

comment on column public.courses.cover_key is
  'Storage key for the cover image. Signed on read; the bucket is private.';
comment on column public.courses.instructor_name is
  'Free text. A guest instructor is a name, not an account.';

commit;
