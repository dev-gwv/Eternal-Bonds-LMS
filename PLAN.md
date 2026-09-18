# Eternal Bonds — Platform Architecture

**LMS + Community + Think Tank + Wins Board.** Web-first, mobile-shippable (Play Store / App Store).
**No revenue tracking, no financial dashboards anywhere.** Tiers exist only as access levels.

This document revises the original plan. Every change has a reason attached; where the original was
right, it says so and moves on. Companion docs: [`docs/portability-contract.md`](docs/portability-contract.md),
the schema notes in §6.

---

## 0. The revisions at a glance

| Original | Revised | Why |
|---|---|---|
| Next.js 15 App Router for `apps/web` | **Vite 8 + React 19 + TanStack Router** (SPA) | Capacitor needs a static bundle. Next in `output: 'export'` loses RSC, server actions, middleware, ISR and route handlers — you pay all of App Router's complexity and get none of its benefit, then maintain two divergent build targets. A Vite SPA is one artifact that serves identically from a CDN, an Nginx box, or a Capacitor WebView. Public/SEO pages get a separate tiny marketing site instead of contorting the app. |
| Hono **on Cloudflare Workers** | **Hono on Bun**, with an optional Workers entrypoint | Hono is the right call (§1). Pinning it to the Workers *runtime* is what creates lock-in — and that decision got silently bundled in with the framework choice. |
| Supabase Auth + Supabase Postgres + RLS + Hono middleware | **Plain Postgres 16, API-owned auth, RLS via `SET ROLE`** | Three sources of authorization truth is how permission bugs ship. One identity system, one policy layer, enforced in the database, reachable from any host. |
| Cloudflare Hyperdrive for pooling | **PgBouncer / built-in pool, Hyperdrive optional** | Hyperdrive is a Cloudflare-only product with no off-platform equivalent. Code written against it has no VPS story. Behind a driver factory it becomes a connection *string*, not an architecture. |
| Cloudflare R2 bindings | **S3 API (`@aws-sdk/client-s3`) pointed at R2** | Same cost and behaviour on R2, but MinIO / Backblaze / Wasabi / S3 become an env change. The *bindings* are the lock-in; the S3 endpoint is not. |
| Cloudflare Stream, hardcoded | **`VideoProvider` interface**, Stream or Bunny behind it | Video is the one genuinely sticky dependency. An ~80-line interface (`createDirectUpload / getPlaybackToken / getAsset / delete / webhook`) means provider choice becomes a pricing decision instead of a rewrite. |
| Turborepo | **Bun workspaces**, Turbo added only when builds hurt | Five packages don't need a build orchestrator. `bun run --filter` covers it with zero config and zero cache-invalidation mysteries. |
| `packages/types` (interfaces + Zod) | **`packages/contracts`** — Zod is the source of truth, types are inferred | Types alone don't validate anything at runtime. One schema per endpoint, consumed by the API validator, the client fetcher, and the form resolver. |
| — | **`services/worker`** added | Digests, streaks, counter reconciliation, video webhooks and search indexing do not belong in the request path. Plan for it in week 1, not month 4. |

**Net effect:** the whole platform runs on a single ₹1,200/mo VPS, *or* split across Cloudflare's
edge, *or* on Fly/Render/AWS — by changing environment variables, not code.

---

## 1. Is Hono a good long-term backend choice?

**Yes — it's arguably the most future-proof decision in the plan.**

- **Runtime-agnostic by design.** The same `app` object runs on Bun, Node (`@hono/node-server`),
  Deno, Cloudflare Workers, Vercel, Lambda and Fastly. Very few frameworks let "where do we host"
  stay a deploy-time decision instead of a rewrite. That property *is* the answer to your second
  question.
- **Web-standard primitives.** `Request`/`Response`, not a bespoke req/res. The middleware you write
  and the knowledge you build are portable.
- **Typed client** (`hono/client`) gives end-to-end types without tRPC's coupling — and you can drop
  to plain `fetch` + Zod parsing any time, which is what I'd actually do for the mobile app.
- **Validation and OpenAPI** via `@hono/zod-validator` and `@hono/zod-openapi` when you want a public
  API or generated mobile SDK.
- **Small and stable.** ~14kB core, minimal dependencies, no bundled ORM/DI/queue to be broken by a
  major version. Low surface area is an underrated form of longevity.

**Where Hono is genuinely the wrong tool**, so you know the edges:
- Long-running work, heavy background processing, large websocket fan-out. Hono doesn't prevent it,
  but it belongs in a separate process (`services/worker`), not the request handler.
- If you'd rather have a batteries-included framework (Rails / Laravel / AdonisJS) with an admin
  panel, ORM, queue and auth in the box, Hono gives you none of that. That's the trade: assembly over
  convention. For this product — many read-heavy endpoints, custom authz, an edge-friendly deploy —
  assembly is correct.

**Verdict: keep Hono.** The risk was never Hono. It was *Hono-on-Workers-with-Workers-only-bindings*.

---

## 2. Will this run on a VPS, or are we locked into Cloudflare?

**As originally written: effectively locked in.** Four specific things did it:

1. `apps/api` targeted the **Workers runtime** — `wrangler.toml`, config via `c.env` bindings, no
   `process.env`, no long-lived TCP sockets, CPU-time caps, no filesystem, no in-process scheduling.
2. **Hyperdrive** for pooling — Cloudflare-only, no equivalent elsewhere. You'd swap in PgBouncer
   *and* change the connection code.
3. **R2 bindings** (`env.BUCKET.put(...)`) rather than the S3 API.
4. **Cloudflare Stream** signed-token generation wired directly into Workers.

**As revised: portable by contract.** The full rules live in `docs/portability-contract.md`; the
short version is six lines:

