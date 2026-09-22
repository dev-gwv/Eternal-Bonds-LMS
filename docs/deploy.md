# Deploying

Everything runs on **Cloudflare Workers**.

| Piece | What it is |
|---|---|
| `apps/web` | The member app and studio — a static bundle served from the edge |
| `services/api` | The Hono app, as a real Worker (`services/api/src/worker.ts`) |
| Background jobs | The same Worker's `scheduled()` handler, on a Cron Trigger |

Two deploys, one vendor, no containers. The API is Hono on Workers, which is
what Hono is for — the same `app` object also runs under `Bun.serve` locally,
with no `if (platform)` anywhere in between. That is the
[portability contract](portability-contract.md) doing its job.

### The database connection

Workers have no long-lived process to hold a connection pool, so the
`DATABASE_URL` secret must point at Supabase's **transaction pooler** — port
**6543**, not 5432. That pooler exists precisely for callers that come and go,
which is every Worker invocation.

`packages/db/src/client.ts` already sets `prepare: false`, which transaction-mode
pooling requires. Using the session pooler (5432) here would work for a while
and then start refusing connections under load.

**Hyperdrive is the upgrade, not the requirement.** It pools at Cloudflare's
edge and caches the handshake, which is worth real latency on every request:

```bash
bun x wrangler hyperdrive create ipc-db --connection-string "$DATABASE_URL"
# then add the id it prints to services/api/wrangler.jsonc:
#   "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<id>" }]
```

`worker.ts` prefers the binding over `DATABASE_URL` when it exists, so adding it
later changes one file and nothing else.

### If you would rather run the API in a container

`Dockerfile`, `fly.toml` and `fly.worker.toml` are still here and still work —
`bun run deploy:api:fly` and `bun run deploy:worker`. A container holds a real
connection pool next to the database, which is the one thing the edge is worst
at, and it is the right answer if the API ever gets CPU-heavy.

