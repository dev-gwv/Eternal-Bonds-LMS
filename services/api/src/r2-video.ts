import { eq, sql } from 'drizzle-orm';
import { lessons, withUser } from '@ipc/db';
import type { R2CompleteInput, R2PartUrls, R2UploadSession, R2UploadStart } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  deleteObject,
  getText,
  headObject,
  presign,
  presignPart,
  r2Configured,
} from './lib/r2.ts';
import { signToken, verifyToken } from './lib/signed.ts';
import { getDb } from './repo.ts';

/**
 * Lesson video on Cloudflare R2, transcoded by the club's VPS.
 *
 *   1. Studio opens a multipart upload (`startUpload`), gets presigned URLs
 *      for batches of parts (`partUrls`) and PUTs them to R2 itself, four at
 *      a time. The file never touches the API.
 *   2. `completeUpload` stitches the parts and queues a transcode. The lesson
 *      reads "processing".
 *   3. The VPS claims the job, runs ffmpeg into `hls/<assetId>/`, heartbeats
 *      progress, and reports done — the lesson becomes ready.
 *   4. Playback is an HLS master playlist behind a signed link. The API serves
 *      the playlists only, rewriting each segment to a presigned R2 URL, so
 *      the segments stream from R2 directly: no request per segment through
 *      the Worker, and no egress fees.
 */

/** R2 allows 10,000 parts; 64MB parts keep a 10GB file to 160 requests. */
const MIN_PART = 64 * 1024 * 1024;
const MAX_PARTS = 10_000;
const PART_URL_TTL = 2 * 60 * 60;

/** The transcoder heartbeats every 30s; two minutes of silence is a dead job. */
const LEASE_SECONDS = 120;
const MAX_ATTEMPTS = 3;

/** As long as a Drive ticket, for the same reason: lunch breaks. */
export const HLS_PLAYBACK_TTL = 6 * 60 * 60;
const HLS_LABEL = 'hls-playback';

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'] as const;

function requireDb(env: Env) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Uploads need a database', 'Set DATABASE_URL to use the studio.');
  return db;
}

function requireR2(env: Env) {
  if (!r2Configured(env)) {
    throw new HttpError(503, 'Video uploads are not set up', 'The API needs its R2 credentials (see docs/r2-video.md).');
  }
}

export function partPlan(size: number): { partSize: number; partCount: number } {
  const partSize = Math.max(MIN_PART, Math.ceil(size / MAX_PARTS));
  return { partSize, partCount: Math.max(1, Math.ceil(size / partSize)) };
}

const extOf = (filename: string) => {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(filename.trim())?.[1]?.toLowerCase();
  return ext && (VIDEO_EXT as readonly string[]).includes(ext) ? ext : 'mp4';
};

/** `originals/<uuid>/source.<ext>`, and nothing else, is a key this module signs for. */
const ORIGINAL_KEY = /^originals\/([0-9a-f-]{36})\/source\.[a-z0-9]{2,5}$/;

/** The lesson, as the caller sees it — RLS makes "not an admin" read as not found. */
async function lessonForUpload(env: Env, userId: string, lessonId: string) {
  const db = requireDb(env);
  const [row] = await withUser(db, userId, (tx) =>
    tx
      .select({
        id: lessons.id,
        provider: lessons.videoProvider,
        assetId: lessons.videoAssetId,
        uploadId: lessons.videoUploadId,
      })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1),
  );
  if (!row) throw new HttpError(404, 'Lesson not found');
  return row;
}

/** The upload the browser is talking about has to be the one this lesson is on. */
async function matchingUpload(env: Env, userId: string, lessonId: string, key: string, uploadId: string) {
  const lesson = await lessonForUpload(env, userId, lessonId);
  const asset = ORIGINAL_KEY.exec(key)?.[1];
  if (lesson.provider !== 'r2' || !asset || lesson.assetId !== asset || lesson.uploadId !== uploadId) {
    throw new HttpError(409, 'That upload is no longer the one on this lesson', 'Start the upload again.');
  }
  return { lesson, assetId: asset };
}

/** Queues removal of an old video's files. Cheap to call twice. */
async function queueDelete(env: Env, assetId: string, lessonId: string | null) {
  const db = requireDb(env);
  await db.execute(sql`
    insert into video_transcodes (kind, lesson_id, asset_id)
    values ('delete', ${lessonId}::uuid, ${assetId})
  `);
  // A transcode still queued for that asset would write files nobody needs.
  await db.execute(sql`
    update video_transcodes set status = 'failed', error = 'Replaced', finished_at = now(), updated_at = now()
    where kind = 'transcode' and asset_id = ${assetId} and status in ('queued', 'running')
  `);
}

