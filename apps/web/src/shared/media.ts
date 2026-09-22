import { AttachMedia, MediaItem, MediaTicket } from '@ipc/contracts';
import { accessToken } from './supabase.ts';

/**
 * Attaching photographs to a post or a win.
 *
 * This is a photographers' club, and until now there was no way to put a
 * photograph in it. The endpoints existed on both sides — ticket, direct
 * upload, record — and the browser half was simply never written, so the whole
 * chain was dead from the picker onwards.
 *
 * Three rules shape the design:
 *
 * 1. **The file never touches the API.** It goes browser → Supabase Storage on
 *    a signed URL. A 12MB RAW-export passing through a request worker would be
 *    both slow and, on Workers, close to the memory ceiling.
 * 2. **Everything is compressed client-side first.** Phone cameras produce 8MB
 *    JPEGs whose extra pixels nobody will ever see in a feed column 640px
 *    wide. Downscaling before upload turns a 30-second upload on Indian mobile
 *    data into a two-second one, which is the difference between a member
 *    posting and giving up.
 * 3. **The canvas re-encode strips EXIF as a side effect.** That is not a
 *    bonus; it is the point. A phone photo carries GPS coordinates, and a
 *    member sharing a shoot should not also be publishing the address it
 *    happened at.
 */

const BASE = import.meta.env.VITE_API_URL ?? '';

export const MAX_PER_POST = 6;
/** The hard stop, checked before compression — a 60MB TIFF should fail fast. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** Longest edge after downscale. Retina-sharp at any feed size we render. */
const MAX_EDGE = 2048;
const ACCEPT = 'image/jpeg,image/png,image/webp';

export type UploadTarget = { kind: 'post' | 'win'; id: string };

export type Pending = {
  /** Stable across the whole lifecycle so React keys do not churn. */
  key: string;
  file: File;
  /** Object URL for the local preview. Revoke it when the picker unmounts. */
  preview: string;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  progress: number;
  error?: string;
};

export const ACCEPT_ATTR = ACCEPT;

/** What the picker should refuse before anything is uploaded. */
export function rejectReason(file: File): string | null {
  if (!ACCEPT.split(',').includes(file.type)) return 'Only JPEG, PNG or WebP';
  if (file.size > MAX_INPUT_BYTES) return 'Larger than 25MB';
  return null;
}

type Prepared = { blob: Blob; mime: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number };

/**
 * Downscale and re-encode. PNGs stay PNG — a screenshot of a histogram turns
 * to mush as a JPEG — and everything else lands as JPEG at quality 0.85, which
 * is indistinguishable from the original at feed sizes and roughly a fifth of
 * the bytes.
 */
async function prepare(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Canvas can be unavailable under aggressive privacy settings. Uploading
    // the original is worse than compressing, and much better than failing.
    bitmap.close();
    const mime = (file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg');
    return { blob: file, mime, width: 0, height: 0 };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, mime === 'image/jpeg' ? 0.85 : undefined),
  );
  if (!blob) return { blob: file, mime: mime as Prepared['mime'], width, height };
  return { blob, mime: mime as Prepared['mime'], width, height };
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-client': 'web',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function json<T>(path: string, body: unknown, schema: { parse: (v: unknown) => T }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
    throw new Error(problem?.detail ?? problem?.title ?? `Upload failed (${res.status})`);
  }
  return schema.parse(await res.json());
}

/**
 * One image, all the way through. Progress is real upload progress from XHR —
 * `fetch` cannot report it, which is the only reason XHR survives here.
 */
export async function uploadOne(
  target: UploadTarget,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<MediaItem> {
  const root = target.kind === 'post' ? `/v1/community/posts/${target.id}` : `/v1/wins/${target.id}`;
  const prepared = await prepare(file);
  onProgress(0.05);

  const ticket = await json(`${root}/media-ticket`, { mime: prepared.mime }, MediaTicket);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.url);
    xhr.setRequestHeader('content-type', prepared.mime);
    // The signed URL carries its own authorisation in the query string. The
    // session token is deliberately not sent to the storage host.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(0.05 + 0.9 * (e.loaded / e.total));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage refused the upload (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Network dropped during upload'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(prepared.blob);
  });

  onProgress(0.97);
  const attached = await json(
    `${root}/media`,
    AttachMedia.parse({
      key: ticket.key,
      mime: prepared.mime,
      width: prepared.width || null,
      height: prepared.height || null,
    }),
    MediaItem,
  );
  onProgress(1);
  return attached;
}

/**
 * Upload a whole batch, one at a time.
 *
 * Sequential on purpose. Six parallel uploads on a phone contend for the same
 * uplink and finish no sooner, but they make the progress bars jitter and turn
 * a partial failure into six ambiguous ones.
 */
export async function uploadAll(
  target: UploadTarget,
  pending: Pending[],
  onChange: (key: string, patch: Partial<Pending>) => void,
): Promise<MediaItem[]> {
  const done: MediaItem[] = [];
  for (const item of pending) {
    if (item.status === 'done') continue;
    onChange(item.key, { status: 'uploading', progress: 0, error: undefined });
    try {
      done.push(await uploadOne(target, item.file, (p) => onChange(item.key, { progress: p })));
      onChange(item.key, { status: 'done', progress: 1 });
    } catch (error) {
      // One bad file must not discard the other five, or the post they belong
      // to. The caller keeps the post and shows a retry for what failed.
      onChange(item.key, { status: 'failed', error: (error as Error).message });
    }
  }
  return done;
}
