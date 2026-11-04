import { sql } from 'drizzle-orm';
import type { Env } from '../env.ts';
import { getDb } from '../repo.ts';
import { HttpError } from './problem.ts';

/**
 * The club's Google Drive.
 *
 * One Google account — the one with the storage — is connected once, from
 * Studio → Drive. From then on:
 *
 *   - **Uploads** go from the admin's browser straight into that account. The
 *     API opens a resumable upload session and hands the browser its address;
 *     the file never passes through a Worker.
 *   - **Existing files** are attached with the Google Picker, which runs in the
 *     admin's browser on a short-lived token minted here.
 *   - **Streaming and downloads** come back through this API. The files stay
 *     private in Drive — no "anyone with the link" sharing, which would leak a
 *     paid course to whoever a member forwards the URL to. A member gets a
 *     signed, expiring link to `/v1/drive/media/…`; the Worker checks the
 *     signature and relays the bytes, passing Range through so seeking works.
 *
 * Scope is `drive.file`: the app can reach only files it created and files an
 * admin picked. It cannot read the rest of the account, and because Google
 * counts that scope as non-sensitive, a personal Gmail can be connected
 * without app verification and the connection does not lapse after a week.
 */

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
].join(' ');

const FOLDER_NAME = 'Eternal Bonds';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const driveCallbackPath = '/v1/drive/callback';

/** Everything the Drive features need. Missing any = the features are hidden. */
export function driveConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.DRIVE_SECRET && getDb(env));
}

function requireConfigured(env: Env) {
  if (!driveConfigured(env)) {
    throw new HttpError(
      503,
      'Google Drive is not set up',
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and DRIVE_SECRET must be set on the API.',
    );
  }
  return getDb(env)!;
}

const redirectUri = (env: Env) => `${env.PUBLIC_API_URL.replace(/\/$/, '')}${driveCallbackPath}`;

/* ── Crypto ────────────────────────────────────────────────────────────────
   One secret, two keys: an AES-GCM key for the stored refresh token and an
   HMAC key for signed state and media links. Derived with a label each, so
   a value signed for one purpose is never valid for the other. */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function keyMaterial(env: Env, label: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(`${label}:${env.DRIVE_SECRET}`));
}

async function aesKey(env: Env) {
  return crypto.subtle.importKey('raw', await keyMaterial(env, 'drive-token'), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

async function hmacKey(env: Env) {
  return crypto.subtle.importKey(
    'raw',
    await keyMaterial(env, 'drive-sign'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function encryptToken(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(plain)));
  return `${b64url(iv)}.${b64url(sealed)}`;
}

async function decryptToken(env: Env, stored: string): Promise<string> {
  const [iv, sealed] = stored.split('.');
  if (!iv || !sealed) throw new Error('Malformed stored token');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64url(iv) },
    await aesKey(env),
    fromB64url(sealed),
  );
  return dec.decode(plain);
}

/** `payload.signature`, both base64url. The payload is JSON. */
export async function sign(env: Env, payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** Null for a bad signature, a malformed value or an expired one — never throws. */
export async function verify<T extends { e: number }>(env: Env, token: string): Promise<T | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64url(body))) as T;
    if (typeof payload.e !== 'number' || payload.e * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ── The stored connection ─────────────────────────────────────────────── */

type ConnectionRow = {
  account_email: string;
  refresh_token_enc: string;
  folder_id: string | null;
  connected_at: string;
};

async function loadConnection(env: Env): Promise<ConnectionRow | null> {
  const db = getDb(env);
  if (!db) return null;
  const rows = await db.execute<ConnectionRow>(sql`
    select account_email, refresh_token_enc, folder_id, connected_at
    from public.drive_connection where id = 'club'
  `);
  return rows[0] ?? null;
}

export type DriveStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  folderId: string | null;
  folderUrl: string | null;
  connectedAt: string | null;
};