export async function startUpload(
  env: Env,
  userId: string,
  lessonId: string,
  input: R2UploadStart,
): Promise<R2UploadSession> {
  requireR2(env);
  const lesson = await lessonForUpload(env, userId, lessonId);
  const { partSize, partCount } = partPlan(input.size);
  if (partCount > MAX_PARTS) throw new HttpError(413, 'That file is too large');

  const assetId = crypto.randomUUID();
  const key = `originals/${assetId}/source.${extOf(input.filename)}`;
  const mime = input.mimeType.startsWith('video/') ? input.mimeType : 'video/mp4';
  const uploadId = await createMultipart(env, key, mime);

  // Replacing an R2 video: the old one stops playing now (the lesson is about
  // to read "uploading"), so its files can go.
  if (lesson.provider === 'r2' && lesson.assetId) await queueDelete(env, lesson.assetId, lessonId);

  await withUser(requireDb(env), userId, (tx) =>
    tx
      .update(lessons)
      .set({
        videoProvider: 'r2',
        videoAssetId: assetId,
        videoUploadId: uploadId,
        videoStatus: 'uploading',
        videoReadyAt: null,
        videoError: null,
      })
      .where(eq(lessons.id, lessonId)),
  );

  return { assetId, key, uploadId, partSize, partCount };
}

export async function partUrls(
  env: Env,
  userId: string,
  lessonId: string,
  input: { key: string; uploadId: string; partNumbers: number[] },
): Promise<R2PartUrls> {
  requireR2(env);
  await matchingUpload(env, userId, lessonId, input.key, input.uploadId);
  const urls = await Promise.all(
    [...new Set(input.partNumbers)].map(async (partNumber) => ({
      partNumber,
      url: await presignPart(env, input.key, input.uploadId, partNumber, PART_URL_TTL),
    })),
  );
  return { urls };
}

export async function completeUpload(env: Env, userId: string, lessonId: string, input: R2CompleteInput) {
  requireR2(env);
  const { assetId } = await matchingUpload(env, userId, lessonId, input.key, input.uploadId);
  await completeMultipart(env, input.key, input.uploadId, input.parts);

  const db = requireDb(env);
  await withUser(db, userId, (tx) =>
    tx
      .update(lessons)
      .set({ videoStatus: 'processing', videoUploadId: null, videoError: null })
      .where(eq(lessons.id, lessonId)),
  );
  await db.execute(sql`
    insert into video_transcodes (kind, lesson_id, asset_id, source_key)
    values ('transcode', ${lessonId}::uuid, ${assetId}, ${input.key})
  `);
  return { assetId, status: 'processing' as const };
}

export async function abortUpload(env: Env, userId: string, lessonId: string, input: { key: string; uploadId: string }) {
  requireR2(env);
  await matchingUpload(env, userId, lessonId, input.key, input.uploadId);
  await abortMultipart(env, input.key, input.uploadId);
  await withUser(requireDb(env), userId, (tx) =>
    tx
      .update(lessons)
      .set({ videoProvider: null, videoAssetId: null, videoUploadId: null, videoStatus: 'none', videoError: null })
      .where(eq(lessons.id, lessonId)),
  );
}

/** Called by `detachVideo` for an R2 lesson. */
export async function forgetR2Video(env: Env, assetId: string, lessonId: string) {
  await queueDelete(env, assetId, lessonId);
}

/* ── The VPS side ─────────────────────────────────────────────────────── */

export type TranscodeJob = {
  id: string;
  kind: 'transcode' | 'delete';
  assetId: string;
  attempt: number;
  /** Presigned GET of the original. Transcode jobs only. */
  sourceUrl: string | null;
  sourceKey: string | null;
  sourceBytes: number | null;
  /** Where the HLS files go, relative to the bucket. */
  outputPrefix: string;
};

