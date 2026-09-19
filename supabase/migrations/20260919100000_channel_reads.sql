-- Unread counts per channel.
--
-- `Channel.unread` has been hardcoded to 0 since the scaffold: the field
-- existed, the UI rendered a dot for it, and nothing could ever set it. This
-- is the row that makes it mean something.
--
-- One row per member per channel, holding the moment they last looked. Unread
-- is then a count of posts newer than that — derived, never stored, so it
-- cannot drift out of step with the posts themselves the way a counter column
-- would.

create table if not exists public.channel_reads (
  user_id      uuid not null references public.users (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create index if not exists channel_reads_user_idx on public.channel_reads (user_id);

alter table public.channel_reads enable row level security;

-- Entirely the member's own data, and harmless if they lie about it — the
-- worst they can do is hide their own badge.
create policy channel_reads_own on public.channel_reads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

/**
 * Unread posts in one channel for one member.
 *
 * Three rules, each of which is obvious only once it is wrong:
 *   - never counts the member's own posts; you have read what you wrote
 *   - a member who has never opened a channel is not shown every post since
 *     the club began, only those since they joined
 *   - capped at 99 in the UI, but counted honestly here
 */
create or replace function public.unread_count(p_user_id uuid, p_channel_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.posts p
  where p.channel_id = p_channel_id
    and p.status = 'published'
    and p.author_id <> p_user_id
    and p.created_at > coalesce(
      (select cr.last_read_at from public.channel_reads cr
        where cr.user_id = p_user_id and cr.channel_id = p_channel_id),
      (select u.created_at from public.users u where u.id = p_user_id),
      now()
    );
$$;

-- Marking a channel read. A function rather than a plain upsert from the API
-- so "now()" is the database's clock — a client with a skewed clock could
-- otherwise mark a channel read into the future and never see a badge again.
create or replace function public.mark_channel_read(p_channel_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.channel_reads (user_id, channel_id, last_read_at)
  values (auth.uid(), p_channel_id, now())
  on conflict (user_id, channel_id) do update set last_read_at = now();
$$;
