-- Likes and comments.
--
-- `posts.likes_count` and `posts.comments_count` already existed and were
-- always zero — the UI rendered counters nothing could ever increment. These
-- are the tables behind them.
--
-- The counters are maintained by triggers rather than by the API. Two people
-- liking the same post in the same millisecond is the normal case, not the
-- edge case, and `count + 1` read-modify-written from application code loses
-- one of them. A trigger doing `count = count + 1` inside the same statement
-- does not. `counters.reconcile` still exists as a safety net, and now has
-- something real to compare against.

/* ── Likes ───────────────────────────────────────────────────────────────── */

create table if not exists public.post_likes (
  post_id     uuid not null references public.posts (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- The primary key is the whole rule: one like per person per post. Enforcing
  -- it here means a double-tap cannot produce two.
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_idx on public.post_likes (user_id);

/* ── Comments ────────────────────────────────────────────────────────────── */

create table if not exists public.post_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  author_id   uuid not null references public.users (id) on delete cascade,
  -- One level of nesting: a reply to a comment, never a reply to a reply.
  -- Deeper threads are unreadable on a phone and nobody asked for them.
  parent_id   uuid references public.post_comments (id) on delete cascade,
  body_md     text not null,
  likes_count integer not null default 0,
  -- Soft delete, so a reply does not lose the comment it was answering.
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);

create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);
create index if not exists post_comments_author_idx on public.post_comments (author_id);

create table if not exists public.comment_likes (
  comment_id  uuid not null references public.post_comments (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);

/* ── Counters ────────────────────────────────────────────────────────────── */

create or replace function public.bump_post_likes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set likes_count = likes_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set likes_count = greatest(0, likes_count - 1) where id = old.post_id;
  end if;
  return null;
end;
$$;

create or replace function public.bump_post_comments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A soft delete has to decrement too, or the count outruns what is visible.
  if tg_op = 'INSERT' then
    update public.posts set comments_count = comments_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set comments_count = greatest(0, comments_count - 1) where id = old.post_id;
  elsif tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    update public.posts set comments_count = greatest(0, comments_count - 1) where id = new.post_id;
  elsif tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null then
    update public.posts set comments_count = comments_count + 1 where id = new.post_id;
  end if;
  return null;
end;
$$;

create or replace function public.bump_comment_likes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.post_comments set likes_count = likes_count + 1 where id = new.comment_id;
  elsif tg_op = 'DELETE' then
    update public.post_comments set likes_count = greatest(0, likes_count - 1) where id = old.comment_id;
  end if;
  return null;
end;
$$;

drop trigger if exists post_likes_count on public.post_likes;
create trigger post_likes_count
  after insert or delete on public.post_likes
  for each row execute function public.bump_post_likes();

drop trigger if exists post_comments_count on public.post_comments;
create trigger post_comments_count
  after insert or delete or update of deleted_at on public.post_comments
  for each row execute function public.bump_post_comments();

drop trigger if exists comment_likes_count on public.comment_likes;
create trigger comment_likes_count
  after insert or delete on public.comment_likes
  for each row execute function public.bump_comment_likes();

/* ── Row Level Security ──────────────────────────────────────────────────── */

alter table public.post_likes    enable row level security;
alter table public.post_comments enable row level security;
alter table public.comment_likes enable row level security;

-- Visibility follows the post, which already follows the channel's tier. A
-- member who cannot see a post must not be able to count its likes either.
create policy post_likes_select on public.post_likes
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
                 and exists (select 1 from public.channels c where c.id = p.channel_id and public.tier_allows(c.min_tier))));

create policy post_likes_write_own on public.post_likes
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
                and exists (select 1 from public.channels c where c.id = p.channel_id and public.tier_allows(c.min_tier)))
  );

create policy post_comments_select on public.post_comments
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
                 and exists (select 1 from public.channels c where c.id = p.channel_id and public.tier_allows(c.min_tier))));

create policy post_comments_insert_self on public.post_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
                and exists (select 1 from public.channels c where c.id = p.channel_id and public.tier_allows(c.min_tier)))
  );

create policy post_comments_update_own on public.post_comments
  for update to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

create policy post_comments_delete_own on public.post_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

create policy comment_likes_select on public.comment_likes
  for select to authenticated
  using (exists (select 1 from public.post_comments pc where pc.id = comment_id));

create policy comment_likes_write_own on public.comment_likes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.post_comments pc where pc.id = comment_id));
