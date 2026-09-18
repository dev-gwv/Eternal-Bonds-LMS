-- Notifications, preferences and device tokens.
--
-- The bell icon in the header has been decoration since the scaffold. This is
-- what puts something behind it, and what the outbox drains into.
--
-- One table holds the in-app feed. Email and push are *deliveries* of the same
-- notification rather than separate records, so "did this person already get
-- told about this?" has one answer instead of three.

create type public.notification_kind as enum (
  'post.replied',
  'post.liked',
  'comment.liked',
  'workshop.reminder',
  'workshop.starting',
  'course.published',
  'membership.activated',
  'membership.expiring',
  'digest.weekly',
  'system'
);

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  kind         public.notification_kind not null,
  title        text not null,
  body         text,
  -- An in-app path, not an absolute URL: the same row has to work in the web
  -- app and in a future native build, which have different origins.
  link         text,
  -- What caused it, for deduping and for opening the right thing.
  subject_type text,
  subject_id   uuid,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),

  -- Delivery state, per channel. Null means "not applicable to this one".
  email_sent_at timestamptz,
  push_sent_at  timestamptz,
  delivery_error text
);

-- The feed query: this member's newest unread first.
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Nobody wants three notifications because three people liked the same post in
-- the same minute — but they do want one per distinct cause.
create unique index if not exists notifications_dedupe_idx
  on public.notifications (user_id, kind, subject_type, subject_id)
  where subject_id is not null;

create table if not exists public.notification_prefs (
  user_id        uuid primary key references public.users (id) on delete cascade,
  -- Defaults are deliberately conservative: in-app on, email digest on, push
  -- off until the member actually grants permission on a device.
  in_app         boolean not null default true,
  email_digest   boolean not null default true,
  email_activity boolean not null default false,
  push           boolean not null default false,
  -- No push between these hours, in the member's own timezone. A 3am phone
  -- buzz is how an app gets its notifications turned off for good.
  quiet_from     time not null default '22:00',
  quiet_to       time not null default '08:00',
  updated_at     timestamptz not null default now()
);

create table if not exists public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  token        text not null,
  platform     text not null check (platform in ('android', 'ios', 'web')),
  -- Registering the same device twice must not create two rows, or every
  -- notification gets sent twice to the same phone.
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when the provider tells us the token is dead, so we stop trying.
  revoked_at   timestamptz
);

create unique index if not exists push_tokens_token_key on public.push_tokens (token);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id) where revoked_at is null;

-- Every member gets a preferences row on sign-up, alongside their profile.
-- Reading a missing row and falling back to defaults works until someone
-- forgets, so the row simply always exists.
create or replace function public.ensure_notification_prefs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_prefs (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists users_notification_prefs on public.users;
create trigger users_notification_prefs
  after insert on public.users
  for each row execute function public.ensure_notification_prefs();

-- Backfill, so existing members are not left without one.
insert into public.notification_prefs (user_id)
select id from public.users on conflict do nothing;

/* ── Row Level Security ──────────────────────────────────────────────────── */

alter table public.notifications      enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_tokens        enable row level security;

-- Read and mark-as-read are the member's; creating one is not. Notifications
-- are written by the worker under the service role, so there is deliberately
-- no insert policy — a member cannot notify anyone, including themselves.
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete_own on public.notifications
  for delete to authenticated using (user_id = auth.uid());

create policy notification_prefs_own on public.notification_prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy push_tokens_own on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
