# Performance budget

Agreed numbers, not aspirations. CI fails the build when these regress.

| Metric | Budget | How it is held |
|---|---|---|
| Initial JS (gzip) | ≤200KB | Route-level code splitting; no chart library (inline SVG); `hls.js`, Razorpay checkout loaded on demand |
| LCP, mid-range Android over 4G | <2.5s | Tokens-first CSS, skeletons per route, images lazy below the fold, video never preloads |
| API p95, catalog + feed reads | <300ms | `ETag` + `stale-while-revalidate` on catalog, TanStack Query client cache, `Cache`-interface Redis only for home feed/leaderboards |
| Progress writes p95 | <150ms | Single-row upsert, debounced ~15s, dedicated minimal endpoint; load-tested before launch |
| Worker lag (outbox → notification) | <60s | `outbox.drain` every 30s; `notifications.deliver` every 60s |

Route sections (Think Tank, Wins, Events, Directory, Photolancer) stay under
~40KB each: shared primitives only, no per-page libraries.

Measured 20 Sep 2026 (`bun run --filter @ipc/web build`, gzip):

| Chunk | Size | Notes |
|---|---|---|
| `index` (shell + dashboard) | 142KB | Under the 200KB first-paint budget |
| `react` / `tanstack` / `supabase` / `zod` | 3 / 52 / 59 / 26KB | Vendor chunks, cached across deploys |
| Every route section | 1–6KB | Lazy via `React.lazy` + `Suspense` in `AppShell` |
| `Lesson` (incl. `hls.js`) | 190KB | Loaded only when a lesson opens — never on first paint |

Remaining path to faster: defer `supabase-js` until the session gate needs it
(demo mode boots without it) and replace full `zod` with a lighter validator
on the client. Neither blocks launch.
