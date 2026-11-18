import { eq, sql } from 'drizzle-orm';
import { lessons, webhookEvents, withUser } from '@ipc/db';
import type { AdminLesson, AttachVideo, UploadTicket } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { createStorage } from './lib/storage.ts';
import { supabaseConfigured } from './lib/supabase.ts';
import { createVideoProvider, youtubeId } from './lib/video-provider.ts';
import { fileInfo, mediaUrl } from './lib/google-drive.ts';
import { getDb } from './repo.ts';
import { forgetR2Video, hlsPlaybackUrl } from './r2-video.ts';

/**
 * Video upload and lifecycle, from the studio's side.
 *
 * The file never passes through this process. The API asks the provider (or
 * storage) for a one-off upload target, the browser sends the file straight
 * there, and then tells us the handle. A 2GB lecture through a Worker or a
 * 512MB container is an outage; this way the API only ever handles kilobytes.
 *
 * Who decides a video is playable depends on the provider:
 *
 *   - `none` — the file is playable the moment the upload finishes, so
 *     `attachVideo` sets `ready` itself.
 *   - a real provider — "uploaded" and "playable" are minutes apart, and only
 *     the provider knows when the second one arrives. `attachVideo` sets
 *     `processing`; the **webhook** promotes it, with `video.poll` as a
 *     fallback for the webhook that never came.
 */

const UPLOAD_TTL_SECONDS = 2 * 60 * 60;

/** Six hours: a long lecture, paused for lunch, still plays when they come back. */
const DRIVE_PLAYBACK_TTL = 6 * 60 * 60;

/** Keeps a member's original filename out of the object key. */
function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{2,5})$/i.exec(filename.trim());
  const ext = match?.[1]?.toLowerCase();
  return ext && ['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext) ? ext : 'mp4';
}

function requireDb(env: Env) {
  const db = getDb(env);
  if (!db) throw new HttpError(503, 'Uploads need a database', 'Set DATABASE_URL to use the studio.');
  return db;
}

export async function createUploadTicket(
  env: Env,
  userId: string,
  lessonId: string,
  filename: string,
): Promise<UploadTicket> {
  const db = requireDb(env);

  // RLS decides whether this caller may touch the lesson at all. Minting an
  // upload target for a lesson they cannot edit would hand them write access
  // to the library, so ownership is checked before anything is signed.
  await withUser(db, userId, async (tx) => {
    const [row] = await tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, lessonId)).limit(1);
    if (!row) throw new HttpError(404, 'Lesson not found');
    return row;
  });

  if (env.VIDEO_PROVIDER === 'none') {
    if (!supabaseConfigured(env)) {
      throw new HttpError(
        503,
        'Storage is not configured',
        'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or configure a video provider.',
      );
    }
    // A fresh key per attempt: re-uploading never overwrites an asset a member
    // might be watching right now.
    const key = `lessons/${lessonId}/${Date.now()}.${extensionOf(filename)}`;
    const { url, token } = await createStorage(env).signedUploadUrl(key);

    await withUser(db, userId, (tx) =>
      tx.update(lessons).set({ videoStatus: 'uploading', videoError: null }).where(eq(lessons.id, lessonId)),
    );

    return {
      key,
      url,
      token,
      method: 'PUT',
      headers: {},
      provider: 'none',
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    };
  }

  const provider = createVideoProvider(env);
  const upload = await provider.createDirectUpload(lessonId, filename, env.VIDEO_MAX_SECONDS);

  // The asset id is recorded *before* the upload starts, not after. If the
  // browser dies mid-upload we still know what was created, which is what
  // makes the orphan sweep possible at all.
  await withUser(db, userId, (tx) =>
    tx
      .update(lessons)
      .set({
        videoProvider: provider.name,
        videoAssetId: upload.assetId,
        videoUploadId: upload.uploadId,
        videoStatus: 'uploading',
        videoError: null,
      })
      .where(eq(lessons.id, lessonId)),
  );

  return {
    key: upload.assetId,
    url: upload.uploadUrl,
    token: '',
    method: upload.method,
    headers: upload.headers,
    provider: provider.name,
    expiresAt: upload.expiresAt,
  };
}

/**
 * Called by the browser once the upload finished.
 *
 * With a provider this only moves the lesson to `processing` — the provider's
 * webhook is what says `ready`, because only it knows when the renditions
 * exist. Trusting the browser here would mean publishing a lesson whose video
 * is still a spinning progress bar on someone else's screen.
 */