1. The API is a **standard Bun HTTP server** (`Bun.serve` → Hono). All config arrives as a single
   typed `Env` object built from `process.env` and *passed into* Hono — so a Workers build can hand
   it bindings instead, with zero changes above that line.
2. **Database access is a factory.** `packages/db` exports `createDb(connectionString, opts)` over
   `postgres.js` + Drizzle. A VPS passes a pooled local URL; Workers pass a Hyperdrive URL. Nothing
   above the factory knows which.
3. **Storage is an interface** — `putObject / signedGetUrl / signedPutUrl / delete` — implemented
   once over the S3 API. R2 in production, MinIO in local Compose.
4. **Video is an interface**, provider selected by `VIDEO_PROVIDER`.
5. **Scheduling is an interface**: a `/internal/cron/:job` route guarded by a shared secret, invoked
   by Workers Cron Triggers *or* a `cron` container running curl *or* systemd timers.
6. **No Durable Objects, KV, Workers AI, or any Workers-only global** in application code. Need
   KV-ish caching? Redis behind a `Cache` interface — Upstash over HTTP at the edge, plain Redis on a box.

Given those rules:

| Target | Web | API | DB | Storage | Notes |
|---|---|---|---|---|---|
| **All-VPS** | Caddy serves `dist/` | Bun container | Postgres container | MinIO or R2 | One `docker compose up`. Cheapest, simplest, fully yours. |
| **Split** *(recommended start)* | Cloudflare static assets | Bun on VPS / Fly / Railway | Neon or Supabase | R2 | Free global CDN for the shell; boring, portable backend. |
| **All-Cloudflare** | Workers static assets | Workers + Hyperdrive | Neon / Supabase | R2 | Swap the entrypoint file and add `wrangler.jsonc`. No application changes. |
| **Anywhere else** | any static host | any container host | any Postgres | any S3 | Nothing Cloudflare-specific remains. |

The only migration cost you could ever face is **moving already-uploaded video files** between
providers. Everything else is environment variables. That residue is acceptable for a video-heavy
product; driving it to zero would mean self-hosting transcoding, which is not worth it.

---

## 3. Final stack

*Versions verified against the npm registry on 2026-09-17. Pin exact majors in `package.json`.*

**Tooling:** Bun 1.3+, **TypeScript 7.0** (the native Go compiler — ~10× faster checks; verify
`typescript-eslint` compatibility before committing, and keep TS 5.9 as the fallback pin),
`strict` + `noUncheckedIndexedAccess`, Bun workspaces, **ESLint 10** flat config, Prettier 3,
**Vitest 5**, **Playwright 1.63**, GitHub Actions.

**`apps/web`** — **Vite 8**, **React 19.3**, TanStack Router 1.170 (file-based, type-safe, code-split
per route), TanStack Query 5.103, **Tailwind 4.3**, shadcn/ui on Radix, Lucide, `vaul` 1.1 drawers,
`sonner` toasts, `@dnd-kit` for the course builder, `react-hook-form` 7.88 + **Zod 4** resolvers,
`hls.js` 1.7 for video.

**`apps/mobile`** — **Capacitor 8** over the same `dist/`. Plugins: push-notifications (FCM/APNs),
preferences, status-bar, haptics, share, app (deep links), safe-area. One bundle → Android `.aab`
and iOS archive. *If native offline downloads become a requirement later, this is the single module
worth rebuilding in Expo — the API contract is unaffected.*

**`apps/marketing`** *(optional, later)* — Astro static site for public/SEO pages. Keeps the app SPA
pure rather than dragging SSR into it for the sake of three landing pages.

