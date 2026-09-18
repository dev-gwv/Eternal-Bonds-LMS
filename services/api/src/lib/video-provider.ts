import { SignJWT, importPKCS8 } from 'jose';
import type { Env } from '../env.ts';
import { HttpError } from './problem.ts';

/**
 * Video, behind one interface.
 *
 * Three implementations: Cloudflare Stream, Bunny Stream, and `none` (the
 * file sits in Supabase Storage and is served as a signed progressive MP4).
 * Nothing above this file knows which is in use, which is what keeps the
 * choice a pricing decision rather than a migration — the portability contract
 * (docs/portability-contract.md §4) in practice.
 *
 * Two things every implementation has to get right:
 *
 *   1. **The browser uploads to the provider, not to us.** A two-hour lecture
 *      going through a Worker or a 512MB container is an outage.
 *   2. **Playback URLs expire and are minted per request.** A URL stored on a
 *      lesson row is a URL that outlives the membership that paid for it.
 */

export type VideoStatus = 'none' | 'uploading' | 'processing' | 'ready' | 'errored';

export type DirectUpload = {
  /** Where the browser PUTs or POSTs the file. */
  uploadUrl: string;
  /** How the browser has to send it. Providers disagree. */
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  /** The handle we store on the lesson. */
  assetId: string;
  uploadId: string;
  expiresAt: string;
};

export type AssetState = {
  status: VideoStatus;
  durationSeconds?: number;
  error?: string;
};

export type PlaybackSource = { url: string; kind: 'hls' | 'mp4' };

/** A webhook that has been verified and understood. Anything else is dropped. */
export type VideoWebhookEvent = {
  eventId: string;
  eventType: string;
  assetId: string;
  state: AssetState;
  payload: Record<string, unknown>;
};

export interface VideoProvider {
  readonly name: 'cloudflare' | 'bunny' | 'none';
  createDirectUpload(lessonId: string, filename: string, maxSeconds: number): Promise<DirectUpload>;
  playback(assetId: string, ttlSeconds: number): Promise<PlaybackSource>;
  state(assetId: string): Promise<AssetState>;
  remove(assetId: string): Promise<void>;
  /** Returns null when the signature does not verify — never throws for that. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<VideoWebhookEvent | null>;
}

/* ── Cloudflare Stream ─────────────────────────────────────────────────────
   Per-minute-of-storage pricing, signed URLs via a short-lived JWT, and it
   already sits in front of the rest of the stack. */

class CloudflareStream implements VideoProvider {
  readonly name = 'cloudflare' as const;

  constructor(private readonly env: Env) {
    if (!env.VIDEO_ACCOUNT_ID || !env.VIDEO_API_TOKEN) {
      throw new HttpError(
        503,
        'Cloudflare Stream is not configured',
        'VIDEO_ACCOUNT_ID and VIDEO_API_TOKEN are required when VIDEO_PROVIDER=cloudflare.',
      );
    }
  }

  private get base() {
    return `https://api.cloudflare.com/client/v4/accounts/${this.env.VIDEO_ACCOUNT_ID}/stream`;
  }

