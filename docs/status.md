# Build status — what is real, what is stubbed

Audited 18 Sep 2026. "Real" means it runs against Supabase Postgres with RLS.
"Seed" means the API serves fixed content from `services/api/src/data/seed.ts`.

## Backend

| Capability | State | Notes |
|---|---|---|
| Hono app on Bun | **Real** | One runtime-agnostic `app` object; `server.ts` is the only file reading `process.env` |
| Supabase Auth verification | **Real** | JWKS verify via `jose`; Bearer-first, cookie as a web convenience |
| Route guard | **Real** | `requireAuth` → 401 + `WWW-Authenticate` + problem+json. Steps aside when `SUPABASE_URL` is unset so a clean checkout runs |
| RFC 9457 errors | **Real** | `application/problem+json` on every failure |
| CORS incl. native origins | **Real** | Web origins + `capacitor://` / `ionic://` |
| Idempotency-Key | **Real** | Replays the first response, from the `idempotency_keys` table — survives a restart and spans instances. Falls back to a per-process map only in seed mode |
| Cursor pagination | **Partial** | Helpers exist (`lib/pagination.ts`); list endpoints do not use them yet — the lists are small |
| ETag / conditional GET | **Real** | `hono/etag` on `/v1/*` |
| Request logging | **Real** | JSON lines with requestId, client, userId, duration |
| Cron endpoint | **Real** | `POST /internal/cron/:job` behind `CRON_SECRET` — a cron container, Workers Cron Trigger, systemd timer or pg_cron all drive the same registry |
| Rate limiting | **Real** | Fixed-window per member/IP with `ratelimit-*` headers, counted in the `rate_limits` table in one atomic statement — the limit is the limit, not the limit × instances. On posting (10/5min), export (3/hr), deletion (5/hr) |
| Courses read | **Real** | List plus `GET /v1/courses/:slug` with the module/lesson tree, per-lesson completion and resume position |
| Workshops read | **Real** | Registration join; `joinUrl` withheld unless registered |
| Channels / posts read | **Real** | Author tier via `public.current_tier()` |
| Library categories | **Real** | Item counts are a real subquery |
| Member profile | **Real** | Tier derived from `memberships`, not cached on the row |
| Leaderboard, activity, stats | **Real** | Served from `member_stats` / `daily_activity` / workshop tables, rebuilt by the worker. Seed fallback with no database |
| Performance (score gauge) | **Seed** | No rollup: quizzes and exams do not exist yet (PLAN §10.3) |
| Likes and comments | **Real** | Like/unlike on posts and comments, one level of threading, edit and soft delete. Counters maintained by database triggers, not application arithmetic |
| Notifications | **Real** | In-app feed with unread counts, per-member preferences, quiet hours, push-token registration. Fanned out from the outbox by the worker |
| Email delivery | **Real** | Resend adapter plus a console one. **Console is the default and should stay there until SPF/DKIM/DMARC exist** — the first send from an unverified domain is how a domain gets blocklisted |
| Push delivery | **Real, untested on a device** | FCM HTTP v1 with a cached service-account token; iOS rides on FCM. No signed app exists yet to receive one (M7) |
| Payments | **Real** | Razorpay orders and webhooks. The membership is granted by the **webhook**, never by the browser — there is deliberately no "confirm payment" endpoint |
| Webhooks | **Real** | `/webhooks/video` and `/webhooks/razorpay`, outside `/v1` so a provider never has to migrate. Signature verified against the raw body, every delivery recorded by provider event id, replays free to ignore |
| Channel unread counts | **Stub** | Always 0 — needs a `last_read_at` per member per channel |
| Writes | **Real** | Create post (validated, rate-limited), workshop register/cancel, lesson progress upsert. Each writes an `activity_events` row and, where it matters, an `outbox` row in the same transaction |
| Storage | **Real** | `lib/storage.ts` signs Supabase Storage URLs; the studio uses them for direct browser→bucket video upload. Bucket `ipc-media` is created by migration and is private |
| Video | **Real** | Cloudflare Stream and Bunny Stream both implemented behind one interface, plus `none` (signed progressive MP4 from Supabase Storage). Direct browser→provider upload, signed short-lived playback, verified webhooks, and a poller for the webhook that never came. See `docs/video.md` |
| Admin / authoring API | **Real** | `/v1/admin/*` behind `requireAdmin` **and** RLS. Course/module/lesson/workshop CRUD, whole-list reorder, publish gating, signed video upload. Proven by `bun run db:test-studio` |
| Workers entrypoint | **Real** | `src/worker.ts` — the deployment target. Same app object as Bun, optional Hyperdrive binding, `scheduled()` on a Cron Trigger. Builds at 416 KiB gzip, under the free plan's 1 MB limit |
| Worker service | **Real** | `services/worker`: Postgres queue (`for update skip locked`), scheduler, 13 jobs — outbox drain, daily-activity and member-stats rollups, streaks, notification delivery, video polling, published-course guard, webhook replay, membership expiry, counter reconciliation, account purge, weekly digest, expired-record sweep |

## Database

