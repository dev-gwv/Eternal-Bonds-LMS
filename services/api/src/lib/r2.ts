import { AwsClient } from 'aws4fetch';
import type { Env } from '../env.ts';
import { HttpError } from './problem.ts';

/**
 * Cloudflare R2, through its S3 API.
 *
 * The S3 API rather than a Worker binding for two reasons: presigned URLs —
 * the browser uploads parts and the player fetches segments straight from R2,
 * which only works with a URL that carries its own signature — and the same
 * code then runs unchanged under the Bun dev server, where bindings do not
 * exist.
 *
 * Layout in the bucket, per video (`assetId` is a random UUID):
 *
 *   originals/<assetId>/source.<ext>   what the admin uploaded, kept
 *   hls/<assetId>/master.m3u8          written by the VPS transcoder
 *   hls/<assetId>/<rendition>/index.m3u8 + segNNNNN.ts
 *   hls/<assetId>/poster.jpg
 */

export const r2Configured = (env: Env) =>
  Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);

/** One client per isolate: aws4fetch caches the derived signing keys on it. */
let cached: { id: string; client: AwsClient } | null = null;

function client(env: Env): AwsClient {
  if (!r2Configured(env)) {
    throw new HttpError(503, 'R2 is not configured', 'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.');
  }
  if (cached?.id !== env.R2_ACCESS_KEY_ID) {
    cached = {
      id: env.R2_ACCESS_KEY_ID,
      client: new AwsClient({
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        service: 's3',
        region: 'auto',
      }),
    };
  }
  return cached.client;
}

/** Keys are ours (UUIDs and fixed names), but encode each segment anyway. */
export function objectUrl(env: Env, key: string): URL {
  const path = key.split('/').map(encodeURIComponent).join('/');
  return new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${path}`);
}

async function send(env: Env, url: URL, init: RequestInit = {}): Promise<Response> {
  const res = await client(env).fetch(url.toString(), init);
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new HttpError(502, 'R2 refused the request', `${init.method ?? 'GET'} ${res.status}: ${detail}`);
  }
  return res;
}

/** A URL anyone can use, for this one method on this one object, until it expires. */
export async function presign(
  env: Env,
  key: string,
  { method = 'GET', ttlSeconds = 3600, query = {} }: { method?: 'GET' | 'PUT'; ttlSeconds?: number; query?: Record<string, string> } = {},
): Promise<string> {
  const url = objectUrl(env, key);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set('X-Amz-Expires', String(Math.min(Math.max(60, Math.floor(ttlSeconds)), 7 * 24 * 3600)));
  const signed = await client(env).sign(url.toString(), { method, aws: { signQuery: true } });
  return signed.url;
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? null;

export async function createMultipart(env: Env, key: string, contentType: string): Promise<string> {
  const url = objectUrl(env, key);
  url.searchParams.set('uploads', '');
  const res = await send(env, url, { method: 'POST', headers: { 'content-type': contentType } });
  const uploadId = tag(await res.text(), 'UploadId');
  if (!uploadId) throw new HttpError(502, 'R2 did not open the upload');
  return uploadId;
}

export function presignPart(env: Env, key: string, uploadId: string, partNumber: number, ttlSeconds = 3600) {
  return presign(env, key, { method: 'PUT', ttlSeconds, query: { partNumber: String(partNumber), uploadId } });
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function completeMultipart(
  env: Env,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  const url = objectUrl(env, key);
  url.searchParams.set('uploadId', uploadId);
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const body =
    '<CompleteMultipartUpload>' +
    sorted
      .map((p) => {
        const etag = p.etag.startsWith('"') ? p.etag : `"${p.etag}"`;
        return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEscape(etag)}</ETag></Part>`;
      })
      .join('') +
    '</CompleteMultipartUpload>';
  const res = await send(env, url, { method: 'POST', body, headers: { 'content-type': 'application/xml' } });
  // S3 can answer 200 with an error document when completion fails late.
  const text = await res.text();
  if (/<Error>/.test(text)) throw new HttpError(502, 'R2 could not finish the upload', tag(text, 'Message') ?? text.slice(0, 200));
}

export async function abortMultipart(env: Env, key: string, uploadId: string): Promise<void> {
  const url = objectUrl(env, key);
  url.searchParams.set('uploadId', uploadId);
  await client(env).fetch(url.toString(), { method: 'DELETE' }).catch(() => undefined);
}

/** Deletes one object. Deleting one that is already gone is not an error. */
export async function deleteObject(env: Env, key: string): Promise<void> {
  const res = await client(env).fetch(objectUrl(env, key).toString(), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new HttpError(502, 'R2 refused the request', `DELETE ${res.status}`);
}

/** The object's text, or null when it does not exist. */
export async function getText(env: Env, key: string): Promise<string | null> {
  const res = await client(env).fetch(objectUrl(env, key).toString());
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, 'R2 refused the request', `GET ${res.status}`);
  return res.text();
}

export async function headObject(env: Env, key: string): Promise<{ size: number } | null> {
  const res = await client(env).fetch(objectUrl(env, key).toString(), { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, 'R2 refused the request', `HEAD ${res.status}`);
  return { size: Number(res.headers.get('content-length') ?? 0) };
}
