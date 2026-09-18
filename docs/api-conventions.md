# API conventions

The API is built so a native app can be added later without reopening it. None of
this requires a mobile client today; it costs nothing now and is expensive to
retrofit once clients exist.

## Auth — Bearer, never cookie-only

Supabase issues the session; this API only verifies it, against the project's
JWKS (`/auth/v1/.well-known/jwks.json`). Tokens arrive as:

```
Authorization: Bearer <supabase access token>
```

A cookie (`sb-access-token`) is read as a convenience for the web client, but no
endpoint depends on one. **A native app cannot rely on cookies**, so an API that
only reads them has to be rewritten when the app ships.

Failures return `401` with `WWW-Authenticate` and a problem document — never a
redirect. An app cannot follow a redirect to a login page.

## Errors — RFC 9457 problem+json

Every failure has the same shape, so a client parses errors once:

```json
{ "type": "about:blank", "title": "Course not found", "status": 404, "detail": "…" }
```

## Versioning

Path-versioned (`/v1/...`) and every response carries `x-api-version`. When a
breaking change lands, old app builds keep working against `/v1` — the store
takes days to review an update and users take weeks to install it.

## Pagination — cursor, never offset

`?cursor=&limit=` with `{ items, nextCursor }`. Offset paging shows duplicates
as a feed mutates under an infinite scroll.

## Idempotency

`Idempotency-Key` on POST/PATCH replays the first response. A phone on a flaky
train retries; without this the member registers for the same workshop twice.
In-memory today, moving to the `idempotency_keys` table in M1.

## CORS

Configured web origins plus `capacitor://localhost` and `ionic://localhost`.
Native requests often carry no `Origin` header at all, which CORS ignores — the
allowance exists for the WebView cases that do send one.

## Headers a client should send

| Header | Why |
|---|---|
| `Authorization: Bearer` | the session |
| `X-Client` | `web` / `ios` / `android` — shows up in logs, makes per-platform bugs visible |
| `X-Client-Version` | lets the server warn or block builds too old to trust |
| `Idempotency-Key` | on any retryable mutation |

## Deliberately absent

- **No server-rendered HTML.** Responses are JSON, always.
- **No redirects** in the API surface.
- **No session state on the server.** Every request carries its own auth, so
  instances scale horizontally and a phone can resume after hours asleep.
- **No playback URLs in responses** — only `video_asset_id` + provider. Signed
  URLs are minted on request and expire.