export async function driveStatus(env: Env): Promise<DriveStatus> {
  if (!driveConfigured(env)) {
    return { configured: false, connected: false, email: null, folderId: null, folderUrl: null, connectedAt: null };
  }
  const row = await loadConnection(env);
  return {
    configured: true,
    connected: Boolean(row),
    email: row?.account_email ?? null,
    folderId: row?.folder_id ?? null,
    folderUrl: row?.folder_id ? `https://drive.google.com/drive/folders/${row.folder_id}` : null,
    connectedAt: row ? new Date(row.connected_at).toISOString() : null,
  };
}

/* ── OAuth ─────────────────────────────────────────────────────────────── */

/**
 * The Google consent URL. `state` is signed and carries who started it, so the
 * callback — which arrives with no session at all — can trust both that it is
 * answering a request made here and which admin made it.
 *
 * `prompt=consent` every time: Google only returns a refresh token on the
 * first consent, and a reconnect that silently comes back without one would
 * leave a connection that dies within the hour.
 */
export async function authUrl(env: Env, userId: string, returnTo: string): Promise<string> {
  requireConfigured(env);
  const state = await sign(env, { u: userId, r: returnTo, e: Math.floor(Date.now() / 1000) + 600 });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: DRIVE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(env: Env, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    throw new HttpError(
      502,
      'Google refused the request',
      json.error_description ?? json.error ?? `HTTP ${res.status}`,
    );
  }
  return json;
}

/** The email inside Google's id_token. Not verified cryptographically: it came straight from Google over TLS. */
function emailFromIdToken(idToken: string | undefined): string | null {
  const part = idToken?.split('.')[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(dec.decode(fromB64url(part))) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Finishes the connection: code → tokens, then the folder, then the row.
 * Returns where to send the browser back to.
 */
export async function completeConnection(env: Env, code: string, state: string): Promise<string> {
  const db = requireConfigured(env);
  const claims = await verify<{ u: string; r: string; e: number }>(env, state);
  if (!claims) throw new HttpError(400, 'This sign-in link has expired', 'Start again from Studio → Drive.');

  // Only an admin may connect the club's storage. The callback has no session,
  // so the role is checked here against the user the signed state names.
  const [who] = await db.execute<{ role: string }>(sql`select role::text as role from public.users where id = ${claims.u}::uuid`);
  if (who?.role !== 'admin') throw new HttpError(403, 'Only an admin can connect Drive');

  const tokens = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env) });
  if (!tokens.refresh_token) {
    throw new HttpError(
      502,
      'Google did not grant offline access',
      'Remove "Eternal Bonds" from myaccount.google.com/permissions for that account, then connect again.',
    );
  }
  if (!tokens.scope?.includes('drive.file')) {
    throw new HttpError(400, 'Drive access was not granted', 'Tick the Google Drive box on the consent screen.');
  }
  const email = emailFromIdToken(tokens.id_token) ?? 'unknown';

  // Reuse the folder from a previous connection of the same account if the
  // app can still see it; otherwise make a fresh one.
  const previous = await loadConnection(env);
  let folderId: string | null = null;
  if (previous?.folder_id && previous.account_email === email) {
    const probe = await fetch(
      `https://www.googleapis.com/drive/v3/files/${previous.folder_id}?fields=id,trashed`,
      { headers: { authorization: `Bearer ${tokens.access_token}` } },
    );
    const found = probe.ok ? ((await probe.json()) as { id?: string; trashed?: boolean }) : null;
    if (found?.id && !found.trashed) folderId = found.id;
  }
  if (!folderId) {
    const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    if (!res.ok) throw new HttpError(502, 'Could not create the Drive folder', await res.text());
    folderId = ((await res.json()) as { id: string }).id;
  }

  const sealed = await encryptToken(env, tokens.refresh_token);
  await db.execute(sql`
    insert into public.drive_connection (id, account_email, refresh_token_enc, folder_id, connected_by, connected_at, updated_at)
    values ('club', ${email}, ${sealed}, ${folderId}, ${claims.u}::uuid, now(), now())
    on conflict (id) do update set
      account_email = excluded.account_email,
      refresh_token_enc = excluded.refresh_token_enc,
      folder_id = excluded.folder_id,
      connected_by = excluded.connected_by,
      connected_at = now(),
      updated_at = now()
  `);
  cached = null;
  return claims.r;
}