export async function attachVideo(
  env: Env,
  userId: string,
  lessonId: string,
  input: AttachVideo,
): Promise<AdminLesson> {
  const db = requireDb(env);
  const direct = env.VIDEO_PROVIDER === 'none';
  const isYouTube = env.VIDEO_PROVIDER === 'youtube';

  // With YouTube there was no upload, so there is no asset id waiting to be
  // matched — the author pasted a link. Normalise it to the 11-character id
  // here, once, so nothing downstream has to know about URL shapes.
  let assetId = input.key;
  if (isYouTube) {
    const id = youtubeId(input.key);
    if (!id) {
      throw new HttpError(
        422,
        'That does not look like a YouTube link',
        'Paste the address from the browser, or the share link — youtube.com/watch?v=…, youtu.be/…, or the 11-character id.',
      );
    }
    assetId = id;
  }

  if (direct && /^https?:\/\//i.test(input.key.trim())) {
    /* A pasted link with no provider configured.
       This used to fall through to the key-ownership check below and come back
       as "That key does not belong to this lesson", which sends whoever reads
       it looking for a permissions problem that does not exist. The real
       answer is that the deployment has `VIDEO_PROVIDER=none`, and no message
       in the studio said so. */
    throw new HttpError(
      409,
      'No video provider is configured',
      'This deployment has VIDEO_PROVIDER=none, so a pasted link cannot be attached. Set it to youtube, cloudflare or bunny and deploy.',
    );
  }

  if (direct && !input.key.startsWith(`lessons/${lessonId}/`)) {
    // The key came from the client, so it is not trusted. Without this check
    // an admin could point one lesson at another's asset.
    throw new HttpError(400, 'That key does not belong to this lesson');
  }

  return withUser(db, userId, async (tx) => {
    if (!direct && !isYouTube) {
      // With an uploading provider the asset id was recorded when the upload
      // was created. Accepting a different one from the browser would undo
      // that. YouTube has no such record, because there was no upload.
      const [existing] = await tx
        .select({ assetId: lessons.videoAssetId })
        .from(lessons)
        .where(eq(lessons.id, lessonId))
        .limit(1);
      if (!existing) throw new HttpError(404, 'Lesson not found');
      if (existing.assetId !== input.key) {
        throw new HttpError(409, 'That is not the asset this lesson is waiting on', 'Start the upload again.');
      }
    }

    const [row] = await tx
      .update(lessons)
      .set({
        videoProvider: env.VIDEO_PROVIDER,
        videoAssetId: assetId,
        // A YouTube video is playable the instant the link is pasted — there
        // is no transcode to wait on and no webhook that will ever arrive.
        videoStatus: direct || isYouTube ? 'ready' : 'processing',
        videoReadyAt: direct || isYouTube ? new Date() : null,
        videoError: null,
        ...(input.durationSeconds
          ? { durationSeconds: input.durationSeconds, videoDurationSource: 'browser' }
          : {}),
      })
      .where(eq(lessons.id, lessonId))
      .returning();
    if (!row) throw new HttpError(404, 'Lesson not found');

    return toAdminLesson(row);
  });
}

/** Detaching also deletes the provider's copy — storage orphans are swept. */
export async function detachVideo(env: Env, userId: string, lessonId: string): Promise<void> {
  const db = requireDb(env);

  const [lesson] = await withUser(db, userId, (tx) =>
    tx
      .select({ assetId: lessons.videoAssetId, provider: lessons.videoProvider })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1),
  );
  if (!lesson) throw new HttpError(404, 'Lesson not found');

  // Not for Drive. The file there is the club's own copy — often a recording
  // that predates the course — and taking a video off a lesson must never be
  // the click that deletes it.
  if (lesson.assetId && lesson.provider === 'r2') {
    // Thousands of segments: the VPS deletes them, from the same queue it
    // transcodes from, rather than this request.
    await forgetR2Video(env, lesson.assetId, lessonId);
  } else if (lesson.assetId && lesson.provider && lesson.provider !== 'none' && lesson.provider !== 'drive') {
    // Best effort: a provider that is briefly down must not stop an admin
    // replacing a wrong video. The orphan costs storage, not correctness.
    try {
      await createVideoProvider(env).remove(lesson.assetId);
    } catch (error) {
      console.warn(JSON.stringify({ detachVideo: lessonId, providerDeleteFailed: String(error) }));
    }
  }

  await withUser(db, userId, (tx) =>
    tx
      .update(lessons)
      .set({
        videoProvider: null,
        videoAssetId: null,
        videoUploadId: null,
        videoStatus: 'none',
        videoReadyAt: null,
        videoError: null,
      })
      .where(eq(lessons.id, lessonId)),
  );
}

/**
 * Applies a verified provider webhook.
 *
 * Recorded in `webhook_events` first, by provider event id. Providers retry
 * for days and deliver out of order; a replay has to be free to ignore.
 * Runs under the service role because there is no user in a webhook.
 */
