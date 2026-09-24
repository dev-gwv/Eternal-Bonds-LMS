-- Challenges: a reason to post this week.
--
-- The club's real problem is not that there is nowhere to share work — the
-- wins board has been there since the beginning — it is that nothing ever
-- asks. An empty box captioned "share a win" is a blank page, and a blank page
-- with no deadline is something everybody intends to fill later. A challenge
-- is the opposite of a blank page: one prompt, one week, everybody at once.
--
-- The important decision here is what an *entry* is, and the answer is: a win.
--
-- Not a new table. A challenge entry wants photographs, comments, reactions,
-- moderation of first-time posters, a public share link, and XP — and every
-- one of those already exists, working, on `wins`. Building `challenge_entries`
-- beside it would mean a third copy of the media pipeline (after post_media and
-- win_media), a second moderation queue, a second set of counters to drift, and
-- a member learning two ways to post the same photograph.
--
-- So a challenge is a prompt, and `wins.challenge_id` is the whole join. An
-- entry is a win that happens to be answering a question. It appears on the
-- board like any other, because it *is* one — which is also how a challenge
-- keeps paying after it closes.

begin;

-- draft: being written, invisible.
-- open: accepting entries.
-- closed: visible, judged or not, no longer accepting.
--
-- No 'judging' state. It would be a fourth thing to explain and a third thing
-- for the cron to get wrong, and the honest version of judging is "closed, and
-- the winner is not picked yet" — which `winner_win_id is null` already says.
do $$ begin
  create type public.challenge_status as enum ('draft', 'open', 'closed');
exception when duplicate_object then null;
end $$;

create table if not exists public.challenges (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  -- The prompt, in one line, in the member's language. This is the product:
  -- "One light, one portrait" is a thing somebody can picture doing on Sunday.
  prompt        text not null,
  brief_md      text,
  status        public.challenge_status not null default 'draft',
  -- Dates rather than timestamps: a challenge runs for days, and a member in
  -- Kochi and one in Delhi should not get different answers about whether it
  -- is open.
  starts_on     date not null,
  ends_on       date not null,
  min_tier      public.tier not null default 'free',
  -- Set when somebody picks one. Nullable forever is a valid outcome: not
  -- every prompt needs a winner, and an unjudged challenge is better than a
  -- rushed judgement.
  winner_win_id uuid references public.wins (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint challenges_dates_ordered check (ends_on >= starts_on)
);

create index if not exists challenges_status_idx on public.challenges (status, starts_on desc);

-- The join, and the whole of it.
alter table public.wins add column if not exists challenge_id uuid
  references public.challenges (id) on delete set null;

-- `on delete set null`, not cascade. Deleting a prompt must never delete the
-- photographs people took for it; the work outlives the question that prompted
-- it and stays on the board.
create index if not exists wins_challenge_idx on public.wins (challenge_id) where challenge_id is not null;

commit;

begin;

alter table public.challenges enable row level security;

-- A draft is invisible; anything else is visible to any signed-in member
-- whatever their tier. `min_tier` gates *entering*, not seeing — a free member
-- who can see what Diamond is doing this week is a free member with a reason
-- to upgrade, and hiding it means the upgrade has to be explained rather than
-- shown. Same argument as journeys.
drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges
  for select to authenticated
  using (status <> 'draft' or public.is_admin());

drop policy if exists challenges_admin_write on public.challenges;
create policy challenges_admin_write on public.challenges
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;

begin;

-- One entry per member per challenge.
--
-- In the schema rather than in a handler, because "did they already enter" is
-- a read-then-write and two tabs is all it takes to lose that race. A partial
-- unique index, so the millions of wins with no challenge are unaffected.
create unique index if not exists wins_one_entry_per_challenge_idx
  on public.wins (challenge_id, author_id)
  where challenge_id is not null;

commit;

begin;

-- Entering a closed challenge.
--
-- The API checks this too, and the API is not enough: it is one `if` away from
-- a member entering a challenge that ended in March and appearing at the top
-- of a board nobody is judging any more. The database is where a rule survives
-- a refactor.
create or replace function public.wins_challenge_is_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.challenges%rowtype;
begin
  if new.challenge_id is null then
    return new;
  end if;

  select * into ch from public.challenges where id = new.challenge_id;
  if not found then
    raise exception 'That challenge does not exist';
  end if;

  -- Admins can file an entry against a closed challenge, because somebody has
  -- to be able to fix a member whose upload failed on the last evening.
  if public.is_admin() then
    return new;
  end if;

  if ch.status <> 'open' then
    raise exception 'That challenge is not open for entries';
  end if;
  if current_date > ch.ends_on then
    raise exception 'That challenge closed on %', to_char(ch.ends_on, 'DD Mon');
  end if;
  if not public.tier_allows(ch.min_tier) then
    raise exception 'That challenge is for % members and above', ch.min_tier;
  end if;

  return new;
end $$;

drop trigger if exists wins_challenge_is_open_trg on public.wins;
create trigger wins_challenge_is_open_trg
  before insert or update of challenge_id on public.wins
  for each row execute function public.wins_challenge_is_open();

commit;

begin;

-- The three things a challenge says out loud.
alter type public.notification_kind add value if not exists 'challenge.open';
alter type public.notification_kind add value if not exists 'challenge.ending';
alter type public.notification_kind add value if not exists 'challenge.won';

commit;
