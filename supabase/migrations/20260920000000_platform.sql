-- Platform second half: Think Tank, Wins, Events, badges, moderation,
-- consent, flags, LMS refinements, Photolancer, support.
--
-- Mirrors packages/db/src/platform.ts. Drizzle is the authoring tool; this
-- file is what Supabase actually applies. RLS on every table, counters by
-- trigger, outbox emission by trigger (the API cannot write `outbox`
-- directly — it is service-role-only).

/* ── Think Tank ──────────────────────────────────────────────────────── */

create table if not exists public.insight_domains (
  id    uuid primary key default gen_random_uuid(),
  slug  text not null unique,
  name  text not null,
  rank  numeric not null default '1000'
);

create table if not exists public.insight_impact_areas (
  id    uuid primary key default gen_random_uuid(),
  slug  text not null unique,
  name  text not null,
  rank  numeric not null default '1000'
);

do $$ begin
  create type public.insight_status as enum ('draft', 'published', 'hidden');
exception when duplicate_object then null; end $$;

create table if not exists public.vote_cycles (
  id        uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on   date not null,
  status    text not null default 'open'
);
create index if not exists vote_cycles_dates_idx on public.vote_cycles (starts_on, ends_on);

create table if not exists public.insights (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references public.users (id) on delete cascade,
  domain_id      uuid references public.insight_domains (id),
  impact_area_id uuid references public.insight_impact_areas (id),
  vote_cycle_id  uuid references public.vote_cycles (id),
  slug           text not null unique,
  title          text not null,
  situation_md   text not null default '',
  big_idea_md    text not null default '',
  how_md         text not null default '',
  status         public.insight_status not null default 'draft',
  votes_count    integer not null default 0,
  saves_count    integer not null default 0,
  featured_at    timestamptz,
  featured_by    uuid references public.users (id),
  search_vector  tsvector,
  created_at     timestamptz not null default now()
);
create index if not exists insights_cycle_idx on public.insights (vote_cycle_id, votes_count);
create index if not exists insights_author_idx on public.insights (author_id);
create index if not exists insights_search_idx on public.insights using gin (search_vector);

create or replace function public.update_insight_search()
returns trigger language plpgsql as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.big_idea_md, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.situation_md, '')), 'C');
  return new;
end; $$;
drop trigger if exists insights_search_trigger on public.insights;
create trigger insights_search_trigger
  before insert or update of title, big_idea_md, situation_md on public.insights
  for each row execute function public.update_insight_search();

create table if not exists public.insight_steps (
  id         uuid primary key default gen_random_uuid(),
  insight_id uuid not null references public.insights (id) on delete cascade,
  title      text not null,
  body_md    text not null default '',
  rank       numeric not null default '1000'
);
create index if not exists insight_steps_insight_idx on public.insight_steps (insight_id);

create table if not exists public.insight_votes (
  insight_id uuid not null references public.insights (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  cycle_id   uuid not null references public.vote_cycles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (insight_id, user_id)
);
create index if not exists insight_votes_cycle_idx on public.insight_votes (cycle_id);

create or replace function public.bump_insight_votes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.insights set votes_count = votes_count + 1 where id = new.insight_id;
  elsif tg_op = 'DELETE' then
    update public.insights set votes_count = greatest(0, votes_count - 1) where id = old.insight_id;
  end if;
  return null;
end; $$;
drop trigger if exists insight_votes_count on public.insight_votes;
create trigger insight_votes_count
  after insert or delete on public.insight_votes
  for each row execute function public.bump_insight_votes();

create table if not exists public.bookmarks (
  user_id     uuid not null references public.users (id) on delete cascade,
  target_type text not null,
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create table if not exists public.solutions (
  id         uuid primary key default gen_random_uuid(),
  dilemma    text not null,
  body_md    text not null,
  curated_by uuid references public.users (id),
  rank       numeric not null default '1000',
  created_at timestamptz not null default now()
);
create index if not exists solutions_rank_idx on public.solutions (rank);

create table if not exists public.unmatched_dilemmas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users (id) on delete set null,
  query      text not null,
  context    text,
  created_at timestamptz not null default now()
);
create index if not exists unmatched_dilemmas_created_idx on public.unmatched_dilemmas (created_at);

/* ── Wins ────────────────────────────────────────────────────────────── */

do $$ begin
  create type public.win_status as enum ('pending', 'published', 'hidden');
exception when duplicate_object then null; end $$;

create table if not exists public.wins (
  id                  uuid primary key default gen_random_uuid(),
  author_id           uuid not null references public.users (id) on delete cascade,
  slug                text not null unique,
  title               text not null,
  big_idea_md         text not null default '',
  how_it_happened_md  text not null default '',
  category            text not null default 'general',
  occurred_on         date,
  tags                text[] not null default '{}',
  status              public.win_status not null default 'pending',
  public_share        boolean not null default false,
  comments_count      integer not null default 0,
  reactions_count     integer not null default 0,
  search_vector       tsvector,
  created_at          timestamptz not null default now()
);
create index if not exists wins_status_created_idx on public.wins (status, created_at);
create index if not exists wins_author_idx on public.wins (author_id);
create index if not exists wins_search_idx on public.wins using gin (search_vector);

create or replace function public.update_win_search()
returns trigger language plpgsql as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.big_idea_md, '')), 'B');
  return new;
