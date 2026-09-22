-- Fix: an RLS policy cannot read an RLS-protected table.
--
-- `wins_public_read` checked the author was not suspended with
--
--   exists (select 1 from users u where u.id = author_id and not u.is_suspended)
--
-- and that subquery is evaluated with the *caller's* privileges. The caller is
-- `anon`, which by design cannot read `users` at all — so the EXISTS was false
-- for every row, and the public page returned 404 for everything.
--
-- This is the dangerous shape of that mistake: it failed **closed**. The page
-- was simply empty, which reads as "no wins are shared yet" rather than as a
-- broken policy, and it would have looked fine in review. The same mistake
-- made the other way — a policy whose subquery is too permissive — fails open
-- and is how private rows end up on the internet. Either way, the rule is that
-- a policy must not depend on a table the caller cannot read.
--
-- The fix is a security-definer function, which is the standard answer:
-- `public.is_admin()` in this schema already works this way for the same
-- reason. It answers exactly one question about one id and returns a boolean.

begin;

create or replace function public.author_is_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select not u.is_suspended from users u where u.id = p_user), false);
$$;

revoke all on function public.author_is_active(uuid) from public;
grant execute on function public.author_is_active(uuid) to anon, authenticated;

drop policy if exists wins_public_read on public.wins;
create policy wins_public_read on public.wins
  for select to anon
  using (
    status = 'published'
    and public_share = true
    and public.author_is_active(author_id)
  );

-- Same substitution here: this policy read `wins` (fine, it has an anon policy
-- now) but also joined `users` (not fine).
drop policy if exists win_media_public_read on public.win_media;
create policy win_media_public_read on public.win_media
  for select to anon
  using (exists (
    select 1 from public.wins w
    where w.id = win_id
      and w.status = 'published'
      and w.public_share = true
      and public.author_is_active(w.author_id)
  ));

commit;