  private headers() {
    return { authorization: `Bearer ${this.env.VIDEO_API_TOKEN}`, 'content-type': 'application/json' };
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { ...init, headers: this.headers() });
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; result?: T; errors?: { message: string }[] }
      | null;
    if (!res.ok || !json?.success) {
      // Surface the provider's own message: "the upload failed" helps nobody.
      const detail = json?.errors?.map((e) => e.message).join('; ') ?? `${res.status} ${res.statusText}`;
      throw new HttpError(502, 'Cloudflare Stream rejected the request', detail);
    }
    return json.result as T;
  }

  async createDirectUpload(lessonId: string, filename: string, maxSeconds: number): Promise<DirectUpload> {
    const result = await this.call<{ uid: string; uploadURL: string }>('/direct_upload', {
      method: 'POST',
      body: JSON.stringify({
        maxDurationSeconds: maxSeconds,
        // The link is single-use and short-lived; the browser is about to use it.
        expiry: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        // requireSignedURLs is the whole access model: without it, anyone who
        // learns the uid can watch a paid lesson forever.
        requireSignedURLs: true,
        meta: { lessonId, name: filename },
      }),
    });

    return {
      uploadUrl: result.uploadURL,
      // Stream's direct-upload endpoint takes a multipart POST, not a raw PUT.
      method: 'POST',
      headers: {},
      assetId: result.uid,
      uploadId: result.uid,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    };
  }

  /**
   * Signs a playback token with the account's private key.
   *
   * Signing locally rather than calling `/token` matters: it is one fewer
   * network round trip on the path a member waits on, and it keeps playback
   * working if Cloudflare's API is briefly unreachable while its CDN is not.
   */
  async playback(assetId: string, ttlSeconds: number): Promise<PlaybackSource> {
    if (!this.env.VIDEO_SIGNING_KEY_ID || !this.env.VIDEO_SIGNING_KEY_PEM) {
      throw new HttpError(
        503,
        'Playback signing is not configured',
        'VIDEO_SIGNING_KEY_ID and VIDEO_SIGNING_KEY_PEM are required for signed playback.',
      );
    }
    const key = await importPKCS8(this.env.VIDEO_SIGNING_KEY_PEM.replace(/\\n/g, '\n'), 'RS256');
    const token = await new SignJWT({ sub: assetId, kid: this.env.VIDEO_SIGNING_KEY_ID })
      .setProtectedHeader({ alg: 'RS256', kid: this.env.VIDEO_SIGNING_KEY_ID })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
      .sign(key);

    const host = this.env.VIDEO_DELIVERY_HOST || 'videodelivery.net';
    return { url: `https://${host}/${token}/manifest/video.m3u8`, kind: 'hls' };
  }

  async state(assetId: string): Promise<AssetState> {
    const result = await this.call<{
      status?: { state?: string; errorReasonText?: string };
      duration?: number;
    }>(`/${assetId}`);

    const state = result.status?.state;
    return {
      status:
        state === 'ready' ? 'ready' : state === 'error' ? 'errored' : state === 'queued' ? 'processing' : 'processing',
      durationSeconds: result.duration && result.duration > 0 ? Math.round(result.duration) : undefined,
      error: result.status?.errorReasonText,
    };
  }

  async remove(assetId: string): Promise<void> {
    await this.call(`/${assetId}`, { method: 'DELETE' });
  }

  /**
   * Cloudflare signs with `Webhook-Signature: time=…,sig1=…`, over
   * `${time}.${body}`.
   */
  async verifyWebhook(rawBody: string, headers: Headers): Promise<VideoWebhookEvent | null> {
    const header = headers.get('webhook-signature');
    if (!header || !this.env.VIDEO_WEBHOOK_SECRET) return null;

    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const time = parts.time;
    const signature = parts.sig1;
    if (!time || !signature) return null;

    // Five minutes: long enough for a retry, short enough that a captured
    // request cannot be replayed tomorrow.
    if (Math.abs(Date.now() / 1000 - Number(time)) > 300) return null;
    if (!(await hmacMatches(this.env.VIDEO_WEBHOOK_SECRET, `${time}.${rawBody}`, signature))) return null;

    const body = JSON.parse(rawBody) as {
      uid?: string;
      status?: { state?: string; errorReasonText?: string };
      duration?: number;
    };
    if (!body.uid) return null;

    const state = body.status?.state;
    return {
      eventId: `cf:${body.uid}:${state ?? 'unknown'}:${time}`,
      eventType: `stream.${state ?? 'unknown'}`,
      assetId: body.uid,
      state: {
        status: state === 'ready' ? 'ready' : state === 'error' ? 'errored' : 'processing',
        durationSeconds: body.duration && body.duration > 0 ? Math.round(body.duration) : undefined,
        error: body.status?.errorReasonText,
      },
      payload: body as Record<string, unknown>,
    };
  }
}

/* ── Bunny Stream ──────────────────────────────────────────────────────────
   Materially cheaper for delivery in India, which is where every member is. */

class BunnyStream implements VideoProvider {
  readonly name = 'bunny' as const;

  constructor(private readonly env: Env) {
    if (!env.VIDEO_LIBRARY_ID || !env.VIDEO_API_TOKEN) {
      throw new HttpError(
        503,
        'Bunny Stream is not configured',
        'VIDEO_LIBRARY_ID and VIDEO_API_TOKEN are required when VIDEO_PROVIDER=bunny.',
      );
    }
  }

