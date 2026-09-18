-- Supabase wiring for the schema created in 20260918120000_init.sql.
--
-- Three things happen here:
--   1. public.users becomes a profile row owned by auth.users
--   2. a trigger creates that profile on sign-up, so the app never has to
--   3. RLS is enabled on every table, with policies expressed once, here
--
-- Everything below is idempotent so it can be re-run against a branch database.

-- 1 ------------------------------------------------------------------- profile

alter table public.users
  add constraint users_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

-- Effective tier, derived from memberships rather than cached on the row.
-- Used by policies and by the API; one definition, not two.
create or replace function public.current_tier(uid uuid)
returns public.tier
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.tier
      from public.memberships m
      where m.user_id = uid
        and m.status in ('active', 'trial')
        and (m.expires_at is null or m.expires_at > now())
      order by array_position(
        array['free', 'silver', 'diamond', 'franchisee']::text[], m.tier::text
      ) desc
      limit 1
    ),
    'free'::public.tier
  );
$$;

-- Does the caller's tier reach `required`?
create or replace function public.tier_allows(required public.tier)
returns boolean
language sql
stable
as $$
  select array_position(array['free','silver','diamond','franchisee']::text[], public.current_tier(auth.uid())::text)
       >= array_position(array['free','silver','diamond','franchisee']::text[], required::text);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin');
$$;

-- 2 ------------------------------------------------------------------- sign-up

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_handle text;
begin
  base_handle := split_part(coalesce(new.email, new.phone, new.id::text), '@', 1);

  insert into public.users (id, handle, member_code, full_name, email, phone)
  values (
    new.id,
    base_handle || '-' || substr(new.id::text, 1, 4),
    'IPC-' || lpad((floor(random() * 99999))::text, 5, '0'),
    coalesce(new.raw_user_meta_data ->> 'full_name', base_handle),
    new.email,
    new.phone
  )
  on conflict (id) do nothing;

  -- Everyone starts free; a paid tier is granted by the payment webhook.
  insert into public.memberships (user_id, tier, status, source)
  values (new.id, 'free', 'active', 'signup');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3 ----------------------------------------------------------------------- RLS

alter table public.users                  enable row level security;
alter table public.memberships            enable row level security;
alter table public.courses                enable row level security;
alter table public.modules                enable row level security;
alter table public.lessons                enable row level security;
alter table public.enrollments            enable row level security;
alter table public.lesson_progress        enable row level security;
alter table public.workshops              enable row level security;
alter table public.workshop_registrations enable row level security;
alter table public.channels               enable row level security;
alter table public.posts                  enable row level security;
alter table public.post_media             enable row level security;
alter table public.library_categories     enable row level security;
alter table public.library_items          enable row level security;
alter table public.activity_events        enable row level security;
alter table public.outbox                 enable row level security;

-- Profiles: every member is visible to the club (it is a community), but only
-- the owner may edit, and nobody may change their own role or suspension.
create policy users_select on public.users
  for select to authenticated using (true);

create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy users_admin_all on public.users
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Memberships are readable by their owner and by admins; only the service role
-- (payment webhooks, admin tools) writes them.
create policy memberships_select_self on public.memberships
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Content is gated by tier, and unpublished content is admin-only.
create policy courses_select on public.courses
  for select to authenticated
  using ((is_published and public.tier_allows(min_tier)) or public.is_admin());

create policy courses_admin_write on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy modules_select on public.modules
  for select to authenticated
  using (
    exists (select 1 from public.courses c where c.id = course_id and c.is_published and public.tier_allows(c.min_tier))
    or public.is_admin()
  );

create policy lessons_select on public.lessons
  for select to authenticated
  using (
    is_preview
    or exists (
      select 1 from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = module_id and c.is_published and public.tier_allows(c.min_tier)
    )
    or public.is_admin()
  );

-- Enrollment and progress belong to one member, full stop.
create policy enrollments_own on public.enrollments
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy lesson_progress_own on public.lesson_progress
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy workshops_select on public.workshops
  for select to authenticated using (public.tier_allows(min_tier) or public.is_admin());

create policy workshops_admin_write on public.workshops
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy workshop_registrations_own on public.workshop_registrations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Channels and posts.
create policy channels_select on public.channels
  for select to authenticated
  using ((not is_archived and public.tier_allows(min_tier)) or public.is_admin());

create policy posts_select on public.posts
  for select to authenticated
  using (
    status = 'published'
    and exists (select 1 from public.channels c where c.id = channel_id and public.tier_allows(c.min_tier))
  );

create policy posts_insert_self on public.posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.channels c where c.id = channel_id and public.tier_allows(c.min_tier))
  );

create policy posts_update_own on public.posts
  for update to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

create policy post_media_select on public.post_media
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'));

create policy post_media_write_own on public.post_media
  for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- Library.
create policy library_categories_select on public.library_categories
  for select to authenticated using (true);

create policy library_items_select on public.library_items
  for select to authenticated using (public.tier_allows(min_tier) or public.is_admin());

-- Activity is written by the API on the member's behalf and read only by them.
create policy activity_events_own on public.activity_events
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy activity_events_insert_self on public.activity_events
  for insert to authenticated with check (user_id = auth.uid());

-- The outbox is drained by the worker as the service role. No policies means
-- no access for anon or authenticated, which is exactly right.
