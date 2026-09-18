-- Billing: plans, orders, payments, and the webhook ledger.
--
-- Until now `memberships` rows were created by hand. This is what lets someone
-- pay for one.
--
-- The rule the whole design serves: **a membership is granted by the webhook,
-- never by the browser.** The browser tells us a payment succeeded; Razorpay
-- tells us it actually did. Trusting the first is how people end up with free
-- diamond memberships.

create type public.order_status as enum ('created', 'paid', 'failed', 'refunded', 'abandoned');

/* ── Plans ───────────────────────────────────────────────────────────────── */

-- In the database rather than in code because prices change, and a price
-- change must not require a deploy — nor should it silently rewrite what
-- somebody already paid. `orders` snapshots the amount at purchase time.
create table if not exists public.plans (
  id            text primary key,
  name          text not null,
  tier          public.tier not null,
  -- Paise, not rupees. Money in a float is how ₹4,999.00 becomes ₹4,998.99.
  amount_paise  integer not null check (amount_paise >= 0),
  currency      text not null default 'INR',
  duration_days integer not null check (duration_days > 0),
  description   text,
  is_active     boolean not null default true,
  rank          integer not null default 100
);

insert into public.plans (id, name, tier, amount_paise, currency, duration_days, description, rank) values
  ('silver-annual',   'Silver',     'silver',     499900,  'INR', 365, 'Community, library and the recorded workshop archive.', 10),
  ('diamond-annual',  'Diamond',    'diamond',    1499900, 'INR', 365, 'Everything in Silver, plus every course and every live workshop.', 20),
  ('franchisee-year', 'Franchisee', 'franchisee', 4999900, 'INR', 365, 'Diamond, plus franchise operations material and direct mentoring.', 30)
on conflict (id) do nothing;

/* ── Orders and payments ─────────────────────────────────────────────────── */

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  plan_id           text not null references public.plans (id),
  -- Snapshotted, so a later price change never rewrites history.
  amount_paise      integer not null,
  currency          text not null default 'INR',
  status            public.order_status not null default 'created',
  provider          text not null default 'razorpay',
  provider_order_id text,
  notes             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists orders_provider_order_key on public.orders (provider, provider_order_id)
  where provider_order_id is not null;
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  provider_payment_id text not null,
  amount_paise        integer not null,
  currency            text not null default 'INR',
  status              text not null,
  method              text,
  captured_at         timestamptz,
  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- The same payment id arriving twice is a retry, not a second payment.
create unique index if not exists payments_provider_key on public.payments (provider_payment_id);

/* ── Webhook ledger ──────────────────────────────────────────────────────── */

-- Providers retry webhooks, sometimes for days, and deliver out of order.
-- Recording every delivery by its provider id makes replays free to ignore and
-- gives us the raw body when something needs explaining months later.
create table if not exists public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

create unique index if not exists webhook_events_key on public.webhook_events (provider, event_id);
create index if not exists webhook_events_unprocessed_idx on public.webhook_events (received_at)
  where processed_at is null;

/* ── Granting a membership ───────────────────────────────────────────────── */

-- Called only from the webhook path, under the service role.
--
-- Extending rather than replacing: someone who renews four months early should
-- get sixteen months, not twelve. Anything else quietly steals time from the
-- people most willing to pay early.
create or replace function public.grant_membership(
  p_user_id uuid,
  p_plan_id text,
  p_source  text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_tier public.tier;
  v_days integer;
  v_from timestamptz;
begin
  select tier, duration_days into v_tier, v_days from public.plans where id = p_plan_id;
  if v_tier is null then
    raise exception 'Unknown plan %', p_plan_id;
  end if;

  select greatest(coalesce(max(expires_at), now()), now()) into v_from
  from public.memberships
  where user_id = p_user_id and tier = v_tier and status = 'active';

  insert into public.memberships (user_id, tier, status, source, started_at, expires_at)
  values (p_user_id, v_tier, 'active', p_source, now(), v_from + (v_days || ' days')::interval);

  insert into public.notifications (user_id, kind, title, body, link, subject_type, subject_id)
  values (
    p_user_id,
    'membership.activated',
    'Your ' || v_tier || ' membership is active',
    'It runs until ' || to_char(v_from + (v_days || ' days')::interval, 'DD Mon YYYY') || '.',
    '/account',
    'plan',
    null
  );
end;
$$;

/* ── Row Level Security ──────────────────────────────────────────────────── */

alter table public.plans          enable row level security;
alter table public.orders         enable row level security;
alter table public.payments       enable row level security;
alter table public.webhook_events enable row level security;

-- The price list is public: a signed-out visitor has to be able to see what
-- membership costs before deciding to become one.
create policy plans_select on public.plans
  for select to authenticated, anon using (is_active or public.is_admin());

create policy plans_admin_write on public.plans
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- A member sees their own orders and nothing else. Crucially there is **no
-- update policy**: status is set by the webhook under the service role, so no
-- client can mark their own order paid.
create policy orders_select_own on public.orders
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy payments_select_own on public.payments
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));

-- webhook_events: service-role only, deliberately no policy. It holds raw
-- provider payloads, which are nobody's business but ours.

-- The billing surface needs its own schedule entries.
insert into public.job_schedule (kind) values ('webhooks.process'), ('memberships.expire'), ('notifications.deliver')
on conflict (kind) do nothing;