end; $$;
drop trigger if exists wins_search_trigger on public.wins;
create trigger wins_search_trigger
  before insert or update of title, big_idea_md on public.wins
  for each row execute function public.update_win_search();

create table if not exists public.win_media (
  id           uuid primary key default gen_random_uuid(),
  win_id       uuid not null references public.wins (id) on delete cascade,
  storage_key  text not null,
  mime         text not null,
  width        integer,
  height       integer,
  rank         numeric not null default '1000'
);
create index if not exists win_media_win_idx on public.win_media (win_id);

create table if not exists public.reactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  target_type text not null,
  target_id   uuid not null,
  kind        text not null default 'like',
  created_at  timestamptz not null default now(),
  unique (user_id, target_type, target_id, kind)
);
create index if not exists reactions_target_idx on public.reactions (target_type, target_id);

create or replace function public.bump_win_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.target_type = 'win' then
    update public.wins set reactions_count = reactions_count + 1 where id = new.target_id;
  elsif tg_op = 'DELETE' and old.target_type = 'win' then
    update public.wins set reactions_count = greatest(0, reactions_count - 1) where id = old.target_id;
  end if;
  return null;
end; $$;
drop trigger if exists reactions_win_count on public.reactions;
create trigger reactions_win_count
  after insert or delete on public.reactions
  for each row execute function public.bump_win_reactions();

