-- Following a journey: the state that "Pick a path" was missing.
--
-- The button has always navigated and never enrolled. Everything downstream of
-- that is derived — progress is counted from `lesson_progress` across the
-- journey's courses — which sounds elegant and costs the three things a path
-- is actually for:
--
--   1. There is no "the path I am on". The dashboard cannot show it, because
--      every published journey has a progress number and nothing distinguishes
--      the one the member chose from the sixteen they did not. A member who is
--      three courses into "Zero to your first ₹1L" sees the same grid as
--      somebody who has never opened it.
--   2. Finishing cannot be noticed. Derived progress crosses 100% silently in
--      the middle of a lesson; there is no moment to congratulate, and the one
--      thing a named outcome earns you is the right to say "you did it".
--   3. Choosing cannot be measured. Whether journeys work at all is a question
--      about how many people pick one and how many of those finish, and
--      neither number exists without a row.
--
-- Still not a gate. Membership records a choice; it locks nothing, and a
-- member can follow a path they are already halfway through or drop one
-- without losing a lesson. That is the same promise the journeys table makes
-- and it would be strange to break it here.

begin;

create table if not exists public.journey_members (
  user_id      uuid not null references public.users (id)    on delete cascade,
  journey_id   uuid not null references public.journeys (id) on delete cascade,
  started_at   timestamptz not null default now(),
  -- Stamped by the `journey.complete` job, not by the reader that notices.
  -- A read that writes is a read that can be raced by two tabs, and this is
  -- the field a congratulation is sent exactly once off.
  completed_at timestamptz,
  primary key (user_id, journey_id)
);

create index if not exists journey_members_user_idx
  on public.journey_members (user_id, started_at desc);

-- The sweep the completion job runs: unfinished memberships, oldest first.
create index if not exists journey_members_open_idx
  on public.journey_members (journey_id) where completed_at is null;

commit;

begin;

alter table public.journey_members enable row level security;

-- Your own rows, and that is all. Who else is on a path is not a fact this
-- table is asked for anywhere, and "sixty people are on this journey" would be
-- a count endpoint rather than a licence to read the rows.
drop policy if exists journey_members_own on public.journey_members;
create policy journey_members_own on public.journey_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Following requires the journey to be visible. Without this check a member
-- could insert a row for an unpublished draft and then see it on their
-- dashboard, which is a slow leak of what the club is about to launch.
drop policy if exists journey_members_follow on public.journey_members;
create policy journey_members_follow on public.journey_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.journeys j
      where j.id = journey_id and (j.is_published or public.is_admin())
    )
  );

-- Unfollowing is always allowed, including for a journey that has since been
-- unpublished — otherwise a member can be stuck following something they can
-- no longer see.
drop policy if exists journey_members_unfollow on public.journey_members;
create policy journey_members_unfollow on public.journey_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

commit;

begin;

-- The congratulation. Its own kind so members can mute nudges without muting
-- the one message that is unambiguously good news.
alter type public.notification_kind add value if not exists 'journey.complete';

commit;
