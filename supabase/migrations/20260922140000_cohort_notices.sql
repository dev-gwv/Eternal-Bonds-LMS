-- Ledgers for the two cohort messages.
--
-- Same pattern as learning_nudges, and for the same reason: the dedupe index
-- on notifications is keyed on (user, kind, subject) and a member can delete
-- or read a notification, so it cannot be relied on to answer "have we already
-- told this person?" a month later. A ledger the member cannot touch can.

begin;

alter type public.notification_kind add value if not exists 'learning.unlocked';
alter type public.notification_kind add value if not exists 'cohort.deadline';

commit;

begin;

-- "This module opened for you" — once per member per module, forever.
create table if not exists public.module_unlock_notices (
  user_id   uuid not null references public.users (id)   on delete cascade,
  module_id uuid not null references public.modules (id) on delete cascade,
  sent_at   timestamptz not null default now(),
  primary key (user_id, module_id)
);

-- "Your cohort ends next week and you are behind" — once per member per cohort.
create table if not exists public.cohort_deadline_notices (
  user_id   uuid not null references public.users (id)   on delete cascade,
  cohort_id uuid not null references public.cohorts (id) on delete cascade,
  sent_at   timestamptz not null default now(),
  primary key (user_id, cohort_id)
);

alter table public.module_unlock_notices    enable row level security;
alter table public.cohort_deadline_notices  enable row level security;

-- Readable by the person it concerns, writable only by the service role that
-- the job runs as. No insert policy exists deliberately: a member who could
-- write here could silence their own reminders, or forge somebody else's.
drop policy if exists module_unlock_notices_select_own on public.module_unlock_notices;
create policy module_unlock_notices_select_own on public.module_unlock_notices
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists cohort_deadline_notices_select_own on public.cohort_deadline_notices;
create policy cohort_deadline_notices_select_own on public.cohort_deadline_notices
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

commit;
