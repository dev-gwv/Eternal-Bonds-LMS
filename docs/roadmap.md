# Roadmap: what is planned, not yet built

Written 2026-11-19. Nothing here is started. Pick what to implement and in which order.

---

## A. Multiple video sources per lesson (finishes the R2 video feature)

Today a lesson has exactly one source. Uploading a video replaced the lesson's YouTube link, and switching back to YouTube deletes the uploaded files from R2.

Planned:
- A lesson keeps several sources (uploaded/R2, YouTube, Drive), with one marked **active**.
- In Studio: a "Playing: Uploaded ▾" switch per lesson. Switching never deletes anything.
- Automatic fallback: while the uploaded video is processing or has failed, members get the YouTube version instead of "unavailable".
- Files are deleted only when a source is removed explicitly.

Size: about a day.

---

## B. Course builder gaps vs SaaS LMSs (Teachable, Thinkific, Kajabi, LearnWorlds)

Already on par: courses → modules → lessons, drip ("Opens day"), preview lessons, publish/draft, own adaptive HLS hosting + YouTube + Drive, quizzes, certificates, progress/resume, tiers, packages (bundles), Razorpay, manual grants, cohorts, journeys, challenges, wins, lesson discussions, push notifications, mobile app.

Missing, most important first:

| # | Missing | Why |
| --- | --- | --- |
| B1 | **Lesson types**: article/text lessons, PDF and file downloads, audio, embeds (Calendly, Typeform) | A lesson is a video + summary today. Downloadable worksheets are the most asked for. |
| B2 | **Coupons and discounts** | Launch offers, early-bird pricing, affiliate codes. |
| B3 | **Checkout extras**: order bumps/upsells, payment plans (EMI/instalments), GST invoices | |
| B4 | **Sales/landing page per course**: testimonials, FAQ, curriculum preview for logged-out visitors | |
| B5 | **Assignments**: learners submit work, instructor reviews and grades | |
| B6 | **Course analytics**: drop-off per lesson, watch-through, completion funnel, revenue per course | |
| B7 | **Instructor roles**: "instructor of course X only" permissions, revenue share | Admins author everything today. |
| B8 | **Bulk tools**: CSV member import, duplicate a course, bulk video upload into a module | |
| B9 | **Reviews and ratings** | |
| B10 | **Live sessions**: Zoom/Meet, recordings auto-attached to lessons | |
| B11 | **Email automation**: drip emails, "you haven't watched in a week", broadcasts to segments | |

---

## C. Multi-tenant: many academies on one platform

Each customer signs up and gets their own academy: their own brand, courses, packages, members and payments. Eternal Bonds becomes tenant #1.

### C1. Data and isolation (the biggest and most careful phase)
- New `organizations` table (name, slug, branding, plan, status).
- `org_id` on every academy-owned table: courses, packages, plans, orders, cohorts, posts, journeys, notifications, and so on.
- Accounts stay global (Supabase auth). Membership is per academy, in `org_members` (owner, admin, instructor, member), so one person can learn in two academies.
- Every RLS policy and every `security definer` function adds "current academy only". An automated test per table tries to read across academies; a missed filter would leak another academy's data.
- Eternal Bonds is migrated in as tenant #1, with nothing visible changing for its members.

### C2. Addresses, branding, signup
- `academy.<platform-domain>` for every academy automatically.
- The API resolves the academy from the domain and checks membership; CORS becomes dynamic.
- Branding per academy: logo, colours, name, favicon, email sender name.
- Self-serve signup wizard: create academy → pick address → brand it → first course.