export async function applyVideoWebhook(env: Env, rawBody: string, headers: Headers): Promise<'ok' | 'ignored'> {
  const db = requireDb(env);
  const event = await createVideoProvider(env).verifyWebhook(rawBody, headers);
  if (!event) return 'ignored';

  const inserted = await db
    .insert(webhookEvents)
    .values({
      provider: `video.${env.VIDEO_PROVIDER}`,
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.payload,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });

  // Already seen: the provider is retrying something we handled.
  if (inserted.length === 0) return 'ok';

  await db
    .update(lessons)
    .set({
      videoStatus: event.state.status,
      videoError: event.state.error ?? null,
      videoReadyAt: event.state.status === 'ready' ? new Date() : null,
      ...(event.state.durationSeconds
        ? { durationSeconds: event.state.durationSeconds, videoDurationSource: 'provider' }
        : {}),
    })
    .where(eq(lessons.videoAssetId, event.assetId));

  await db
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(webhookEvents.id, inserted[0]!.id));

  return 'ok';
}

/**
 * Mints a playback source for a lesson whose entitlement has already been
 * checked. Never called directly by a route — `lessons.ts` owns that gate.
 */
export async function playbackFor(
  env: Env,
  assetId: string,
  ttlSeconds: number,
  lessonProvider?: string | null,
): Promise<{ url: string; kind: 'hls' | 'mp4' | 'youtube' }> {
  // Per lesson, not per deployment: a course can mix YouTube lessons with
  // private recordings kept in the club Drive.
  if (lessonProvider === 'drive') {
    // Longer than other tickets. A <video> keeps using the same URL for every
    // Range request while it plays, so the link has to outlive a long lecture
    // with a pause in the middle — not just the first second of it.
    return { url: await mediaUrl(env, assetId, { ttlSeconds: Math.max(ttlSeconds, DRIVE_PLAYBACK_TTL) }), kind: 'mp4' };
  }
  if (lessonProvider === 'youtube') return { url: assetId, kind: 'youtube' };
  if (lessonProvider === 'r2') return { url: await hlsPlaybackUrl(env, assetId, ttlSeconds), kind: 'hls' };
  if (env.VIDEO_PROVIDER === 'none') {
    return { url: await createStorage(env).signedDownloadUrl(assetId, ttlSeconds), kind: 'mp4' };
  }
  return createVideoProvider(env).playback(assetId, ttlSeconds);
}

/**
 * Puts a Drive file on a lesson — one just uploaded, or one picked from the
 * club Drive. Either way the file is checked with Drive first: that it exists,
 * that the app may reach it, and that it is a video. The duration comes from
 * Drive when it has worked it out; otherwise the first viewer's browser
 * reports it, as with YouTube.
 */
export async function attachDriveVideo(
  env: Env,
  userId: string,
  lessonId: string,
  input: { fileId: string; durationSeconds?: number },
): Promise<AdminLesson> {
  const db = requireDb(env);
  const file = await fileInfo(env, input.fileId);
  if (!file.mimeType.startsWith('video/')) {
    throw new HttpError(422, 'That file is not a video', `Drive says it is ${file.mimeType}. Choose an MP4 or similar.`);
  }
  const duration = file.durationSeconds ?? input.durationSeconds ?? null;

  return withUser(db, userId, async (tx) => {
    const [row] = await tx
      .update(lessons)
      .set({
        videoProvider: 'drive',
        videoAssetId: file.id,
        videoUploadId: null,
        // Drive serves the original file, so there is nothing to wait for.
        videoStatus: 'ready',
        videoReadyAt: new Date(),
        videoError: null,
        ...(duration ? { durationSeconds: duration, videoDurationSource: 'provider' } : {}),
      })
      .where(eq(lessons.id, lessonId))
      .returning();
    if (!row) throw new HttpError(404, 'Lesson not found');
    return toAdminLesson(row);
  });
}

const toAdminLesson = (row: typeof lessons.$inferSelect): AdminLesson => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  durationSeconds: row.durationSeconds,
  isPreview: row.isPreview,
  rank: Number(row.rank),
  videoStatus: row.videoStatus,
  videoAssetId: row.videoAssetId,
  videoError: row.videoError,
  videoProvider: row.videoProvider ?? null,
  videoProgress: null,
  bodyMd: row.summaryMd ?? null,
});

/** Counts lessons still waiting, so the studio can show a live badge. */
export async function pendingVideoCount(env: Env, userId: string): Promise<number> {
  const db = requireDb(env);
  const [row] = await withUser(db, userId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)` })
      .from(lessons)
      .where(sql`${lessons.videoStatus} in ('uploading', 'processing')`),
  );
  return Number(row?.n ?? 0);
}
