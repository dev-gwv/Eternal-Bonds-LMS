# Connecting Supabase

Fifteen minutes, once. Everything below assumes you are in the repo root.

## 1. Create the project

In the [Supabase dashboard](https://supabase.com/dashboard): **New project**.
Pick the **Mumbai (ap-south-1)** region — the club is in India and this is the
single biggest lever on how fast every query feels.

Save the database password it shows you. It is displayed once.

## 2. Fill in `.env`

```bash
cp .env.example .env
```

Four values, all from the dashboard:

| Variable | Where |
|---|---|
| `SUPABASE_URL`, `VITE_SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` — **server only**, it bypasses RLS |
| `DATABASE_URL` | Project Settings → Database → Connection string → **Session pooler** |

Use the **session pooler** string, not the direct connection. is **IPv6-only**, so most networks get  against it; the pooler is
IPv4 and is what a multi-instance deployment needs anyway.

Percent-encode the password. A literal  splits the URL at the wrong place and
you get a confusing host error —  becomes .

This project is on **aws-0-ap-south-1** (Mumbai).

## 3. Push the schema and check it

```bash
bun run db:setup    # push migrations + seed + verify
```

No `supabase login` or `link` needed — the CLI is pointed straight at
`DATABASE_URL`.

`db:setup` applies `supabase/migrations/`, loads `supabase/seed.sql`, then runs
`db:verify`, which checks every table exists, **RLS is enabled on all of them**,
every table has a policy, the SQL helpers and sign-up trigger are present, seed
rows landed — and then runs all seven worker jobs against real data.

Run `bun run db:verify` any time you want that proof again.

## 4. Turn on the sign-in methods you want

Authentication → Providers:

- **Phone** — needs an SMS provider. In India that means **DLT registration**,
  which has lead time measured in days, so start it before you need it.
  Rate limits on the OTP endpoint are already in place (PLAN §10.5) — leave
  them on; unprotected OTP endpoints get farmed for premium-rate traffic.
- **Email** — works immediately for magic links.
- **Google** — needs a client ID and secret from Google Cloud Console.

Set **Site URL** to `http://localhost:5173` for development, and add your
production domain plus `ipc://auth-callback` to the redirect allow-list when the
mobile build arrives.

## 5. Run it

```bash
bun dev             # api + web
bun run dev:worker  # rollups, streaks, digests
```

`/health` should now report `"source": "supabase"` instead of `"seed"`.

## What changes the moment this is connected

- The auth gate becomes real. An anonymous visitor gets the sign-in screen
  instead of demo mode — the same branch, no code change.
- `/v1/me` starts returning 401 without a valid token.
- Leaderboard, activity and stats come from the worker's rollups instead of
  seed content. They will read **zero** until members generate activity, which
  is correct, not broken.

## Rolling the service role key

If it ever leaks: Project Settings → API → roll `service_role`, update `.env`,
restart the API and worker. Nothing else stores it.
