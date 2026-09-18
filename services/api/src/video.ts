import { eq, sql } from 'drizzle-orm';
import { lessons, webhookEvents, withUser } from '@ipc/db';
import type { AdminLesson, AttachVideo, UploadTicket } from '@ipc/contracts';
import type { Env } from './env.ts';
import { HttpError } from './lib/problem.ts';
import { createStorage } from './lib/storage.ts';
import { supabaseConfigured } from './lib/supabase.ts';
import { createVideoProvider } from './lib/video-provider.ts';
import { getDb } from './repo.ts';

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

  if (direct && !input.key.startsWith(`lessons/${lessonId}/`)) {
    // The key came from the client, so it is not trusted. Without this check
    // an admin could point one lesson at another's asset.
    throw new HttpError(400, 'That key does not belong to this lesson');
  }

  return withUser(db, userId, async (tx) => {
    if (!direct) {
      // With a provider the asset id was recorded when the upload was created.
      // Accepting a different one from the browser would undo that.
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
        videoAssetId: input.key,
        videoStatus: direct ? 'ready' : 'processing',
        videoReadyAt: direct ? new Date() : null,
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

  if (lesson.assetId && lesson.provider && lesson.provider !== 'none') {
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
): Promise<{ url: string; kind: 'hls' | 'mp4' }> {
  if (env.VIDEO_PROVIDER === 'none') {
    return { url: await createStorage(env).signedDownloadUrl(assetId, ttlSeconds), kind: 'mp4' };
  }
  return createVideoProvider(env).playback(assetId, ttlSeconds);
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