/** Revokes the grant at Google and forgets it here. Files in Drive are untouched. */
export async function disconnect(env: Env): Promise<void> {
  const db = requireConfigured(env);
  const row = await loadConnection(env);
  if (row) {
    try {
      const token = await decryptToken(env, row.refresh_token_enc);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
    } catch (error) {
      // Revocation is a courtesy; the owner can also remove it in their Google
      // account. Forgetting it here is what actually stops the app using it.
      console.warn(JSON.stringify({ driveRevokeFailed: String(error) }));
    }
  }
  await db.execute(sql`delete from public.drive_connection where id = 'club'`);
  cached = null;
}

/* ── Access tokens ─────────────────────────────────────────────────────────
   Cached per isolate until five minutes before expiry. A video makes a Range
   request every few seconds while it plays, and each of them refreshing a
   token would be thousands of calls to Google for one lecture. */

let cached: { token: string; expiresAt: number } | null = null;

export async function accessToken(env: Env): Promise<{ token: string; expiresAt: number }> {
  requireConfigured(env);
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached;

  const row = await loadConnection(env);
  if (!row) throw new HttpError(409, 'Google Drive is not connected', 'An admin can connect it from Studio → Drive.');
  const refresh = await decryptToken(env, row.refresh_token_enc);
  try {
    const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh });
    cached = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
    return cached;
  } catch (error) {
    if (error instanceof HttpError && /invalid_grant|revoked|expired/i.test(error.detail ?? '')) {
      throw new HttpError(
        409,
        'The Drive connection has lapsed',
        'Google no longer accepts it (the password changed, or access was removed). Reconnect from Studio → Drive.',
      );
    }
    throw error;
  }
}

export async function folderId(env: Env): Promise<string> {
  const row = await loadConnection(env);
  if (!row?.folder_id) throw new HttpError(409, 'Google Drive is not connected', 'An admin can connect it from Studio → Drive.');
  return row.folder_id;
}

/* ── Files ─────────────────────────────────────────────────────────────── */

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  durationSeconds: number | null;
};

/**
 * Reads a file's metadata — and in doing so proves the app may reach it. With
 * `drive.file` that is true only for files uploaded through the app or picked
 * in the Picker, which is exactly the set an admin meant to publish.
 */
export async function fileInfo(env: Env, fileId: string): Promise<DriveFile> {
  if (!/^[\w-]{10,200}$/.test(fileId)) throw new HttpError(400, 'That is not a Drive file id');
  const { token } = await accessToken(env);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,trashed,videoMediaMetadata(durationMillis)&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) {
    throw new HttpError(
      404,
      'The app cannot see that Drive file',
      'Upload it through the studio, or choose it with "From Drive" — that is what grants the app access.',
    );
  }
  if (!res.ok) throw new HttpError(502, 'Google Drive did not answer', `HTTP ${res.status}`);
  const f = (await res.json()) as {
    id: string; name: string; mimeType: string; size?: string; trashed?: boolean;
    videoMediaMetadata?: { durationMillis?: string };
  };
  if (f.trashed) throw new HttpError(409, 'That file is in the Drive trash', 'Restore it in Drive first.');
  if (f.mimeType.startsWith('application/vnd.google-apps.')) {
    // Docs, Sheets and folders have no bytes to stream or download as-is.
    throw new HttpError(422, 'That is a Google Docs file or a folder', 'Choose an actual file — a video, PDF, zip or similar.');
  }
  const ms = Number(f.videoMediaMetadata?.durationMillis ?? 0);
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? Number(f.size) : null,
    durationSeconds: ms > 0 ? Math.round(ms / 1000) : null,
  };
}

/**
 * Opens a resumable upload into the club folder and returns its address.
 *
 * The session is opened here, with the Drive token, and the browser only ever
 * sees the session URL — which authorises that one upload and nothing else.
 * `Origin` is forwarded so Google answers the browser's PUT with CORS headers.
 */
