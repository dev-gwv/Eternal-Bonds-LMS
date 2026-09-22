-- View counts on posts.
--
-- Worth having because of what the live club's numbers actually look like:
-- posts with 665 and 212 views and a single like. Views are how engagement is
-- read there, and a feed that shows only likes tells an author their post
-- landed badly when several hundred people in fact read it.
--
-- Distinct viewers, not a hit counter. A counter that increments on every
-- render rewards refreshing, drifts upward forever, and cannot answer the only
-- question an author actually has — how many *people* saw this.

alter table public.posts
  add column if not exists views_count integer not null default 0;

create table if not exists public.post_views (
  post_id         uuid not null references public.posts (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  -- One row per person per post. The primary key is the dedupe: a member
  -- scrolling past the same post ten times is one view, without the client
  -- having to remember anything.
  primary key (post_id, user_id)
);

create index if not exists post_views_user_idx on public.post_views (user_id);

create or replace function public.bump_post_views()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.posts set views_count = views_count + 1 where id = new.post_id;
  return null;
end;
$$;

drop trigger if exists post_views_count on public.post_views;
create trigger post_views_count
  after insert on public.post_views
  for each row execute function public.bump_post_views();

alter table public.post_views enable row level security;

-- Only ever your own row, and only for a post you can already see. Without the
-- visibility check a member could enumerate post ids and inflate the counter
-- on content their tier does not reach.
create policy post_views_insert_own on public.post_views
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.status = 'published'
        and exists (select 1 from public.channels c where c.id = p.channel_id and public.tier_allows(c.min_tier))
    )
  );

-- Deliberately no select policy for members: who read a post is the author's
-- business at best and nobody's at worst. The aggregate on posts.views_count
-- is what gets shown, and admins reach the rows through the service role.
create policy post_views_select_admin on public.post_views
  for select to authenticated using (public.is_admin());