/** Constant-time compare, so the secret cannot be guessed a byte at a time. */
export function transcoderAuthorized(env: Env, header: string | undefined): boolean {
  const secret = env.TRANSCODER_SECRET;
  const given = header?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || secret.length < 16 || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/**
 * Hands the VPS its next job, or null.
 *
 * `for update skip locked` makes two transcoders safe to run side by side
 * (a second VPS later, say) — each gets a different row. A job whose lease ran
 * out with no heartbeat is claimable again, until it has failed three times.
 */
export async function claimJob(env: Env): Promise<TranscodeJob | null> {
  requireR2(env);
  const db = requireDb(env);

  // Out of attempts: give up for good and tell the admin, rather than leaving
  // the lesson at "processing" forever.
  const dead = await db.execute<{ lesson_id: string | null; error: string | null }>(sql`
    update video_transcodes
    set status = 'failed', finished_at = now(), updated_at = now(),
        error = coalesce(error, 'The transcoder stopped responding')
    where status = 'running' and leased_until < now() and attempts >= ${MAX_ATTEMPTS}
    returning lesson_id, error
  `);
  for (const d of dead) {
    if (d.lesson_id) await markLessonErrored(env, d.lesson_id, d.error ?? 'Transcoding failed');
  }

  const rows = await db.execute<{ id: string; kind: 'transcode' | 'delete'; asset_id: string; source_key: string | null; attempts: number }>(sql`
    update video_transcodes j
    set status = 'running', attempts = j.attempts + 1, leased_until = now() + make_interval(secs => ${LEASE_SECONDS}),
        updated_at = now()
    where j.id = (
      select id from video_transcodes
      where status = 'queued'
         or (status = 'running' and leased_until < now() and attempts < ${MAX_ATTEMPTS})
      -- Deletes first: they are quick, and they free space the next transcode may need.
      order by (kind = 'delete') desc, created_at asc
      limit 1
      for update skip locked
    )
    returning j.id, j.kind, j.asset_id, j.source_key, j.attempts
  `);
  const job = rows[0];
  if (!job) return null;

  let sourceUrl: string | null = null;
  let sourceBytes: number | null = null;
  if (job.kind === 'transcode' && job.source_key) {
    const head = await headObject(env, job.source_key);
    if (!head) {
      await failJob(env, job.id, 'The uploaded file is missing from storage', true);
      return claimJob(env);
    }
    sourceBytes = head.size;
    // Long enough for a slow download of a big file; the VPS fetches once.
    sourceUrl = await presign(env, job.source_key, { ttlSeconds: 12 * 3600 });
  }

  return {
    id: job.id,
    kind: job.kind,
    assetId: job.asset_id,
    attempt: Number(job.attempts),
    sourceUrl,
    sourceKey: job.source_key,
    sourceBytes,
    outputPrefix: `hls/${job.asset_id}/`,
  };
}

/** Heartbeat. Returns false when the job was taken away (replaced, or given up). */
export async function reportProgress(env: Env, jobId: string, percent: number): Promise<boolean> {
  const db = requireDb(env);
  const rows = await db.execute<{ id: string }>(sql`
    update video_transcodes
    set progress = ${Math.max(0, Math.min(100, Math.round(percent)))},
        leased_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
    where id = ${jobId}::uuid and status = 'running'
    returning id
  `);
  return rows.length > 0;
}

export async function completeJob(env: Env, jobId: string, durationSeconds: number | null): Promise<void> {
  const db = requireDb(env);
  // ffprobe reports fractions (8106.709333); both columns are whole seconds.
  const seconds = durationSeconds && durationSeconds > 0 ? Math.round(durationSeconds) : null;
  const rows = await db.execute<{ kind: string; lesson_id: string | null; asset_id: string; source_key: string | null }>(sql`
    update video_transcodes
    set status = 'done', progress = 100, finished_at = now(), updated_at = now(),
        duration_seconds = ${seconds}
    where id = ${jobId}::uuid and status = 'running'
    returning kind, lesson_id, asset_id, source_key
  `);
  const job = rows[0];
  if (!job || job.kind !== 'transcode') return;

  // The original is not kept once its streaming versions exist: it is the
  // biggest file of the lot and nothing plays it. (A failed attempt keeps it,
  // so the retry has something to work from.) Best effort: if the delete
  // fails, the file is only left over, and replacing the video removes it.
  if (job.source_key) {
    await deleteObject(env, job.source_key).catch((error) =>
      console.warn(JSON.stringify({ msg: 'r2 original not deleted', key: job.source_key, error: String(error) })),
    );
  }
  if (!job.lesson_id) return;

  // Only if the lesson still points at this asset — an admin may have
  // replaced the video while it was transcoding.
  await db.execute(sql`
    update lessons set
      video_status = 'ready', video_ready_at = now(), video_error = null,
      duration_seconds = coalesce(${seconds}, duration_seconds),
      video_duration_source = case when ${seconds}::int is null then video_duration_source else 'transcoder' end
    where id = ${job.lesson_id}::uuid and video_provider = 'r2' and video_asset_id = ${job.asset_id}
  `);
}

async function markLessonErrored(env: Env, lessonId: string, error: string) {
  const db = requireDb(env);
  await db.execute(sql`
    update lessons set video_status = 'errored', video_error = ${error.slice(0, 500)}
    where id = ${lessonId}::uuid and video_provider = 'r2' and video_status = 'processing'
  `);
}

/**
 * A failure the VPS reports. Retried (the lease is simply released) unless it
 * says the file itself is the problem, or attempts are used up.
 */
export async function failJob(env: Env, jobId: string, error: string, permanent: boolean): Promise<void> {
  const db = requireDb(env);
  const rows = await db.execute<{ lesson_id: string | null; attempts: number; kind: string }>(sql`
    select lesson_id, attempts, kind from video_transcodes where id = ${jobId}::uuid and status = 'running'
  `);
  const job = rows[0];
  if (!job) return;
  const final = permanent || Number(job.attempts) >= MAX_ATTEMPTS;
  await db.execute(sql`
    update video_transcodes
    set status = ${final ? 'failed' : 'queued'}, error = ${error.slice(0, 1000)}, leased_until = null,
        updated_at = now(), finished_at = case when ${final} then now() else null end
    where id = ${jobId}::uuid
  `);
  if (final && job.kind === 'transcode' && job.lesson_id) await markLessonErrored(env, job.lesson_id, error);
}

/* ── Playback ─────────────────────────────────────────────────────────── */

type HlsToken = { a: string; e: number };

export async function hlsPlaybackUrl(env: Env, assetId: string, ttlSeconds: number): Promise<string> {
  requireR2(env);
  const e = Math.floor(Date.now() / 1000) + Math.max(ttlSeconds, HLS_PLAYBACK_TTL);
  const token = await signToken(env.R2_SECRET_ACCESS_KEY, HLS_LABEL, { a: assetId, e });
  return `${env.PUBLIC_API_URL.replace(/\/$/, '')}/v1/media/hls/${token}/master.m3u8`;
}

/** Which files under a token are playlists we serve. Everything else is refused. */
const PLAYLIST = /^(?:master|[a-z0-9_-]{1,20}\/index)\.m3u8$/;

/**
 * Rewrites every media URI in a playlist with `resolve`.
 *
 * Variant playlists (`720p/index.m3u8`) stay relative, so the player asks us
 * for them through the same signed path; segments, keys and init sections
 * become absolute presigned R2 URLs.
 */
export async function rewritePlaylist(
  text: string,
  resolve: (relative: string) => Promise<string>,
): Promise<string> {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
    } else if (trimmed.startsWith('#')) {
      // URI="…" attributes: EXT-X-MAP (fMP4 init), EXT-X-KEY, EXT-X-MEDIA.
      const m = /URI="([^"]+)"/.exec(trimmed);
      if (m && m[1] && !/\.m3u8$/i.test(m[1]) && !/^[a-z]+:/i.test(m[1])) {
        out.push(trimmed.replace(m[0], `URI="${await resolve(m[1])}"`));
      } else {
        out.push(trimmed);
      }
    } else if (/\.m3u8$/i.test(trimmed) || /^[a-z]+:/i.test(trimmed)) {
      out.push(trimmed);
    } else {
      out.push(await resolve(trimmed));
    }
  }
  return out.join('\n');
}