### C3. Money
- **Academies pay the platform:** SaaS plans (monthly, with limits on members, storage and video hours).
- **Learners pay academies:** Razorpay Route (marketplace split with the platform's commission taken automatically), or each academy connects its own Razorpay keys.

### C4. Custom domains, email, limits
- Custom domains (`learn.theirbrand.com`) through the Vercel domains API, with automatic SSL.
- Email moves from Gmail SMTP to Resend or Amazon SES, sending from each academy's own domain.
- Usage metering and limits: storage, video hours, members.
- R2 keys under `orgs/<id>/…`. The transcoder queue gets fairness, so one academy's 50 uploads don't block everyone else.
- Platform super-admin console: all academies, plans, usage, suspend, impersonate for support, revenue.

### C5. Mobile app
- (a) One platform app where learners find or join their academy. Cheap, one store listing. **Do first.**
- (b) A white-label app per academy (its own name and icon) from the same code via EAS builds. Needs a store account per academy; a paid add-on later.

### Decisions needed before C is planned in detail
1. Who are the tenants: individual coaches, institutes, or companies training staff?
2. How does the platform earn: subscription, commission per sale, or both?
3. Custom domains on day one?
4. One shared mobile app, or a branded app per academy?

---

## D. Transcoding at scale: Cloudflare Containers

The transcoder runs on the club VPS (`/opt/eb-transcoder`, 3 of 4 cores). That's fine for one academy. With many academies (C), uploads arrive in bursts, and one VPS converting one video at a time becomes the queue.

Plan when needed: run the **same Docker image** on Cloudflare Containers, one container per job, started by the API when a job is queued. Many videos then convert in parallel and the VPS is no longer involved. The queue, API and R2 layout stay as they are; the VPS can stay as a free worker alongside.

Check Cloudflare's current Containers pricing and limits (instance sizes, disk, maximum run time) before building it.

Estimates (2026-11-19, from measured VPS speed of ~1x real time per core for 3 rungs; verify prices):
- One 4-vCPU container per video: a 2h15 lecture takes ~35–45 min, about $0.25–0.30 (≈ $0.12 per video hour).
- Split into ~10-minute chunks across ~14 containers, then joined: ~5–8 min, same cost. Needs chunk/join code (keyframes are already segment-aligned).

Other options considered:
| Option | 2h15 lecture | Cost | Notes |
| --- | --- | --- | --- |
| VPS (now) | ~45 min | $0 | one at a time |
| Dedicated transcoding server (Hetzner 8–16 cores) | ~15–25 min | ~€30–60/month flat | |
| GPU on demand (RunPod serverless, NVENC) | ~5–10 min | ~$0.05–0.10 | slightly lower quality per bitrate |
| AWS MediaConvert | ~5–10 min | ~$4–6 + AWS egress | too expensive |
| Cloudflare Stream | ~5–10 min | free encode; $5/1k min stored + $1/1k min watched | per-view cost grows |
| Mux | ~5 min | per minute stored + watched | same problem |
| Bunny Stream | ~10 min | free encode, ~$0.01/GB stored, ~$0.005–0.03/GB delivered | DRM (MediaCage), captions, watermark |
| VdoCipher / Gumlet | ~10–20 min | yearly bandwidth plans | strong DRM, viewer watermark; only if piracy matters |

**Chunked parallel encoding (build with Containers, not on the VPS):**
1. The API splits a video into ~10-minute time ranges cut on 6-second segment boundaries; each container reads only its range from R2 (ffmpeg seeks over HTTP range requests).
2. Each container encodes its range into every video rung, with timestamps continuing from the previous chunk.
3. Audio is encoded once for the whole video as a separate HLS audio rendition (no clicks at chunk joins).
4. The API joins the chunk playlists into one: no re-encoding, seconds.
5. Videos under ~15 minutes skip chunking.
6. A failed chunk is retried alone.
About 2–3 days, including testing joins on long lectures. Result: a 2h15 lecture in ~5–8 min at the same cost.

**Bunny Stream as an optional source** (per academy or course, ideally a paid plan upgrade): free encoding in minutes, MediaCage DRM, captions, watermark, player, analytics; pays per GB watched (~$0.005–0.03/GB). At 20,000 watched hours/month that is ~$100–600 vs ~$3 on R2. Integration: TUS upload direct from the browser, webhook when encoded, token-signed HLS playback; 1–2 days on top of item A.

Anti-piracy gap: signed links stop link sharing, not screen recording. Cheap step: dynamic watermark with the learner's email. Full DRM means VdoCipher/Bunny for those courses.

---

## F. Backend gaps

No separate API gateway: the Hono Worker on Cloudflare already is one (edge TLS/DDoS, CORS, auth, rate limits, idempotency, ETags, request validation). Gateway-type features still to add inside it, mostly for multi-tenant: tenant resolution by domain, per-tenant rate limits and plan quotas, API keys for tenants' integrations, outgoing webhooks.

Already there: rate limits, idempotency keys, outbox, audit log, moderation, search, Razorpay webhooks, account deletion, Workers logs, PostHog hook (key not set).

| # | Missing | Why |
| --- | --- | --- |
| F1 | **Database backups**: nightly `pg_dump` to R2 from the VPS, or Supabase Pro ($25/month, daily backups) | Free plan has no downloadable backups. Losing the database loses every member, order and progress record. |
| F2 | **Error tracking** (Sentry, free tier) for API, web and app | Errors are only in Workers logs, kept a few days, and nobody is alerted. |
| F3 | **Alerts and uptime monitoring**: API health, failed transcode jobs, queue backing up, failed payments/webhooks | Tonight's transcode failure (fractional duration) went unnoticed until checked by hand. |
| F4 | **Staging environment**: staging Worker + Supabase branch/project | CI already supports STAGING_DATABASE_URL; changes go straight to production today. |
| F5 | **Transactional email service** (Resend or SES) with templates | Gmail SMTP caps around 500 emails/day and can't send per academy domain. |
| F6 | **Admin security**: 2FA for admins, Cloudflare Turnstile on sign-up and password reset | Admin accounts control payments and content; reset forms invite abuse. |
| F7 | **Cloudflare Queues** for async work (emails, certificates, transcode triggers) | Cron + outbox works now; Queues retry per message and scale with multi-tenant. |
| F8 | **Payments backend**: coupon engine, GST invoices, refunds, payment plans | Pairs with B2/B3. |
| F9 | **Analytics pipeline**: video watch events, course funnels, revenue reports | Pairs with B6. |
| F10 | **Personal data export** (India DPDP Act) | Account deletion exists; check whether a "download my data" exists. |
| F11 | **Public API keys and outgoing webhooks** | Zapier/CRM integrations; needed per academy in C. |
| F12 | **Plan entitlements / feature flags** | Turn features on per academy plan in C. |

---

## E. Mobile app

Lives on branch `mobile-rn` (`apps/mobile`, Expo SDK 58 / RN 0.88), checked out at `E:\eb-mobile`. Merge into `main` when work on the app starts.
