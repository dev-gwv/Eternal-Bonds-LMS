-- Reminders for a member who joined and stopped.
--
-- Same ledger pattern as learning_nudges, same reason: the dedupe index on
-- notifications is keyed on (user, kind, subject) and a member can read or
-- delete a notification, so it cannot answer "have we already said this?" a
-- fortnight later. A ledger the member cannot touch can.
--
-- Two messages and then silence. Somebody who has not posted an introduction
-- after two weeks has decided, and a third reminder does not change that — it
-- just costs the goodwill needed for the messages that would have worked.

begin;

alter type public.notification_kind add value if not exists 'onboarding.nudge';

commit;

begin;

create table if not exists public.onboarding_notices (
  user_id uuid not null references public.users (id) on delete cascade,
  -- 1 on day two, 2 on day seven. Nothing after that.
  stage   smallint not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, stage)
);

alter table public.onboarding_notices enable row level security;

drop policy if exists onboarding_notices_select_own on public.onboarding_notices;
create policy onboarding_notices_select_own on public.onboarding_notices
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

commit;
