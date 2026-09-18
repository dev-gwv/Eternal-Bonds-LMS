# Portability contract

The rules that keep Eternal Bonds runnable on a VPS, on Cloudflare, or anywhere else — by changing
environment variables rather than code. Every rule below is enforceable in code review; several are
enforceable by lint.

**The principle:** platform features are reached through *interfaces we own*, never through a
platform's global objects. Hono is runtime-agnostic; these rules keep our code agnostic too.

---

## 1. Config: one typed `Env`, built at the edge of the process

Application code never reads `process.env` and never reads `c.env.SOME_BINDING`. Each entrypoint
builds one Zod-validated `Env` object and hands it to the app. Bad config fails at boot, loudly, not
at 3am in a request handler.

```ts
// services/api/src/env.ts
export const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_BUCKET: z.string(),
  STORAGE_ACCESS_KEY_ID: z.string(),
  STORAGE_SECRET_ACCESS_KEY: z.string(),
  VIDEO_PROVIDER: z.enum(['cloudflare', 'bunny']),
  VIDEO_API_TOKEN: z.string(),
  CRON_SECRET: z.string().min(32),
  ALLOWED_ORIGINS: z.string(),
})
export type Env = z.infer<typeof EnvSchema>

// services/api/src/server.ts      — VPS / container
Bun.serve({ port: 8080, fetch: (req) => app.fetch(req, EnvSchema.parse(process.env)) })

// services/api/src/worker.ts      — Cloudflare Workers (optional)
export default { fetch: (req, env, ctx) => app.fetch(req, EnvSchema.parse(env), ctx) }
```

Two entrypoint files, one application. That is the entire cost of supporting both.

---

## 2. Database: a factory, not a platform product

```ts
// packages/db/src/client.ts
export function createDb(url: string, opts?: { max?: number }) {
  const sql = postgres(url, { max: opts?.max ?? 10, prepare: false })
  return drizzle(sql, { schema })
}
```

- **VPS / container:** `DATABASE_URL` points at Postgres (direct, or via PgBouncer in transaction mode).
- **Cloudflare Workers:** `DATABASE_URL` is the Hyperdrive connection string, `max: 1`.

Hyperdrive therefore appears exactly once, as a *string*, in deploy config. Nothing above
`createDb` knows it exists. `prepare: false` keeps it compatible with transaction-mode poolers everywhere.

**Authorization lives in the database.** Every request runs inside a transaction that adopts the
caller's identity, so Row Level Security — not scattered `where user_id = ?` clauses — decides access:

```ts
// packages/db/src/rls.ts
export async function withUser<T>(db: Db, userId: string | null, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticator`)
    await tx.execute(sql`select set_config('app.user_id', ${userId ?? ''}, true)`)
    return fn(tx)
  })
}
```

This works identically on managed Postgres and on a self-hosted container, because it uses nothing
but standard Postgres. `deploy/db/00_bootstrap.sql` creates the roles and the `current_user_id()`
helper on a plain instance.

---

## 3. Storage: the S3 API, never vendor bindings

```ts
export interface Storage {
  signedPutUrl(key: string, mime: string, expiresIn?: number): Promise<string>
  signedGetUrl(key: string, expiresIn?: number): Promise<string>
  putObject(key: string, body: Uint8Array, mime: string): Promise<void>
  delete(key: string): Promise<void>
}
```

One implementation over `@aws-sdk/client-s3`, pointed wherever `STORAGE_ENDPOINT` says: R2 in
production, MinIO in local Compose, Backblaze/Wasabi/S3 if pricing changes. `env.BUCKET.put(...)`
never appears in the codebase.

**Uploads are always browser-direct via presigned PUT**, never proxied through the API. That rule
keeps request bodies small enough for any runtime's limits — including Workers' — and keeps upload
throughput off your API box.

---

## 4. Video: an interface, because this is the sticky one

```ts
export interface VideoProvider {
  createDirectUpload(opts: { maxDurationSeconds: number }): Promise<{ uploadUrl: string; assetId: string }>
  getPlaybackToken(assetId: string, ttlSeconds: number): Promise<string>
  getAsset(assetId: string): Promise<{ status: VideoStatus; durationSeconds: number; thumbnailUrl: string }>
  delete(assetId: string): Promise<void>
  verifyWebhook(req: Request): Promise<{ assetId: string; status: VideoStatus } | null>
}
```

Selected by `VIDEO_PROVIDER`. The LMS knows `video_asset_id` + `video_provider` and nothing else — it
never stores a playback URL, because signed URLs expire.

This is the one dependency with a real migration cost: switching providers means re-uploading the
media. The interface makes that a *data* migration on a known schedule, not a code rewrite. Driving
the cost to zero would mean self-hosting transcoding, which is not worth it for this product.

---

## 5. Scheduling: an HTTP endpoint, not a platform scheduler

```
POST /internal/cron/:job     Authorization: Bearer ${CRON_SECRET}
```

Jobs are ordinary functions in `services/worker`, invoked by whatever the host provides:

| Host | Trigger |
|---|---|
| VPS | a `cron` container (or systemd timer) running `curl` |
| Cloudflare | Workers Cron Triggers calling the same route |
| Fly / Render | platform scheduled job |
| Local dev | `bun run job <name>` |

Same code, four triggers. No `scheduled()` handler in application logic.

---

## 6. Caching and realtime

- **Caching:** HTTP caching first (`ETag`, `stale-while-revalidate`, immutable hashed assets), then
  TanStack Query client-side, then — only for genuinely expensive aggregates — a `Cache` interface
  over Redis (Upstash HTTP at the edge, plain Redis on a box). No KV, no Durable Objects.
- **Realtime:** Server-Sent Events from the Bun API when it's needed. SSE works on a VPS, in a
  browser, and inside a Capacitor WebView. Websockets on Workers require Durable Objects, which is
  precisely the lock-in this document exists to avoid.

---

## 7. Banned in application code

These are the specific things that would quietly re-introduce lock-in:

- `process.env` / `c.env.X` outside an entrypoint file
- Cloudflare bindings: `env.BUCKET`, `env.KV`, `env.DB`, Durable Objects, Workers AI, `caches.default`
- Node-only APIs in shared packages: `fs`, `path`, `__dirname`, `Buffer` (use `Uint8Array`)
- A raw video playback URL persisted in the database
- Long-running work inside a request handler (belongs in `services/worker`)
- Vendor SDKs imported outside `services/api/src/lib/` — providers live behind interfaces, always

---

## 8. Deployment matrix

| Target | Web | API | DB | Storage |
|---|---|---|---|---|
| **All-VPS** | Caddy serves `dist/` | Bun container | Postgres container | MinIO or R2 |
| **Split** *(recommended start)* | Cloudflare static assets | Bun on VPS / Fly / Railway | Neon or Supabase | R2 |
| **All-Cloudflare** | Workers static assets | Workers + Hyperdrive | Neon / Supabase | R2 |
| **Anywhere else** | any static host | any container host | any Postgres | any S3-compatible |

Moving between columns changes `.env`, `docker-compose.yml` and which entrypoint is built. It does not
change application code.

---

## 9. The proof

Portability claims rot unless they're tested. CI runs the integration suite against **Postgres in a
container with MinIO for storage** — the fully self-hosted configuration. If that suite passes, the
VPS path works, whatever production happens to be running on that week.