| Item | State |
|---|---|
| Schema (33 tables) | **Real** — `packages/db/src/schema.ts`, migration generated |
| Supabase migration | **Real** — `supabase/migrations/…_init.sql` + `…_auth_and_rls.sql` |
| `auth.users` → `public.users` FK + sign-up trigger | **Real** |
| RLS on every table | **Real** — policies for profiles, tier-gated content, own-row progress, channel posts |
| `current_tier()` / `tier_allows()` / `is_admin()` | **Real** |
| Seed SQL | **Real** — channels, library categories, 8 courses, 3 workshops |
| Applied to a project | **Done** — ap-south-1 (Mumbai), Postgres 17.6. All 33 tables, RLS on every one |
| Admin write policies | **Real** — modules, lessons, library, channels and post moderation. Without these nobody could author at all |
| Private `ipc-media` bucket | **Real** — created by migration; `db:verify` fails if it is ever made public |
| RLS test suite | **Real** — `bun run db:test-rls` creates two throwaway members and proves isolation and tier gating, then cleans up |
| Authoring test suite | **Real** — `bun run db:test-studio`: 20 checks covering create/reorder/publish and, on the other side, that a plain member is refused by the database |
| Engagement test suite | **Real** — `bun run db:test-engagement`: 30 checks over likes, threading, soft delete, notification fan-out, preferences, membership grants, and deliberate counter drift being corrected |
| Events emitted by the database | **Real** — triggers on posts, likes, comments and courses write the outbox row. Application-side emission was impossible: `outbox` is service-role-only, and an insert policy on it would let a member forge `course.published` through PostgREST |

## Web

| Item | State |
|---|---|
| Design tokens + primitives + charts | **Real** |
| App shell (nav, page header, footer) | **Real**, identical on every page |
| Dashboard / Community / Workshops / Courses / Library / Member | **Real** views over live API data |
| Supabase client + Bearer on every request | **Real** |
| Sign-in / sign-up UI | **Real** — phone OTP, email magic link, Google |
| Route protection | **Real** — the shell gates on session; demo mode only when Supabase is unconfigured |
| Account deletion + data export | **Real** — 30-day soft delete with cancel, and a full JSON export |
| Lesson player | **Real** — HLS via hls.js, resume, speed, scrub, mark complete, syllabus sidebar, debounced progress writes |
| Write paths | **Real** — composer posts, workshop register/join, lesson progress from the player |
| Admin studio | **Real** — `/admin`: overview counts, course list with publish/delete, course builder (modules, lessons, reorder, preview flag, per-lesson video upload with progress), workshop scheduler in IST. Link appears only for admins |
| Community engagement | **Real** — optimistic like button, collapsible comment threads with reply/edit/delete |
| Notification bell | **Real** — polls every 30s, pauses in a background tab, click-outside and Escape close it |
| Notifications page | **Real** — full history plus the preference switches and quiet hours, on one page |
| Membership page | **Real** — plans, Razorpay checkout loaded on demand, order history |
| Mobile breakpoints | **Partial** — CSS exists for <1100 and <720; untested on a real device. The studio is desktop-first and has no small-screen layout |

## Known shortcuts, deliberately taken

1. **Seed fallback.** With no `DATABASE_URL` the API serves fixed content. It is what makes `bun dev` work on a clean checkout, and it doubles as the launch seed (PLAN §10.1). It must not reach production — `/health` reports `"source": "seed"` so this is visible.
2. **Leaderboard XP is fixed.** Computing it needs the worker; the endpoint shape is final so the UI will not change when it becomes real.
3. **`author.tier` on seeded posts** is whatever the seed says. In the DB path it comes from `current_tier()`.
4. **Reordering is buttons, not drag-and-drop.** Drag is nicer with a mouse and worse with a keyboard; the whole order is sent on every move, so a dropped request cannot leave a course in an order nobody chose.
5. **The first admin is made in SQL.** There is deliberately no UI — self-service admin is not a feature. See `docs/deploy.md`.

## Still missing before launch

| Gap | Consequence |
|---|---|
| A verified sending domain | Email is written and tested but goes to a log line until SPF/DKIM/DMARC exist. This is a DNS task, not a code one |
| A real device for push | FCM is implemented; nothing has ever received a notification because no signed app exists |
| Razorpay account + webhook | The code path is complete and `BILLING_MODE=web_only` until keys are set |
| Play user-choice billing + iOS IAP | v1.1, after the entitlement-only build clears review — `EntitlementGrant` per provider, `BILLING_MODE` toggles the client |
| Seeded insights + wins (PLAN §10.1) | Schema, wizards and Solution Finder exist; 25–40 insights and 10–15 wins need real authors from the founding cohort |
| End-to-end tests | 58 unit tests (`bun test`), three database suites, and `bun run smoke` — 23 in-process endpoint checks in seed mode, under a second. No browser-level tests |
| Rehearsed restore + progress load test | Backup exists; the restore has never been rehearsed and the progress endpoint never load-tested |
| SMS/DLT registration | Phone OTP rides on Supabase Auth; MSG91/Twilio + DLT is an M0 lead-time item |
| Direct messages | Deliberately off in v1 (`feature_flags.direct_messages = false`) — moderation policy undecided |

Built since the last audit: Think Tank (library, vote cycles, share wizard, Solution Finder,
bookmarks), Wins Board (blueprint wizard, reactions, comments, proof media), Events
(schedule, RSVP, featured-insight linking, recording→lesson), Photolancer (briefs +
applications), member directory + badges engine, moderation queue + audit log + feature
flags + impersonation, terms acceptance + legal page, lesson Q&A + notes + resources +
certificates, image pipeline contract, PostHog proxy analytics, offline banner +
last-course cache, skip link + focus + reduced-motion, perf budget, Capacitor + Astro
scaffolds, cursor pagination on new feeds, `packages/domain|permissions|ui`.
