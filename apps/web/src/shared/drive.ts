import { adminApi, type DrivePickerToken } from './admin-api.ts';

/**
 * The studio's side of the club Drive: uploading into it and picking from it.
 *
 * Both run in the admin's browser. The API never carries the bytes — it opens
 * an upload session and the file goes straight to Google — and the Picker is
 * Google's own window, given a short-lived token by the API.
 */

export type DriveFile = { id: string; name: string; mimeType: string };

/* ── Upload ────────────────────────────────────────────────────────────────
   In chunks, against a resumable session. A two-hour recording is gigabytes,
   and one dropped request in a single-shot upload means starting again from
   zero; here a failed chunk is retried from the last byte Google confirmed. */

/** A multiple of 256 KiB, as Google requires for every chunk but the last. */
const CHUNK = 32 * 1024 * 1024;
const RETRIES = 5;

type ChunkResult = { done: true; file: DriveFile } | { done: false; next: number };

function putChunk(
  url: string,
  file: File,
  start: number,
  onBytes: (sentInChunk: number) => void,
  signal?: AbortSignal,
): Promise<ChunkResult> {
  const end = Math.min(start + CHUNK, file.size);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-range', `bytes ${start}-${end - 1}/${file.size}`);
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          resolve({ done: true, file: JSON.parse(xhr.responseText) as DriveFile });
        } catch {
          reject(new Error('Drive finished the upload but its answer could not be read.'));
        }
      } else if (xhr.status === 308) {
        // "Resume incomplete": Range says how much Google has kept. If the
        // header is not readable, it kept the whole chunk.
        const range = xhr.getResponseHeader('range');
        const kept = range ? Number(/-(\d+)$/.exec(range)?.[1] ?? end - 1) + 1 : end;
        resolve({ done: false, next: kept });
      } else if (xhr.status === 404 || xhr.status === 410) {
        reject(Object.assign(new Error('The upload session expired. Start the upload again.'), { fatal: true }));
      } else {
        reject(new Error(`Drive refused part of the upload (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('The connection dropped during the upload.'));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled.'), { fatal: true }));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file.slice(start, end));
  });
}

/** Asks Google how much of the file it already has, after a failure. */
async function confirmedBytes(url: string, size: number): Promise<number | DriveFile> {
  const res = await fetch(url, { method: 'PUT', headers: { 'content-range': `bytes */${size}` } });
  if (res.status === 200 || res.status === 201) return (await res.json()) as DriveFile;
  if (res.status !== 308) throw Object.assign(new Error('The upload session expired. Start the upload again.'), { fatal: true });
  const range = res.headers.get('range');
  return range ? Number(/-(\d+)$/.exec(range)?.[1] ?? -1) + 1 : 0;
}

export async function uploadToDrive(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<DriveFile> {
  const session = await adminApi.driveUploadSession({
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  });

  let offset = 0;
  let failures = 0;
  onProgress(0);
  for (;;) {
    try {
      const result = await putChunk(session.url, file, offset, (sent) => onProgress((offset + sent) / file.size), signal);
      if (result.done) {
        onProgress(1);
        return result.file;
      }
      offset = result.next;
      failures = 0;
    } catch (error) {
      if ((error as { fatal?: boolean }).fatal || ++failures > RETRIES) throw error;
      // Back off, then pick up from whatever Google actually kept.
      await new Promise((r) => setTimeout(r, 1000 * 2 ** failures));
      const state = await confirmedBytes(session.url, file.size).catch(() => offset);
      if (typeof state !== 'number') {
        onProgress(1);
        return state;
      }
      offset = state;
    }
    onProgress(offset / file.size);
  }
}

/* ── Picker ────────────────────────────────────────────────────────────────
   Google's own file chooser. Picking a file is also what grants the app
   access to it: the API holds only the `drive.file` scope, which reaches the
   files the app created and the files picked here — nothing else. */

type PickerKind = 'video' | 'any';

declare global {
  interface Window {
    gapi?: { load: (name: string, cb: { callback: () => void; onerror: () => void }) => void };
    google?: { picker?: any };
  }
}

let loading: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = () =>
      window.gapi!.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('The Drive picker did not load.')) });
    script.onerror = () => reject(new Error('Could not reach Google to open the Drive picker.'));
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null; // So the next click retries instead of failing forever.
    throw error;
  });
  return loading;
}

let token: DrivePickerToken | null = null;

async function pickerToken(): Promise<DrivePickerToken> {
  // The token lasts an hour; refresh it with a few minutes to spare.
  if (token && new Date(token.expiresAt).getTime() - Date.now() > 5 * 60_000) return token;
  token = await adminApi.drivePickerToken();
  return token;
}

/** Opens the Picker. Resolves with the file, or null if the admin closed it. */
export async function pickFromDrive(kind: PickerKind): Promise<DriveFile | null> {
  const [auth] = await Promise.all([pickerToken(), loadPicker()]);
  const picker = window.google!.picker!;

  // Everything in the account, searchable, newest first; plus the club folder
  // as its own tab, since that is where studio uploads land.
  const everything = new picker.DocsView(kind === 'video' ? picker.ViewId.DOCS_VIDEOS : picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMode(picker.DocsViewMode.LIST);
  const clubFolder = auth.folderId
    ? new picker.DocsView(picker.ViewId.DOCS).setParent(auth.folderId).setMode(picker.DocsViewMode.LIST)
    : null;

  return new Promise((resolve) => {
    const builder = new picker.PickerBuilder()
      .setOAuthToken(auth.accessToken)
      .setDeveloperKey(auth.apiKey)
      .setAppId(auth.appId)
      .setOrigin(window.location.origin)
      .setTitle(kind === 'video' ? 'Choose a video from the club Drive' : 'Choose a file from the club Drive')
      .addView(everything)
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name, mimeType: doc.mimeType } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      });
    if (clubFolder) builder.addView(clubFolder);
    builder.build().setVisible(true);
  });
}

export const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
