-- Pictures on the four things that did not have one.
--
-- Courses have had a cover since the client asked for it. Workshops, journeys,
-- insights and library items have not, and it shows: the workshops page is a
-- list of dates, the journeys page is a list of sentences, and the library —
-- which has a shelf literally called "Photo Library" — is a list of filenames.
-- For a club of photographers, a product made entirely of text is a strange
-- thing to have shipped.
--
-- One column name on all of them, `cover_key`, matching `courses.cover_key`.
-- That is not tidiness for its own sake: it is what lets one endpoint, one
-- upload component and one signing helper serve all five, instead of the fifth
-- copy of a pattern that was already on its fourth.
--
-- A storage key, not a URL. The bucket is private and every read is signed for
-- an hour, the same as course covers, avatars and win photos. Storing a URL
-- would mean either a public bucket or a link that dies.

begin;

alter table public.workshops      add column if not exists cover_key text;
alter table public.journeys       add column if not exists cover_key text;
alter table public.insights       add column if not exists cover_key text;

-- On a library item this is a *thumbnail*, distinct from `storage_key`, which
-- is the file members download. A PDF contract has a thumbnail and a file; a
-- link to a Drive folder has a thumbnail and no file at all.
alter table public.library_items  add column if not exists cover_key text;

commit;
