-- The ledger that stops a challenge becoming spam.
--
-- Same pattern, and the same reason, as `module_unlock_notices` and
-- `onboarding_notices`: the dedupe index on `notifications` is keyed on
-- (user, kind, subject), and a member can read or delete a notification — so
-- the notifications table cannot answer "have we already said this?" a week
-- later. A ledger the member cannot touch can.
--
-- It matters more here than elsewhere. The closing reminder goes to everybody
-- who has not entered, which is most of the club, and a job that runs hourly
-- would send it hourly for the whole of the last day.

begin;

create table if not exists public.challenge_notices (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id      uuid not null references public.users (id)      on delete cascade,
  -- 'ending' once, two days out. 'won' once, when a winner is chosen. An admin
  -- changing their mind sends the new winner a message and does not send the
  -- old one a second.
  kind         text not null,
  sent_at      timestamptz not null default now(),
  primary key (challenge_id, user_id, kind)
);

alter table public.challenge_notices enable row level security;

-- Nobody reads this from the application. It exists for the worker, which
-- connects as the owner and is not subject to RLS; leaving it with RLS on and
-- no policy is the correct closed default rather than an oversight.
revoke all on public.challenge_notices from authenticated, anon;

commit;
