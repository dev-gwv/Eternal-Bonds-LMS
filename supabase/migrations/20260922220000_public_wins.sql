-- Public wins: the only thing in this app a stranger may read.
--
-- `wins.public_share` has been collected since the wins board was built — the
-- member ticks "allow the club to share this outside the platform" — and it
-- has never been read by anything. A wins board whose proof cannot leave the
-- login wall is a marketing asset with the marketing removed: the whole point
-- of somebody's ₹1.2L booking story is that a photographer who is *not* yet a
-- member can read it.
--
-- The gate is a policy, not a WHERE clause.
--
-- That distinction is the entire security design here. A hand-written filter
-- in one handler is one typo away from serving every draft win to the open
-- internet, and the typo would look like working code. A policy on the `anon`
-- role applies to every query that role will ever make, including ones nobody
-- has written yet, and it fails closed.
--
-- Three conditions, all required: published, opted in, and the author not
-- suspended. The last one matters because suspension is a moderation action
-- and it must reach the public copy — otherwise the one thing a removed member
-- keeps is their shop window.

begin;

drop policy if exists wins_public_read on public.wins;
create policy wins_public_read on public.wins
  for select to anon
  using (
    status = 'published'
    and public_share = true
    and exists (select 1 from public.users u where u.id = author_id and not u.is_suspended)
  );

-- The proof photographs, under exactly the same conditions. Without this the
-- public page renders a win with its images missing, which reads as broken
-- rather than as private.
drop policy if exists win_media_public_read on public.win_media;
create policy win_media_public_read on public.win_media
  for select to anon
  using (exists (
    select 1 from public.wins w
    join public.users u on u.id = w.author_id
    where w.id = win_id
      and w.status = 'published'
      and w.public_share = true
      and not u.is_suspended
  ));

-- Just the author's display name, for the byline. `users` has email, phone,
-- member code and last-seen on it, so this is deliberately not a select policy
-- on the table: anon gets a function that returns one string and nothing else.
create or replace function public.public_win_author(p_win uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.full_name
  from wins w
  join users u on u.id = w.author_id
  where w.id = p_win
    and w.status = 'published'
    and w.public_share = true
    and not u.is_suspended;
$$;

revoke all on function public.public_win_author(uuid) from public;
grant execute on function public.public_win_author(uuid) to anon, authenticated;

commit;
