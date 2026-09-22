-- Completion nudges.
--
-- The members console can already point at the people worth a message. This is
-- the part that does not need Abdullah to be awake: a member who started a
-- course and stopped is the most recoverable person in the club, and nobody
-- was going to hand-write eight hundred of those.
--
-- The whole design is about *not* becoming spam. Three things enforce that:
--
--   1. Stages. A member is nudged at most once per stage per course — quiet,
--      then a week, then three weeks, then six, and after that never again for
--      that course. An unbounded reminder is how an app gets muted.
--   2. A per-member floor. `learning_nudges` records every send, so the job
--      can refuse to touch anybody nudged in the last five days regardless of
--      how many courses they have abandoned.
--   3. It stops at completion. Finishing the course ends the sequence, and the
--      rows stay so a re-enrolment does not start the nagging over.

begin;

alter type public.notification_kind add value if not exists 'learning.nudge';

commit;

begin;

create table if not exists public.learning_nudges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id)   on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade,
  -- 0 enrolled and never opened it · 1 a week quiet · 2 three weeks · 3 six weeks
  stage      smallint not null,
  sent_at    timestamptz not null default now()
);

-- The idempotency that makes the job safe to run every hour forever.
create unique index if not exists learning_nudges_once_idx
  on public.learning_nudges (user_id, course_id, stage);

-- The per-member floor query: "when did we last bother this person?"
create index if not exists learning_nudges_recent_idx
  on public.learning_nudges (user_id, sent_at desc);

alter table public.learning_nudges enable row level security;

-- A member may see what was sent to them; nothing writes through the API. The
-- job runs as the service role, which bypasses this entirely — deliberately,
-- so no policy can be tricked into forging a nudge.
create policy learning_nudges_select_own on public.learning_nudges
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

commit;