create table if not exists public.win_comments (
  id         uuid primary key default gen_random_uuid(),
  win_id     uuid not null references public.wins (id) on delete cascade,
  author_id  uuid not null references public.users (id) on delete cascade,
  parent_id  uuid references public.win_comments (id) on delete cascade,
  body_md    text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists win_comments_win_idx on public.win_comments (win_id, created_at);

create or replace function public.bump_win_comments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.wins set comments_count = comments_count + 1 where id = new.win_id;
  elsif tg_op = 'DELETE' then
    update public.wins set comments_count = greatest(0, comments_count - 1) where id = old.win_id;
  elsif tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    update public.wins set comments_count = greatest(0, comments_count - 1) where id = new.win_id;
  end if;
  return null;
end; $$;
drop trigger if exists win_comments_count on public.win_comments;
create trigger win_comments_count
  after insert or delete or update of deleted_at on public.win_comments
  for each row execute function public.bump_win_comments();

/* ── Events ──────────────────────────────────────────────────────────── */

create table if not exists public.events (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  title                text not null,
  description_md       text,
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  join_url             text,
  recording_lesson_id  uuid,
  is_featured_session  boolean not null default false,
  min_tier             public.tier not null default 'free',
  created_at           timestamptz not null default now()
);
create index if not exists events_starts_idx on public.events (starts_at);

create table if not exists public.event_rsvps (
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.event_insights (
  event_id   uuid not null references public.events (id) on delete cascade,
  insight_id uuid not null references public.insights (id) on delete cascade,
  primary key (event_id, insight_id)
);

/* ── Badges ──────────────────────────────────────────────────────────── */

create table if not exists public.badge_defs (
  id          text primary key,
  name        text not null,
  description text,
  icon        text not null default 'award',
  rule        jsonb not null default '{}'
);

create table if not exists public.user_badges (
  user_id    uuid not null references public.users (id) on delete cascade,
  badge_id   text not null references public.badge_defs (id) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

/* ── Moderation ──────────────────────────────────────────────────────── */

do $$ begin
  create type public.report_status as enum ('open', 'actioned', 'dismissed');
exception when duplicate_object then null; end $$;

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.users (id) on delete set null,
  target_type text not null,
  target_id   uuid not null,
  reason      text not null,
  status      public.report_status not null default 'open',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists reports_status_idx on public.reports (status, created_at);

create table if not exists public.channel_moderators (
  channel_id uuid not null,
  user_id    uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.users (id) on delete set null,
  action      text not null,
  target_type text,
  target_id   uuid,
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at);

/* ── Legal / directory / flags ───────────────────────────────────────── */

create table if not exists public.terms_acceptances (
  user_id     uuid not null references public.users (id) on delete cascade,
  version     text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

create table if not exists public.member_profiles (
  user_id           uuid primary key references public.users (id) on delete cascade,
  bio_md            text,
  expertise         text[] not null default '{}',
  show_in_directory boolean not null default true,
  updated_at        timestamptz not null default now()
);

create table if not exists public.feature_flags (
  key        text primary key,
  enabled    boolean not null default false,
  payload    jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

/* ── LMS refinements ─────────────────────────────────────────────────── */

create table if not exists public.lesson_resources (
  id             uuid primary key default gen_random_uuid(),
  lesson_id      uuid not null references public.lessons (id) on delete cascade,
  title          text not null,
  storage_key    text not null,
  size_bytes     integer not null default 0,
  mime           text not null default 'application/octet-stream',
  rank           numeric not null default '1000',
  download_count integer not null default 0
);
create index if not exists lesson_resources_lesson_idx on public.lesson_resources (lesson_id);

create table if not exists public.lesson_questions (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references public.lessons (id) on delete cascade,
  author_id  uuid not null references public.users (id) on delete cascade,
  parent_id  uuid references public.lesson_questions (id) on delete cascade,
  body_md    text not null,
  resolved   boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lesson_questions_lesson_idx on public.lesson_questions (lesson_id, created_at);

create table if not exists public.lesson_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  lesson_id  uuid not null references public.lessons (id) on delete cascade,
  body_md    text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create table if not exists public.certificates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  course_id  uuid not null,
  code       text not null unique,
  issued_at  timestamptz not null default now(),
  pdf_key    text
);
create index if not exists certificates_user_idx on public.certificates (user_id);

/* ── Photolancer ─────────────────────────────────────────────────────── */

do $$ begin
  create type public.brief_status as enum ('open', 'assigned', 'closed');
exception when duplicate_object then null; end $$;

create table if not exists public.freelance_briefs (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.users (id) on delete cascade,
  title        text not null,
  body_md      text not null,
  city         text,
  budget_paise integer,
  shoot_on     date,
  status       public.brief_status not null default 'open',
  created_at   timestamptz not null default now()
);
create index if not exists freelance_briefs_status_idx on public.freelance_briefs (status, created_at);

create table if not exists public.freelance_applications (
  id           uuid primary key default gen_random_uuid(),
  brief_id     uuid not null references public.freelance_briefs (id) on delete cascade,
  applicant_id uuid not null references public.users (id) on delete cascade,
  pitch_md     text not null,
  status       text not null default 'applied',
  created_at   timestamptz not null default now(),
  unique (brief_id, applicant_id)
);
create index if not exists freelance_applications_brief_idx on public.freelance_applications (brief_id);

/* ── Support ─────────────────────────────────────────────────────────── */

create table if not exists public.impersonation_sessions (
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid not null references public.users (id) on delete cascade,
  target_user_id uuid not null references public.users (id) on delete cascade,
  reason         text not null,
  started_at     timestamptz not null default now(),
  ends_at        timestamptz not null
);
create index if not exists impersonation_target_idx on public.impersonation_sessions (target_user_id);

/* ── Outbox emission ───────────────────────────────────────────────────
   The app cannot insert into outbox (service-role-only). Triggers emit
   alongside the change so the event cannot exist without it. */

create or replace function public.emit_outbox(topic text, payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.outbox (topic, payload) values (topic, payload);
end; $$;

create or replace function public.on_insight_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (old.status is distinct from 'published') then
    perform public.emit_outbox('insight.published',
      jsonb_build_object('insightId', new.id, 'authorId', new.author_id));
  end if;
  return new;
end; $$;
drop trigger if exists insights_outbox on public.insights;
create trigger insights_outbox after update on public.insights
  for each row execute function public.on_insight_published();

create or replace function public.on_win_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (old.status is distinct from 'published') then
    perform public.emit_outbox('win.published',
      jsonb_build_object('winId', new.id, 'authorId', new.author_id));
  end if;
  return new;
end; $$;
drop trigger if exists wins_outbox on public.wins;
create trigger wins_outbox after update on public.wins
  for each row execute function public.on_win_published();

create or replace function public.on_event_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.emit_outbox('event.scheduled', jsonb_build_object('eventId', new.id));
  return new;
end; $$;
drop trigger if exists events_outbox on public.events;
create trigger events_outbox after insert on public.events
  for each row execute function public.on_event_created();

/* ── Row Level Security ──────────────────────────────────────────────── */

alter table public.insight_domains     enable row level security;
alter table public.insight_impact_areas enable row level security;
alter table public.vote_cycles         enable row level security;
alter table public.insights            enable row level security;
alter table public.insight_steps       enable row level security;
alter table public.insight_votes       enable row level security;
alter table public.bookmarks           enable row level security;
alter table public.solutions           enable row level security;
alter table public.unmatched_dilemmas  enable row level security;
alter table public.wins                enable row level security;
alter table public.win_media           enable row level security;
alter table public.reactions           enable row level security;
alter table public.win_comments        enable row level security;
alter table public.events              enable row level security;
alter table public.event_rsvps         enable row level security;
alter table public.event_insights      enable row level security;
alter table public.badge_defs          enable row level security;
alter table public.user_badges         enable row level security;
alter table public.reports             enable row level security;
alter table public.channel_moderators  enable row level security;
alter table public.audit_log           enable row level security;
alter table public.terms_acceptances   enable row level security;
alter table public.member_profiles     enable row level security;
alter table public.feature_flags       enable row level security;
alter table public.lesson_resources    enable row level security;
alter table public.lesson_questions    enable row level security;
alter table public.lesson_notes        enable row level security;
alter table public.certificates        enable row level security;
alter table public.freelance_briefs    enable row level security;
alter table public.freelance_applications enable row level security;
alter table public.impersonation_sessions enable row level security;

-- Public lookups readable by any authenticated member.
create policy insight_domains_select on public.insight_domains for select to authenticated using (true);
create policy insight_impact_areas_select on public.insight_impact_areas for select to authenticated using (true);
create policy vote_cycles_select on public.vote_cycles for select to authenticated using (true);
create policy solutions_select on public.solutions for select to authenticated using (true);
create policy badge_defs_select on public.badge_defs for select to authenticated using (true);
create policy events_select on public.events for select to authenticated
  using (public.tier_allows(public.current_tier(), min_tier));

-- Insights: published visible, drafts only to author + admin.
create policy insights_select on public.insights for select to authenticated
  using (status = 'published' or author_id = auth.uid() or public.is_admin());
create policy insights_insert on public.insights for insert to authenticated with check (author_id = auth.uid());
create policy insights_update on public.insights for update to authenticated
  using (author_id = auth.uid() or public.is_admin()) with check (author_id = auth.uid() or public.is_admin());
create policy insight_steps_select on public.insight_steps for select to authenticated using (true);
create policy insight_steps_write on public.insight_steps for all to authenticated
  using (public.is_admin() or exists (select 1 from public.insights i where i.id = insight_id and i.author_id = auth.uid()))
  with check (public.is_admin() or exists (select 1 from public.insights i where i.id = insight_id and i.author_id = auth.uid()));
create policy insight_votes_all on public.insight_votes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy bookmarks_all on public.bookmarks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy unmatched_insert on public.unmatched_dilemmas for insert to authenticated with check (true);
create policy unmatched_select on public.unmatched_dilemmas for select to authenticated using (public.is_admin() or user_id = auth.uid());

-- Wins: published visible (public_share ones even anonymously via service role only);
-- pending visible to author + admin.
create policy wins_select on public.wins for select to authenticated
  using (status = 'published' or author_id = auth.uid() or public.is_admin());
create policy wins_insert on public.wins for insert to authenticated with check (author_id = auth.uid());
create policy wins_update on public.wins for update to authenticated
  using (author_id = auth.uid() or public.is_admin()) with check (true);
create policy win_media_select on public.win_media for select to authenticated using (true);
create policy win_media_write on public.win_media for all to authenticated
  using (public.is_admin() or exists (select 1 from public.wins w where w.id = win_id and w.author_id = auth.uid()))
  with check (public.is_admin() or exists (select 1 from public.wins w where w.id = win_id and w.author_id = auth.uid()));
create policy reactions_all on public.reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy win_comments_select on public.win_comments for select to authenticated using (true);
create policy win_comments_insert on public.win_comments for insert to authenticated with check (author_id = auth.uid());
create policy win_comments_update on public.win_comments for update to authenticated
  using (author_id = auth.uid() or public.is_admin()) with check (true);

-- Events: tier-gated read; RSVPs own-row.
create policy event_rsvps_all on public.event_rsvps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy event_insights_select on public.event_insights for select to authenticated using (true);

-- Badges: earned rows readable by owner; awarded by service role only (no write policy).
create policy user_badges_select on public.user_badges for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Moderation: members can report and read their own; queue is admin-only.
create policy reports_insert on public.reports for insert to authenticated with check (true);
create policy reports_select on public.reports for select to authenticated
  using (public.is_admin() or reporter_id = auth.uid());
create policy channel_moderators_select on public.channel_moderators for select to authenticated using (true);
create policy audit_log_select on public.audit_log for select to authenticated using (public.is_admin());

-- Consent + directory + flags.
create policy terms_all on public.terms_acceptances for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy member_profiles_select on public.member_profiles for select to authenticated
  using (show_in_directory or user_id = auth.uid() or public.is_admin());
create policy member_profiles_write on public.member_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy feature_flags_select on public.feature_flags for select to authenticated using (true);

-- LMS refinements.
create policy lesson_resources_select on public.lesson_resources for select to authenticated using (true);
create policy lesson_questions_select on public.lesson_questions for select to authenticated using (true);
create policy lesson_questions_insert on public.lesson_questions for insert to authenticated with check (author_id = auth.uid());
create policy lesson_questions_update on public.lesson_questions for update to authenticated
  using (author_id = auth.uid() or public.is_admin()) with check (true);
create policy lesson_notes_all on public.lesson_notes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy certificates_select on public.certificates for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Photolancer: open briefs visible; applications visible to brief author + applicant + admin.
create policy briefs_select on public.freelance_briefs for select to authenticated using (true);
create policy briefs_insert on public.freelance_briefs for insert to authenticated with check (author_id = auth.uid());
create policy briefs_update on public.freelance_briefs for update to authenticated
  using (author_id = auth.uid() or public.is_admin()) with check (true);
create policy freelance_applications_all on public.freelance_applications for all to authenticated
  using (applicant_id = auth.uid() or public.is_admin()
    or exists (select 1 from public.freelance_briefs b where b.id = brief_id and b.author_id = auth.uid()))
  with check (applicant_id = auth.uid());

-- Impersonation: admin-only read. Rows are written by the API under service role.
create policy impersonation_select on public.impersonation_sessions for select to authenticated using (public.is_admin());

-- Seed the six domains + badge catalogue + flags so a fresh database is usable.
insert into public.insight_domains (slug, name, rank) values
  ('business','Business','100'),('marketing','Marketing','200'),('mindset','Mindset','300'),
  ('sales','Sales','400'),('operations','Operations','500'),('relationships','Relationships','600')
on conflict (slug) do nothing;

insert into public.badge_defs (id, name, description, icon, rule) values
  ('first-lesson','First Lesson','Complete your first lesson','play','{"kind":"lessons_completed","count":1}'),
  ('ten-lessons','Momentum x10','Complete 10 lessons','zap','{"kind":"lessons_completed","count":10}'),
  ('first-insight','First Insight','Publish your first Think Tank insight','bulb','{"kind":"insights_published","count":1}'),
  ('first-win','First Win','Publish your first win','trophy','{"kind":"wins_published","count":1}'),
  ('week-streak','7-Day Streak','Learn 7 days in a row','flame','{"kind":"streak_days","count":7}'),
  ('helper','Helper','Answer 5 lesson questions','hands','{"kind":"questions_answered","count":5}')
on conflict (id) do nothing;

insert into public.feature_flags (key, enabled, payload) values
  ('direct_messages', false, '{"reason":"moderation policy undecided — deliberately off in v1"}'),
  ('public_win_pages', true, '{}'),
  ('certificates', true, '{}')
on conflict (key) do nothing;