Nothing in the application code changes either way. If you switch, delete the
`triggers.crons` block from `services/api/wrangler.jsonc` — otherwise the Cron
Trigger and the worker process would do the same work twice.
[Jump to the Fly instructions](#the-container-alternative-fly).

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
bun test                   # 55 unit tests, no database needed
bun run smoke              # 22 endpoint checks against the app in seed mode
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

## The API → Cloudflare Workers

> **Pick the Worker name before anything else.** `wrangler deploy` is an
> **upsert**: if a Worker already exists under that name it is silently
> overwritten, with no prompt and output identical to a fresh deploy. The name
> has to be unique across the whole Cloudflare account, not just this project.
> Generic names collide — `ipc-web` here once overwrote an unrelated CRM.
>
> ```bash
> bun x wrangler deployments list --name <the-name-you-want>
> ```
>
> Deployments you do not recognise, or anything other than "Worker not found",
> means the name is taken. Cloudflare keeps version history, so an overwrite is
> recoverable — see [Rolling back](#rolling-back) — but do not rely on it.

```bash
bun x wrangler login

# One at a time; each prompts for the value and never echoes it.
cd services/api
bun x wrangler secret put DATABASE_URL            # the 6543 transaction pooler
bun x wrangler secret put SUPABASE_URL
bun x wrangler secret put SUPABASE_ANON_KEY
bun x wrangler secret put SUPABASE_SERVICE_ROLE_KEY
bun x wrangler secret put CRON_SECRET
bun x wrangler secret put ALLOWED_ORIGINS         # your web app's URL
cd ../..

bun run deploy:api
curl https://eternal-bonds-api.<your-subdomain>.workers.dev/health
```

`/health` answers `"source": "supabase"` when `DATABASE_URL` arrived and
`"source": "seed"` when it did not. If you see `seed` in production the secret
is missing — the API serves fixtures rather than crashing, which is right on a
laptop and wrong on a server, so check it every time.

`ALLOWED_ORIGINS` is a secret rather than a var purely so it can be changed
without a redeploy. It is not sensitive.

### Background jobs

The Cron Trigger in `wrangler.jsonc` fires every minute; `scheduled()` calls
`dueJobs()`, which decides what is actually due. Fifteen jobs with cadences
from 30 seconds to a day do **not** all run every minute.

Check it is working:

```bash
bun x wrangler tail --config services/api/wrangler.jsonc
```

You should see a JSON line per job as each comes due.

### Plan limits, honestly

The Free plan gives 100,000 requests a day and **10ms of CPU per invocation**.
The Worker is 416 KiB gzipped, well under the 1 MB free-plan limit, and most of
a request is waiting on Postgres — which is I/O, not CPU. It fits.

What pushes you to the $5/month Paid plan is the CPU ceiling: JWT verification
plus a rollup job in the same isolate can exceed 10ms, and Hyperdrive needs it.
Start free; move when a `scheduled()` run shows up as an exceeded-CPU error in
`wrangler tail`.

## The web app → Cloudflare Workers

```bash
VITE_API_URL=https://eternal-bonds-api.<your-subdomain>.workers.dev VITE_SUPABASE_URL=https://xxxx.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_… bun run deploy:web
```

`apps/web/wrangler.jsonc` serves `dist/` with
`not_found_handling: "single-page-application"`, because TanStack Router owns
the URL space — a deep link like `/admin/courses/<id>` has to reach the bundle
rather than 404 at the edge.

Then set `ALLOWED_ORIGINS` on the API to this URL, or every request the browser
makes is blocked before it arrives and the app looks broken for no visible
reason.

---

## The container alternative (Fly)

Still supported, still tested. Use it if the API outgrows the edge.

```bash
fly launch --no-deploy --name ipc-api --region bom
fly secrets set   DATABASE_URL="…pooler.supabase.com:5432/postgres"   SUPABASE_URL="https://xxxx.supabase.co"   SUPABASE_ANON_KEY="sb_publishable_…"   SUPABASE_SERVICE_ROLE_KEY="…"   CRON_SECRET="$(openssl rand -hex 32)"
bun run deploy:api:fly

# The worker as its own machine, no public address:
fly launch --no-deploy -c fly.worker.toml --name ipc-worker --region bom
fly secrets set --app ipc-worker DATABASE_URL="…" SUPABASE_SERVICE_ROLE_KEY="…"
bun run deploy:worker
```

Here `DATABASE_URL` is the **session** pooler (5432), not the transaction one —
a long-lived process wants a long-lived connection. Use the pooler host either
way: the direct host resolves to IPv6 only, which most container hosts cannot
reach. Percent-encode the password, because an `@` in a connection string ends
the userinfo section and the URL silently means something else.

Run **one** worker machine. A second would be safe — the queue claims rows
`FOR UPDATE SKIP LOCKED` — just wasteful. And delete `triggers.crons` from
`services/api/wrangler.jsonc` so the Cron Trigger is not doing the same work.

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
verify ──► migrations ──► api
    └────────────────────► web
```

Both go to Cloudflare. Background jobs ride along with the API on a Cron
Trigger, so there is no third thing to deploy. If you switch to Fly, swap the
`api` job's `bun run deploy:api` for `flyctl deploy` and add a `worker` job —
`deploy.yml` has a comment where that goes.

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
| Secret | `CLOUDFLARE_API_TOKEN` | API and web deploys |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | API and web deploys |
| Variable | `VITE_API_URL` | the web build |
| Variable | `VITE_SUPABASE_URL` | the web build |
| Variable | `VITE_SUPABASE_ANON_KEY` | the web build |
| Variable | `API_URL` | the post-deploy health check (optional) |

The `VITE_*` three are **variables, not secrets**, on purpose: they end up in a
public bundle, and filing them as secrets would be pretending otherwise. It
would also break the health check, since GitHub masks secret values in logs.

Everything else — `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`,
`VIDEO_API_TOKEN`, `EMAIL_API_KEY`, `FCM_PRIVATE_KEY` — lives in
`wrangler secret put`, not in GitHub. CI never needs them, and a credential that only exists in one
place is a credential with one place to leak from.

### The Cloudflare token

Made from the **Edit Cloudflare Workers** template at
`dash.cloudflare.com/profile/api-tokens`. Two things about it are worth writing
down, because both are surprises later rather than at the time.

**It cannot be scoped to individual Workers.** Cloudflare's Account Resources
picker chooses an *account*; `Workers Scripts Write` is account-wide. So this
token can overwrite every Worker in the account, and once already has — a
deploy under a name that was already taken replaced a live CRM frontend, with
no warning, because `wrangler deploy` is an upsert. The protection is the name
check in `services/api/wrangler.jsonc` and `apps/web/wrangler.jsonc`, not the
token. Before any *first* deploy under a new name:

```bash
bun x wrangler deployments list --name <the-name>   # must 404
```

**Set an expiry of about a year, not "No expiration".** A permanent credential
in GitHub is a permanent credential. Cloudflare emails before it lapses; when
it does, deploys fail with a 403 that reads like a permissions bug rather than
an expiry. If you are reading this because of exactly that, the fix is a new
token in the same secret.

Leave **Client IP address filtering** empty. GitHub Actions runners come from a
large and changing pool, so any value there breaks the first deploy that lands
on a different address.

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
| Any number of Worker isolates | Yes — rate limits and idempotency are in Postgres, not in memory. This is what makes the edge viable at all. |
| A Cron Trigger firing while a job is already running | Yes — the queue claims rows `FOR UPDATE SKIP LOCKED`. |

That last row is why `rate_limits` and `idempotency_keys` are database tables.
An in-memory counter divided across N instances is a limit of N × limit, and
for the OTP endpoint that is the difference between a cap and a suggestion.

---

## Rolling back

Cloudflare keeps every version of a Worker, which is also how you undo an
accidental overwrite of somebody else's Worker: roll it back to the last
version that was not yours.

```bash
bun x wrangler deployments list --config services/api/wrangler.jsonc
bun x wrangler rollback --config services/api/wrangler.jsonc
```

Or from the dashboard: Workers & Pages → the Worker → Deployments → **Rollback**
on any previous version. On Fly it is `fly releases` and
`fly deploy --image <ref>`.

**The database does not roll back with them.** Migrations are forward-only.
This is why they are additive: an old release meeting a new schema should find
extra columns it ignores, not missing ones it needs.
