# India Photographers Club — platform

Rebuild of the club's member platform: dashboard, community, workshops, courses and library,
behind the top navigation members already know.

- **Build status**: [`docs/status.md`](docs/status.md) — what is real and what is stubbed, per feature
- **Architecture**: [`PLAN.md`](PLAN.md) — stack, schema, milestones, gaps and risks
- **API conventions**: [`docs/api-conventions.md`](docs/api-conventions.md) — auth, errors, pagination, and why this API is ready for a native client
- **Deploying**: [`docs/deploy.md`](docs/deploy.md) — web on Cloudflare, API and worker on Fly, secrets, CI
- **Video**: [`docs/video.md`](docs/video.md) — Cloudflare Stream, Bunny, and why uploads never touch the API
- **Portability rules**: [`docs/portability-contract.md`](docs/portability-contract.md)
- **Design**: [`docs/design-tokens.md`](docs/design-tokens.md) · canvas: https://claude.ai/artifact/R4ggoUTePf62pdFeukPLqK

## Layout

```
apps/web          Vite + React 19 + TanStack Router — the member app and the admin studio
services/api      Hono — one app object; server.ts runs it on Bun, worker.ts on Cloudflare
services/worker   The job loop: rollups, outbox drain, account purge, sweeps
packages/contracts Zod schemas; types are inferred from them, never hand-written
packages/db       Drizzle schema, the createDb() factory, the RLS helper
```

## Running it

```bash
bun install
bun dev           # api on :8080, web on :5173 (proxied, so no CORS in dev)
```

Separately if you prefer: `bun dev:api` / `bun dev:web`.

With no `DATABASE_URL` the API serves seed content, so a clean checkout runs with no
infrastructure at all. `/health` reports `"source": "seed"` while that is happening, and
`"supabase"` once a database is connected.

### Connecting Supabase

Supabase owns **auth** (email, phone OTP, Google), **Postgres + RLS**, **storage** and
**realtime**. This API verifies its JWTs and reaches Postgres through Drizzle inside a
transaction that adopts the caller's identity — so the same RLS policies apply whether a
request arrives via PostgREST, supabase-js, or here.

```bash
cp .env.example .env           # project URL, anon key, service role key, pooler DATABASE_URL
supabase link --project-ref <ref>
supabase db push               # applies supabase/migrations
psql "$DATABASE_URL" -f supabase/seed.sql
```

Or run everything locally: `supabase start`, then `supabase db reset` (replays migrations
and seed).

Then prove it, rather than assuming:

```bash
bun run db:verify          # schema, RLS, policies, functions, storage bucket, every job
bun run db:test-rls        # two throwaway members cannot see each other
bun run db:test-studio     # only an admin can author; a member is refused by the database
bun run db:test-engagement # likes, threads, notifications, membership grants
bun test                   # 31 unit tests, no database needed
```

### Getting into the studio

The Studio link only appears for an admin, and the first one is made by hand —
self-service admin is not a feature:

```sql
update public.users set role = 'admin' where email = 'you@yourdomain.com';
```

Sign in once first, so the profile row exists (the `on_auth_user_created` trigger makes it).

## What exists today

| Area | State |
|---|---|
| Design system | Tokens in `apps/web/src/styles.css`, primitives and charts in `src/shared/ui` |
| App shell | Top nav, page header, footer — identical on every page |
| Pages | Dashboard, Community, Workshops, Courses, Library, Member Details |
| API | `/health`, `/v1/{courses,workshops,community,library,lessons,me}` and `/v1/admin/*` over Supabase, with a seed fallback |
| Studio | `/admin` — create courses, build modules and lessons, upload video, schedule workshops. Admins only |
| Video | Cloudflare Stream, Bunny Stream, or signed MP4 from Supabase Storage — one interface, chosen by env |
| Community | Likes and threaded comments, with counters kept right by database triggers |
| Notifications | In-app feed, email digests, FCM push, quiet hours, per-member preferences |
| Payments | Razorpay orders and webhooks; the membership is granted by the webhook, never the browser |
| Schema | Drizzle tables for identity, memberships, courses, progress, workshops, posts, library, activity, outbox |
| Charts | Grouped pill bars, score gauge, trend line, progress rings — inline SVG, no chart library |

Not built yet, in rough order: auth (M1), account deletion and DPDP consent (M1), the lesson
player and progress writes (M2), instructor studio (M3), events and notifications (M6). See
`PLAN.md` §8.

## Conventions worth knowing

- **Zod is the source of truth.** The API validates with it, the web app parses responses with
  it. A shape change surfaces as an error at the boundary, not as a blank card.
- **Colour lives in tokens.** Components reference `var(--pink)`, never a hex. The three chart
  series (`--s1/--s2/--s3`) are deepened from the reference pastels so they pass the lightness,
  chroma and colour-blind separation checks; the pastels stay on tiles and badges.
- **No vendor bindings.** `process.env` is read in exactly one file per service. Storage goes
  through the S3 API, video through a provider interface, cron through an HTTP endpoint.
- **Markdown, never stored HTML.** `body_md`, `summary_md` — sanitised on render.
- **Playback URLs are never stored**, only `video_asset_id` + `video_provider`.
