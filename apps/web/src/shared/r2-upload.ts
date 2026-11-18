import { R2PartUrls, R2UploadSession } from '@ipc/contracts';
import { z } from 'zod';
import { adminCall } from './admin-api.ts';

/**
 * A lesson video, straight from the admin's browser to the club's R2 bucket.
 *
 * Multipart, four parts in flight at once: on an ordinary office connection
 * that fills the uplink, which a single PUT never does. Each part is retried on
 * its own, so a dropped connection costs one 64MB part rather than the file.
 * The API only opens the upload, signs part URLs and closes it.
 *
 * Once it completes, the lesson reads "processing" and the club's VPS
 * transcodes it to HLS — Studio polls the lesson to show how far it has got.
 */

const PARALLEL = 4;
const RETRIES = 5;
/** URLs are fetched in batches; each is good for two hours. */
const URL_BATCH = 20;

type Part = { partNumber: number; etag: string };

function putPart(
  url: string,
  blob: Blob,
  onBytes: (loaded: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Readable only because the bucket's CORS exposes ETag. Without it
        // every upload fails here, so say what to fix.
        const etag = xhr.getResponseHeader('etag');
        if (!etag) {
          reject(Object.assign(new Error('R2 did not return the ETag header. Add ETag to the bucket CORS "ExposeHeaders".'), { fatal: true }));
        } else {
          resolve(etag);
        }
      } else if (xhr.status === 403) {
        reject(Object.assign(new Error('The upload link expired'), { expired: true }));
      } else {
        reject(new Error(`R2 refused part of the upload (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('The connection dropped during the upload.'));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled.'), { fatal: true }));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

export async function uploadLessonToR2(
  lessonId: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const session = await adminCall('POST', `/v1/admin/lessons/${lessonId}/r2-upload`, {
    body: { filename: file.name, size: file.size, mimeType: file.type || 'video/mp4' },
    schema: R2UploadSession,
  });
  const { key, uploadId, partSize, partCount } = session;
  const base = `/v1/admin/lessons/${lessonId}/r2-upload`;

  const urls = new Map<number, string>();
  const fetchUrls = async (from: number) => {
    const partNumbers = Array.from({ length: Math.min(URL_BATCH, partCount - from + 1) }, (_, i) => from + i);
    const { urls: got } = await adminCall('POST', `${base}/parts`, {
      body: { key, uploadId, partNumbers },
      schema: R2PartUrls,
    });
    for (const u of got) urls.set(u.partNumber, u.url);
  };

  const sent = new Map<number, number>();
  const report = () => {
    let total = 0;
    for (const v of sent.values()) total += v;
    onProgress(Math.min(0.999, total / file.size));
  };

  const parts: Part[] = [];
  let next = 1;
  const worker = async () => {
    for (let n = next++; n <= partCount; n = next++) {
      const blob = file.slice((n - 1) * partSize, Math.min(n * partSize, file.size));
      for (let attempt = 0; ; attempt++) {
        if (signal.aborted) throw Object.assign(new Error('Upload cancelled.'), { fatal: true });
        if (!urls.has(n)) await fetchUrls(n);
        try {
          const etag = await putPart(urls.get(n)!, blob, (loaded) => {
            sent.set(n, loaded);
            report();
          }, signal);
          parts.push({ partNumber: n, etag });
          sent.set(n, blob.size);
          report();
          break;
        } catch (error) {
          sent.set(n, 0);
          const e = error as Error & { fatal?: boolean; expired?: boolean };
          if (e.fatal || attempt >= RETRIES) throw e;
          if (e.expired) urls.delete(n);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, partCount) }, worker));
  } catch (error) {
    // Best effort: an abandoned multipart upload is storage nobody can see.
    void adminCall('POST', `${base}/abort`, { body: { key, uploadId }, schema: z.unknown() }).catch(() => undefined);
    throw error;
  }

  await adminCall('POST', `${base}/complete`, { body: { key, uploadId, parts }, schema: z.unknown() });
  onProgress(1);
}