export async function createUploadSession(
  env: Env,
  input: { filename: string; mimeType: string; size: number; origin: string | null },
): Promise<{ url: string; expiresAt: string }> {
  const { token } = await accessToken(env);
  const parent = await folderId(env);
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': input.mimeType || 'application/octet-stream',
        'x-upload-content-length': String(input.size),
        ...(input.origin ? { origin: input.origin } : {}),
      },
      body: JSON.stringify({ name: input.filename, parents: [parent] }),
    },
  );
  const url = res.headers.get('location');
  if (!res.ok || !url) {
    const detail = await res.text().catch(() => '');
    if (/storageQuotaExceeded/i.test(detail)) throw new HttpError(507, 'The club Drive is full');
    throw new HttpError(502, 'Google Drive would not start the upload', detail.slice(0, 300) || `HTTP ${res.status}`);
  }
  // Google keeps a resumable session for a week; say a day so nobody relies on more.
  return { url, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() };
}

/* ── Media links ───────────────────────────────────────────────────────── */

type MediaClaims = { f: string; e: number; d?: 1 };

/**
 * A link a `<video>` or a download button can use with no headers at all.
 * Minted only after the caller's access has been checked — lessons.ts and the
 * library decide who gets one; this only makes it unforgeable and short-lived.
 */
export async function mediaUrl(
  env: Env,
  fileId: string,
  opts: { ttlSeconds: number; download?: boolean },
): Promise<string> {
  const token = await sign(env, {
    f: fileId,
    e: Math.floor(Date.now() / 1000) + opts.ttlSeconds,
    ...(opts.download ? { d: 1 } : {}),
  });
  return `${env.PUBLIC_API_URL.replace(/\/$/, '')}/v1/drive/media/${token}`;
}

const PASS_THROUGH = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

/**
 * Relays a file from Drive. Range in, Range out — the `<video>` element seeks
 * by asking for byte ranges, and passing them straight through is what makes
 * scrubbing a two-hour lecture instant instead of a full download.
 */
export async function relayMedia(env: Env, token: string, request: Request): Promise<Response> {
  const claims = await verify<MediaClaims>(env, token);
  if (!claims) {
    return new Response('This link has expired. Reload the page to get a new one.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const { token: access } = await accessToken(env);

  const headers: Record<string, string> = { authorization: `Bearer ${access}` };
  const range = request.headers.get('range');
  if (range) headers.range = range;

  const upstream = await fetch(
    `https://www.googleapis.com/drive/v3/files/${claims.f}?alt=media&supportsAllDrives=true`,
    { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers },
  );

  if (!upstream.ok && upstream.status !== 206) {
    const text = await upstream.text().catch(() => '');
    const status = upstream.status === 404 ? 404 : upstream.status === 416 ? 416 : 502;
    const message = /downloadQuotaExceeded|quota/i.test(text)
      ? 'Google is limiting downloads of this file right now. Try again later.'
      : status === 404
        ? 'This file is no longer in the club Drive.'
        : 'The file could not be loaded from Drive.';
    console.warn(JSON.stringify({ driveRelay: upstream.status, file: claims.f, detail: text.slice(0, 200) }));
    return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }

  const out = new Headers();
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes');
  // Private: these bytes are behind a membership, so no shared cache may keep them.
  out.set('cache-control', 'private, max-age=3600');
  out.set('x-content-type-options', 'nosniff');

  if (claims.d) {
    const info = await fileInfo(env, claims.f).catch(() => null);
    const name = info?.name ?? 'download';
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    out.set('content-disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  } else {
    out.set('content-disposition', 'inline');
  }

  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/** The keys a Drive file is stored under, wherever a storage key is kept. */
export const DRIVE_PREFIX = 'drive:';
export const isDriveKey = (key: string | null | undefined): key is string => Boolean(key?.startsWith(DRIVE_PREFIX));
export const driveIdOf = (key: string) => key.slice(DRIVE_PREFIX.length);