**`services/api`** — **Hono 4.13** on Bun. `@hono/zod-validator` (Zod 4), `jose` 6 (JWT),
`postgres.js` 3.4 + **Drizzle 0.45**,
`@aws-sdk/client-s3`, `argon2` (via Bun's built-in password hashing), Sentry, `pino`-style structured logs.

**`services/worker`** — Bun process for scheduled and queued work: email digests, streak
recalculation, video-ready webhooks, counter reconciliation, search-vector refresh, notification
fan-out. Queue = a Postgres job table with `FOR UPDATE SKIP LOCKED`. One fewer moving part than
Redis/BullMQ, and comfortably sufficient at this scale.

**`packages/db`** — Drizzle schema, numbered SQL migrations, RLS policies as reviewable SQL, seeds,
`createDb()` factory, `withUser()` RLS helper.

**`packages/contracts`** — Zod schemas + inferred types for every request and response. Along with
pure functions, the only thing web and API share.

**`packages/domain`** — pure business logic: progress math, tier gating rules, vote cycle scoring,
streak rules, ordering ranks. No I/O, trivially unit-tested, reused by API and worker.

**`packages/permissions`** — the single tier × role × action matrix. Imported by API middleware
(authoritative) and by the UI (cosmetic gating only).

**`packages/ui`** — shared shadcn components, theme tokens, and the responsive `Modal` primitive that
renders a centered dialog at `md+` and a swipeable bottom sheet below it.

---

## 4. Directory structure

```
eternal-bonds/
├─ apps/
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ app/                  # providers, router instance, error boundaries, auth gate
│  │  │  ├─ routes/               # TanStack file routes
│  │  │  │  ├─ (auth)/            # login, otp, oauth-callback, onboarding
│  │  │  │  ├─ _shell/            # authed layout: sidebar (md+) ↔ bottom nav (mobile)
│  │  │  │  │  ├─ index.tsx               # Home feed
│  │  │  │  │  ├─ learn/                  # catalog · $courseSlug · $lessonSlug
│  │  │  │  │  ├─ think-tank/             # library · $slug · share · solve
│  │  │  │  │  ├─ wins/                   # board · $slug · submit
│  │  │  │  │  ├─ community/              # $channelSlug · $postId
│  │  │  │  │  └─ profile/                # me · $handle · settings
│  │  │  │  └─ admin/             # studio: courses, builder, members, moderation, insights
│  │  │  ├─ features/             # one folder per domain: components + hooks + queries
│  │  │  ├─ shared/               # api client, auth store, media, hooks, utils
│  │  │  └─ styles.css
│  │  ├─ index.html · vite.config.ts · wrangler.jsonc (optional static-assets Worker)
│  └─ mobile/
│     ├─ capacitor.config.ts      # webDir: ../web/dist
│     ├─ android/  ios/           # generated, committed
├─ services/
│  ├─ api/
│  │  └─ src/
│  │     ├─ server.ts             # Bun.serve entrypoint (container / VPS)
│  │     ├─ worker.ts             # Cloudflare Workers entrypoint (optional, same app)
│  │     ├─ app.ts                # builds the Hono app, mounts modules
│  │     ├─ env.ts                # Zod-parsed Env — fails fast at boot on bad config
│  │     ├─ context.ts            # typed Variables: db, user, storage, video, log
│  │     ├─ middleware/           # auth · rls · rateLimit · idempotency · error · cors · log
│  │     ├─ modules/
│  │     │  ├─ auth/ courses/ lessons/ progress/ enrollments/
│  │     │  ├─ insights/ challenges/ wins/
│  │     │  ├─ channels/ posts/ comments/ reactions/ bookmarks/
│  │     │  ├─ uploads/ notifications/ profiles/ admin/
│  │     │  └─ internal/          # cron + provider webhooks (secret-guarded)
│  │     └─ lib/                  # jwt · storage(s3) · video(provider) · mail · push · otp
│  └─ worker/                     # scheduled + queued jobs
├─ packages/
│  ├─ db/
│  │  ├─ src/schema/              # one file per domain, re-exported
│  │  ├─ src/client.ts            # createDb(connectionString)
│  │  ├─ src/rls.ts               # withUser(db, userId) → SET LOCAL ROLE + set_config
│  │  ├─ migrations/              # numbered .sql, tracked in schema_migrations
│  │  ├─ policies/                # RLS policies as reviewable SQL
│  │  └─ seed/
│  ├─ contracts/ · domain/ · permissions/ · ui/
├─ deploy/
│  ├─ db/00_bootstrap.sql         # auth schema, roles, extensions on plain Postgres
│  ├─ db/migrate.sh · Caddyfile · .env.example
├─ docker-compose.yml             # db · api · worker · minio · caddy · cron
├─ docs/  portability-contract.md · schema.md · runbook.md · adr/
└─ package.json                   # bun workspaces
```

---

## 5. Cross-cutting architecture decisions

These weren't in the original plan and are the difference between a demo and a platform.

**Auth tokens.** Short-lived access JWT (15 min, in memory) + rotating refresh token (30 days,
httpOnly cookie on web, secure storage on mobile) with reuse detection. Never put a long-lived JWT in
`localStorage` — a single XSS becomes permanent account takeover, and store reviewers do look.

**Authorization, one layer.** Every request resolves a user → the API opens a transaction →
`SET LOCAL ROLE authenticator` + `set_config('request.jwt.claim.sub', userId, true)` → RLS policies
decide. Application code never hand-writes `where user_id = ?` for access control. The `permissions`
package covers *route-level* capability checks (can this role reach this endpoint at all); RLS covers
*row-level* access. Two complementary layers, not three competing ones.

**API conventions.** REST-ish under `/v1`, cursor pagination everywhere (never offset — feeds mutate
under you), `ETag`/`If-None-Match` on read-heavy endpoints, `Idempotency-Key` honoured on all POSTs
the mobile app might retry, envelope-free responses, RFC-9457 problem details for errors.

**Caching.** HTTP caching first (immutable asset hashes, `stale-while-revalidate` on catalog reads),
TanStack Query on the client, and only then a `Cache` interface over Redis for the few genuinely
expensive aggregates (home feed, leaderboards).

**Realtime.** Not in v1. Polling with TanStack Query covers comments and vote counts fine at this
size. When you need it: Server-Sent Events from the Bun API (works on VPS, works in Capacitor,
one-directional is all a feed needs) — *not* websockets on Workers, which forces Durable Objects and
re-introduces the lock-in you just removed.

**Search.** Postgres `tsvector` + GIN + a trigger-maintained `search_vector` column, with
`pg_trgm` for fuzzy titles. Free, transactional, and good well past five figures of rows. Revisit
only when it measurably hurts.

**Observability.** Sentry (API + web + mobile), structured JSON request logs with a request ID
propagated to the client, and four business metrics from day one: lesson completions/day, insights
posted/week, wins posted/week, DAU. Instrument before launch, not after the first mystery.

**Testing.** Vitest units on `packages/domain` (pure, fast, high coverage), integration tests for API
modules against an ephemeral Postgres in CI, a dedicated **RLS test suite** that proves tenant/user
isolation by attempting cross-user reads, and Playwright smoke tests on the five critical journeys
(sign in, watch a lesson, post an insight, post a win, comment).

**Migrations.** Numbered SQL files applied by an idempotent migrate step on every deploy, tracked in
`schema_migrations`. Drizzle generates the first draft; the file is then hand-reviewed and committed.
Expand/contract for anything destructive — never a breaking change in a single deploy.

---

## 5.1 Layer inventory — completeness audit

Everything the platform needs, and where it lives. The **bold** rows were missing from both the
original plan and my first revision; several are hard blockers for store review or Indian law.

| Layer | Status | Notes |
|---|---|---|
| Identity & sessions | §5 | Access/refresh rotation, `auth_identities`, OTP, OAuth |
| Authorization | §5 | Route capabilities + RLS rows |
| Data & migrations | §4, §6 | Drizzle, numbered SQL, expand/contract |
| API | §5 | Hono modules, Zod contracts, cursor pagination, idempotency |
| Background work | §3 | `services/worker`, Postgres queue with `SKIP LOCKED` |
| Video pipeline | §2 | Provider interface, webhooks, signed playback |
| File storage | §2 | S3 interface, presigned direct upload |
| **Image pipeline** | **missing** | Avatars and win proof need resize, format conversion, **EXIF stripping** (screenshots leak location/device). `sharp` in the worker, or Cloudflare Images behind the same interface. |
| Search | §5 | Postgres FTS + `pg_trgm` |
| Feed & activity | §6 | `activity_events` |
| Notifications | §6 | In-app + push |
| **Email infrastructure** | **missing** | Digests were listed with no provider. Resend or SES, React Email templates, plus **SPF/DKIM/DMARC** — without those, welcome and OTP mail lands in spam and members think signup is broken. |
| SMS/WhatsApp | §7 | MSG91/Twilio + DLT registration |
| Billing & entitlement | §7 | `EntitlementGrant` per provider, `BILLING_MODE` |
| **Events / live sessions** | **missing** | The brief's core loop — insights voted up get featured in a *weekly live coaching session* — has no home. Needs `events` (schedule, RSVP, reminder, join link, recording → promoted to a lesson) and `event_insights` linking the featured picks. Without it the Think Tank vote leads nowhere. |
| **Gamification / badges** | **missing** | Profiles show completion badges and streaks, but nothing awards them. A small rules engine in `packages/domain` evaluating `activity_events` → `user_badges`. |
| Moderation | §7 | Queue, reports, `channel_moderators`, audit log |
| **Account deletion & data export** | **missing — hard blocker** | Apple 5.1.1(v) **requires in-app account deletion**; India's **DPDP Act** requires consent records, export and erasure. Needs a real flow: soft-delete → 30-day grace → anonymize authored content rather than cascade-deleting community threads. Build in M1, not M8. |
| **Legal & consent** | **missing** | Privacy policy, ToS, `terms_acceptances` (version + timestamp), cookie/consent for analytics, store privacy labels. |
| **Product analytics** | **missing** | Sentry catches errors, not behaviour. PostHog (self-hostable, keeps the portability story) for funnels: signup → first lesson → first insight. |
| **Feature flags & config** | **missing** | `BILLING_MODE`, staged rollouts, kill switches. A `feature_flags` table with per-tier/per-user targeting is enough; no vendor needed. |
| **Support & impersonation** | **missing** | Admin "view as member" (audit-logged, time-boxed, never for admins) plus in-app contact. You cannot debug a member's missing course access without it. |
| **Accessibility** | **missing** | Radix gives keyboard/ARIA for free; you still owe focus management, contrast ≥4.5:1, captions on lesson video, and reduced-motion. Store reviewers and Indian accessibility norms both care. |
| **Performance budget** | **missing** | Initial JS ≤200KB gzip, LCP <2.5s on a mid-range Android over 4G, route-level code splitting. Set it now or the SPA quietly bloats. |
| **Offline & poor network** | **missing** | Queue progress writes when offline and flush on reconnect; cached last-viewed course; an honest offline state. Also what makes the Capacitor build read as an app rather than a wrapper. |
| **Environments** | **missing** | dev / staging / prod, seeded staging, preview deploys per PR, separate buckets and video projects. |
| Observability | §5 | Sentry, structured logs, request IDs, business metrics |
| Security | §5, §9 | CSP, CORS allowlist, rate limits, secret rotation, `bun audit` in CI, pen test before launch |
| Backup & DR | §8 | Nightly PITR + a **rehearsed** restore |
| Design system | §8.1 | Tokens → components → screens |

---

## 6. Schema revisions

The full table-by-table schema lands with the scaffold (`packages/db/src/schema/`). The corrections
to the original that matter:

**Identity & access**
- `users` — add `handle` (unique, for `/profile/:handle`), `timezone`, `onboarding_completed_at`,
  `last_seen_at`, `is_suspended`. `email` and `phone` stay nullable with a **partial unique index each**.
- Add **`auth_identities (user_id, provider, provider_uid, verified_at)`** so Google / phone / email
  map onto one user cleanly instead of being wedged into columns on `users`.
- **Tier does not belong on `users` as a bare enum.** Use
  **`memberships (user_id, tier, status, started_at, expires_at, source)`** and derive the effective
  tier. Otherwise you cannot express "Pro until March", trials, comps or downgrades — and you will
  need all four within a month. Keep `users.tier` only as a cached convenience column, refreshed by trigger.
- Roles stay `student | instructor | admin`. Per-space moderation goes in `channel_moderators`, not
  new global roles.

**LMS**
- `lessons.video_url` → **`video_asset_id` + `video_provider` + `video_status`**
  (`uploading|processing|ready|errored`, driven by the provider webhook) + `thumbnail_url`. Never
  store a playback URL; they're signed and expire.
- `lessons.summary_html` → **`summary_md`** (markdown, sanitized on render — never store trusted HTML; see §10.5).
- `lessons.resources jsonb` → **`lesson_resources (lesson_id, title, storage_key, size_bytes, mime,
  order_index)`**. You need per-file access control and download counts; jsonb blocks both.
- `user_lesson_progress` — add `completed_at`, `watch_seconds`, `first_started_at`, unique
  `(user_id, lesson_id)`. Write `last_playback_position` **debounced to ~15s** through a dedicated
  minimal endpoint. This will be your highest-write table by an order of magnitude; design it that way now.
- Add **`enrollments (user_id, course_id, enrolled_at, completed_at, last_lesson_id)`** — "continue
  learning" and "my courses" both need it, and deriving access purely from tier makes those queries slow.
- `order_index` → **fractional ranks** (`numeric`) so a drag-and-drop reorder is a one-row update
  rather than rewriting every sibling.

**Think Tank**
- `domain_category` and `impact_area` → **lookup tables, not enums.** You will add categories;
  Postgres enum migrations are friction you don't need.
- `think_tank_insights` — add `slug`, `actionable_steps` (child table, ordered), `status`
  (`draft|published|hidden`), `featured_at`, `search_vector`. `votes_count`/`saves_count` stay as
  **trigger-maintained counter caches** with a nightly reconciliation job.
- Voting: add **`vote_cycle`** (the week an insight competes in) so "Vote for Momentum" resets weekly
  instead of accumulating forever and permanently freezing the top of the list.
- `think_tank_challenge_solutions` — add `curated_by` and `rank`: the Solution Finder's ordering
  should be editorial, not incidental.

**Wins**
- `wins` — add `slug`, `status` (moderation), `occurred_on`, `tags`, `comments_count`.
- `proof_media_urls` → **`win_media (win_id, storage_key, mime, width, height, order_index)`**.
  Signed URLs are generated on read, never stored.

**Community & cross-cutting (absent from the original)**
- `channels` — add `slug`, `visibility` (`public|tier_gated|private`), `min_tier`, `is_archived`.
- `posts` / `post_comments` — nested replies need `parent_id` **plus** `root_id + depth` (or `ltree`),
  or deep threads become N+1 reads.
- **`reactions (user_id, target_type, target_id, kind)`** — one polymorphic table for claps/likes
  across wins, insights and posts. Don't build three.
- **`bookmarks (user_id, target_type, target_id)`** — same; replaces `user_saved_insights`.
- Consider **one polymorphic `comments` table** rather than three near-identical ones.
- **`notifications (user_id, type, payload, read_at)`** + **`push_tokens (user_id, platform, token)`**.
- **`activity_events`** — append-only; powers the home feed, streaks and admin analytics.
- **`streaks (user_id, current, longest, last_active_on)`** — the plan showed streaks on profiles but
  had no table.
- **`audit_log`** — every admin and moderation action. Cheap now, invaluable in a dispute.
- **`idempotency_keys`** — for mutating endpoints the mobile app may retry on flaky networks.

---

## 7. Module refinements

**LMS**
- Player: HLS via `hls.js` (native on iOS/Safari). Speed control, resume prompt, keyboard shortcuts,
  captions, and auto-complete at 90% watched *in addition to* the manual toggle.
- Gate video at the **token layer**: `GET /v1/lessons/:id/playback` verifies tier + enrollment and
  returns a short-lived signed token. Hiding the player in React is not access control.
- Course builder: optimistic `@dnd-kit` reordering, one PATCH per moved item, fractional ranks.
- "Preview as tier" in the studio — the fastest way to catch gating mistakes before members do.

**Think Tank**
- The share wizard **autosaves a draft after step 1.** Two-step forms that lose data to an incoming
  phone call get abandoned, and this is your highest-value content-creation flow.
- Solution Finder: keep the 3-step flow, add "none of these match → post to #ask-for-help with context
  prefilled", and **log every unmatched dilemma**. That log is your content roadmap, free.
- Featuring: the weekly winner should be a recorded decision (`featured_at`, `featured_by`), not a
  derived max — you'll want to override it.

**Wins**
- The structured blueprint is the strongest idea in the original plan. Enforce it: minimum lengths on
  `big_idea` and `how_it_happened`, a mandatory preview step, and a moderation queue for first-time
  posters with auto-approve for trusted members.

**Community**
- Rate-limit posting per user per minute. Ship report/flag on day one — retrofitting moderation into a
  live community is miserable.

**Mobile / store reality — not addressed in the original, and it will bite**
- **Billing inside the app is a store-policy question, and the two stores differ.** Razorpay on the
  *web* is unconstrained. Inside the binaries, as of Sept 2026:
  - **Android:** India has **user choice billing** — Razorpay may be offered *alongside* Google Play
    Billing, with Google's service fee reduced by 4% on those transactions. Since 30 Jun 2026 Google
    also split its fee into a 10% service fee + a 5% billing fee that applies **only** to Play
    Billing, so alternative billing and external web links carry no billing fee; that link-out
    permission launched in US/EEA/UK and is expanding, with India's fee transition dated 30 Sep 2027.
    **An in-app Razorpay flow is legitimate on Android** — it simply cannot be the only option.
  - **iOS:** guideline 3.1.1 still requires IAP to unlock content. The post-*Epic* zero-commission
    link-out applies to the **US storefront only**; elsewhere it needs an entitlement and **India is
    not an eligible storefront**. An in-app Razorpay checkout on iOS-India is a 3.1.1 rejection.
  - **Caveat:** 3.1.3(b) permits access to content acquired "on other platforms or your web site"
    but adds *"provided those items are also available as in-app purchases within the app."*
    Login-only apps are approved routinely in practice — that is convention, not a guarantee.
- **Therefore:** ship v1 entitlement-only on both stores (fastest approval), add in-app Razorpay on
  **Android** in v1.1, and add iOS IAP only if iOS conversion ever justifies 15–30%. For high-ticket
  mastermind tiers that close on a call or webinar, in-app checkout is not a v1 blocker.
- **Architecturally this must be a toggle, not a rewrite.** `memberships.source` is
  `razorpay | google_play | app_store | manual`, and entitlement is granted by one
  `EntitlementGrant` interface with a webhook handler per provider (verify signature → resolve user →
  upsert membership → emit `activity_event`). Build the Razorpay handler in M2; the others are
  additive files. A `BILLING_MODE` build flag (`web_only | play_ucb | iap`) controls what the client
  renders. We still store **entitlement, never money** — no amounts, no revenue reporting.
- Both stores reject thin website wrappers. Push notifications, offline-tolerant UI, native share and
  correct safe-area navigation are what make it read as an app. Budget the time.
- Phone + OTP needs an SMS/WhatsApp provider with **Indian DLT registration** (MSG91 / Twilio). That's
  a multi-day lead-time item — start it in M0, not M7.
- Deep links (`/wins/:slug` opening in-app) need Android App Links + iOS Universal Links files served
  from the web domain.

---

## 8. Milestones

**M0 — Foundations (week 1).** Monorepo, Bun workspaces, TS/lint/format, `docker compose`
(pg + minio + api + web), `packages/db` with `createDb`, migration runner, bootstrap SQL (auth schema,
`authenticator` role, `set_config`-based `current_user_id()`), `/health`, CI running typecheck +
tests + migrations against ephemeral Postgres. *Also: begin SMS provider / DLT registration.*

**M1 — Identity & shell (week 2).** Email+password, magic link, Google OAuth, phone+OTP. Access/refresh
token rotation, `auth_identities`, `memberships`, RLS middleware, permissions matrix. Web: auth routes,
app shell with desktop sidebar ↔ mobile bottom nav, responsive `Modal` primitive, theming, profile stub.
Plus the compliance floor, because retrofitting it is worse: **in-app account deletion** (soft-delete →
30-day grace → anonymize authored content), data export, `terms_acceptances`, consent capture.
**Exit criterion:** an automated RLS suite proves two accounts cannot read each other's data.

**M2 — LMS read path (weeks 3–4).** Course/module/lesson schema + seed, catalog, course page, player
with HLS + signed playback tokens, debounced progress, completion toggle, progress bars, Continue
Learning card, enrollments.

**M3 — Instructor Studio (week 5).** ✅ **Built.** Course/module/lesson CRUD, whole-list reordering,
direct browser→bucket video upload via a signed URL, per-course tier gating, publish/unpublish with a
gate that refuses to publish a course whose lessons have no video, and a workshop scheduler. Guarded
by `requireAdmin` **and** by RLS `is_admin()` policies — `bun run db:test-studio` proves both sides.

Two deviations from the sketch above, both deliberate:

- **Buttons, not drag-and-drop.** Drag is better with a mouse and worse with a keyboard or on a long
  list, and the whole order is sent on every move, so a dropped request cannot leave a course in an
  order nobody chose.
- **No provider webhook yet.** With `VIDEO_PROVIDER=none` an uploaded asset is playable immediately
  and goes straight to `ready`. The `processing` state and the webhook that clears it land with the
  provider, not before it.

Still open here: resource files, per-*module* gating (it is per-course today), preview-as-tier.

**M3a — Video, engagement, notifications and payments.** ✅ **Built.**

- **Video** — Cloudflare Stream and Bunny Stream behind one interface, plus
  `none` (signed MP4 from Supabase Storage). Browser→provider direct upload,
  signed short-lived playback, verified webhooks, a poller for the webhook that
  never arrived, and a guard that unpublishes a course whose video has broken.
  `docs/video.md`.
- **Likes and comments** — one level of threading, soft delete so a reply never
  loses its parent, counters maintained by database triggers rather than
  application arithmetic. `counters.reconcile` finally has something real to
  compare against, and the test suite proves it corrects deliberate drift.
- **Notifications** — in-app feed, per-member preferences, quiet hours that
  handle a window crossing midnight, FCM push and Resend email behind adapters
  that both default to logging. The default is deliberate: sending from a
  domain without SPF/DKIM/DMARC is a permanent mistake.
- **Payments** — Razorpay orders and webhooks. The membership is granted by the
  webhook under the service role; there is deliberately no endpoint the browser
  can call to say a payment worked.

One design correction worth recording: the API used to write `outbox` rows
itself, inside the transaction that adopts the caller's identity. That could
never have worked — `outbox` is service-role-only. The fix was **not** an insert
policy (Supabase exposes any table with a policy through PostgREST, so that
would let a member forge `course.published` and notify the whole club) but
database triggers that emit the event alongside the change.

**M4 — Think Tank (weeks 6–7).** Insight schema + lookup tables, share wizard with draft autosave,
library with filters + full-text search, weekly vote cycles, bookmarks, Solution Finder with curated
solutions and unmatched-dilemma logging.

**M5 — Wins Board (week 8).** Structured submission wizard, media gallery upload, board with category
filters, detail page, reactions + comments + bookmarks, moderation queue.

**M6 — Community & profiles (weeks 9–10).** Channels with visibility/tier gating, threaded markdown
posts, nested comments, mentions, reports, rate limiting. Profiles with tier badge, completion badges,
wins and streaks. Home feed from `activity_events`. Notifications: in-app + email digests via
`services/worker`. **Events / live sessions**: schedule, RSVP, reminders, join link, and the weekly
featured-insight session that closes the Think Tank voting loop — recordings promote into the LMS as
lessons. Badges engine over `activity_events`.

**M7 — Mobile (weeks 11–12).** Capacitor project, safe areas, native back handling, push tokens +
FCM/APNs, deep links, store assets and privacy labels, `BILLING_MODE=web_only` for the store builds,
Play internal testing track, TestFlight. *(Android user-choice billing + in-app Razorpay lands in
v1.1, once the entitlement-only build has cleared review.)*

**M8a — Deployment path (week 12).** ✅ **Built.** Web to Cloudflare static assets; API and worker as
one container image on Fly in Mumbai; a Workers entrypoint (`services/api/src/worker.ts`) with a
Hyperdrive binding and Cron Triggers, kept working so the choice stays reversible. Rate limiting and
idempotency moved from process memory into Postgres, because an in-memory limit behind N instances is
a limit of N × limit. CI typechecks, builds, applies migrations to staging and runs all three database
suites before it deploys anything. See `docs/deploy.md`.

**M8 — Hardening & launch (week 13).** Sentry wired end to end, structured logging, backup **and a
rehearsed restore**, load test on the progress endpoint, counter reconciliation job, seed content,
admin audit log, runbook, staging → production cutover.

---

## 8.1 Design workflow (runs before M1, parallel to M0)

**The failure mode to avoid:** generating forty beautiful screens in an AI design tool, then
discovering that each one invented its own spacing, radii and button weights, and that translating
them into shadcn components takes longer than designing from scratch. AI tools are excellent at
*exploration* and poor at *consistency*. So we fix consistency first and let the tool explore inside it.

**D1 — Direction (half a day).** Google Stitch or a mood board. Prompt for the same screen — the
lesson player — five ways, pick a direction. Stitch's output is a fork in the road: it exports to
Figma/code but doesn't feed our token system, so treat it as *reference only* and throw the files away.

**D2 — Tokens (one day).** Colour ramps (light + dark), type scale, spacing, radii, elevation, motion
durations, plus the tier and win-category accent colours. Written once as CSS custom properties on
`:root` — the same file Tailwind 4 reads via `@theme`, so tokens are literally shared between the
designs and the app. Published as a **Design System artifact**, which subsequent design canvases
attach to.

**D3 — Component inventory (one day).** Design the ~24 primitives *before* any screen: button set,
input, select, tabs, card, avatar, badge (tier + completion), progress bar, vote control, empty
state, skeleton, toast, the responsive `Modal` (dialog at `md+` / bottom sheet below), bottom nav,
sidebar. Screens then compose rather than invent.

**D4 — Screens (two to three days).** Eight that carry the product, each at 390px and 1280px:
1. Home feed · 2. Course catalog · 3. **Lesson player** (the screen members live in) · 4. Think Tank
library · 5. Share-an-Insight wizard step 2 · 6. Wins board · 7. Win detail (the blueprint layout) ·
8. Community thread. Then the two admin screens: course builder, moderation queue.

**D5 — Translation (ongoing).** Because the canvases are real HTML + Tailwind against our tokens,
"translation" is extracting them into `packages/ui` as shadcn components — mechanical, not
interpretive. This is the whole reason for choosing an HTML-native design tool over an image-native one.

**Tooling verdict**

| Tool | Use it for | Don't use it for |
|---|---|---|
| **Claude design canvases** (available in this Claude Code session via the Artifact tool) | D2–D4: live HTML artboards side by side, sharing one token file, iterated from the same session that writes the code | Pixel-perfect brand work with a human designer |
| **Google Stitch** | D1 only — fast visual direction, mobile-shaped output | Anything downstream; its output doesn't carry our tokens |
| **v0** | One-off complex components (the video player chrome, the course builder) — it emits shadcn/Tailwind directly | Whole-app generation; it re-invents primitives each time |
| **Figma** | Only if a human designer joins | Solo founder speed |

---

## 9. Architecture shape: build the modular monolith

**Recommendation: a modular monolith in two processes (`api` + `worker`). Do not build microservices.**
Not "not yet as a compromise" — for this product, at this size, microservices would be a straight
downgrade.

**Why not microservices**
- **Your domains are not independent.** A lesson completion touches progress, enrollment, activity
  events, streaks, badges and notifications. In one process that's a single transaction that either
  happens or doesn't. Across six services it's a distributed saga with compensating actions — and
  every counter-drift bug you'd then spend weeks chasing is a bug the monolith simply cannot have.
- **You lose foreign keys.** `wins.author_id → users.id` stops being enforceable the moment users and
  wins live in different databases. Referential integrity is the cheapest correctness guarantee you
  have; don't trade it for an org-chart benefit you have no org chart to collect.
- **The costs are fixed, the benefits scale with headcount.** Service discovery, contract versioning,
  distributed tracing, N deploy pipelines, per-service on-call, local-dev orchestration — you pay all
  of it on day one. The payoff is independent team deploys, which needs multiple teams. Microservices
  are an organizational solution; you have an engineering problem.
- **Your actual scaling axis is reads and video egress**, and neither is helped by splitting the API.
  Reads scale with indexes, caching and a replica. Video never touches your servers at all.

**Also considered and rejected**
- *Function-per-route serverless* — worst of both worlds here: cold starts on a Postgres-heavy app,
  connection-pool pressure, and no shared in-process cache.
- *Event-driven / CQRS everywhere* — solves a write-throughput problem you will not have.
- *BFF layer* — justified with several dissimilar clients. You have one SPA that both the web and the
  mobile build serve.

**What we do take from the microservices playbook** — the parts that are free:
1. **Enforced module boundaries.** `services/api/src/modules/*` may not import each other's internals.
   Cross-module access goes through an exported service function. Enforced by an ESLint
   `no-restricted-imports` rule, so it fails in CI rather than in review.
2. **Domain logic stays I/O-free** in `packages/domain` — the thing that would actually be extractable
   later, if that day ever came.
3. **The worker is already separate.** Anything slow, retryable or scheduled crosses a queue boundary
   from day one. That is the one split that pays for itself immediately.
4. **An outbox table.** Writes that must produce an event (`activity_events`, notifications) insert
   into `outbox` *in the same transaction*, and the worker drains it. This removes the dual-write bug
   class — and is exactly the seam you'd cut along if you ever did split a service out.

**When to revisit:** a genuinely different scaling profile (real-time chat with tens of thousands of
concurrent sockets), a separate team owning a domain end to end, or a compliance boundary requiring
physical data isolation. None are plausible inside eighteen months. Revisit then, from a codebase
whose module boundaries are already clean.

---

## 10. Gaps, risks and improvements

Ranked by what actually threatens the launch, not by engineering interest.

### 10.1 The biggest risk isn't technical: the cold start

Both the Think Tank and the Wins Board are **empty on day one**, and an empty community board is
self-reinforcing — nobody posts into silence. No amount of architecture fixes this, and the plan had
nothing to say about it. Needed before launch:
- 25–40 seeded insights across all six domains, written by you or harvested from existing coaching
  calls, so the library looks alive and the Solution Finder actually returns results.
- 10–15 seeded wins showing the blueprint format — members copy the shape of what they see. Seed
  thin, low-quality wins and that's the ceiling you set.
- A founding cohort invited in a batch, not a trickle, so the first week has conversation.
- A 30-day content calendar and a prompt schedule for `#introductions` and `#ask-for-help`.

**Treat seeded content as a launch deliverable with a named owner**, alongside the code.

### 10.2 No defined engagement loop

Skool-class products live on a weekly rhythm: live call → featured insight → digest → streak nudge.
The pieces are now in the plan (events, digests, streaks, votes) but the *cadence* isn't specified,
and unspecified cadence means it silently doesn't happen. Define: which day the vote closes, when the
session runs, when the digest sends, what the streak actually counts. Then build the worker jobs to
match.

### 10.3 Missing features members will expect

| Gap | Why it matters | Cost |
|---|---|---|
| **Lesson-level Q&A threads** | The single strongest completion driver in any LMS — questions asked *at the point of confusion*. Currently all discussion lives in channels, detached from lessons. Reuses the polymorphic `comments` table. | Low |
| **Drip / scheduled release** | Standard for cohort programmes; gating by tier alone can't express "module 3 unlocks in week 3". Needs `available_from` + optional prerequisite on modules. | Low |
| **Completion certificates** | High perceived value, trivial to generate, and members post them — free distribution. | Low |
| **Member directory** | The actual value of a mastermind is peers. Searchable by domain, expertise and location; nothing in the plan lets members find each other. | Medium |
| **Notes & highlights per lesson** | Retention feature; also gives members a reason to return to finished lessons. | Low |
| **Granular notification preferences** | Without them people mute everything after week two and never come back. | Low |
| **Direct messages** | Expected in a peer community — but they carry real moderation and safety obligations. Decide deliberately; "not in v1" is a fine answer, silence is not. | High |
| **Quizzes / assessments** | Genuinely optional for a mastermind, but flag it now rather than discovering the expectation mid-build. | Medium |

### 10.4 Revenue leak and content protection

Course businesses lose more to **account sharing** than to piracy, and the plan has no defence:
- **Concurrent session / device limits** — cap active refresh tokens per account, show members their
  devices, let them revoke. The single highest-ROI item in this section.
- **Short-TTL signed playback tokens bound to the session**, not just to the user.
- **Visible watermark** overlaying the member's email on premium video — cheap, and a strong
  deterrent against re-uploads.
- **Video egress is your dominant variable cost.** Model it before pricing: minutes delivered per
  active member per month × provider rate. An LMS's unit economics are decided here, and the plan
  never costed it.

### 10.5 Security gaps not yet covered

- **SMS pumping fraud.** Phone OTP endpoints are attacked to generate premium-rate traffic, and the
  bill lands on you — this has cost Indian startups lakhs. Needs per-phone, per-IP and per-device
  rate limits, a country allowlist, exponential backoff, and a spend alarm on the SMS account. Do it
  *with* the OTP feature in M1, not after the first invoice.
- **Rich text is an XSS surface.** The original schema stored `summary_html`. Store **markdown**
  instead (or ProseMirror/Tiptap JSON), sanitize on render, never trust stored HTML. Changing this
  after members have authored content is a painful migration.
- **Webhook hardening** — signature verification, replay protection via a nonce/timestamp window,
  idempotent handlers, retry with backoff. Payment and video-status webhooks both need it.
- **Signup abuse** — disposable-email blocking, invite codes for early cohorts.

### 10.6 Engineering discipline that prevents slow decay

- **An index and query budget.** Write the expected access pattern next to each table, and run
  `EXPLAIN` in CI on the ten hottest queries. Progress writes and feed reads are where this bites.
- **Timezone correctness.** Streaks and event reminders are date-boundary logic; `users.timezone`
  exists, so use it — a streak that resets at UTC midnight punishes Indian members at 5:30am.
- **Pick the rich-text format once** (see 10.5) and write it into the contracts package.
- **Public win pages** — wins are your best growth asset. Public, SEO-indexed, shareable win pages
  (author opt-in) turn member success into distribution. This is the strongest argument for the
  marketing site existing at launch.
- **A migration path for existing members**, if you have a community or course elsewhere today. Bulk
  import with invite-on-first-login is a week of work that's easy to forget to schedule.

---

## 11. Decisions I need from you

1. **Postgres host** — managed (Neon / Supabase: easy backups, branching, zero ops) or self-hosted in
   Compose (cheapest, fully portable)? Identical code; this only changes `DATABASE_URL`.
2. **Video provider** — Cloudflare Stream (global delivery, ~$5 per 1000 min stored + $1 per 1000 min
   delivered) or Bunny Stream (materially cheaper, strong India POPs)? Affects `VIDEO_PROVIDER` only.
3. **Auth ownership** — own it in the API as specified (portable, ~3 extra days) or lean on a managed
   provider for OTP/OAuth (faster, adds a dependency and a second identity store)? I recommend owning
   it, given the VPS goal.
4. **iOS in scope for v1, or Android first?** iOS roughly doubles store overhead and IAP scrutiny.
5. **Marketing/SEO pages** — needed at launch? If yes, that's the separate Astro site, not SSR in the app.
6. **Billing scope** — confirm v1 is entitlement-only in the store builds with Razorpay on web, and
   whether Android user-choice billing is a v1.1 commitment (it changes only which webhook handlers
   we write first, not the schema).

*Store policies here move fast — re-verify Apple's guideline 3.1.1/3.1.3 and Google's India billing
terms immediately before each store submission rather than trusting this document's dates.*

Answer those five and I'll scaffold the monorepo, the Drizzle schema, the Hono module skeleton with
Zod contracts, and the responsive app shell.
