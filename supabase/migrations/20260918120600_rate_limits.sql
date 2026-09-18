-- Rate limiting moves out of process memory for the same reason idempotency
-- did: an in-memory counter divided by N instances is a limit of N×. The OTP
-- endpoint this protects is the one that turns into somebody else's SMS bill,
-- so "roughly enforced" is not good enough.

create table if not exists public.rate_limits (
  bucket    text primary key,
  count     integer not null default 0,
  reset_at  timestamptz not null
);

create index if not exists rate_limits_reset_idx on public.rate_limits (reset_at);

alter table public.rate_limits enable row level security;
-- Service-role only. A member being able to read their own counter would be
-- harmless; being able to write it would not.

-- Sweeping is cheap and keeps both tables from growing without bound. Seeded
-- here so the worker picks them up on its next pass.
insert into public.job_schedule (kind) values ('sweep.expired')
on conflict (kind) do nothing;
