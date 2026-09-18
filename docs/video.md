# Video

Three providers, one interface (`services/api/src/lib/video-provider.ts`).
Nothing above that file knows which is in use, which is what keeps the choice a
pricing decision rather than a migration.

| `VIDEO_PROVIDER` | Where the file lives | Playback | Adaptive bitrate |
|---|---|---|---|
| `none` (default) | Supabase Storage, private bucket | Signed progressive MP4 | No |
| `cloudflare` | Cloudflare Stream | Signed HLS | Yes |
| `bunny` | Bunny Stream | Token-authenticated HLS | Yes |

`none` is not a placeholder — a course can be published and watched on it. What
it cannot do is degrade gracefully on a weak connection, which in India is most
connections. That is the reason to move.

---

## How an upload actually works

The file never passes through the API. A 2GB lecture going through a Worker or
a 512MB container is an outage, not a slow request.

```
browser                    API                     provider
   │  POST /upload  ────────►│
   │                         │ create direct upload ──►│
   │◄──── ticket ────────────│◄──── url + asset id ────│
   │                                                    │
   │  PUT / POST the file  ─────────────────────────────►│
   │                                                    │
   │  POST /video (key) ────►│ status = processing       │
   │                         │◄──── webhook: ready ──────│
   │                         │ status = ready
```

The ticket carries the URL, the **method** and any headers, so the browser has
no provider-specific code at all. Supabase Storage wants a `PUT` with a content
type; Cloudflare Stream wants a multipart `POST`. That difference lives in the
ticket, not in `admin-api.ts`.

### Who decides a video is playable

- **`none`** — the file is playable the moment the upload finishes, so
  `attachVideo` sets `ready` itself.
- **A real provider** — "uploaded" and "playable" are minutes apart, and only
  the provider knows when the renditions exist. `attachVideo` sets
  `processing`; the **webhook** promotes it.

Trusting the browser here would mean publishing a lesson whose video is still a
progress bar on someone else's screen.

### When the webhook never comes

A deploy mid-transcode, a misconfigured URL, an outage. The `video.poll` job
asks the provider about anything stuck in `uploading` or `processing` every two
minutes. Without it a lesson sits at `processing` forever and nobody finds out
until a member complains.

`courses.guard` goes further: a published course whose lesson video has since
broken gets **unpublished**, and every admin is notified. A course that is
briefly missing is better than one with a dead player.

---

## Cloudflare Stream

```bash
# An API token with Stream:Edit on the account.
fly secrets set \
  VIDEO_PROVIDER=cloudflare \
  VIDEO_ACCOUNT_ID=<account id> \
  VIDEO_API_TOKEN=<token> \
  VIDEO_DELIVERY_HOST=customer-<code>.cloudflarestream.com \
  VIDEO_SIGNING_KEY_ID=<key id> \
  VIDEO_SIGNING_KEY_PEM="$(cat stream-signing-key.pem)" \
  VIDEO_WEBHOOK_SECRET=<from the webhook settings page>
```

Get the signing key once:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/stream/keys" \
  -H "Authorization: Bearer $TOKEN"
```

It returns a key id and a base64 PKCS#8 private key. **Store it immediately** —
Cloudflare does not show it again.

Point the webhook at `https://api.yourdomain.com/webhooks/video`.

Two details that matter:

- **`requireSignedURLs: true`** is set on every direct upload. Without it,
  anyone who learns the asset uid can watch a paid lesson forever, and the
  entire tier model is decoration.
- The playback token is **signed locally** rather than fetched from
  Cloudflare's `/token` endpoint. That is one fewer round trip on the path a
  member waits on, and playback keeps working if Cloudflare's API is briefly
  unreachable while its CDN is not.

## Bunny Stream

```bash
fly secrets set \
  VIDEO_PROVIDER=bunny \
  VIDEO_LIBRARY_ID=<library id> \
  VIDEO_API_TOKEN=<library API key> \
  VIDEO_DELIVERY_HOST=<pull-zone>.b-cdn.net \
  VIDEO_SIGNING_KEY_PEM=<pull zone token authentication key> \
  VIDEO_WEBHOOK_SECRET=<any random string>
```

Materially cheaper for delivery in India, which is where every member is.

Two things it does differently:

- **There is no signed-upload endpoint.** The upload is authenticated by the
  library key, and sending that to a browser would hand it the whole library.
  The API mints a per-video presigned signature instead, scoped to one video id
  and expiring in two hours.
- **Token authentication is optional in Bunny and mandatory here.** Without it
  the pull zone URL is permanent and shareable. `VIDEO_SIGNING_KEY_PEM` holds
  the pull zone's token key (the field is named for Cloudflare's use of it;
  Bunny's is a plain string).

Bunny's webhook is unsigned, so it is authenticated by a shared secret in the
`x-bunny-secret` header. Set `VIDEO_WEBHOOK_SECRET` to a long random value and
configure the header on the webhook.

---

## Webhook safety

All three rules in `modules/webhooks.ts` exist because getting them wrong is
expensive:

1. **Verify against the raw body**, before parsing. A re-serialised object is a
   different string — the signature will not match, or worse, will match
   something the provider did not send.
2. **Answer 2xx for anything already handled.** Providers retry for days; a
   non-2xx on a duplicate produces an escalating retry storm.
3. **Never leak why something was rejected.** A bad signature gets the same
   flat answer as a malformed body.

Every delivery is recorded in `webhook_events` by provider event id, so a
replay is free to ignore and an argument months later can be settled with the
raw payload.

---

## Switching provider later

Existing lessons keep working. `lessons.video_provider` records which system
owns each asset, so a switch is additive rather than a migration of every row —
old lessons keep playing from the old provider until somebody re-uploads them.

What is **not** handled automatically: moving existing assets between
providers. If that is ever wanted, it is a script that downloads from one and
re-uploads through `createUploadTicket`, and it should be written when there is
a reason to, not before.

---

## Cost, honestly

At 2026 list prices, for ~50 hours of library with modest viewing:

| | Storage | Delivery |
|---|---|---|
| Cloudflare Stream | ~$5/1000 min stored | $1/1000 min watched |
| Bunny Stream | ~$0.01/GB | ~$0.005/GB in India |
| Supabase Storage (`none`) | $0.021/GB | $0.09/GB egress |

Bunny wins on delivery in India by a wide margin. Cloudflare wins on being one
fewer vendor if the rest of the stack is already there. Supabase Storage is the
most expensive per GB delivered *and* has no ABR — it is the right default for
building, and the wrong one at scale.