/** Segment links outlive the playlist by a margin, and are cached per isolate. */
const SEGMENT_TTL = 8 * 60 * 60;
const playlistCache = new Map<string, { text: string; until: number }>();

/** Joins `720p/index.m3u8` + `seg00001.ts` → `720p/seg00001.ts`, refusing `..`. */
export function joinKey(base: string, relative: string): string | null {
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  const parts = `${dir}${relative}`.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) return null;
  return parts.join('/');
}

export async function servePlaylist(env: Env, token: string, file: string): Promise<Response> {
  const claim = await verifyToken<HlsToken>(env.R2_SECRET_ACCESS_KEY, HLS_LABEL, token);
  if (!claim || !/^[0-9a-f-]{36}$/.test(claim.a)) return new Response('This link has expired', { status: 403 });

  const headers = {
    'content-type': 'application/vnd.apple.mpegurl',
    'cache-control': 'private, max-age=300',
    'access-control-allow-origin': '*',
  };

  if (file === 'poster.jpg') {
    const url = await presign(env, `hls/${claim.a}/poster.jpg`, { ttlSeconds: 3600 });
    return Response.redirect(url, 302);
  }
  if (!PLAYLIST.test(file)) return new Response('Not found', { status: 404 });

  const cacheKey = `${claim.a}/${file}`;
  const hit = playlistCache.get(cacheKey);
  if (hit && hit.until > Date.now()) return new Response(hit.text, { headers });

  const raw = await getText(env, `hls/${claim.a}/${file}`);
  if (raw === null) return new Response('Not found', { status: 404 });

  const text = await rewritePlaylist(raw, async (relative) => {
    const key = joinKey(file, relative);
    if (!key) return relative;
    return presign(env, `hls/${claim.a}/${key}`, { ttlSeconds: SEGMENT_TTL });
  });
  // Cached for an hour: every URL inside is good for eight, so a cached copy
  // is always handed out with at least seven hours left on it.
  if (playlistCache.size > 500) playlistCache.clear();
  playlistCache.set(cacheKey, { text, until: Date.now() + 3600_000 });
  return new Response(text, { headers });
}
