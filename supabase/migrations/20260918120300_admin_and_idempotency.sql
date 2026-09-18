-- Two things the studio needs before it can work:
--   1. admins can only write the tables they were given policies for, and
--      modules/lessons/library/channels were read-only. Nobody could author.
--   2. idempotency moves out of process memory so it survives a restart and
--      works behind more than one instance.

/* ── Authoring ───────────────────────────────────────────────────────────── */

create policy modules_admin_write on public.modules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy lessons_admin_write on public.lessons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy library_categories_admin_write on public.library_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy library_items_admin_write on public.library_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy channels_admin_write on public.channels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admins need to see drafts; the member-facing policy filters to published.
create policy modules_admin_select on public.modules
  for select to authenticated using (public.is_admin());

create policy lessons_admin_select on public.lessons
  for select to authenticated using (public.is_admin());

-- Moderation: an admin can hide a post without being its author.
create policy posts_admin_all on public.posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

/* ── Idempotency ─────────────────────────────────────────────────────────── */

-- A phone on a flaky train retries. In memory this only worked per instance
-- and vanished on restart; in Postgres it holds across both.
create table if not exists public.idempotency_keys (
  key         text not null,
  user_id     uuid references public.users (id) on delete cascade,
  path        text not null,
  status      integer not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  primary key (key, path)
);

create index if not exists idempotency_keys_created_idx on public.idempotency_keys (created_at);

alter table public.idempotency_keys enable row level security;
-- Service-role only, like the queue: replay is decided by the API, not a client.

/* ── Promoting an admin ──────────────────────────────────────────────────── */

-- There is deliberately no UI for this: the first admin is made by hand, and
-- every later one should be a reviewed change.
--
--   update public.users set role = 'admin' where email = 'you@club.in';

comment on column public.users.role is
  'member | instructor | admin. Set by hand or by an audited admin action, never self-service.';
