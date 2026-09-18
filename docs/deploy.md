# Deploying

Three things get deployed, and they do not all belong in the same place.

| Piece | Where | Why there |
|---|---|---|
| `apps/web` | Cloudflare (static assets) | It is a built bundle. Cloudflare serves it from everywhere, free, with no origin. |
| `services/api` | Fly.io, Mumbai (container) | It holds a Postgres connection pool. Pooling is what the edge is worst at. |
| `services/worker` | Fly.io, Mumbai (container, no public address) | A loop that has to keep running. |

You can run the API on Cloudflare Workers instead — the entrypoint exists and
is supported (`services/api/src/worker.ts`). Read [Running the API on
Workers](#running-the-api-on-workers) before you do; it needs Hyperdrive, and
the reasons it is not the default are real.

Nothing below is Cloudflare-specific by accident. The
[portability contract](portability-contract.md) is what makes the API movable,
and this document is the proof that it holds: the same code runs under
`Bun.serve`, under Workers, and in a container, with no `if (platform)` in it.

---

## Before the first deploy

### 1. Rotate the database password

The password used during development was typed into a chat transcript. Change
it in **Supabase → Project Settings → Database → Reset database password**, and
use the new one everywhere below. This is not optional.

### 2. Make yourself an admin

The studio is invisible until a real row says you may author. There is no UI
for this on purpose — self-service admin is not a feature.

```sql
update public.users set role = 'admin' where email = 'you@yourdomain.com';
```

You have to have signed in once first, so the profile row exists.

### 3. Apply the migrations

```bash
bun x supabase db push --db-url "$DATABASE_URL"
bun run db:verify          # schema, RLS, policies, functions, bucket, jobs
bun run db:test-rls        # members cannot read each other's data
bun run db:test-studio     # only admins can author
bun run db:test-engagement # likes, threads, notifications, membership grants
bun test                   # 31 unit tests, no database needed
```

All of them have to pass. `db:verify` also checks that the `ipc-media` bucket
exists and is **private** — a public bucket would make every paid lesson
readable by anyone holding the object key, which is the whole access model
undone in one setting.

---

## Secrets

The single rule: **`VITE_*` is public, everything else is not.**

Vite compiles `VITE_*` values into the JavaScript bundle at build time. They
are readable by anyone who opens devtools. That is fine for the Supabase URL
and the publishable key, which are designed to be public and are protected by
RLS. It is catastrophic for anything else.

| Variable | Where it goes | Public? |
|---|---|---|
| `VITE_API_URL` | web build env | yes — it is a URL people's browsers call |
| `VITE_SUPABASE_URL` | web build env | yes |
| `VITE_SUPABASE_ANON_KEY` | web build env | yes — RLS is what protects the data, not this key |
| `DATABASE_URL` | API + worker secret | **no** |
| `SUPABASE_SERVICE_ROLE_KEY` | API + worker secret | **no** — it bypasses RLS entirely |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | API secret | harmless, but keep them together |
| `CRON_SECRET` | API secret | **no** |
| `ALLOWED_ORIGINS` | API var | not secret |
| `RAZORPAY_KEY_ID` | API secret | it reaches the browser via `/v1/billing/orders`, which is correct — it is the publishable half |
| `RAZORPAY_KEY_SECRET` | API secret | **no** |
| `RAZORPAY_WEBHOOK_SECRET` | API secret | **no** |
| `VIDEO_API_TOKEN` / `VIDEO_SIGNING_KEY_PEM` | API + worker secret | **no** |
| `VIDEO_WEBHOOK_SECRET` | API secret | **no** |
| `EMAIL_API_KEY` | worker secret | **no** |
| `FCM_PRIVATE_KEY` | worker secret | **no** |

If you ever find yourself naming a secret `VITE_SOMETHING` to "make it
available in the frontend", stop: the frontend is the one place it must never
be.

### Why `.env` exists at all

`.env` is local development only, it is gitignored, and it is never copied into
an image — `.dockerignore` excludes it. On a server it is replaced by the
platform's secret store (`fly secrets set`, `wrangler secret put`), which is
better in three ways: the value is encrypted at rest, it is not sitting in a
file a stray `cat` can print, and rotating it does not need a rebuild.

---

## The web app → Cloudflare

```bash
bun x wrangler login

VITE_API_URL=https://api.yourdomain.com \
VITE_SUPABASE_URL=https://xxxx.supabase.co \
VITE_SUPABASE_ANON_KEY=sb_publishable_… \
bun run deploy:web
```

`apps/web/wrangler.jsonc` serves `dist/` with
`not_found_handling: "single-page-application"`, because TanStack Router owns
the URL space — a deep link like `/admin/courses/<id>` has to reach the bundle
rather than 404 at the edge.

Then point a custom domain at the Worker in the Cloudflare dashboard, and add
that domain to `ALLOWED_ORIGINS` on the API.

---

## The API → Fly

```bash
fly launch --no-deploy        # once, to create the app
fly secrets set \
  DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" \
  SUPABASE_URL="https://xxxx.supabase.co" \
  SUPABASE_ANON_KEY="sb_publishable_…" \
  SUPABASE_SERVICE_ROLE_KEY="…" \
  CRON_SECRET="$(openssl rand -hex 32)"

fly deploy
curl https://api.yourdomain.com/health
```

`/health` answers `"source": "supabase"` when `DATABASE_URL` is set and
`"source": "seed"` when it is not. If you see `seed` in production, the secret
did not arrive — the API will happily serve fixtures rather than crash, which
is right for a laptop and wrong for a server, so check it.

Use the **session pooler** URL (port 5432, `aws-0-ap-south-1.pooler…`), not the
direct one. The direct host resolves to IPv6 only, which most container hosts
cannot reach. Percent-encode the password: an `@` in a connection string ends
the userinfo section and the URL silently means something else.

---

## Webhooks

Two endpoints live outside `/v1`, because a provider cannot be asked to migrate
when we bump a version:

| Provider | URL | Secret |
|---|---|---|
| Cloudflare Stream / Bunny | `https://api.yourdomain.com/webhooks/video` | `VIDEO_WEBHOOK_SECRET` |
| Razorpay | `https://api.yourdomain.com/webhooks/razorpay` | `RAZORPAY_WEBHOOK_SECRET` |

Subscribe Razorpay to `payment.captured`, `payment.failed`, `order.paid` and
`refund.processed`. The membership is granted by `payment.captured` — **not**
by the browser's success callback, which is a `fetch` anybody can issue.

Both verify the signature against the raw body and record every delivery in
`webhook_events` by provider event id, so retries are free to ignore. See
[`docs/video.md`](video.md) for the details.

If a handler ever throws, the row keeps its error and `webhooks.process` replays
it every five minutes for three days. That is the difference between "a database
blip lost somebody's membership" and "it was granted ninety seconds late".

## Email and push

Both default to a console adapter that logs what it would have sent. That is
not a placeholder:

- **Email** — sending from a domain without SPF, DKIM and DMARC is how a club's
  address ends up on a blocklist on its first campaign, permanently. Set those
  DNS records, verify the domain with Resend, *then* set `EMAIL_PROVIDER=resend`.
- **Push** — FCM is fully implemented, but nothing has ever received a
  notification because no signed app exists yet (M7). Turning it on before then
  produces perfect logs of messages nobody gets.

## The worker → Fly

```bash
fly launch --no-deploy -c fly.worker.toml
fly secrets set --app ipc-worker \
  DATABASE_URL="…" \
  SUPABASE_SERVICE_ROLE_KEY="…"

fly deploy -c fly.worker.toml
fly logs --app ipc-worker
```

It has no public address and no health check port — nothing outside should be
able to reach it. Run one machine: a second would do the same work twice.
(It would be *safe* — the queue claims rows `FOR UPDATE SKIP LOCKED` — just
wasteful.)

To run a single job by hand:

```bash
fly ssh console --app ipc-worker -C "bun services/worker/src/main.ts run rollup.member_stats"
```

---

## Running the API on Workers

Supported, with conditions.

```bash
wrangler hyperdrive create ipc-db --connection-string "$DATABASE_URL"
# paste the returned id into services/api/wrangler.jsonc

cd services/api
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put CRON_SECRET
wrangler deploy
```

What you need to know before choosing this:

- **Hyperdrive is not optional.** Without it every request opens its own
  Postgres connection from whichever edge location got it, and Supabase's
  pooler will run out of connections long before your traffic does.
- **`nodejs_compat` is required** for `postgres.js` to run at all.
- **Cron Triggers replace the worker process.** `scheduled()` in
  `worker.ts` calls `dueJobs()` and runs what is due, in-process. If you deploy
  this way, do not also run the Fly worker — they would duplicate each other.
- **`/internal/cron/:job` still works** either way, guarded by `CRON_SECRET`.
  That endpoint is what makes the schedule portable: a cron container running
  `curl`, a Cloudflare trigger, or a systemd timer all drive the same jobs.

The honest summary: Workers is a good fit for the web bundle and a workable fit
for the API. Fly is the better fit for the API today because the API's job is
to hold a connection pool, and that is a stateful thing to be doing at the
edge.

---

## CI and the deploy workflow

Two workflows, both in `.github/workflows/`:

**`ci.yml`** — on every push and pull request.

1. `check` — typecheck every workspace, run the 31 unit tests, build.
2. `database` — applies migrations to a **staging** project, then runs
   `verify-supabase`, `test-rls`, `test-studio` and `test-engagement` against
   it. These create and delete real rows; never point them at production.

**`deploy.yml`** — on every push to `main`, and manually from the Actions tab
(*Run workflow*, with a target picker for re-running just one piece).

```
verify ──► migrations ──► api ──► worker
    └────────────────────► web
```

Migrations run **before** the code that depends on them. Every migration so far
is additive, which is what makes that order safe; a destructive one (dropping a
column, renaming in place) needs a two-step release instead — ship the code
that tolerates both shapes, then the migration, then the cleanup.

The API deploy then polls `/health` until it answers `"source": "supabase"`. If
it says `"seed"`, the `DATABASE_URL` secret never reached the app and the job
fails: an API quietly serving fixtures in production is worse than one that is
visibly down.

### It turns itself on as you configure it

Both workflows start with a `gate` job that checks which secrets exist and
skips the rest accordingly. A freshly pushed repository gets a **green** CI run
that typechecks, tests and builds, and a deploy run that announces it deployed
nothing. Each target starts working the moment its secret is added — there is
no point at which the pipeline is red for the entirely correct reason that
nobody has created a Fly app yet.

### Settings → Secrets and variables → Actions

| Kind | Name | Needed for |
|---|---|---|
| Secret | `DATABASE_URL` | production migrations |
| Secret | `STAGING_DATABASE_URL` | the database suites in CI |
| Secret | `FLY_API_TOKEN` | API and worker deploys |
| Secret | `CLOUDFLARE_API_TOKEN` | web deploy |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | web deploy |
| Variable | `VITE_API_URL` | the web build |
| Variable | `VITE_SUPABASE_URL` | the web build |
| Variable | `VITE_SUPABASE_ANON_KEY` | the web build |
| Variable | `API_URL` | the post-deploy health check (optional) |

The `VITE_*` three are **variables, not secrets**, on purpose: they end up in a
public bundle, and filing them as secrets would be pretending otherwise. It
would also break the health check, since GitHub masks secret values in logs.

Everything else — `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`,
`VIDEO_API_TOKEN`, `EMAIL_API_KEY`, `FCM_PRIVATE_KEY` — lives in `fly secrets`,
not in GitHub. CI never needs them, and a credential that only exists in one
place is a credential with one place to leak from.

### The `production` environment

Every deploy job targets a GitHub environment called `production`. Creating it
is optional, but doing so gives you **Settings → Environments → production →
Required reviewers**, which turns every deploy into something a human approves.
Worth it the first time a push to `main` goes out at 2am.

---

## What is safe to run more than once

| Thing | Safe to run twice? |
|---|---|
| `supabase db push` | Yes — applied migrations are tracked and skipped. |
| `bun run db:seed` | Yes — upserts. |
| `db:verify` / `db:test-rls` / `db:test-studio` | Yes — the test scripts clean up after themselves, on failure too. |
| `fly deploy` | Yes. |
| Two API instances | Yes — rate limits and idempotency are in Postgres, not in memory. |
| Two worker instances | Yes, but pointless: `SKIP LOCKED` prevents double work. |

That last row is why `rate_limits` and `idempotency_keys` are database tables.
An in-memory counter divided across N instances is a limit of N × limit, and
for the OTP endpoint that is the difference between a cap and a suggestion.

---

## Rolling back

```bash
fly releases --app ipc-api
fly deploy --image <previous-image-ref>
```

Cloudflare keeps deployment history per Worker; roll back from the dashboard or
`wrangler rollback`.

**The database does not roll back with them.** Migrations are forward-only.
This is why they are additive: an old release meeting a new schema should find
extra columns it ignores, not missing ones it needs.