  private get base() {
    return `https://video.bunnycdn.com/library/${this.env.VIDEO_LIBRARY_ID}`;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { AccessKey: this.env.VIDEO_API_TOKEN, 'content-type': 'application/json', accept: 'application/json' },
    });
    if (!res.ok) {
      throw new HttpError(502, 'Bunny Stream rejected the request', `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Bunny has no signed-upload endpoint: the upload is a PUT authenticated by
   * the library key. Sending that key to a browser would hand it the whole
   * library, so the API mints a per-video **TUS-style presigned signature**
   * instead — sha256(libraryId + apiKey + expiry + videoId), which is scoped
   * to one video id and expires.
   */
  async createDirectUpload(lessonId: string, filename: string, _maxSeconds: number): Promise<DirectUpload> {
    const created = await this.call<{ guid: string }>('/videos', {
      method: 'POST',
      body: JSON.stringify({ title: `${filename} (${lessonId})` }),
    });

    const expiry = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
    const signature = await sha256Hex(`${this.env.VIDEO_LIBRARY_ID}${this.env.VIDEO_API_TOKEN}${expiry}${created.guid}`);

    return {
      uploadUrl: `https://video.bunnycdn.com/tusupload`,
      method: 'POST',
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expiry),
        VideoId: created.guid,
        LibraryId: String(this.env.VIDEO_LIBRARY_ID),
      },
      assetId: created.guid,
      uploadId: created.guid,
      expiresAt: new Date(expiry * 1000).toISOString(),
    };
  }

  async playback(assetId: string, ttlSeconds: number): Promise<PlaybackSource> {
    const host = this.env.VIDEO_DELIVERY_HOST;
    if (!host) {
      throw new HttpError(503, 'VIDEO_DELIVERY_HOST is not set', 'Bunny playback needs the pull zone hostname.');
    }
    const path = `/${assetId}/playlist.m3u8`;

    // Token authentication is optional in Bunny and mandatory here: without it
    // the pull zone URL is permanent and shareable.
    if (!this.env.VIDEO_SIGNING_KEY_PEM) {
      throw new HttpError(
        503,
        'Playback signing is not configured',
        'Set VIDEO_SIGNING_KEY_PEM to the pull zone token authentication key.',
      );
    }
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const token = await sha256Base64Url(`${this.env.VIDEO_SIGNING_KEY_PEM}${path}${expires}`);

    return { url: `https://${host}${path}?token=${token}&expires=${expires}`, kind: 'hls' };
  }

  async state(assetId: string): Promise<AssetState> {
    const video = await this.call<{ status: number; length: number; encodeProgress: number }>(`/videos/${assetId}`);
    // Bunny's status is an integer: 0–3 in progress, 4 finished, 5 failed.
    return {
      status: video.status === 4 ? 'ready' : video.status === 5 ? 'errored' : 'processing',
      durationSeconds: video.length > 0 ? video.length : undefined,
      error: video.status === 5 ? 'Bunny could not encode this file' : undefined,
    };
  }

  async remove(assetId: string): Promise<void> {
    await this.call(`/videos/${assetId}`, { method: 'DELETE' });
  }

  /**
   * Bunny's webhook is unsigned; it is authenticated by a shared secret in the
   * query string, which is why the route also checks the path.
   */
  async verifyWebhook(rawBody: string, headers: Headers): Promise<VideoWebhookEvent | null> {
    const provided = headers.get('x-bunny-secret');
    if (!this.env.VIDEO_WEBHOOK_SECRET || provided !== this.env.VIDEO_WEBHOOK_SECRET) return null;

    const body = JSON.parse(rawBody) as { VideoGuid?: string; Status?: number };
    if (!body.VideoGuid) return null;

    return {
      eventId: `bunny:${body.VideoGuid}:${body.Status ?? 'unknown'}`,
      eventType: `video.status.${body.Status ?? 'unknown'}`,
      assetId: body.VideoGuid,
      state: {
        status: body.Status === 4 ? 'ready' : body.Status === 5 ? 'errored' : 'processing',
        error: body.Status === 5 ? 'Bunny could not encode this file' : undefined,
      },
      payload: body as Record<string, unknown>,
    };
  }
}

/* ── No provider ───────────────────────────────────────────────────────────
   Supabase Storage, signed progressive MP4. Not adaptive bitrate — that is
   what a provider buys — but it plays, and it means a course can be published
   before that decision is made. */

class NoProvider implements VideoProvider {
  readonly name = 'none' as const;

  async createDirectUpload(): Promise<DirectUpload> {
    // Storage signing lives in lib/storage.ts; video.ts routes around this.
    throw new HttpError(500, 'Direct upload is handled by storage when VIDEO_PROVIDER=none');
  }
  async playback(): Promise<PlaybackSource> {
    throw new HttpError(500, 'Playback is handled by storage when VIDEO_PROVIDER=none');
  }
  async state(): Promise<AssetState> {
    // A file in a bucket is ready the moment it finished uploading.
    return { status: 'ready' };
  }
  async remove(): Promise<void> {}
  async verifyWebhook(): Promise<null> {
    return null;
  }
}

export function createVideoProvider(env: Env): VideoProvider {
  switch (env.VIDEO_PROVIDER) {
    case 'cloudflare':
      return new CloudflareStream(env);
    case 'bunny':
      return new BunnyStream(env);
    default:
      return new NoProvider();
  }
}

/* ── Crypto helpers ────────────────────────────────────────────────────────
   WebCrypto only: `node:crypto` would not run on Workers, and these are on the
   webhook path, which has to work wherever the API is deployed. */

async function hmacMatches(secret: string, message: string, expectedHex: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const actual = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(actual, expectedHex);
}

/**
 * Comparing signatures with `===` leaks where they first differ, one byte at a
 * time. The cost of doing it properly is nothing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
